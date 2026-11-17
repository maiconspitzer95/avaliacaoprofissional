import { employeeSchema, fail } from "../utils/validation.js";
import { audit } from "./audit.js";
import { syncEmployeeEvaluations, evaluationLock } from "./evaluations.js";
export const employeeSelect = `SELECT e.*,to_char(e.admission_date,'YYYY-MM-DD') admission_date,to_char(e.position_start,'YYYY-MM-DD') position_start,to_char(e.level_start,'YYYY-MM-DD') level_start,p.name position_name,l.sector_id,l.manager_id,l.supervisor_id,s.name sector_name,s.nucleus_id,n.name nucleus_name,um.username manager_name,us.username supervisor_name FROM ad.employees e JOIN ad.positions p ON p.id=e.position_id LEFT JOIN ad.organizational_links l ON l.employee_id=e.id AND l.ended_at IS NULL LEFT JOIN ad.sectors s ON s.id=l.sector_id LEFT JOIN ad.nuclei n ON n.id=s.nucleus_id LEFT JOIN ad.users um ON um.id=l.manager_id LEFT JOIN ad.users us ON us.id=l.supervisor_id`;
export async function validateReferences(c, v) {
  for (const [table, id] of [
    ["positions", v.position_id],
    ["sectors", v.sector_id],
  ]) {
    const r = await c.query(
      `SELECT 1 FROM ad.${table} WHERE id=$1 AND active`,
      [id],
    );
    if (!r.rowCount) fail(400, "Cargo ou setor inexistente/inativo.");
  }
  for (const [table, role, id] of [
    ["managers", "gerente", v.manager_id],
    ["supervisors", "gestor", v.supervisor_id],
  ])
    if (id) {
      const r = await c.query(
        `SELECT 1 FROM ad.${table} t JOIN ad.users u ON u.id=t.user_id WHERE t.user_id=$1 AND u.active AND u.role_id=$2`,
        [id, role],
      );
      if (!r.rowCount) fail(400, "Gerente ou gestor inválido/inativo.");
    }
}
export async function saveEmployee(c, input, user, id = null) {
  await evaluationLock(c);
  const v = employeeSchema.parse(input);
  await validateReferences(c, v);
  let previous = null;
  if (id) {
    previous = (
      await c.query("SELECT * FROM ad.employees WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!previous) fail(404, "Funcionário não encontrado.");
    const account = (
      await c.query("SELECT id FROM ad.users WHERE employee_id=$1", [id])
    ).rows[0];
    if (account && previous.cpf !== v.cpf)
      await c.query("UPDATE ad.users SET username=$1 WHERE employee_id=$2", [
        v.cpf,
        id,
      ]);
  }
  const values = [
    v.name,
    v.cpf,
    v.re,
    v.position_id,
    v.status,
    v.admission_date,
    v.position_start,
    v.level_start,
  ];
  if (id)
    await c.query(
      "UPDATE ad.employees SET name=$1,cpf=$2,re=$3,position_id=$4,status=$5,admission_date=$6,position_start=$7,level_start=$8,updated_at=now() WHERE id=$9",
      [...values, id],
    );
  else
    id = (
      await c.query(
        "INSERT INTO ad.employees(name,cpf,re,position_id,status,admission_date,position_start,level_start) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        values,
      )
    ).rows[0].id;
  const current = (
    await c.query(
      "SELECT * FROM ad.organizational_links WHERE employee_id=$1 AND ended_at IS NULL",
      [id],
    )
  ).rows[0];
  if (
    !current ||
    current.sector_id !== v.sector_id ||
    current.manager_id !== v.manager_id ||
    current.supervisor_id !== v.supervisor_id
  ) {
    await c.query(
      "UPDATE ad.organizational_links SET ended_at=now() WHERE employee_id=$1 AND ended_at IS NULL",
      [id],
    );
    await c.query(
      "INSERT INTO ad.organizational_links(employee_id,sector_id,manager_id,supervisor_id,created_by) VALUES($1,$2,$3,$4,$5)",
      [id, v.sector_id, v.manager_id, v.supervisor_id, user.id],
    );
    await syncEmployeeEvaluations(c, id, current, v, user);
  }
  await audit(
    c,
    user,
    previous ? "employee.update" : "employee.create",
    "employees",
    id,
    previous ? { before: previous, after: v } : { after: v },
  );
  return id;
}
