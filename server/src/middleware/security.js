import { createHash, randomBytes } from "node:crypto";
import { pool } from "../database/pool.js";
import { fail } from "../utils/validation.js";
export const digest = (s) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
};
export async function settings(c = pool) {
  const r = await c.query("SELECT * FROM ad.settings WHERE id=true");
  return {
    password_min_length: Math.max(
      r.rows[0].password_min_length,
      Number(process.env.PASSWORD_MIN_LENGTH) || 6,
    ),
    session_idle_minutes: Math.min(
      r.rows[0].session_idle_minutes,
      Number(process.env.SESSION_IDLE_MINUTES) || 480,
    ),
  };
}
export async function auth(req, res, next) {
  try {
    const token = req.cookies.ad_session;
    if (!token) fail(401, "Entre para continuar.");
    const conf = await settings();
    const r = await pool.query(
      "UPDATE ad.sessions s SET last_seen=now() FROM ad.users u WHERE s.token_hash=$1 AND s.user_id=u.id AND u.active AND s.expires_at>now() AND s.last_seen>now()-($2 * interval '1 minute') RETURNING u.id,u.username,u.role_id,u.employee_id,u.must_change_password,s.csrf_token,s.token_hash",
      [digest(token), conf.session_idle_minutes],
    );
    if (!r.rowCount) {
      res.clearCookie("ad_session", cookieOptions);
      fail(401, "Sessão expirada. Entre novamente.");
    }
    req.user = r.rows[0];
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== req.user.csrf_token
    )
      fail(403, "Solicitação inválida. Atualize a página.");
    next();
  } catch (e) {
    next(e);
  }
}
export function passwordChanged(req, res, next) {
  if (req.user.must_change_password)
    return next(
      Object.assign(new Error("Troque a senha inicial para continuar."), {
        status: 403,
      }),
    );
  next();
}
export function permission(name) {
  return async (req, res, next) => {
    try {
      const r = await pool.query(
        "SELECT 1 FROM ad.role_permissions WHERE role_id=$1 AND permission_id=$2",
        [req.user.role_id, name],
      );
      if (!r.rowCount) fail(403, "Acesso não autorizado.");
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function visibility(user, alias = "e", offset = 1) {
  if (["master", "rh"].includes(user.role_id))
    return { sql: "TRUE", params: [] };
  return {
    sql: `(${alias}.id=$${offset} OR EXISTS(SELECT 1 FROM ad.organizational_links vl WHERE vl.employee_id=${alias}.id AND vl.ended_at IS NULL AND (($${offset + 2}='gerente' AND vl.manager_id=$${offset + 1}) OR ($${offset + 2}='gestor' AND vl.supervisor_id=$${offset + 1}))) OR EXISTS(SELECT 1 FROM ad.hierarchy_exceptions hx WHERE hx.employee_id=${alias}.id AND hx.user_id=$${offset + 1} AND hx.active))`,
    params: [user.employee_id, user.id, user.role_id],
  };
}
