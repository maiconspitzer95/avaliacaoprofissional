import { pool, requireDatabaseConfig } from "./pool.js";
try {
  requireDatabaseConfig();
  const r = await pool.query(
    "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
  );
  console.table(r.rows);
} catch (e) {
  console.error("Inspeção indisponível:", e.code || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
