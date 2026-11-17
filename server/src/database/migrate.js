import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, transaction, requireDatabaseConfig } from "./pool.js";
try {
  requireDatabaseConfig();
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(5005001)");
    const existing = await c.query(
      "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
    );
    console.log("Inspeção anterior às alterações:");
    console.table(existing.rows);
    const owned = existing.rows.filter((t) => t.table_schema === "ad");
    if (
      owned.length &&
      !owned.some((t) => t.table_name === "schema_migrations")
    )
      throw new Error(
        "Schema ad já ocupado sem controle de versões. Revisão manual necessária; nenhuma alteração aplicada.",
      );
    await c.query("CREATE SCHEMA IF NOT EXISTS ad");
    await c.query(
      "CREATE TABLE IF NOT EXISTS ad.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = new URL("./migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(name, dir), "utf8"),
        hash = createHash("sha256").update(sql).digest("hex");
      const old = await c.query(
        "SELECT checksum FROM ad.schema_migrations WHERE name=$1",
        [name],
      );
      if (old.rowCount) {
        if (old.rows[0].checksum !== hash)
          throw new Error(`Migration alterada: ${name}`);
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO ad.schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash],
      );
      console.log("Aplicada:", name);
    }
  });
} catch (e) {
  console.error("Migration cancelada:", e.code || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
