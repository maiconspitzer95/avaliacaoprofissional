import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "../server/src/database/pool.js";
const file = new URL("../docs/preservation-phase3.json", import.meta.url);
const digest = (v) => createHash("sha256").update(v).digest("hex");
try {
  const before = process.argv.includes("--capture");
  const previous = before ? null : JSON.parse(await readFile(file, "utf8"));
  const tables = before
    ? (
        await pool.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='ad' AND tablename<>'schema_migrations' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename)
    : Object.keys(previous.tables);
  const snapshot = { tables: {}, migrations: {} };
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Nome de tabela inválido");
    // Only hashes and counts leave PostgreSQL; no personal data or passwords are stored.
    snapshot.tables[table] = (
      await pool.query(
        `SELECT count(*)::int count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) hash FROM (SELECT md5(row_to_json(t)::text) row_hash FROM ad.${table} t) rows`,
      )
    ).rows[0];
  }
  for (const name of ["001_foundation.sql", "002_evaluations.sql"])
    snapshot.migrations[name] = digest(
      await readFile(
        new URL("../server/src/database/migrations/" + name, import.meta.url),
      ),
    );
  if (before) {
    await writeFile(file, JSON.stringify(snapshot, null, 2));
    console.log(
      "Referência de preservação registrada (somente hashes e contagens).",
    );
  } else {
    const businessOnly = process.argv.includes('--business-only');
    const changed = Object.keys(snapshot.tables).filter(
      (t) =>
        JSON.stringify(snapshot.tables[t]) !==
        JSON.stringify(previous.tables[t]),
    );
    if (
      changed.some(t=>!businessOnly||t!=='sessions') ||
      JSON.stringify(snapshot.migrations) !==
        JSON.stringify(previous.migrations)
    )
      throw new Error("Diferenças detectadas: " + changed.join(", "));
    if(businessOnly && changed.includes('sessions')) console.log('Diferença operacional detectada na tabela sessions; referência original mantida. Contagem anterior: '+previous.tables.sessions.count+'; atual: '+snapshot.tables.sessions.count+'.');
    console.log(`Preservação confirmada: ${tables.length-(businessOnly?1:0)} tabelas ${businessOnly?'fora de sessions':'originais'} e migrations 001/002 sem alterações.`);
  }
} finally {
  await pool.end();
}
