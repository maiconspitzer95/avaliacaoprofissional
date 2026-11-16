import bcrypt from "bcryptjs";
import { pool, transaction, requireDatabaseConfig } from "../pool.js";
try {
  requireDatabaseConfig();
  await transaction(async (c) => {
    const hash = await bcrypt.hash("master", 12);
    const r = await c.query(
      "INSERT INTO ad.users(username,password_hash,role_id) VALUES('master',$1,'master') ON CONFLICT(username) DO NOTHING RETURNING id",
      [hash],
    );
    if (r.rowCount)
      await c.query(
        "INSERT INTO ad.audit(user_id,action,entity) VALUES($1,'installation.seed','users')",
        [r.rows[0].id],
      );
    console.log(
      r.rowCount
        ? "Master inicial criado; troca obrigatória de senha."
        : "Master existente preservado.",
    );
  });
} catch (e) {
  console.error("Seed não aplicada:", e.code || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
