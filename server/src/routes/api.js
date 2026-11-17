import { Router } from "express";
import { evaluations } from './evaluations.js';
import { development } from './development.js';
import { contestations } from './contestations.js';
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, transaction } from "../database/pool.js";
import {
  auth,
  passwordChanged,
  permission,
  visibility,
  settings,
} from "../middleware/security.js";
import { login, logout, changePassword } from "../controllers/auth.js";
import { positiveId, userSchema, fail } from "../utils/validation.js";
import { employeeSelect, saveEmployee } from "../services/employees.js";
import { audit } from "../services/audit.js";
import {
  parseFile,
  preview,
  commitImport,
  importInput,
} from "../services/imports.js";
export const api = Router();
api.use((req, res, next) => {
  for (const key of ["password", "current_password"])
    if (
      typeof req.body?.[key] === "string" &&
      Buffer.byteLength(req.body[key], "utf8") > 72
    )
      return res
        .status(400)
        .json({
          message:
            "A senha excede o limite de 72 bytes UTF-8. Use uma senha menor.",
        });
  if (req.path === "/settings" && Number(req.body?.password_min_length) > 72)
    return res
      .status(400)
      .json({
        message: "O mínimo configurável não pode ultrapassar 72 caracteres.",
      });
  next();
});
const sensitive = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Muitas tentativas. Aguarde 15 minutos." },
});
api.post("/auth/login", sensitive, login);
api.use(auth);
api.get("/auth/me", (req, res) => {
  const { token_hash, ...u } = req.user;
  res.json(u);
});
api.post("/auth/logout", logout);
api.post("/auth/password", sensitive, changePassword);
api.use(passwordChanged);
api.use('/evaluations',evaluations);
api.use('/development',development);
api.use('/contestations',contestations);
api.get("/dashboard", async (req, res) => {
  const v = visibility(req.user);
  const r = await pool.query(
    `SELECT count(*)::int total,count(*) FILTER(WHERE e.status='ativo')::int active FROM ad.employees e WHERE ${v.sql}`,
    v.params,
  );
  res.json(r.rows[0]);
});
api.get("/employees", permission("employees:read"), async (req, res) => {
  const v = visibility(req.user);
  const params = [...v.params];
  let where = v.sql;
  for (const [key, sql] of [
    ["q", "(e.name ILIKE ? OR e.re ILIKE ?)"],
    ["status", "e.status=?"],
    ["sector_id", "l.sector_id=?"],
    ["nucleus_id", "s.nucleus_id=?"],
  ]) {
    if (req.query[key]) {
      params.push(
        key === "q"
          ? `%${String(req.query[key]).slice(0, 150)}%`
          : req.query[key],
      );
      where += " AND " + sql.replaceAll("?", `$${params.length}`);
    }
  }
  res.json(
    (
      await pool.query(
        `${employeeSelect} WHERE ${where} ORDER BY e.name LIMIT 1000`,
        params,
      )
    ).rows,
  );
});
api.get(
  "/employees/:id/history",
  permission("employees:read"),
  async (req, res) => {
    const id = positiveId(req.params.id),
      v = visibility(req.user, "e", 2);
    if (
      !(
        await pool.query(
          `SELECT 1 FROM ad.employees e WHERE e.id=$1 AND ${v.sql}`,
          [id, ...v.params],
        )
      ).rowCount
    )
      fail(404, "Funcionário não encontrado.");
    res.json(
      (
        await pool.query(
          "SELECT l.*,s.name sector_name FROM ad.organizational_links l JOIN ad.sectors s ON s.id=l.sector_id WHERE employee_id=$1 ORDER BY started_at DESC",
          [id],
        )
      ).rows,
    );
  },
);
api.post("/employees", permission("employees:write"), async (req, res) =>
  res
    .status(201)
    .json({
      id: await transaction((c) => saveEmployee(c, req.body, req.user)),
    }),
);
api.put("/employees/:id", permission("employees:write"), async (req, res) =>
  res.json({
    id: await transaction((c) =>
      saveEmployee(c, req.body, req.user, positiveId(req.params.id)),
    ),
  }),
);
api.get("/lookups", async (req, res) => {
  const full = ["master", "rh"].includes(req.user.role_id);
  const [n, s, p, u] = await Promise.all([
    pool.query("SELECT * FROM ad.nuclei ORDER BY name"),
    pool.query("SELECT * FROM ad.sectors ORDER BY name"),
    pool.query("SELECT * FROM ad.positions ORDER BY name"),
    full
      ? pool.query(
          "SELECT u.id,u.username,u.role_id,coalesce(e.name,u.username) name FROM ad.users u LEFT JOIN ad.employees e ON e.id=u.employee_id WHERE u.active AND u.role_id IN ('gerente','gestor') ORDER BY name",
        )
      : Promise.resolve({ rows: [] }),
  ]);
  res.json({
    nuclei: n.rows,
    sectors: s.rows,
    positions: p.rows,
    leaders: u.rows,
  });
});
api.use(permission("admin"));
for (const table of ["nuclei", "sectors", "positions"]) {
  const schema = z.object({
    name: z.string().trim().min(2).max(120),
    active: z.boolean().default(true),
    ...(table === "sectors"
      ? { nucleus_id: z.coerce.number().int().positive() }
      : {}),
  });
  api.get("/" + table, async (req, res) =>
    res.json(
      (await pool.query(`SELECT * FROM ad.${table} ORDER BY name`)).rows,
    ),
  );
  for (const method of ["post", "put"])
    api[method](
      "/" + table + (method === "put" ? "/:id" : ""),
      async (req, res) => {
        const v = schema.parse(req.body),
          id = method === "put" ? positiveId(req.params.id) : null;
        res.json(
          await transaction(async (c) => {
            const cols = Object.keys(v),
              values = Object.values(v);
            const r = await c.query(
              id
                ? `UPDATE ad.${table} SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${values.length + 1} RETURNING *`
                : `INSERT INTO ad.${table}(${cols.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
              id ? [...values, id] : values,
            );
            if (!r.rowCount) fail(404, "Cadastro não encontrado.");
            await audit(
              c,
              req.user,
              id ? "catalog.update" : "catalog.create",
              table,
              r.rows[0].id,
              v,
            );
            return r.rows[0];
          }),
        );
      },
    );
}
api.get("/users", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.username,u.role_id,u.employee_id,u.active,u.must_change_password,e.name FROM ad.users u LEFT JOIN ad.employees e ON e.id=u.employee_id ORDER BY u.id",
      )
    ).rows,
  ),
);
api.post("/users", async (req, res) => {
  const v = userSchema.parse(req.body),
    conf = await settings();
  if (v.password.length < conf.password_min_length)
    fail(400, `Senha mínima: ${conf.password_min_length} caracteres.`);
  const hash = await bcrypt.hash(v.password, 12);
  const result = await transaction(async (c) => {
    const e = (
      await c.query("SELECT cpf FROM ad.employees WHERE id=$1", [v.employee_id])
    ).rows[0];
    if (!e) fail(400, "Funcionário não encontrado.");
    const u = (
      await c.query(
        "INSERT INTO ad.users(username,password_hash,role_id,employee_id,active) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [e.cpf, hash, v.role_id, v.employee_id, v.active],
      )
    ).rows[0];
    if (v.role_id === "gerente" || v.role_id === "gestor")
      await c.query(
        `INSERT INTO ad.${v.role_id === "gerente" ? "managers" : "supervisors"}(user_id) VALUES($1) ON CONFLICT DO NOTHING`,
        [u.id],
      );
    await audit(c, req.user, "user.create", "users", u.id, { role: v.role_id });
    return u;
  });
  res.status(201).json(result);
});
api.put("/users/:id", async (req, res) => {
  const id = positiveId(req.params.id),
    v = z
      .object({
        role_id: z.enum(["rh", "gerente", "gestor", "colaborador"]),
        active: z.boolean(),
      })
      .parse(req.body);
  await transaction(async (c) => {
    const target = (
      await c.query("SELECT * FROM ad.users WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!target) fail(404, "Usuário não encontrado.");
    if (target.role_id === "master" || id === req.user.id)
      fail(400, "Não é permitido alterar este acesso.");
    if (target.role_id !== v.role_id || !v.active) {
      const links = await c.query(
        "SELECT 1 FROM ad.organizational_links WHERE ended_at IS NULL AND (manager_id=$1 OR supervisor_id=$1) LIMIT 1",
        [id],
      );
      if (links.rowCount)
        fail(
          400,
          "Transfira os vínculos ativos deste responsável antes de alterar o perfil ou desativar.",
        );
    }
    await c.query("UPDATE ad.users SET role_id=$1,active=$2 WHERE id=$3", [
      v.role_id,
      v.active,
      id,
    ]);
    if (["gerente", "gestor"].includes(v.role_id))
      await c.query(
        `INSERT INTO ad.${v.role_id === "gerente" ? "managers" : "supervisors"}(user_id) VALUES($1) ON CONFLICT DO NOTHING`,
        [id],
      );
    await c.query("DELETE FROM ad.sessions WHERE user_id=$1", [id]);
    await audit(c, req.user, "user.update", "users", id, v);
  });
  res.json({ ok: true });
});
api.post("/users/:id/reset-password", async (req, res) => {
  const id = positiveId(req.params.id),
    v = z.object({ password: z.string().min(6).max(128) }).parse(req.body);
  const conf = await settings();
  if (v.password.length < conf.password_min_length)
    fail(400, "Senha menor que a política configurada.");
  const hash = await bcrypt.hash(v.password, 12);
  await transaction(async (c) => {
    const target = (
      await c.query("SELECT role_id FROM ad.users WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!target) fail(404, "Usuário não encontrado.");
    if (target.role_id === "master")
      fail(403, "Master deve alterar sua própria senha.");
    await c.query(
      "UPDATE ad.users SET password_hash=$1,must_change_password=true WHERE id=$2",
      [hash, id],
    );
    await c.query("DELETE FROM ad.sessions WHERE user_id=$1", [id]);
    await audit(c, req.user, "user.password_reset", "users", id);
  });
  res.json({ ok: true });
});
api.get("/hierarchy/exceptions", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT h.*,u.username,e.name FROM ad.hierarchy_exceptions h JOIN ad.users u ON u.id=h.user_id JOIN ad.employees e ON e.id=h.employee_id ORDER BY h.id DESC",
      )
    ).rows,
  ),
);
api.post("/hierarchy/exceptions", async (req, res) => {
  const v = z
    .object({
      user_id: z.coerce.number().int().positive(),
      employee_id: z.coerce.number().int().positive(),
      reason: z.string().trim().min(10).max(1000),
      active: z.boolean(),
    })
    .parse(req.body);
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO ad.hierarchy_exceptions(user_id,employee_id,reason,active,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,employee_id) DO UPDATE SET reason=excluded.reason,active=excluded.active,created_by=excluded.created_by",
      [v.user_id, v.employee_id, v.reason, v.active, req.user.id],
    );
    await audit(
      c,
      req.user,
      "hierarchy.exception",
      "employees",
      v.employee_id,
      v,
    );
  });
  res.json({ ok: true });
});
api.post("/imports/parse", async (req, res) => {
  const v = z
    .object({ filename: z.string().max(180), base64: z.string().max(3000000) })
    .parse(req.body);
  const input = await parseFile(v.filename, v.base64);
  res.json(await preview(pool, input.rows));
});
api.post("/imports/preview", async (req, res) => {
  const input = importInput.parse(req.body);
  res.json(await preview(pool, input.rows));
});
api.post("/imports/confirm", async (req, res) =>
  res.json(
    await transaction((c) =>
      commitImport(c, importInput.parse(req.body), req.user),
    ),
  ),
);
api.get("/imports", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT i.*,u.username FROM ad.imports i JOIN ad.users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 100",
      )
    ).rows,
  ),
);
api.get("/audit", permission("audit:read"), async (req, res) => {
  const page = Math.max(0, Math.min(100000, Number(req.query.page) || 0));
  res.json(
    (
      await pool.query(
        "SELECT a.*,u.username FROM ad.audit a LEFT JOIN ad.users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100 OFFSET $1",
        [page * 100],
      )
    ).rows,
  );
});
api.get("/settings", async (req, res) => res.json(await settings()));
api.put("/settings", async (req, res) => {
  const v = z
    .object({
      password_min_length: z.coerce.number().int().min(6).max(72),
      session_idle_minutes: z.coerce.number().int().min(5).max(480),
    })
    .parse(req.body);
  await transaction(async (c) => {
    await c.query(
      "UPDATE ad.settings SET password_min_length=$1,session_idle_minutes=$2 WHERE id=true",
      [v.password_min_length, v.session_idle_minutes],
    );
    await audit(c, req.user, "settings.update", "settings", null, v);
  });
  res.json({ ok: true });
});
