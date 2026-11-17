import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { employeeSchema, fail } from "../utils/validation.js";
import { validateReferences, saveEmployee } from "./employees.js";
import { audit } from "./audit.js";
export const importInput = z.object({
  filename: z.string().min(1).max(180),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
});
export async function parseFile(filename, base64) {
  if (!/\.(csv|xlsx)$/i.test(filename)) fail(400, "Use CSV ou XLSX.");
  if (typeof base64 !== "string" || base64.length > 3000000)
    fail(400, "Arquivo excede 2 MB.");
  const buffer = Buffer.from(base64, "base64");
  let rows;
  if (/\.csv$/i.test(filename)) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: text.split(/\r?\n/)[0].includes(";") ? ";" : ",",
      max_record_size: 10000,
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 1001)
      fail(400, "Limite de 1000 registros por arquivo.");
    const headers = sheet.getRow(1).values.slice(1).map(String);
    rows = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const obj = {};
      headers.forEach((h, i) => {
        let v = row.getCell(i + 1).value;
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        if (v && typeof v === "object") v = row.getCell(i + 1).text;
        obj[h] = v ?? "";
      });
      rows.push(obj);
    });
  }
  return importInput.parse({ filename, rows });
}
export async function preview(c, rows) {
  const cpfs = new Set(),
    res = new Set(),
    report = [];
  for (let i = 0; i < rows.length; i++) {
    const parsed = employeeSchema.safeParse(rows[i]);
    const item = {
      line: i + 2,
      input: rows[i],
      errors: [],
      action: null,
      id: null,
    };
    if (!parsed.success)
      item.errors = parsed.error.issues.map(
        (x) => `${x.path.join(".")}: ${x.message}`,
      );
    else {
      const v = parsed.data;
      item.input = v;
      if (cpfs.has(v.cpf) || res.has(v.re))
        item.errors.push("CPF ou RE repetido no arquivo.");
      cpfs.add(v.cpf);
      res.add(v.re);
      try {
        await validateReferences(c, v);
      } catch (e) {
        if (!e.status) throw e;
        item.errors.push(e.message);
      }
      const found = (
        await c.query(
          "SELECT id,cpf,re FROM ad.employees WHERE cpf=$1 OR re=$2",
          [v.cpf, v.re],
        )
      ).rows;
      if (found.length > 1 || (found.length === 1 && found[0].cpf !== v.cpf))
        item.errors.push("CPF e RE conflitam com o cadastro existente.");
      item.id = found.find((x) => x.cpf === v.cpf)?.id || null;
      item.action = item.id ? "atualizar" : "cadastrar";
    }
    report.push(item);
  }
  return report;
}
export async function commitImport(c, input, user) {
  await c.query("SELECT pg_advisory_xact_lock(5005002)");
  const report = await preview(c, input.rows);
  if (report.some((r) => r.errors.length))
    fail(400, "Existem erros na importação. Corrija e valide novamente.");
  for (const row of report)
    row.id = await saveEmployee(c, row.input, user, row.id);
  const result = report.map(({ line, id, action }) => ({ line, id, action }));
  const r = await c.query(
    "INSERT INTO ad.imports(user_id,filename,total,report) VALUES($1,$2,$3,$4) RETURNING id,created_at",
    [user.id, input.filename, result.length, JSON.stringify(result)],
  );
  await audit(c, user, "import.commit", "imports", r.rows[0].id, {
    total: result.length,
  });
  return { ...r.rows[0], report: result };
}
