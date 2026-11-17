import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { pool, transaction } from "../database/pool.js";
import { positiveId, fail } from "../utils/validation.js";
import { audit } from "../services/audit.js";
import {
  evaluationLock,
  participant,
  result,
  assignments,
  revokeResult,
} from "../services/evaluations.js";
import { isHR, canReadIndividual } from "../services/evaluation-policy.js";
import {
  date,
  documentSchema,
  emptyDocument,
  developmentAccess,
  requireReady,
  validateCompetencies,
  planSituation,
} from "../services/development-policy.js";
export const development = Router();
development.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const hash = (v) => createHash("sha256").update(v).digest("hex");
const acknowledgment =
  "Declaro ciência do conteúdo deste feedback e PDI. Minha assinatura não pressupõe concordância com seu conteúdo.";
const versionSchema = z.object({ version: z.number().int().nonnegative() });
const reasonSchema = z.string().trim().min(10).max(3000);
const write = (fn) =>
  transaction(async (c) => {
    await evaluationLock(c);
    return fn(c);
  });
async function context(c, id, user) {
  const p = await participant(c, id),
    access = developmentAccess(user, p);
  if (!access.read)
    fail(
      403,
      "Feedback restrito ao RH, gestor responsável e funcionário após liberação do resultado.",
    );
  const plan = (
    await c.query(
      "SELECT * FROM ad.development_plans WHERE participant_id=$1",
      [p.id],
    )
  ).rows[0];
  return { p, access, plan };
}
function editable(ctx, version, mode = "draft") {
  if (!ctx.plan) fail(404, "Feedback ainda não iniciado.");
  if (!ctx.access.manager && !ctx.access.employee)
    fail(403, "Somente as partes podem elaborar e acompanhar o PDI.");
  if (ctx.plan.version !== version)
    fail(
      409,
      "Documento atualizado por outra sessão. Recarregue antes de salvar.",
    );
  if (mode === "draft" && ctx.plan.status !== "draft")
    fail(409, "Documento congelado para assinatura.");
  if (mode === "tracking" && ctx.plan.status !== "signed")
    fail(409, "Acompanhamento disponível após as duas assinaturas.");
}
async function event(c, plan, user, type, details = {}) {
  await c.query(
    "INSERT INTO ad.development_history(plan_id,user_id,event,details) VALUES($1,$2,$3,$4)",
    [plan.id, user.id, type, JSON.stringify(details)],
  );
  await audit(
    c,
    user,
    "development." + type,
    "development_plans",
    plan.id,
    details,
  );
}
async function saveDocument(c, ctx, user, doc, type) {
  await c.query(
    "UPDATE ad.development_plans SET document=$1,version=version+1,updated_at=now() WHERE id=$2",
    [JSON.stringify(doc), ctx.plan.id],
  );
  await event(c, ctx.plan, user, type, {
    version: ctx.plan.version + 1,
    document: doc,
  });
}
const visibility = `($1 OR (p.responsible_id=$2 AND p.employee_id IS DISTINCT FROM $3 AND $4) OR (p.employee_id=$3 AND (p.feedback_access OR p.released)))`;
const scope = (u) => [
  isHR(u),
  u.id,
  u.employee_id,
  ["gerente", "gestor", "rh", "master"].includes(u.role_id),
];
development.get("/", async (req, res) => {
  const rows = (
    await pool.query(
      `SELECT p.id,p.released,p.responsible_id,e.name employee_name,e.re,cy.name cycle_name,cy.id cycle_id,cy.status cycle_status,coalesce(d.status,'not_started') status,d.document,d.version,
 (SELECT count(*)::int FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND a.kind='manager' AND a.status='submitted') submitted,
 EXISTS(SELECT 1 FROM ad.evaluation_assignments a WHERE a.participant_id=p.id AND (a.status='pending' AND a.kind='manager' OR a.review_needed)) pending
 FROM ad.cycle_participants p JOIN ad.employees e ON e.id=p.employee_id JOIN ad.evaluation_cycles cy ON cy.id=p.cycle_id LEFT JOIN ad.development_plans d ON d.participant_id=p.id WHERE ${visibility} ORDER BY cy.id DESC,e.name`,
      scope(req.user),
    )
  ).rows;
  const today = (
    await pool.query(
      "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text today",
    )
  ).rows[0].today;
  res.json(
    rows.map(({ document, ...r }) => ({
      ...r,
      actions: document?.actions || [],
      situation: planSituation(document?.actions || [], today),
      today,
    })),
  );
});
// Due notifications are derived on every request, so deadlines stay current even without a scheduler.
development.get("/notifications", async (req, res) => {
  const rows = (
    await pool.query(
      `WITH visible AS (
 SELECT d.*,p.employee_id,p.responsible_id,e.name employee_name FROM ad.development_plans d JOIN ad.cycle_participants p ON p.id=d.participant_id JOIN ad.employees e ON e.id=p.employee_id WHERE ${visibility}
 ), notices AS (
 SELECT 'action:'||d.id||':'||(a->>'id')||':'||(a->>'deadline')||':'||CASE WHEN (a->>'deadline')::date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'late' ELSE 'soon' END key,d.participant_id,
 d.employee_name||' · '||CASE WHEN (a->>'deadline')::date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'Ação atrasada: ' ELSE 'Ação vence em até 7 dias: ' END||(a->>'description') message,d.updated_at created_at
 FROM visible d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.document->'actions','[]')) a WHERE d.status='signed' AND a->>'status' NOT IN ('completed','cancelled') AND (a->>'deadline')::date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date+7
 UNION ALL SELECT 'check:'||ch.id,d.participant_id,d.employee_name||' · Verificação pendente em '||ch.due_on::text,ch.created_at FROM visible d JOIN ad.development_checkins ch ON ch.plan_id=d.id WHERE ch.completed_at IS NULL AND ch.due_on <= (now() AT TIME ZONE 'America/Sao_Paulo')::date+7
 UNION ALL SELECT 'event:'||h.id,d.participant_id,d.employee_name||' · '||h.event,h.created_at FROM visible d JOIN ad.development_history h ON h.plan_id=d.id WHERE h.user_id<>$2
 ) SELECT n.*,r.read_at FROM notices n LEFT JOIN ad.development_notification_reads r ON r.notification_key=n.key AND r.user_id=$2 ORDER BY (r.read_at IS NULL) DESC,n.created_at DESC LIMIT 200`,
      scope(req.user),
    )
  ).rows;
  res.json(rows);
});
development.post("/notifications/read", async (req, res) => {
  const v = z
    .object({
      key: z
        .string()
        .max(200)
        .regex(/^(action|check|event):[a-zA-Z0-9:-]+$/),
    })
    .parse(req.body);
  await pool.query(
    "INSERT INTO ad.development_notification_reads(user_id,notification_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [req.user.id, v.key],
  );
  res.json({ ok: true });
});
development.get("/:id/pdf", async (req, res) => {
  const ctx = await context(pool, positiveId(req.params.id), req.user),
    plan = ctx.plan;
  if (!plan || plan.status !== "signed" || !plan.signed_text)
    fail(409, "PDF disponível após as duas assinaturas.");
  const frozen = JSON.parse(plan.signed_text),
    signatures = (
      await pool.query(
        "SELECT kind,functional_identity,signed_at FROM ad.development_signatures WHERE plan_id=$1 AND signature_round=$2 ORDER BY kind",
        [plan.id, plan.signature_round],
      )
    ).rows;
  if (signatures.length !== 2) fail(409, "Documento sem duas assinaturas.");
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="feedback-${ctx.p.id}-v${plan.signature_round}.pdf"`,
    "Cache-Control": "no-store",
  });
  const pdf = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: "Feedback de Desempenho e PDI",
      Author: "Santa Casa de Pelotas",
    },
  });
  pdf.pipe(res);
  pdf.fillColor("#183c5b").fontSize(18).text("SANTA CASA DE PELOTAS");
  pdf.fontSize(10).text("GESTÃO DE PESSOAS  |  AVALIAÇÃO E DESENVOLVIMENTO");
  pdf
    .moveDown()
    .fillColor("#182b3a")
    .fontSize(20)
    .text("Feedback de Desempenho e PDI");
  const section = (t) => {
    pdf.moveDown().fillColor("#246082").fontSize(13).text(t);
    pdf.moveDown(0.3).fillColor("#182b3a").fontSize(10);
  };
  const value = (label, v) =>
    pdf
      .font("Helvetica-Bold")
      .text(label + ": ", { continued: true })
      .font("Helvetica")
      .text(String(v || "—"));
  const i = frozen.identity,
    d = frozen.document,
    r = frozen.result;
  section("Identificação");
  value("Funcionário", i.name);
  value("RE", i.re);
  value("Cargo", i.position_name);
  value("Setor", i.sector_name);
  value("Ciclo", i.cycle_name);
  value("Período", `${i.reference_start} a ${i.reference_end}`);
  value("Versão", frozen.round);
  value("Nota consolidada", Number(r.score).toFixed(2));
  section("Mapa de competências");
  for (const c of r.competencies) {
    pdf.font("Helvetica-Bold").text(c.name);
    pdf
      .font("Helvetica")
      .text(
        `Autoavaliação: ${c.self_score ?? "—"}  |  Gestores: ${c.score}  |  Diferença: ${c.difference ?? "—"}${c.divergent ? "  |  Diferença relevante" : ""}`,
      );
    pdf.moveDown(0.3);
  }
  pdf.text(
    "Diferenças são percepções para diálogo e não classificam automaticamente o desempenho.",
  );
  section("Reunião e observações");
  value("Data", d.meeting_date);
  value("Pontos fortes", d.strengths);
  value("Oportunidades", d.opportunities);
  value("Gestor", d.manager_notes);
  value("Funcionário", d.employee_notes);
  section("Plano de Desenvolvimento Individual");
  value("Objetivo geral", d.objective);
  value("Observações", d.notes);
  for (const a of d.actions) {
    pdf
      .moveDown(0.5)
      .font("Helvetica-Bold")
      .text(a.description)
      .font("Helvetica");
    value(
      "Competência",
      r.competencies.find((c) => c.id === a.competency_id)?.name,
    );
    value("Responsável", a.responsible);
    value("Início e prazo", `${a.start} a ${a.deadline}`);
    value("Indicador", a.indicator);
    value(
      "Situação na versão assinada",
      {
        planned: "Planejada",
        in_progress: "Em andamento",
        completed: "Concluída",
        cancelled: "Cancelada",
      }[a.status] || a.status,
    );
    value("Observações", a.notes);
    if (a.cancellation_reason) value("Justificativa", a.cancellation_reason);
  }
  section("Assinaturas de ciência");
  pdf.text(frozen.acknowledgment);
  for (const s of signatures)
    value(
      s.kind === "manager" ? "Gestor" : "Funcionário",
      `${s.functional_identity.name || "Usuário"} · RE ${s.functional_identity.re || "não informado"} · ${new Date(s.signed_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    );
  pdf
    .moveDown()
    .fontSize(8)
    .text("Assinatura interna por senha, sem certificado digital.");
  pdf.text("SHA-256: " + plan.document_hash);
  pdf.end();
});
development.get("/:id", async (req, res) => {
  await transaction(async (c) => {
    await evaluationLock(c);
    const ctx = await context(c, positiveId(req.params.id), req.user),
      { p, plan, access } = ctx;
    const consolidated = await result(c, p);
    const identity = (
      await c.query(
        `SELECT e.name,e.re,pos.name position_name,s.name sector_name,coalesce(me.name,u.username) manager_name,cy.reference_start::text,cy.reference_end::text FROM ad.employees e JOIN ad.positions pos ON pos.id=e.position_id LEFT JOIN ad.organizational_links l ON l.employee_id=e.id AND l.ended_at IS NULL LEFT JOIN ad.sectors s ON s.id=l.sector_id LEFT JOIN ad.users u ON u.id=$2 LEFT JOIN ad.employees me ON me.id=u.employee_id JOIN ad.evaluation_cycles cy ON cy.id=$3 WHERE e.id=$1`,
        [p.employee_id, p.responsible_id, p.cycle_id],
      )
    ).rows[0];
    const all = await assignments(c, p.id);
    const permitted = all.filter(
      (a) => canReadIndividual(req.user, p) || a.evaluator_id === req.user.id,
    );
    const history = plan
      ? (
          await c.query(
            "SELECT h.*,e.name author_name FROM ad.development_history h JOIN ad.users u ON u.id=h.user_id LEFT JOIN ad.employees e ON e.id=u.employee_id WHERE plan_id=$1 ORDER BY h.id DESC",
            [plan.id],
          )
        ).rows
      : [];
    const signatures = plan
      ? (
          await c.query(
            "SELECT id,signature_round,user_id,functional_identity,kind,document_hash,signed_at,signed_text::jsonb->>'acknowledgment' acknowledgment FROM ad.development_signatures WHERE plan_id=$1 ORDER BY id",
            [plan.id],
          )
        ).rows
      : [];
    const evidence = plan
      ? (
          await c.query(
            "SELECT id,action_id,filename,mime,sha256,user_id,created_at FROM ad.development_evidence WHERE plan_id=$1 ORDER BY id",
            [plan.id],
          )
        ).rows
      : [];
    const checkins = plan
      ? (
          await c.query(
            "SELECT ch.*,ch.due_on::text FROM ad.development_checkins ch WHERE plan_id=$1 ORDER BY ch.due_on,ch.id",
            [plan.id],
          )
        ).rows
      : [];
    const today = (
      await c.query(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text today",
      )
    ).rows[0].today;
    res.json({
      participant: {
        id: p.id,
        employee_id: p.employee_id,
        responsible_id: p.responsible_id,
        cycle_name: p.cycle_name,
        released: p.released,
        ...identity,
      },
      access,
      plan,
      consolidated,
      questionnaire: p.snapshot,
      assignments: permitted,
      history,
      signatures,
      versions: plan
        ? (
            await c.query(
              "SELECT * FROM ad.development_document_versions WHERE plan_id=$1 ORDER BY signature_round DESC",
              [plan.id],
            )
          ).rows
        : [],
      evidence,
      checkins,
      today,
    });
  });
});
development.post("/:id/start", async (req, res) => {
  res.json(
    await write(async (c) => {
      const ctx = await context(c, positiveId(req.params.id), req.user);
      if (!ctx.access.manager)
        fail(403, "O gestor responsável deve iniciar o feedback.");
      await result(c, ctx.p);
      if (ctx.plan) return { id: ctx.plan.id };
      const plan = (
        await c.query(
          "INSERT INTO ad.development_plans(participant_id,document,created_by) VALUES($1,$2,$3) RETURNING *",
          [ctx.p.id, JSON.stringify(emptyDocument()), req.user.id],
        )
      ).rows[0];
      await event(c, plan, req.user, "created");
      return { id: plan.id };
    }),
  );
});
development.put("/:id/document", async (req, res) => {
  const v = versionSchema.extend({ document: documentSchema }).parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version);
    if (!ctx.access.manager)
      fail(403, "O funcionário registra contribuições pelo campo próprio.");
    if (v.document.employee_notes !== ctx.plan.document.employee_notes)
      fail(403, "Observações do funcionário são de autoria exclusiva dele.");
    validateCompetencies(v.document, ctx.p);
    if (
      v.document.actions.some((a) => {
        const old = ctx.plan.document.actions.find(
          (previous) => previous.id === a.id,
        );
        return (
          !["planned", "cancelled", old?.status].includes(a.status) ||
          (a.progress !== (old?.progress ?? 0) && a.progress !== null)
        );
      })
    )
      fail(
        400,
        "Na elaboração, ações devem estar planejadas ou canceladas. O andamento é registrado após a formalização.",
      );
    const oldIds = ctx.plan.document.actions.map((a) => a.id);
    if (oldIds.some((id) => !v.document.actions.some((a) => a.id === id)))
      fail(
        400,
        "Ações existentes devem ser canceladas com justificativa, não excluídas.",
      );
    await saveDocument(c, ctx, req.user, v.document, "draft_saved");
  });
  res.json({ ok: true });
});
development.post("/:id/contributions", async (req, res) => {
  const v = versionSchema
    .extend({ text: z.string().trim().min(3).max(10000) })
    .parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version);
    if (!ctx.access.employee)
      fail(403, "Contribuição reservada ao funcionário avaliado.");
    await saveDocument(
      c,
      ctx,
      req.user,
      { ...ctx.plan.document, employee_notes: v.text },
      "employee_contribution",
    );
  });
  res.json({ ok: true });
});
development.post("/:id/submit", async (req, res) => {
  const v = versionSchema.parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version);
    if (!ctx.access.manager)
      fail(403, "Somente o gestor responsável encaminha para assinatura.");
    const contributed = (
      await c.query(
        "SELECT 1 FROM ad.development_history h JOIN ad.users u ON u.id=h.user_id WHERE h.plan_id=$1 AND h.event='employee_contribution' AND u.employee_id=$2 AND h.id>coalesce((SELECT max(id) FROM ad.development_history WHERE plan_id=$1 AND event='revision_created'),0) LIMIT 1",
        [ctx.plan.id, ctx.p.employee_id],
      )
    ).rowCount;
    requireReady(ctx.plan.document, ctx.p, contributed > 0);
    const consolidated = await result(c, ctx.p);
    const signers = (
      await c.query(
        "SELECT id,employee_id,role_id,active FROM ad.users WHERE id=$1 OR employee_id=$2",
        [ctx.p.responsible_id, ctx.p.employee_id],
      )
    ).rows;
    if (signers.length !== 2 || signers.some((u) => !u.active))
      fail(409, "As duas partes precisam de acessos ativos e distintos.");
    const identity = (
      await c.query(
        `SELECT e.id,e.name,e.re,pos.name position_name,s.name sector_name,cy.name cycle_name,cy.reference_start::text,cy.reference_end::text FROM ad.employees e JOIN ad.positions pos ON pos.id=e.position_id LEFT JOIN ad.organizational_links l ON l.employee_id=e.id AND l.ended_at IS NULL LEFT JOIN ad.sectors s ON s.id=l.sector_id JOIN ad.evaluation_cycles cy ON cy.id=$2 WHERE e.id=$1`,
        [ctx.p.employee_id, ctx.p.cycle_id],
      )
    ).rows[0];
    const text = JSON.stringify({
      participant_id: ctx.p.id,
      employee_id: ctx.p.employee_id,
      manager_id: ctx.p.responsible_id,
      identity,
      document: ctx.plan.document,
      result: consolidated,
      round: ctx.plan.signature_round + 1,
      acknowledgment,
    });
    await c.query(
      "INSERT INTO ad.development_document_versions(plan_id,signature_round,signed_text,document_hash,created_by) VALUES($1,$2,$3,$4,$5)",
      [
        ctx.plan.id,
        ctx.plan.signature_round + 1,
        text,
        hash(text),
        req.user.id,
      ],
    );
    await c.query(
      "UPDATE ad.development_plans SET status='awaiting_signatures',signature_round=signature_round+1,signed_text=$1,document_hash=$2,version=version+1,updated_at=now() WHERE id=$3",
      [text, hash(text), ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "submitted", {
      document_hash: hash(text),
    });
  });
  res.json({ ok: true });
});
development.post("/:id/revise", async (req, res) => {
  const v = versionSchema.extend({ reason: reasonSchema }).parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "any");
    if (!ctx.access.manager)
      fail(403, "O gestor responsável inicia a revisão conjunta.");
    if (ctx.plan.status !== "signed")
      fail(409, "Somente um documento formalizado pode originar nova versão.");
    if (ctx.p.released) {
      await c.query(
        "UPDATE ad.cycle_participants SET feedback_access=true WHERE id=$1",
        [ctx.p.id],
      );
      await revokeResult(
        c,
        ctx.p,
        req.user,
        "Nova versão do feedback: " + v.reason,
      );
    }
    await c.query(
      "UPDATE ad.development_plans SET status='draft',signed_text=NULL,document_hash=NULL,version=version+1,updated_at=now() WHERE id=$1",
      [ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "revision_created", {
      reason: v.reason,
      previous_round: ctx.plan.signature_round,
      previous_hash: ctx.plan.document_hash,
      document: ctx.plan.document,
    });
  });
  res.json({ ok: true });
});
development.post("/:id/reopen", async (req, res) => {
  const v = versionSchema.extend({ reason: reasonSchema }).parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "any");
    if (ctx.plan.status !== "awaiting_signatures")
      fail(
        409,
        "Somente documentos aguardando assinatura podem voltar para elaboração.",
      );
    await c.query(
      "UPDATE ad.development_plans SET status='draft',signed_text=NULL,document_hash=NULL,version=version+1,updated_at=now() WHERE id=$1",
      [ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "reopened", {
      reason: v.reason,
      invalidated_round: ctx.plan.signature_round,
    });
  });
  res.json({ ok: true });
});
const signatureLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Muitas tentativas de assinatura. Aguarde 15 minutos." },
});
development.post("/:id/sign", signatureLimit, async (req, res) => {
  const v = versionSchema
    .extend({
      password: z.string().min(1).max(128),
      document_hash: z.string().length(64),
      acknowledgment: z.literal(true),
    })
    .parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "any");
    const { plan, p, access } = ctx;
    if (
      plan.status !== "awaiting_signatures" ||
      !(p.feedback_access || p.released)
    )
      fail(409, "Documento indisponível para assinatura.");
    const frozen = JSON.parse(plan.signed_text);
    if (
      frozen.manager_id !== p.responsible_id ||
      frozen.employee_id !== p.employee_id
    )
      fail(
        409,
        "Responsável alterado. Reabra o documento e encaminhe novamente.",
      );
    if (
      hash(plan.signed_text) !== plan.document_hash ||
      v.document_hash !== plan.document_hash
    )
      fail(409, "Versão do documento divergente. Recarregue.");
    if (JSON.stringify(await result(c, p)) !== JSON.stringify(frozen.result))
      fail(409, "Resultado alterado. Reabra o documento antes de assinar.");
    const u = (
      await c.query(
        "SELECT u.*,e.re,e.name FROM ad.users u LEFT JOIN ad.employees e ON e.id=u.employee_id WHERE u.id=$1 FOR UPDATE OF u",
        [req.user.id],
      )
    ).rows[0];
    if (
      !u?.active ||
      u.must_change_password ||
      !(await bcrypt.compare(v.password, u.password_hash))
    )
      fail(400, "Senha incorreta ou acesso indisponível.");
    const kind = access.employee ? "employee" : "manager";
    if (
      (
        await c.query(
          "SELECT 1 FROM ad.development_signatures WHERE plan_id=$1 AND signature_round=$2 AND (kind=$3 OR user_id=$4)",
          [plan.id, plan.signature_round, kind, u.id],
        )
      ).rowCount
    )
      fail(409, "Sua assinatura já foi registrada nesta versão.");
    await c.query(
      "INSERT INTO ad.development_signatures(plan_id,signature_round,user_id,functional_identity,kind,document_hash,signed_text) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        plan.id,
        plan.signature_round,
        u.id,
        JSON.stringify({
          employee_id: u.employee_id,
          re: u.re,
          name: u.name,
          role_id: u.role_id,
        }),
        kind,
        plan.document_hash,
        plan.signed_text,
      ],
    );
    const count = (
      await c.query(
        "SELECT count(*)::int n FROM ad.development_signatures WHERE plan_id=$1 AND signature_round=$2",
        [plan.id, plan.signature_round],
      )
    ).rows[0].n;
    await c.query(
      "UPDATE ad.development_plans SET status=$1,version=version+1,updated_at=now() WHERE id=$2",
      [count === 2 ? "signed" : "awaiting_signatures", plan.id],
    );
    await event(c, plan, req.user, count === 2 ? "formalized" : "signed", {
      kind,
      document_hash: plan.document_hash,
      round: plan.signature_round,
    });
  });
  res.json({ ok: true });
});
development.post("/:id/actions/:actionId/progress", async (req, res) => {
  const v = versionSchema
    .extend({
      status: z.enum(["planned", "in_progress", "completed", "cancelled"]),
      progress: z.number().int().min(0).max(100).nullable(),
      notes: z.string().trim().max(10000),
      cancellation_reason: z.string().trim().max(3000),
    })
    .parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "tracking");
    const doc = structuredClone(ctx.plan.document),
      a = doc.actions.find((a) => a.id === req.params.actionId);
    if (!a) fail(404, "Ação não encontrada.");
    if (v.status === "cancelled" && !ctx.access.manager)
      fail(403, "Cancelamento exige justificativa do gestor responsável.");
    if (a.status === "cancelled")
      fail(409, "Ação cancelada não pode ser reativada.");
    if (
      v.status === "completed" &&
      !(
        await c.query(
          "SELECT 1 FROM ad.development_evidence WHERE plan_id=$1 AND action_id=$2 LIMIT 1",
          [ctx.plan.id, a.id],
        )
      ).rowCount
    )
      fail(400, "Anexe uma evidência antes de concluir a ação.");
    const { version, ...progress } = v;
    Object.assign(a, progress);
    documentSchema.parse(doc);
    await saveDocument(c, ctx, req.user, doc, "progress_updated");
  });
  res.json({ ok: true });
});
development.post("/:id/actions/:actionId/evidence", async (req, res) => {
  const v = versionSchema
    .extend({
      filename: z
        .string()
        .trim()
        .min(1)
        .max(180)
        .regex(/^[^\\/\r\n]+$/),
      content: z
        .string()
        .min(4)
        .max(2796204)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .parse(req.body);
  const bytes = Buffer.from(v.content, "base64");
  if (
    bytes.length > 2097152 ||
    !bytes.length ||
    bytes.toString("base64") !== v.content
  )
    fail(400, "Arquivo inválido ou maior que 2 MB.");
  // Always download as an attachment; never execute uploaded content in the browser.
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "tracking");
    if (!ctx.plan.document.actions.some((a) => a.id === req.params.actionId))
      fail(404, "Ação não encontrada.");
    const r = (
      await c.query(
        "INSERT INTO ad.development_evidence(plan_id,action_id,filename,mime,content,sha256,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          ctx.plan.id,
          req.params.actionId,
          v.filename,
          "application/octet-stream",
          bytes,
          hash(bytes),
          req.user.id,
        ],
      )
    ).rows[0];
    await c.query(
      "UPDATE ad.development_plans SET version=version+1,updated_at=now() WHERE id=$1",
      [ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "evidence_added", {
      id: r.id,
      filename: v.filename,
      sha256: hash(bytes),
      action_id: req.params.actionId,
    });
  });
  res.json({ ok: true });
});
development.get("/:id/evidence/:evidenceId", async (req, res) => {
  const ctx = await context(pool, positiveId(req.params.id), req.user);
  const e = (
    await pool.query(
      "SELECT * FROM ad.development_evidence WHERE id=$1 AND plan_id=$2",
      [positiveId(req.params.evidenceId), ctx.plan?.id || 0],
    )
  ).rows[0];
  if (!e) fail(404, "Evidência não encontrada.");
  res
    .set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(e.filename),
      "Cache-Control": "no-store",
    })
    .send(e.content);
});
development.post("/:id/checkins", async (req, res) => {
  const v = versionSchema
    .extend({
      action_id: z.string().uuid(),
      due_on: date,
      notes: z.string().trim().max(10000),
    })
    .parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "tracking");
    if (!ctx.access.manager) fail(403, "O gestor agenda as verificações.");
    if (!ctx.plan.document.actions.some((a) => a.id === v.action_id))
      fail(404, "Ação não encontrada.");
    await c.query(
      "INSERT INTO ad.development_checkins(plan_id,action_id,due_on,notes,created_by) VALUES($1,$2,$3,$4,$5)",
      [ctx.plan.id, v.action_id, v.due_on, v.notes, req.user.id],
    );
    await c.query(
      "UPDATE ad.development_plans SET version=version+1,updated_at=now() WHERE id=$1",
      [ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "checkin_scheduled", v);
  });
  res.json({ ok: true });
});
development.post("/:id/checkins/:checkId/complete", async (req, res) => {
  const v = versionSchema
    .extend({ notes: z.string().trim().min(3).max(10000) })
    .parse(req.body);
  await write(async (c) => {
    const ctx = await context(c, positiveId(req.params.id), req.user);
    editable(ctx, v.version, "tracking");
    if (!ctx.access.manager)
      fail(403, "O gestor registra a verificação intermediária.");
    const r = await c.query(
      "UPDATE ad.development_checkins SET notes=$1,completed_by=$2,completed_at=now() WHERE id=$3 AND plan_id=$4 AND completed_at IS NULL RETURNING id",
      [v.notes, req.user.id, positiveId(req.params.checkId), ctx.plan.id],
    );
    if (!r.rowCount) fail(409, "Verificação inexistente ou já concluída.");
    await c.query(
      "UPDATE ad.development_plans SET version=version+1,updated_at=now() WHERE id=$1",
      [ctx.plan.id],
    );
    await event(c, ctx.plan, req.user, "checkin_completed", {
      id: r.rows[0].id,
      notes: v.notes,
    });
  });
  res.json({ ok: true });
});
