import { z } from "zod";
export function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let n = 9; n < 11; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(cpf[i]) * (n + 1 - i);
    let d = (sum * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(cpf[n])) return false;
  }
  return true;
}
export const cpfSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine(validCpf, "CPF inválido");
const id = z.coerce.number().int().positive();
const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  id.nullable(),
);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD")
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida",
  );
export const employeeSchema = z
  .object({
    name: z.string().trim().min(3).max(180),
    cpf: cpfSchema,
    re: z.string().trim().min(1).max(30),
    position_id: id,
    sector_id: id,
    manager_id: optionalId,
    supervisor_id: optionalId,
    status: z.enum(["ativo", "afastado", "desligado"]),
    admission_date: date,
    position_start: date,
    level_start: date,
  })
  .refine(
    (v) =>
      v.position_start >= v.admission_date && v.level_start >= v.admission_date,
    "Início no cargo e nível não podem preceder a admissão",
  );
export const userSchema = z.object({
  employee_id: id,
  role_id: z.enum(["rh", "gerente", "gestor", "colaborador"]),
  password: z.string().min(6).max(128),
  active: z.boolean().default(true),
});
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function positiveId(value) {
  return id.parse(value);
}
