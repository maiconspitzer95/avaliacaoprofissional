import { z } from "zod";
import { fail } from "../utils/validation.js";
import { isHR, canReadResult } from "./evaluation-policy.js";
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida",
  );
const text = z.string().trim().max(10000);
export const actionSchema = z
  .object({
    id: z.string().uuid(),
    description: text.min(3),
    competency_id: z.number().int().positive(),
    responsible: text.min(3),
    start: date,
    deadline: date,
    indicator: text.min(3),
    status: z.enum(["planned", "in_progress", "completed", "cancelled"]),
    progress: z.number().int().min(0).max(100).nullable(),
    notes: text,
    cancellation_reason: text,
  })
  .strict()
  .refine((a) => a.deadline >= a.start, "Prazo anterior ao início")
  .refine(
    (a) => a.status !== "cancelled" || a.cancellation_reason.length >= 10,
    "Justifique o cancelamento (mínimo 10 caracteres)",
  )
  .refine(
    (a) =>
      a.status !== "completed" || a.progress === null || a.progress === 100,
    "Ação concluída deve ter andamento de 100%",
  );
export const documentSchema = z
  .object({
    strengths: text,
    opportunities: text,
    manager_notes: text,
    employee_notes: text,
    meeting_date: z.union([date, z.literal("")]),
    objective: text,
    notes: text,
    actions: z.array(actionSchema).max(100),
  })
  .strict()
  .refine(
    (d) => new Set(d.actions.map((a) => a.id)).size === d.actions.length,
    "Ações duplicadas",
  );
export const emptyDocument = () => ({
  strengths: "",
  opportunities: "",
  manager_notes: "",
  employee_notes: "",
  meeting_date: "",
  objective: "",
  notes: "",
  actions: [],
});
export function developmentAccess(user, p) {
  const employee = user.employee_id === p.employee_id;
  const manager =
    user.id === p.responsible_id &&
    !employee &&
    ["gestor", "gerente", "rh", "master"].includes(user.role_id);
  return {
    employee,
    manager,
    read: (isHR(user) || manager || (employee && (p.feedback_access || p.released))) && (isHR(user) || manager || employee),
    hr: isHR(user),
  };
}
export function requireReady(doc, p, hasContribution) {
  documentSchema.parse(doc);
  if (
    !doc.objective ||
    !doc.strengths ||
    !doc.opportunities ||
    !doc.meeting_date ||
    !doc.actions.some((a) => a.status !== "cancelled")
  )
    fail(
      400,
      "Preencha reunião, pontos fortes, oportunidades, objetivo e pelo menos uma ação válida.",
    );
  if (!hasContribution)
    fail(
      409,
      "É necessária uma contribuição do funcionário antes do encaminhamento.",
    );
  if (!p.feedback_access && !p.released)
    fail(409, "O RH precisa autorizar a apresentação para feedback antes das assinaturas.");
  validateCompetencies(doc, p);
}
export function validateCompetencies(doc, p) {
  if (
    doc.actions.some((a) => !p.snapshot.some((c) => c.id === a.competency_id))
  )
    fail(400, "Competência fora do questionário deste ciclo.");
}
export function actionSituation(a, today) {
  return !["completed", "cancelled"].includes(a.status) && a.deadline < today
    ? "overdue"
    : a.status;
}
export function planSituation(actions, today) {
  const valid = actions.filter((a) => a.status !== "cancelled");
  if (!valid.length) return "planned";
  if (valid.every((a) => a.status === "completed")) return "completed";
  if (valid.some((a) => actionSituation(a, today) === "overdue"))
    return "overdue";
  return valid.some((a) => a.status !== "planned") ? "in_progress" : "planned";
}
