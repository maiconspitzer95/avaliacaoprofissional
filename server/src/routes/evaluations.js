import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../database/pool.js";
import { positiveId, fail } from "../utils/validation.js";
import { audit } from "../services/audit.js";
import { requireReleaseReady } from '../services/release-policy.js';
import {
  isHR,
  canReadResult,
  canReadIndividual,
  canAnswer,
  validateAnswers,
} from "../services/evaluation-policy.js";
import {
  evaluationLock,
  participant,
  assignments,
  result,
  newAssignment,
  revokeResult,
  transferAssignment,
  reviewTransfer,
  publishQuestionnaire,
} from "../services/evaluations.js";
export const evaluations = Router();
const id = z.coerce.number().int().positive();
const decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (v) => /^\d+(\.\d{1,20})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000,
    "Peso deve ser decimal positivo até 1000",
  );
const reason = z.string().trim().min(10).max(2000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida",
  );
const hr = (req, res, next) => {
  if (!isHR(req.user))
    return next(
      Object.assign(new Error("Operação restrita ao RH."), { status: 403 }),
    );
  next();
};
const write = (fn) =>
  transaction(async (c) => {
    await evaluationLock(c);
    return fn(c);
  });
const compSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(3000),
  category: z.string().trim().min(2).max(100),
  weight: decimal,
  position_id: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    id.nullable(),
  ),
  active: z.boolean(),
});
evaluations.get("/cycles", async (req, res) => {
  const r = await pool.query(
    `SELECT cy.*,cy.reference_start::text,cy.reference_end::text,cy.opens_on::text,cy.deadline::text FROM ad.evaluation_cycles cy WHERE $1 OR EXISTS(SELECT 1 FROM ad.cycle_participants p LEFT JOIN ad.evaluation_assignments a ON a.participant_id=p.id AND a.status<>'superseded' WHERE p.cycle_id=cy.id AND (p.employee_id=$2 OR p.responsible_id=$3 OR a.evaluator_id=$3)) ORDER BY cy.id DESC`,
    [isHR(req.user), req.user.employee_id, req.user.id],
  );
  res.json(r.rows);
});
evaluations.get("/cycles/:id/participants", async (req, res) => {
  const r = await pool.query(
    `SELECT p.*,e.name employee_name,e.re,coalesce(u.username,'—') responsible_name,(SELECT count(*)::int FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND a.status='pending') pending,(SELECT count(*)::int FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND a.review_needed) reviews,(SELECT count(*)::int FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND a.status='submitted') submitted FROM ad.cycle_participants p JOIN ad.employees e ON e.id=p.employee_id LEFT JOIN ad.users u ON u.id=p.responsible_id WHERE p.cycle_id=$1 AND ($2 OR p.employee_id=$3 OR p.responsible_id=$4 OR EXISTS(SELECT 1 FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND a.evaluator_id=$4 AND a.status<>'superseded')) ORDER BY e.name`,
    [
      positiveId(req.params.id),
      isHR(req.user),
      req.user.employee_id,
      req.user.id,
    ],
  );
  res.json(
    r.rows.map((p) => ({
      ...p,
      can_result: canReadResult(req.user, p),
      can_individual: canReadIndividual(req.user, p),
    })),
  );
});
evaluations.get("/mine", async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT a.id,a.kind,a.status,a.review_needed,a.participant_id,e.name employee_name,cy.name cycle_name,cy.deadline::text,cy.status cycle_status FROM ad.evaluation_assignments a JOIN ad.cycle_participants p ON p.id=a.participant_id JOIN ad.employees e ON e.id=p.employee_id JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id WHERE a.evaluator_id=$1 AND a.status<>'superseded' ORDER BY cy.deadline,e.name`,
        [req.user.id],
      )
    ).rows,
  ),
);
evaluations.get("/assignments/:id", async (req, res) => {
  const a = (
    await pool.query("SELECT * FROM ad.evaluation_assignments WHERE id=$1", [
      positiveId(req.params.id),
    ])
  ).rows[0];
  if (!a) fail(404, "Avaliação não encontrada.");
  const p = await participant(pool, a.participant_id);
  if (a.evaluator_id !== req.user.id && !canReadIndividual(req.user, p))
    fail(403, "Sem acesso à avaliação individual.");
  const full = (await assignments(pool, p.id)).find((x) => x.id === a.id);
  res.json({
    assignment: full,
    participant: p,
    editable: canAnswer(req.user, a) && p.cycle_status === "open",
  });
});
evaluations.post("/assignments/:id/answers", async (req, res) => {
  const v = z
    .object({
      version: z.number().int().nonnegative(),
      answers: z.record(z.string(), z.number().int().min(1).max(5)),
      submit: z.boolean(),
    })
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const a = (
        await c.query(
          "SELECT * FROM ad.evaluation_assignments WHERE id=$1 FOR UPDATE",
          [positiveId(req.params.id)],
        )
      ).rows[0];
      if (!a) fail(404, "Avaliação não encontrada.");
      if (!canAnswer(req.user, a))
        fail(403, "Avaliação não disponível para edição por este usuário.");
      const p = await participant(c, a.participant_id);
      const today = (await c.query("SELECT current_date::text today")).rows[0]
        .today;
      if (p.cycle_status !== "open" || today < p.opens_on || today > p.deadline)
        fail(409, "Fora do período de resposta do ciclo.");
      if (v.version !== a.version)
        fail(
          409,
          "A avaliação foi atualizada em outra sessão. Reabra antes de salvar.",
        );
      validateAnswers(p.snapshot, v.answers, v.submit);
      const revision = a.version + 1;
      await c.query(
        "INSERT INTO ad.evaluation_responses(assignment_id,revision,answers,submitted,author_id) VALUES($1,$2,$3,$4,$5)",
        [a.id, revision, JSON.stringify(v.answers), v.submit, req.user.id],
      );
      await c.query(
        "UPDATE ad.evaluation_assignments SET version=$1,status=$2,submitted_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$4",
        [revision, v.submit ? "submitted" : "pending", v.submit, a.id],
      );
      await audit(
        c,
        req.user,
        v.submit ? "evaluation.submit" : "evaluation.draft",
        "evaluation_assignments",
        a.id,
        { revision },
      );
      return { version: revision, status: v.submit ? "submitted" : "pending" };
    }),
  );
});
evaluations.get("/participants/:id/result", async (req, res) => {
  const p = await participant(pool, positiveId(req.params.id));
  if (!canReadResult(req.user, p))
    fail(403, "Resultado restrito até liberação do RH.");
  const r = await result(pool, p);
  const individual = canReadIndividual(req.user, p)
    ? await assignments(pool, p.id)
    : undefined;
  res.json({
    participant: {
      id: p.id,
      employee_name: p.employee_name,
      cycle_name: p.cycle_name,
      released: p.released,
    },
    ...r,
    ...(individual ? { individual } : {}),
  });
});
evaluations.get("/participants/:id/assignments", async (req, res) => {
  const p = await participant(pool, positiveId(req.params.id));
  if (!canReadIndividual(req.user, p))
    fail(
      403,
      "Somente RH e gestor responsável consultam avaliações individuais.",
    );
  res.json(await assignments(pool, p.id));
});
evaluations.use(hr);
evaluations.get("/competencies", async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT c.id,c.code,c.active,v.name,v.description,v.category,v.weight,v.position_id,v.version FROM ad.competencies c JOIN LATERAL(SELECT * FROM ad.competency_versions WHERE competency_id=c.id ORDER BY version DESC LIMIT 1) v ON true ORDER BY c.code`,
      )
    ).rows,
  ),
);
for (const method of ["post", "put"])
  evaluations[method](
    "/competencies" + (method === "put" ? "/:id" : ""),
    async (req, res) => {
      const v = compSchema.parse(req.body);
      res.json(
        await write(async (c) => {
          let key = method === "put" ? positiveId(req.params.id) : null;
          if (key) {
            if (
              !(
                await c.query(
                  "UPDATE ad.competencies SET code=$1,active=$2 WHERE id=$3 RETURNING id",
                  [v.code, v.active, key],
                )
              ).rowCount
            )
              fail(404, "Competência não encontrada.");
          } else
            key = (
              await c.query(
                "INSERT INTO ad.competencies(code,active) VALUES($1,$2) RETURNING id",
                [v.code, v.active],
              )
            ).rows[0].id;
          const version = (
            await c.query(
              "SELECT coalesce(max(version),0)+1 v FROM ad.competency_versions WHERE competency_id=$1",
              [key],
            )
          ).rows[0].v;
          await c.query(
            "INSERT INTO ad.competency_versions(competency_id,version,name,description,category,weight,position_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              key,
              version,
              v.name,
              v.description,
              v.category,
              v.weight,
              v.position_id,
              req.user.id,
            ],
          );
          await audit(c, req.user, "competency.version", "competencies", key, {
            version,
          });
          return { id: key, version };
        }),
      );
    },
  );
