import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5434),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  connectionTimeoutMillis: 5000,
  options: "-c search_path=ad,public",
});
export function requireDatabaseConfig() {
  const missing = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"].filter(
    (k) => !process.env[k],
  );
  if (missing.length)
    throw new Error("Configure o arquivo .env: " + missing.join(", "));
}
pool.on("error", (e) =>
  console.error(JSON.stringify({ event: "database.pool_error", code: e.code })),
);
export async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
