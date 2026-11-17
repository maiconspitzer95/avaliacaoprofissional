import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../database/pool.js";
import { positiveId, fail } from "../utils/validation.js";
import { isHR, validateAnswers } from "../services/evaluation-policy.js";
import {
  participant,
  result,
  evaluationLock,
  revokeResult,
} from "../services/evaluations.js";
import { releaseReadiness } from "../services/release-policy.js";
import { audit } from "../services/audit.js";
export const contestations = Router();
const write = (fn) =>
  transaction(async (c) => {
    await evaluationLock(c);
    return fn(c);
  });
const reason = z.string().trim().min(10).max(5000);
function hr(req) {
  if (!isHR(req.user)) fail(403, "Operação restrita ao RH.");
}
async function log(c, req, id, event, details) {
  await c.query(
    "INSERT INTO ad.evaluation_contestation_history(contestation_id,user_id,event,details) VALUES($1,$2,$3,$4)",
    [id, req.user.id, event, JSON.stringify(details)],
  );
  await audit(
    c,
    req.user,
    "contestation." + event,
    "evaluation_contestations",
    id,
    details,
  );
}
contestations.get("/release", async (req, res) => {
  hr(req);
  const ids = (
    await pool.query(
      "SELECT id FROM ad.cycle_participants ORDER BY cycle_id DESC,id",
    )
  ).rows;
  const rows = [];
  for (const { id } of ids) {
    const p = await participant(pool, id),
      r = await releaseReadiness(pool, p);
    const plan = (
      await pool.query(
        "SELECT status FROM ad.development_plans WHERE participant_id=$1",
        [id],
      )
    ).rows[0];
    rows.push({
      id,
      employee_name: p.employee_name,
      cycle_name: p.cycle_name,
      released: p.released,
      feedback_access: p.feedback_access,
      plan_status: plan?.status || "not_started",
      ...r,
    });
  }
  res.json(rows);
});
contestations.post("/participants/:id/access", async (req, res) => {
  hr(req);
  const v = z.object({ allow: z.boolean(), reason }).parse(req.body);
  await write(async (c) => {
    const p = await participant(c, positiveId(req.params.id));
    if (v.allow) await result(c, p);
    await c.query(
      "UPDATE ad.cycle_participants SET feedback_access=$1 WHERE id=$2",
      [v.allow, p.id],
    );
    await audit(
      c,
      req.user,
      "evaluation.feedback_access",
      "cycle_participants",
      p.id,
      v,
    );
  });
  res.json({ ok: true });
});
contestations.get("/", async (req, res) => {
  const rows = (
    await pool.query(
      `SELECT x.*,p.employee_id,e.name employee_name,cy.name cycle_name,r.assignment_id,r.completed_at revision_completed_at,a.evaluator_id FROM ad.evaluation_contestations x JOIN ad.cycle_participants p ON p.id=x.participant_id JOIN ad.employees e ON e.id=p.employee_id JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id LEFT JOIN ad.evaluation_contestation_revisions r ON r.contestation_id=x.id LEFT JOIN ad.evaluation_assignments a ON a.id=r.assignment_id WHERE $1 OR p.employee_id=$2 OR a.evaluator_id=$3 ORDER BY x.id DESC`,
      [isHR(req.user), req.user.employee_id, req.user.id],
    )
  ).rows;
  res.json(rows);
});
contestations.get("/:id", async (req, res) => {
  const x = (
    await pool.query(
      "SELECT x.*,p.employee_id FROM ad.evaluation_contestations x JOIN ad.cycle_participants p ON p.id=x.participant_id WHERE x.id=$1",
      [positiveId(req.params.id)],
    )
  ).rows[0];
  if (!x) fail(404, "Contestação não encontrada.");
  if (!isHR(req.user) && x.employee_id !== req.user.employee_id)
    fail(403, "Sem acesso.");
  res.json({
    contestation: x,
    history: (
      await pool.query(
        "SELECT * FROM ad.evaluation_contestation_history WHERE contestation_id=$1 ORDER BY id",
        [x.id],
      )
    ).rows,
  });
});
contestations.get("/:id/revision", async (req, res) => {
  const x = (
    await pool.query(
      "SELECT r.*,a.evaluator_id,a.status assignment_status FROM ad.evaluation_contestation_revisions r JOIN ad.evaluation_assignments a ON a.id=r.assignment_id WHERE r.contestation_id=$1",
      [positiveId(req.params.id)],
    )
  ).rows[0];
  if (!x) fail(404, "Revisão não encontrada.");
  if (!isHR(req.user) && x.evaluator_id !== req.user.id)
    fail(403, "Sem acesso à avaliação individual.");
  const a = (
    await pool.query(
      "SELECT a.*,coalesce(r.answers,'{}'::jsonb) answers FROM ad.evaluation_assignments a LEFT JOIN LATERAL(SELECT answers FROM ad.evaluation_responses WHERE assignment_id=a.id ORDER BY revision DESC LIMIT 1) r ON true WHERE a.id=$1",
      [x.assignment_id],
    )
  ).rows[0];
  const p = await participant(pool, a.participant_id);
  res.json({ revision: x, assignment: a, questionnaire: p.snapshot });
});
contestations.post("/:id/authorize", async (req, res) => {
  hr(req);
  const v = z
    .object({ assignment_id: z.number().int().positive(), reason })
    .parse(req.body);
  await write(async (c) => {
    const x = (
      await c.query(
        "SELECT * FROM ad.evaluation_contestations WHERE id=$1 FOR UPDATE",
        [positiveId(req.params.id)],
      )
    ).rows[0];
    if (!x || x.status !== "in_review")
      fail(409, "Contestação não está em análise.");
    const a = (
      await c.query(
        "SELECT * FROM ad.evaluation_assignments WHERE id=$1 AND participant_id=$2 AND kind='manager' AND status='submitted' AND NOT review_needed",
        [v.assignment_id, x.participant_id],
      )
    ).rows[0];
    if (!a) fail(400, "Selecione uma avaliação concluída e ativa deste ciclo.");
    await c.query(
      "INSERT INTO ad.evaluation_contestation_revisions(contestation_id,assignment_id,authorized_by,justification) VALUES($1,$2,$3,$4)",
      [x.id, a.id, req.user.id, v.reason],
    );
    await c.query(
      "UPDATE ad.evaluation_contestations SET status='approved',analyst_id=$1,decision='authorize_revision',decision_reason=$2,updated_at=now() WHERE id=$3",
      [req.user.id, v.reason, x.id],
    );
    await log(c, req, x.id, "revision_authorized", {
      assignment_id: a.id,
      reason: v.reason,
    });
  });
  res.json({ ok: true });
});
contestations.post("/:id/revision", async (req, res) => {
  const v = z
    .object({
      version: z.number().int().nonnegative(),
      answers: z.record(z.string(), z.number().int().min(1).max(5)),
      reason,
    })
    .parse(req.body);
  await write(async (c) => {
    const x = (
      await c.query(
        "SELECT r.*,a.evaluator_id,a.participant_id,a.version,a.status,a.review_needed FROM ad.evaluation_contestation_revisions r JOIN ad.evaluation_assignments a ON a.id=r.assignment_id WHERE r.contestation_id=$1 FOR UPDATE OF r,a",
        [positiveId(req.params.id)],
      )
    ).rows[0];
    if (!x || x.completed_at) fail(409, "Revisão indisponível.");
    if (x.evaluator_id !== req.user.id)
      fail(403, "Somente o avaliador original pode revisar suas respostas.");
    if (x.version !== v.version || x.status !== "submitted" || x.review_needed)
      fail(409, "Avaliação alterada; recarregue.");
    const p = await participant(c, x.participant_id);
    validateAnswers(p.snapshot, v.answers, true);
    const revision = x.version + 1;
    await c.query(
      "INSERT INTO ad.evaluation_responses(assignment_id,revision,answers,submitted,author_id) VALUES($1,$2,$3,true,$4)",
      [x.assignment_id, revision, JSON.stringify(v.answers), req.user.id],
    );
    await c.query(
      "UPDATE ad.evaluation_assignments SET version=$1,submitted_at=now() WHERE id=$2",
      [revision, x.assignment_id],
    );
    await c.query(
      "UPDATE ad.evaluation_contestation_revisions SET completed_by=$1,completed_at=now(),response_revision=$2 WHERE id=$3",
      [req.user.id, revision, x.id],
    );
    await log(c, req, x.contestation_id, "revision_completed", {
      assignment_id: x.assignment_id,
      revision,
      reason: v.reason,
    });
  });
  res.json({ ok: true });
});
contestations.post("/", async (req, res) => {
  const v = z
    .object({
      participant_id: z.number().int().positive(),
      justification: reason,
    })
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const p = await participant(c, v.participant_id);
      if (p.employee_id !== req.user.employee_id)
        fail(403, "Somente o funcionário pode contestar seu resultado.");
      if (!p.feedback_access && !p.released)
        fail(403, "Resultado indisponível.");
      await result(c, p);
      const x = (
        await c.query(
          "INSERT INTO ad.evaluation_contestations(participant_id,requested_by,justification) VALUES($1,$2,$3) RETURNING *",
          [p.id, req.user.id, v.justification],
        )
      ).rows[0];
      await revokeResult(
        c,
        p,
        req.user,
        "Contestação aberta: " + v.justification,
      );
      await log(c, req, x.id, "opened", { justification: v.justification });
      return x;
    }),
  );
});
contestations.post("/:id/transition", async (req, res) => {
  const v = z
    .object({
      action: z.enum([
        "analyze",
        "return",
        "resubmit",
        "approve",
        "reject",
        "complete",
      ]),
      reason,
    })
    .parse(req.body);
  await write(async (c) => {
    const x = (
      await c.query(
        "SELECT * FROM ad.evaluation_contestations WHERE id=$1 FOR UPDATE",
        [positiveId(req.params.id)],
      )
    ).rows[0];
    if (!x) fail(404, "Contestação não encontrada.");
    const p = await participant(c, x.participant_id);
    let status,
      decision = x.decision;
    if (v.action === "resubmit") {
      if (req.user.employee_id !== p.employee_id || x.status !== "returned")
        fail(403, "Ajuste indisponível.");
      status = "pending";
    } else {
      hr(req);
      const allowed = {
        analyze: ["pending"],
        return: ["in_review"],
        approve: ["in_review"],
        reject: ["in_review"],
        complete: ["approved", "rejected"],
      };
      if (!allowed[v.action].includes(x.status))
        fail(409, "Transição indisponível.");
      status = {
        analyze: "in_review",
        return: "returned",
        approve: "approved",
        reject: "rejected",
        complete: "completed",
      }[v.action];
      if (v.action === "approve")
        fail(400, "Use a autorização de revisão com a avaliação identificada.");
      if (v.action === "reject") decision = "maintain";
      if (
        v.action === "complete" &&
        decision === "authorize_revision" &&
        !(
          await c.query(
            "SELECT 1 FROM ad.evaluation_contestation_revisions WHERE contestation_id=$1 AND completed_at IS NOT NULL",
            [x.id],
          )
        ).rowCount
      )
        fail(
          409,
          "A revisão autorizada precisa ser concluída antes do encerramento.",
        );
    }
    await c.query(
      "UPDATE ad.evaluation_contestations SET status=$1,analyst_id=CASE WHEN $2 THEN $3 ELSE analyst_id END,decision=$4,decision_reason=CASE WHEN $5 THEN $6 ELSE decision_reason END,updated_at=now() WHERE id=$7",
      [
        status,
        isHR(req.user),
        req.user.id,
        decision,
        ["approve", "reject"].includes(v.action),
        v.reason,
        x.id,
      ],
    );
    await log(c, req, x.id, v.action, { reason: v.reason, status });
  });
  res.json({ ok: true });
});
