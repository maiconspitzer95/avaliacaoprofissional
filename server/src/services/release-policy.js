import { fail } from "../utils/validation.js";
import { result } from "./evaluations.js";
import { documentSchema } from "./development-policy.js";
import { createHash } from "node:crypto";
export async function releaseReadiness(c, p) {
  const reasons = [];
  let consolidated = null;
  try {
    consolidated = await result(c, p);
  } catch (e) {
    if (e.status !== 409) throw e;
    reasons.push("Avaliações ainda não consolidadas.");
  }
  const plan = (
    await c.query(
      "SELECT * FROM ad.development_plans WHERE participant_id=$1",
      [p.id],
    )
  ).rows[0];
  if (!plan || plan.status !== "signed")
    reasons.push("Feedback e PDI ainda não formalizados.");
  if (plan) {
    const valid = documentSchema.safeParse(plan.document);
    if (
      !valid.success ||
      !plan.document.objective ||
      !plan.document.meeting_date ||
      !plan.document.strengths ||
      !plan.document.opportunities ||
      !plan.document.actions.some((a) => a.status !== "cancelled")
    )
      reasons.push("PDI obrigatório incompleto.");
    const signatures = (
      await c.query(
        "SELECT kind,user_id,document_hash FROM ad.development_signatures WHERE plan_id=$1 AND signature_round=$2",
        [plan.id, plan.signature_round],
      )
    ).rows;
    if (
      signatures.length !== 2 ||
      new Set(signatures.map((s) => s.kind)).size !== 2 ||
      new Set(signatures.map((s) => s.user_id)).size !== 2 ||
      signatures.some((s) => s.document_hash !== plan.document_hash)
    )
      reasons.push("Assinaturas das duas partes pendentes.");
    if (
      plan.signed_text &&
      consolidated &&
      JSON.stringify(JSON.parse(plan.signed_text).result) !==
        JSON.stringify(consolidated)
    )
      reasons.push(
        "Resultado alterado após assinatura; é necessária nova versão.",
      );
    if (
      !plan.signed_text ||
      createHash("sha256").update(plan.signed_text).digest("hex") !==
        plan.document_hash
    )
      reasons.push("Integridade do documento assinado não confirmada.");
    if (
      plan.signed_text &&
      JSON.parse(plan.signed_text).manager_id !== p.responsible_id
    )
      reasons.push("Gestor responsável alterado após assinatura.");
  }
  if (
    (
      await c.query(
        "SELECT 1 FROM ad.evaluation_contestations WHERE participant_id=$1 AND status <> 'completed'",
        [p.id],
      )
    ).rowCount
  )
    reasons.push("Há contestação aberta.");
  return { ready: reasons.length === 0, reasons, consolidated };
}
export async function requireReleaseReady(c, p) {
  const readiness = await releaseReadiness(c, p);
  if (!readiness.ready) fail(409, readiness.reasons.join(" "));
  return readiness.consolidated;
}
