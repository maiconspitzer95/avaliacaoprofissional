import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, transaction } from "../database/pool.js";
import { audit } from "../services/audit.js";
import {
  cookieOptions,
  digest,
  randomToken,
  settings,
} from "../middleware/security.js";
import { fail } from "../utils/validation.js";
const dummy = await bcrypt.hash(randomToken(), 12);
export async function login(req, res) {
  const input = z
    .object({
      username: z.string().min(1).max(30),
      password: z.string().min(1).max(128),
    })
    .parse(req.body);
  const username =
    input.username === "master" ? "master" : input.username.replace(/\D/g, "");
  const r = await pool.query("SELECT * FROM ad.users WHERE username=$1", [
    username,
  ]);
  const u = r.rows[0];
  const ok = await bcrypt.compare(input.password, u?.password_hash || dummy);
  if (!u || !ok || !u.active) {
    await audit(pool, null, "auth.failure", "users", null);
    fail(401, "Usuário ou senha inválidos.");
  }
  const token = randomToken(),
    csrf = randomToken();
  await transaction(async (c) => {
    await c.query("DELETE FROM ad.sessions WHERE expires_at<now()");
    await c.query(
      "INSERT INTO ad.sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
      [digest(token), u.id, csrf],
    );
    await audit(c, u, "auth.login", "users", u.id);
  });
  res
    .cookie("ad_session", token, cookieOptions)
    .json({
      id: u.id,
      username: u.username,
      role_id: u.role_id,
      employee_id: u.employee_id,
      must_change_password: u.must_change_password,
      csrf_token: csrf,
    });
}
export async function changePassword(req, res) {
  const input = z
    .object({
      current_password: z.string().min(1).max(128),
      password: z.string().min(6).max(128),
    })
    .parse(req.body);
  const conf = await settings();
  if (input.password.length < conf.password_min_length)
    fail(
      400,
      `A senha deve ter pelo menos ${conf.password_min_length} caracteres.`,
    );
  if (input.password === input.current_password)
    fail(400, "Escolha uma senha diferente da atual.");
  const hash = await bcrypt.hash(input.password, 12);
  await transaction(async (c) => {
    const r = await c.query(
      "SELECT password_hash FROM ad.users WHERE id=$1 FOR UPDATE",
      [req.user.id],
    );
    if (
      !(await bcrypt.compare(input.current_password, r.rows[0].password_hash))
    )
      fail(400, "Senha atual incorreta.");
    await c.query(
      "UPDATE ad.users SET password_hash=$1,must_change_password=false WHERE id=$2",
      [hash, req.user.id],
    );
    await c.query("DELETE FROM ad.sessions WHERE user_id=$1", [req.user.id]);
    await audit(c, req.user, "auth.password_changed", "users", req.user.id);
  });
  res
    .clearCookie("ad_session", cookieOptions)
    .json({ message: "Senha alterada. Entre novamente." });
}
export async function logout(req, res) {
  await transaction(async (c) => {
    await c.query("DELETE FROM ad.sessions WHERE token_hash=$1", [
      req.user.token_hash,
    ]);
    await audit(c, req.user, "auth.logout", "users", req.user.id);
  });
  res.clearCookie("ad_session", cookieOptions).json({ ok: true });
}
