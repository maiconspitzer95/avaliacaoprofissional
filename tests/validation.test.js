import test from "node:test";
import assert from "node:assert/strict";
import { validCpf, employeeSchema } from "../server/src/utils/validation.js";
import { visibility } from "../server/src/middleware/security.js";
import { parseFile } from "../server/src/services/imports.js";
import ExcelJS from "exceljs";
test("CPF: dígitos verificadores, sequência repetida e normalização", () => {
  assert.equal(validCpf("52998224725"), true);
  assert.equal(validCpf("52998224726"), false);
  assert.equal(validCpf("11111111111"), false);
  assert.equal(validCpf("123"), false);
});
const employee = {
  name: "Pessoa de Teste",
  cpf: "529.982.247-25",
  re: "0001",
  position_id: 1,
  sector_id: 1,
  manager_id: "",
  supervisor_id: "",
  status: "ativo",
  admission_date: "2025-01-01",
  position_start: "2025-01-02",
  level_start: "2025-01-02",
};
test("Funcionário: normaliza CPF e responsáveis opcionais", () => {
  const v = employeeSchema.parse(employee);
  assert.equal(v.cpf, "52998224725");
  assert.equal(v.manager_id, null);
});
test("Funcionário: rejeita datas impossíveis e anteriores à admissão", () => {
  assert.equal(
    employeeSchema.safeParse({ ...employee, admission_date: "2025-02-30" })
      .success,
    false,
  );
  assert.equal(
    employeeSchema.safeParse({ ...employee, position_start: "2024-12-01" })
      .success,
    false,
  );
});
test("Visibilidade: somente RH/Master têm consulta global", () => {
  for (const role_id of ["master", "rh"])
    assert.equal(visibility({ role_id }).sql, "TRUE");
  for (const role_id of ["gerente", "gestor", "colaborador"]) {
    const scope = visibility({ role_id, id: 42, employee_id: 7 });
    assert.notEqual(scope.sql, "TRUE");
    assert.deepEqual(scope.params, [7, 42, role_id]);
    assert.match(scope.sql, /ended_at IS NULL/);
    assert.match(scope.sql, /hx.active/);
  }
});
test("CSV preserva zeros e rejeita arquivo sem registros", async () => {
  const v = await parseFile(
    "teste.csv",
    Buffer.from("name;cpf;re\nTeste;01234567890;0001").toString("base64"),
  );
  assert.equal(v.rows[0].re, "0001");
  assert.equal(v.rows[0].cpf, "01234567890");
  await assert.rejects(() =>
    parseFile("teste.csv", Buffer.from("name;cpf;re\n").toString("base64")),
  );
});
test("Importação rejeita extensão não permitida", async () => {
  await assert.rejects(() => parseFile("teste.exe", ""), /CSV ou XLSX/);
});
test("XLSX: escrita e leitura preservam CPF, RE e datas", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Funcionários");
  sheet.addRow(["name", "cpf", "re", "admission_date"]);
  sheet.addRow([
    "Pessoa teste",
    "01234567890",
    "0001",
    new Date("2025-01-01T00:00:00Z"),
  ]);
  const buffer = await book.xlsx.writeBuffer();
  const parsed = await parseFile(
    "teste.xlsx",
    Buffer.from(buffer).toString("base64"),
  );
  assert.equal(parsed.rows[0].cpf, "01234567890");
  assert.equal(parsed.rows[0].re, "0001");
  assert.equal(parsed.rows[0].admission_date, "2025-01-01");
});
