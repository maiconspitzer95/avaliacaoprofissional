import test from "node:test";
import assert from "node:assert/strict";
import {
  transferAssignment,
  reviewTransfer,
  result,
} from "../server/src/services/evaluations.js";
function fixture() {
  const p = {
    id: 7,
    employee_id: 99,
    released: false,
    cycle_status: "open",
    role_weights: { gestor: "2" },
  };
  const rows = [
    {
      id: 1,
      participant_id: 7,
      evaluator_id: 10,
      profile: "gestor",
      kind: "manager",
      weight: "2",
      status: "pending",
      review_needed: false,
      version: 1,
      answers: { 11: 4 },
    },
  ];
  const revisions = [{ assignment_id: 1, revision: 1, answers: { 11: 4 } }],
    transfers = [],
    queries = [];
  const c = {
    async query(sql, args = []) {
      queries.push(sql);
      if (sql.startsWith("SELECT a.*"))
        return { rows: rows.map((a) => ({ ...a })) };
      if (sql.includes("FROM ad.cycle_participants p JOIN ad.employees"))
        return { rows: [p] };
      if (sql.startsWith("SELECT * FROM ad.users"))
        return {
          rows: [
            { id: args[0], active: true, role_id: "gestor", employee_id: 30 },
          ],
        };
      if (sql.startsWith("SELECT * FROM ad.evaluation_transfers"))
        return { rows: transfers.filter((t) => t.id === args[0]) };
      if (sql.startsWith("SELECT 1 FROM ad.evaluation_transfers"))
        return {
          rowCount: transfers.filter(
            (t) => t.assignment_id === args[0] && !t.decision,
          ).length,
        };
      if (sql.startsWith("INSERT INTO ad.evaluation_assignments")) {
        const a = {
          id: 2,
          participant_id: args[0],
          evaluator_id: args[1],
          profile: args[2],
          kind: args[3],
          weight: args[4],
          predecessor_id: args[5],
          status: "pending",
          review_needed: false,
          version: 0,
          answers: {},
        };
        rows.push(a);
        return { rows: [{ ...a }] };
      }
      if (sql.startsWith("UPDATE ad.evaluation_assignments")) {
        if (sql.includes("status='superseded'"))
          Object.assign(
            rows.find((a) => a.id === args[0]),
            { status: "superseded", review_needed: false },
          );
        else if (sql.includes("version=1"))
          Object.assign(
            rows.find((a) => a.id === args[0]),
            { version: 1, review_needed: true },
          );
        else if (sql.includes("version=$1"))
          rows.find((a) => a.id === args[1]).version = args[0];
        else if (sql.includes("review_needed=$1"))
          rows.find((a) => a.id === args[1]).review_needed = args[0];
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO ad.evaluation_responses")) {
        const empty = sql.includes("'{}'");
        const revision = empty ? args[1] : 1,
          answers = empty ? {} : JSON.parse(args[1]);
        revisions.push({ assignment_id: args[0], revision, answers });
        rows.find((a) => a.id === args[0]).answers = answers;
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO ad.evaluation_transfers")) {
        const t = {
          id: 5,
          participant_id: args[0],
          assignment_id: args[1],
          previous_evaluator_id: args[2],
          next_evaluator_id: args[3],
          decision: args[6],
        };
        transfers.push(t);
        return { rows: [{ id: 5 }] };
      }
      if (sql.startsWith("UPDATE ad.evaluation_transfers")) {
        transfers.find((t) => t.id === args[3]).decision = args[0];
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO ad.audit")) return { rows: [] };
      throw new Error("Consulta inesperada no teste: " + sql);
    },
  };
  return { p, rows, revisions, transfers, queries, c };
}
test("Serviço transfere rascunho sem sobrescrever origem e mantém peso do ciclo", async () => {
  const f = fixture();
  await transferAssignment(
    f.c,
    f.p,
    { ...f.rows[0] },
    20,
    { id: 3 },
    "Troca de setor autorizada",
  );
  assert.equal(f.rows[0].status, "superseded");
  assert.deepEqual(f.rows[0].answers, { 11: 4 });
  assert.equal(f.rows[1].evaluator_id, 20);
  assert.equal(f.rows[1].weight, "2");
  assert.equal(f.rows[1].review_needed, true);
  assert.equal(f.rows[1].predecessor_id, 1);
  assert.equal(f.revisions.length, 2);
  assert.ok(
    f.queries.every((q) => !/^DELETE|^UPDATE ad.evaluation_responses/.test(q)),
  );
});
test("RH desconsidera rascunho por nova revisão sem apagar resposta anterior", async () => {
  const f = fixture();
  await transferAssignment(
    f.c,
    f.p,
    { ...f.rows[0] },
    20,
    { id: 3 },
    "Troca de setor autorizada",
  );
  await reviewTransfer(
    f.c,
    5,
    "discard",
    "Rascunho fora do período observado",
    { id: 3 },
  );
  assert.deepEqual(f.rows[1].answers, {});
  assert.equal(f.rows[1].review_needed, false);
  assert.equal(f.rows[1].version, 2);
  assert.deepEqual(f.revisions[1].answers, { 11: 4 });
  assert.equal(f.transfers[0].decision, "discard");
});
test("RH preserva respostas e desbloqueia novo avaliador; impede redecisão", async () => {
  const f = fixture();
  await transferAssignment(
    f.c,
    f.p,
    { ...f.rows[0] },
    20,
    { id: 3 },
    "Troca de setor autorizada",
  );
  await reviewTransfer(
    f.c,
    5,
    "accept",
    "Observações anteriores consideradas válidas",
    { id: 3 },
  );
  assert.deepEqual(f.rows[1].answers, { 11: 4 });
  assert.equal(f.rows[1].review_needed, false);
  await assert.rejects(
    () =>
      reviewTransfer(f.c, 5, "discard", "Tentativa de redecidir", { id: 3 }),
    /já decidida/,
  );
});
test("Não transfere novamente enquanto existir decisão de validade pendente", async () => {
  const f = fixture();
  await assert.rejects(
    () =>
      transferAssignment(
        f.c,
        f.p,
        { ...f.rows[0], review_needed: true },
        20,
        { id: 3 },
        "Segunda transferência",
      ),
    /anterior/,
  );
  assert.equal(f.queries.length, 0);
});
test("Transferência para avaliador já distribuído nunca altera as respostas dele", async () => {
  const f = fixture();
  f.rows.push({
    id: 3,
    participant_id: 7,
    evaluator_id: 20,
    profile: "gestor",
    kind: "manager",
    weight: "2",
    status: "submitted",
    review_needed: false,
    version: 1,
    answers: { 11: 5 },
  });
  const query = f.c.query.bind(f.c);
  f.c.query = async (sql, args = []) => {
    if (
      sql ===
      "UPDATE ad.evaluation_assignments SET review_needed=true WHERE id=$1"
    ) {
      f.rows.find((a) => a.id === args[0]).review_needed = true;
      return { rows: [] };
    }
    if (
      sql.startsWith(
        "SELECT 1 FROM ad.evaluation_transfers WHERE participant_id=",
      )
    )
      return { rowCount: f.transfers.filter((t) => !t.decision).length };
    return query(sql, args);
  };
  await transferAssignment(
    f.c,
    f.p,
    { ...f.rows[0] },
    20,
    { id: 3 },
    "Novo responsável já avaliou",
  );
  assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows[1].answers, { 11: 5 });
  assert.equal(f.rows[1].status, "submitted");
  assert.equal(f.rows[1].review_needed, false);
  await assert.rejects(() => result(f.c, f.p), /decisões de validade/);
  await reviewTransfer(f.c, 5, "discard", "Não mesclar rascunho antigo", {
    id: 3,
  });
  assert.deepEqual(f.rows[1].answers, { 11: 5 });
  assert.equal(f.rows[1].status, "submitted");
  assert.deepEqual(f.revisions[0].answers, { 11: 4 });
});
