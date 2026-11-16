import { pool } from "../database/pool.js";
import { audit } from "./audit.js";
import { fail } from "../utils/validation.js";
import { consolidate } from "./evaluation-calculation.js";
import { transferPlan } from "./evaluation-policy.js";
export async function evaluationLock(c) {
  await c.query("SELECT pg_advisory_xact_lock(5005003)");
}
export async function participant(c, id) {
  const p = (
    await c.query(
      `SELECT p.*,e.name employee_name,q.snapshot,cy.status cycle_status,cy.opens_on::text,cy.deadline::text,cy.role_weights,cy.divergence_limit,cy.name cycle_name FROM ad.cycle_participants p JOIN ad.employees e ON e.id=p.employee_id JOIN ad.questionnaire_versions q ON q.id=p.questionnaire_version_id JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id WHERE p.id=$1`,
      [id],
    )
  ).rows[0];
  if (!p) fail(404, "Participante não encontrado.");
  return p;
}
export async function assignments(c, id) {
  return (
    await c.query(
      `SELECT a.*,coalesce(e.name,u.username) evaluator_name,coalesce(r.answers,'{}'::jsonb) answers FROM ad.evaluation_assignments a JOIN ad.users u ON u.id=a.evaluator_id LEFT JOIN ad.employees e ON e.id=u.employee_id LEFT JOIN LATERAL(SELECT answers FROM ad.evaluation_responses WHERE assignment_id=a.id ORDER BY revision DESC LIMIT 1) r ON true WHERE a.participant_id=$1 ORDER BY a.id`,
      [id],
    )
  ).rows;
}
export async function result(c, p) {
  if (
    (
      await c.query(
        "SELECT 1 FROM ad.evaluation_transfers WHERE participant_id=$1 AND decision IS NULL LIMIT 1",
        [p.id],
      )
    ).rowCount
  )
    fail(409, "Há decisões de validade pendentes do RH.");
  try {
    return consolidate(
      p.snapshot,
      await assignments(c, p.id),
      p.divergence_limit,
    );
  } catch (e) {
    fail(409, e.message);
  }
}
export async function revokeResult(c, p, user, reason) {
  if (!p.released) return;
  await c.query(
    "UPDATE ad.cycle_participants SET released=false,released_at=null WHERE id=$1",
    [p.id],
  );
  await c.query(
    "INSERT INTO ad.evaluation_result_releases(participant_id,released,reason,user_id) VALUES($1,false,$2,$3)",
    [p.id, reason, user.id],
  );
  await audit(
    c,
    user,
    "evaluation.release_revoked",
    "cycle_participants",
    p.id,
    { reason },
  );
}
export async function newAssignment(
  c,
  p,
  evaluatorId,
  profile,
  kind,
  user,
  predecessor = null,
) {
  const u = (
    await c.query("SELECT * FROM ad.users WHERE id=$1 AND active", [
      evaluatorId,
    ])
  ).rows[0];
  if (!u) fail(400, "Avaliador inexistente ou inativo.");
  if (
    kind === "manager" &&
    (!["gerente", "gestor", "rh", "master"].includes(u.role_id) ||
      u.employee_id === p.employee_id)
  )
    fail(
      400,
      "Avaliador deve ser responsável habilitado e diferente do avaliado.",
    );
  const weight = kind === "self" ? "1" : p.role_weights[profile];
  if (!weight) fail(400, "Perfil sem peso configurado no ciclo.");
  const a = (
    await c.query(
      "INSERT INTO ad.evaluation_assignments(participant_id,evaluator_id,profile,kind,weight,predecessor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [p.id, evaluatorId, profile, kind, weight, predecessor],
    )
  ).rows[0];
  await audit(c, user, "evaluation.assign", "evaluation_assignments", a.id, {
    participant: p.id,
    evaluator: evaluatorId,
    profile,
    kind,
  });
  return a;
}
export async function transferAssignment(c, p, a, nextId, user, reason) {
  if (a.review_needed)
    fail(
      409,
      "Decida a validade das respostas da transferência anterior antes de substituir novamente.",
    );
  if (a.kind !== "manager" || a.status === "superseded")
    fail(400, "Somente avaliações ativas de gestores podem ser transferidas.");
  const rows = await assignments(c, p.id);
  const existing = rows.find(
    (x) =>
      x.evaluator_id === nextId &&
      x.kind === "manager" &&
      x.status !== "superseded" &&
      x.id !== a.id,
  );
  if (nextId === a.evaluator_id) fail(400, "Informe um responsável diferente.");
  await revokeResult(c, p, user, "Mudança de avaliador: " + reason);
  const last = rows.find((x) => x.id === a.id);
  const plan = transferPlan(a, Object.keys(last.answers).length > 0);
  let target = a;
  if (plan.replace) {
    await c.query(
      "UPDATE ad.evaluation_assignments SET status='superseded',review_needed=false WHERE id=$1",
      [a.id],
    );
    if (existing) {
      if (plan.carry) {
        await c.query(
          "UPDATE ad.evaluation_assignments SET review_needed=true WHERE id=$1",
          [a.id],
        );
      }
      // Preserve the destination evaluation; the RH decision applies to the archived source.
      target = a;
    } else {
      target = await newAssignment(
        c,
        p,
        nextId,
        a.profile,
        "manager",
        user,
        a.id,
      );
      if (plan.carry) {
        await c.query(
          "INSERT INTO ad.evaluation_responses(assignment_id,revision,answers,author_id) VALUES($1,1,$2,$3)",
          [target.id, JSON.stringify(last.answers), user.id],
        );
        await c.query(
          "UPDATE ad.evaluation_assignments SET version=1,review_needed=true WHERE id=$1",
          [target.id],
        );
      }
    }
  } else
    await c.query(
      "UPDATE ad.evaluation_assignments SET review_needed=true WHERE id=$1",
      [a.id],
    );
  const t = (
    await c.query(
      "INSERT INTO ad.evaluation_transfers(participant_id,assignment_id,previous_evaluator_id,next_evaluator_id,reason,created_by,decision) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [
        p.id,
        target.id,
        a.evaluator_id,
        nextId,
        reason,
        user.id,
        plan.review ? null : "accept",
      ],
    )
  ).rows[0];
  await audit(c, user, "evaluation.transfer", "evaluation_transfers", t.id, {
    from: a.evaluator_id,
    to: nextId,
    assignment: a.id,
    reason,
  });
}
export async function reviewTransfer(c, transferId, decision, reason, user) {
  const t = (
    await c.query("SELECT * FROM ad.evaluation_transfers WHERE id=$1", [
      transferId,
    ])
  ).rows[0];
  if (!t || t.decision) fail(409, "Transferência inexistente ou já decidida.");
  const p = await participant(c, t.participant_id);
  const a = (await assignments(c, p.id)).find((a) => a.id === t.assignment_id);
  if (!a) fail(404, "Avaliação não encontrada.");
  if (decision === "discard") {
    if (p.cycle_status === "closed")
      fail(
        409,
        "Não é possível criar respostas pendentes em um ciclo encerrado.",
      );
    if (a.status === "submitted") {
      await c.query(
        "UPDATE ad.evaluation_assignments SET status='superseded',review_needed=false WHERE id=$1",
        [a.id],
      );
      const other = (await assignments(c, p.id)).find(
        (x) =>
          x.evaluator_id === t.next_evaluator_id &&
          x.kind === "manager" &&
          x.status !== "superseded",
      );
      if (!other)
        await newAssignment(
          c,
          p,
          t.next_evaluator_id,
          a.profile,
          "manager",
          user,
          a.id,
        );
    } else if (a.status === "pending") {
      const revision = a.version + 1;
      await c.query(
        "INSERT INTO ad.evaluation_responses(assignment_id,revision,answers,author_id) VALUES($1,$2,'{}',$3)",
        [a.id, revision, user.id],
      );
      await c.query(
        "UPDATE ad.evaluation_assignments SET version=$1 WHERE id=$2",
        [revision, a.id],
      );
    }
  }
  await c.query(
    "UPDATE ad.evaluation_transfers SET decision=$1,decision_reason=$2,decided_by=$3 WHERE id=$4",
    [decision, reason, user.id, t.id],
  );
  const pending = (
    await c.query(
      "SELECT 1 FROM ad.evaluation_transfers WHERE assignment_id=$1 AND decision IS NULL",
      [a.id],
    )
  ).rowCount;
  await c.query(
    "UPDATE ad.evaluation_assignments SET review_needed=$1 WHERE id=$2",
    [!!pending, a.id],
  );
  await revokeResult(
    c,
    p,
    user,
    "Decisão sobre validade de respostas anteriores",
  );
  await audit(
    c,
    user,
    "evaluation.transfer_decision",
    "evaluation_transfers",
    t.id,
    { decision, reason },
  );
}
export async function syncEmployeeEvaluations(
  c,
  employeeId,
  previous,
  next,
  user,
) {
  const installed = (
    await c.query("SELECT to_regclass('ad.cycle_participants') AS table_name")
  ).rows[0].table_name;
  if (!installed) return;
  await evaluationLock(c);
  const rows = (
    await c.query(
      "SELECT p.id FROM ad.cycle_participants p JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id WHERE p.employee_id=$1 AND cy.status IN ('draft','open')",
      [employeeId],
    )
  ).rows;
  for (const row of rows) {
    let p = await participant(c, row.id);
    await c.query(
      "UPDATE ad.cycle_participants SET responsible_id=$1 WHERE id=$2",
      [next.supervisor_id || next.manager_id, p.id],
    );
    await revokeResult(c, p, user, "Alteração da hierarquia do participante");
    for (const [profile, field] of [
      ["gerente", "manager_id"],
      ["gestor", "supervisor_id"],
    ]) {
      if (previous?.[field] === next[field]) continue;
      const old = (await assignments(c, p.id)).filter(
        (a) =>
          a.kind === "manager" &&
          a.profile === profile &&
          a.status !== "superseded" &&
          a.evaluator_id === previous?.[field],
      );
      if (old.length) {
        if (!next[field])
          fail(
            400,
            "Existe avaliação neste ciclo. Defina o novo responsável ou substitua o avaliador antes de remover o vínculo.",
          );
        for (const a of old) {
          if (next[field])
            await transferAssignment(
              c,
              p,
              a,
              next[field],
              user,
              "Transferência organizacional do funcionário",
            );
        }
      } else if (
        next[field] &&
        !(await assignments(c, p.id)).some(
          (a) =>
            a.kind === "manager" &&
            a.evaluator_id === next[field] &&
            a.status !== "superseded",
        )
      )
        await newAssignment(c, p, next[field], profile, "manager", user);
    }
  }
}
export async function publishQuestionnaire(c, id, user) {
  const q = (
    await c.query(
      "SELECT * FROM ad.questionnaires WHERE id=$1 AND active FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!q) fail(404, "Questionário não encontrado ou inativo.");
  const competencies = (
    await c.query(
      `SELECT c.id,c.code,v.* FROM ad.competencies c JOIN LATERAL(SELECT * FROM ad.competency_versions WHERE competency_id=c.id ORDER BY version DESC LIMIT 1) v ON true WHERE c.active AND (v.position_id IS NULL OR v.position_id=$1) ORDER BY c.code`,
      [q.position_id],
    )
  ).rows;
  const snapshot = [];
  for (const v of competencies) {
    const questions = (
      await c.query(
        `SELECT q.id,v.version,v.prompt,v.scale FROM ad.questions q JOIN LATERAL(SELECT * FROM ad.question_versions WHERE question_id=q.id ORDER BY version DESC LIMIT 1) v ON true WHERE q.competency_id=$1 AND q.active ORDER BY q.id`,
        [v.competency_id],
      )
    ).rows;
    if (!questions.length)
      fail(400, `A competência ${v.code} não possui perguntas ativas.`);
    snapshot.push({
      id: v.competency_id,
      code: v.code,
      name: v.name,
      description: v.description,
      version: v.version,
      weight: v.weight,
      questions,
    });
  }
  if (!snapshot.length)
    fail(400, "Cadastre competências e perguntas aplicáveis ao cargo.");
  const version = (
    await c.query(
      "SELECT coalesce(max(version),0)+1 v FROM ad.questionnaire_versions WHERE questionnaire_id=$1",
      [id],
    )
  ).rows[0].v;
  const r = (
    await c.query(
      "INSERT INTO ad.questionnaire_versions(questionnaire_id,version,snapshot,created_by) VALUES($1,$2,$3,$4) RETURNING *",
      [id, version, JSON.stringify(snapshot), user.id],
    )
  ).rows[0];
  await audit(
    c,
    user,
    "questionnaire.publish",
    "questionnaire_versions",
    r.id,
    { version, competencies: snapshot.length },
  );
  return r;
}