evaluations.get("/questions", async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT q.id,q.competency_id,q.active,c.code,v.version,v.prompt,v.scale FROM ad.questions q JOIN ad.competencies c ON c.id=q.competency_id JOIN LATERAL(SELECT * FROM ad.question_versions WHERE question_id=q.id ORDER BY version DESC LIMIT 1) v ON true ORDER BY c.code,q.id`,
      )
    ).rows,
  ),
);
for (const method of ["post", "put"])
  evaluations[method](
    "/questions" + (method === "put" ? "/:id" : ""),
    async (req, res) => {
      const v = z
        .object({
          competency_id: id,
          prompt: z.string().trim().min(5).max(3000),
          scale: z.array(z.string().trim().min(5).max(1000)).length(5),
          active: z.boolean(),
        })
        .parse(req.body);
      res.json(
        await write(async (c) => {
          let key = method === "put" ? positiveId(req.params.id) : null;
          if (key) {
            if (
              !(
                await c.query(
                  "UPDATE ad.questions SET active=$1 WHERE id=$2 AND competency_id=$3 RETURNING id",
                  [v.active, key, v.competency_id],
                )
              ).rowCount
            )
              fail(
                400,
                "Pergunta não encontrada; a competência original não pode ser alterada.",
              );
          } else
            key = (
              await c.query(
                "INSERT INTO ad.questions(competency_id,active) VALUES($1,$2) RETURNING id",
                [v.competency_id, v.active],
              )
            ).rows[0].id;
          const version = (
            await c.query(
              "SELECT coalesce(max(version),0)+1 v FROM ad.question_versions WHERE question_id=$1",
              [key],
            )
          ).rows[0].v;
          await c.query(
            "INSERT INTO ad.question_versions(question_id,version,prompt,scale,created_by) VALUES($1,$2,$3,$4,$5)",
            [key, version, v.prompt, JSON.stringify(v.scale), req.user.id],
          );
          await audit(c, req.user, "question.version", "questions", key, {
            version,
          });
          return { id: key, version };
        }),
      );
    },
  );
evaluations.get("/questionnaires", async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT q.*,p.name position_name,coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'created_at',v.created_at) ORDER BY v.version DESC) FROM ad.questionnaire_versions v WHERE v.questionnaire_id=q.id),'[]') versions FROM ad.questionnaires q JOIN ad.positions p ON p.id=q.position_id ORDER BY q.name`,
      )
    ).rows,
  ),
);
evaluations.post("/questionnaires", async (req, res) => {
  const v = z
    .object({ name: z.string().trim().min(3).max(180), position_id: id })
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const q = (
        await c.query(
          "INSERT INTO ad.questionnaires(name,position_id) VALUES($1,$2) RETURNING *",
          [v.name, v.position_id],
        )
      ).rows[0];
      await publishQuestionnaire(c, q.id, req.user);
      return q;
    }),
  );
});
evaluations.post("/questionnaires/:id/publish", async (req, res) =>
  res.json(
    await write((c) =>
      publishQuestionnaire(c, positiveId(req.params.id), req.user),
    ),
  ),
);
evaluations.get("/questionnaire-versions/:id", async (req, res) => {
  const v = (
    await pool.query("SELECT * FROM ad.questionnaire_versions WHERE id=$1", [
      positiveId(req.params.id),
    ])
  ).rows[0];
  if (!v) fail(404, "Versão não encontrada.");
  res.json(v);
});
evaluations.post("/cycles", async (req, res) => {
  const v = z
    .object({
      name: z.string().trim().min(3).max(180),
      reference_start: date,
      reference_end: date,
      opens_on: date,
      deadline: date,
      periodicity_months: z.coerce.number().int().min(1).max(120),
      role_weights: z.object({
        gerente: decimal,
        gestor: decimal,
        rh: decimal,
        master: decimal,
      }),
      divergence_limit: z.coerce.number().min(0).max(4),
    })
    .refine(
      (v) => v.reference_end >= v.reference_start && v.deadline >= v.opens_on,
      "Período inválido",
    )
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const r = (
        await c.query(
          "INSERT INTO ad.evaluation_cycles(name,reference_start,reference_end,opens_on,deadline,periodicity_months,role_weights,divergence_limit,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            v.name,
            v.reference_start,
            v.reference_end,
            v.opens_on,
            v.deadline,
            v.periodicity_months,
            JSON.stringify(v.role_weights),
            v.divergence_limit,
            req.user.id,
          ],
        )
      ).rows[0];
      await audit(c, req.user, "cycle.create", "evaluation_cycles", r.id, v);
      return r;
    }),
  );
});
evaluations.post("/cycles/:id/participants", async (req, res) => {
  const v = z
    .object({ employee_id: id, questionnaire_version_id: id })
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const cy = (
        await c.query("SELECT * FROM ad.evaluation_cycles WHERE id=$1", [
          positiveId(req.params.id),
        ])
      ).rows[0];
      if (!cy || cy.status !== "draft")
        fail(409, "Adicione participantes antes de abrir o ciclo.");
      const e = (
        await c.query(
          "SELECT e.*,l.manager_id,l.supervisor_id FROM ad.employees e LEFT JOIN ad.organizational_links l ON l.employee_id=e.id AND l.ended_at IS NULL WHERE e.id=$1",
          [v.employee_id],
        )
      ).rows[0];
      if (!e || e.status !== "ativo")
        fail(400, "Funcionário deve estar ativo.");
      const q = (
        await c.query(
          "SELECT q.position_id FROM ad.questionnaire_versions v JOIN ad.questionnaires q ON q.id=v.questionnaire_id WHERE v.id=$1",
          [v.questionnaire_version_id],
        )
      ).rows[0];
      if (!q || q.position_id !== e.position_id)
        fail(400, "Questionário incompatível com o cargo.");
      const self = (
        await c.query(
          "SELECT id FROM ad.users WHERE employee_id=$1 AND active",
          [e.id],
        )
      ).rows[0];
      if (!self)
        fail(
          400,
          "Cadastre o acesso por CPF do participante antes de incluí-lo.",
        );
      const key = (
        await c.query(
          "INSERT INTO ad.cycle_participants(cycle_id,employee_id,questionnaire_version_id,responsible_id) VALUES($1,$2,$3,$4) RETURNING id",
          [
            cy.id,
            e.id,
            v.questionnaire_version_id,
            e.supervisor_id || e.manager_id,
          ],
        )
      ).rows[0].id;
      const p = await participant(c, key);
      await newAssignment(c, p, self.id, "colaborador", "self", req.user);
      const seen = new Set([self.id]);
      for (const [profile, key] of [
        ["gerente", "manager_id"],
        ["gestor", "supervisor_id"],
      ])
        if (e[key] && !seen.has(e[key])) {
          await newAssignment(c, p, e[key], profile, "manager", req.user);
          seen.add(e[key]);
        }
      await audit(c, req.user, "cycle.enroll", "cycle_participants", p.id);
      return { id: p.id };
    }),
  );
});
evaluations.post("/cycles/:id/status", async (req, res) => {
  const v = z
    .object({
      action: z.enum(["open", "close", "extend"]),
      reason: z.string().trim().max(2000).default(""),
      deadline: date.optional(),
    })
    .parse(req.body);
  await write(async (c) => {
    const cy = (
      await c.query("SELECT * FROM ad.evaluation_cycles WHERE id=$1", [
        positiveId(req.params.id),
      ])
    ).rows[0];
    if (!cy) fail(404, "Ciclo não encontrado.");
    const ps = (
      await c.query("SELECT id FROM ad.cycle_participants WHERE cycle_id=$1", [
        cy.id,
      ])
    ).rows;
    if (v.action === "open") {
      if (cy.status !== "draft" || !ps.length)
        fail(409, "Ciclo precisa estar em preparação e possuir participantes.");
      for (const p of ps)
        if (
          !(await assignments(c, p.id)).some(
            (a) => a.kind === "manager" && a.status !== "superseded",
          )
        )
          fail(
            400,
            "Todos os participantes precisam de pelo menos um avaliador gestor.",
          );
      await c.query(
        "UPDATE ad.evaluation_cycles SET status='open' WHERE id=$1",
        [cy.id],
      );
    } else if (v.action === "close") {
      if (cy.status !== "open")
        fail(409, "Somente ciclos abertos podem ser encerrados.");
      const pending = (
        await c.query(
          "SELECT 1 FROM ad.evaluation_assignments a JOIN ad.cycle_participants p ON p.id=a.participant_id WHERE p.cycle_id=$1 AND (a.status='pending' OR a.review_needed) LIMIT 1",
          [cy.id],
        )
      ).rowCount;
      if (pending) reason.parse(v.reason);
      await c.query(
        "UPDATE ad.evaluation_cycles SET status='closed',closed_at=now() WHERE id=$1",
        [cy.id],
      );
    } else {
      if (cy.status !== "open" || !v.deadline)
        fail(409, "Prorrogação disponível somente em ciclo aberto.");
      reason.parse(v.reason);
      const current = (
        await c.query(
          "SELECT deadline::text d FROM ad.evaluation_cycles WHERE id=$1",
          [cy.id],
        )
      ).rows[0].d;
      if (v.deadline <= current)
        fail(400, "O novo prazo deve ser posterior ao atual.");
      await c.query("UPDATE ad.evaluation_cycles SET deadline=$1 WHERE id=$2", [
        v.deadline,
        cy.id,
      ]);
    }
    await audit(
      c,
      req.user,
      "cycle." + v.action,
      "evaluation_cycles",
      cy.id,
      v,
    );
  });
  res.json({ ok: true });
});
evaluations.post("/participants/:id/evaluators", async (req, res) => {
  const v = z
    .object({
      evaluator_id: id,
      profile: z.enum(["gerente", "gestor", "rh", "master"]),
      reason,
    })
    .parse(req.body);
  res.json(
    await write(async (c) => {
      const p = await participant(c, positiveId(req.params.id));
      if (p.cycle_status === "closed") fail(409, "Ciclo encerrado.");
      const a = await newAssignment(
        c,
        p,
        v.evaluator_id,
        v.profile,
        "manager",
        req.user,
      );
      await revokeResult(c, p, req.user, v.reason);
      await audit(
        c,
        req.user,
        "evaluation.extra_evaluator",
        "evaluation_assignments",
        a.id,
        { reason: v.reason },
      );
      return a;
    }),
  );
});
evaluations.post("/assignments/:id/substitute", async (req, res) => {
  const v = z.object({ evaluator_id: id, reason }).parse(req.body);
  await write(async (c) => {
    const a = (
      await c.query("SELECT * FROM ad.evaluation_assignments WHERE id=$1", [
        positiveId(req.params.id),
      ])
    ).rows[0];
    if (!a) fail(404, "Avaliação não encontrada.");
    const p = await participant(c, a.participant_id);
    if (p.cycle_status === "closed") fail(409, "Ciclo encerrado.");
    await transferAssignment(c, p, a, v.evaluator_id, req.user, v.reason);
  });
  res.json({ ok: true });
});
evaluations.get("/transfers", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT t.*,e.name employee_name,cy.name cycle_name FROM ad.evaluation_transfers t JOIN ad.cycle_participants p ON p.id=t.participant_id JOIN ad.employees e ON e.id=p.employee_id JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id ORDER BY t.id DESC LIMIT 500",
      )
    ).rows,
  ),
);
evaluations.post("/transfers/:id/decision", async (req, res) => {
  const v = z
    .object({ decision: z.enum(["accept", "discard"]), reason })
    .parse(req.body);
  await write((c) =>
    reviewTransfer(
      c,
      positiveId(req.params.id),
      v.decision,
      v.reason,
      req.user,
    ),
  );
  res.json({ ok: true });
});
evaluations.post("/participants/:id/release", async (req, res) => {
  const v = z.object({ released: z.boolean(), reason }).parse(req.body);
  await write(async (c) => {
    const p = await participant(c, positiveId(req.params.id));
    const snapshot = v.released ? await requireReleaseReady(c, p) : null;
    await c.query(
      "UPDATE ad.cycle_participants SET released=$1,released_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2",
      [v.released, p.id],
    );
    await c.query(
      "INSERT INTO ad.evaluation_result_releases(participant_id,released,snapshot,reason,user_id) VALUES($1,$2,$3,$4,$5)",
      [
        p.id,
        v.released,
        snapshot ? JSON.stringify(snapshot) : null,
        v.reason,
        req.user.id,
      ],
    );
    await audit(c, req.user, "evaluation.release", "cycle_participants", p.id, {
      released: v.released,
      reason: v.reason,
    });
  });
  res.json({ ok: true });
});
