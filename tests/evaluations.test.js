import test from "node:test";
import assert from "node:assert/strict";
import { consolidate } from "../server/src/services/evaluation-calculation.js";
import {
  canReadResult,
  canReadIndividual,
  canAnswer,
  validateAnswers,
  transferPlan,
} from "../server/src/services/evaluation-policy.js";
const snapshot = [
  {
    id: 1,
    code: "C1",
    name: "Competência 1",
    weight: "1",
    questions: [{ id: 1 }, { id: 2 }],
  },
  {
    id: 2,
    code: "C2",
    name: "Competência 2",
    weight: "3",
    questions: [{ id: 3 }],
  },
];
const assignment = (weight, answers, kind = "manager") => ({
  weight,
  answers,
  kind,
  status: "submitted",
  review_needed: false,
});
test("Consolidação pondera avaliadores por competência e depois competências", () => {
  const r = consolidate(snapshot, [
    assignment("1", { 1: 3, 2: 5, 3: 2 }),
    assignment("3", { 1: 5, 2: 5, 3: 4 }),
  ]);
  assert.equal(r.competencies[0].score, "4.75");
  assert.equal(r.competencies[1].score, "3.5");
  assert.equal(r.score, "3.8125");
});
test("Autoavaliação não altera nota final, calcula diferença e limiar", () => {
  const managers = [assignment("1", { 1: 4, 2: 4, 3: 4 })];
  const before = consolidate(snapshot, managers);
  const after = consolidate(
    snapshot,
    [...managers, assignment("999", { 1: 1, 2: 1, 3: 5 }, "self")],
    "1",
  );
  assert.equal(after.score, before.score);
  assert.equal(after.competencies[0].difference, "-3");
  assert.equal(after.competencies[1].difference, "1");
  assert.ok(after.competencies.every((c) => c.divergent));
});
test("Não arredonda resultados intermediários e preserva pesos decimais", () => {
  const r = consolidate(snapshot, [
    assignment("0.1", { 1: 1, 2: 1, 3: 1 }),
    assignment("0.2", { 1: 2, 2: 2, 3: 2 }),
  ]);
  assert.match(r.score, /^1\.666666666666666666666666666/);
});
test("Avaliação substituída não entra no cálculo", () => {
  const old = {
    ...assignment("1000", { 1: 1, 2: 1, 3: 1 }),
    status: "superseded",
  };
  assert.equal(
    consolidate(snapshot, [old, assignment("1", { 1: 5, 2: 5, 3: 5 })]).score,
    "5",
  );
});
test("Bloqueia resultado sem avaliadores, com respostas faltantes, revisão ou pendências", () => {
  assert.throws(() => consolidate(snapshot, []));
  assert.throws(() => consolidate(snapshot, [assignment("1", { 1: 5, 2: 5 })]));
  assert.throws(() =>
    consolidate(snapshot, [
      { ...assignment("1", { 1: 5, 2: 5, 3: 5 }), review_needed: true },
    ]),
  );
  assert.throws(() =>
    consolidate(snapshot, [
      { ...assignment("1", { 1: 5, 2: 5, 3: 5 }), status: "pending" },
    ]),
  );
});
test("Escala só permite inteiros 1–5; todas as perguntas exigidas na conclusão", () => {
  for (const v of [0, 6, 1.5, "Não se aplica"])
    assert.throws(() => validateAnswers(snapshot, { 1: v }));
  assert.throws(() => validateAnswers(snapshot, { 99: 3 }));
  assert.throws(() => validateAnswers(snapshot, { 1: 3 }, true));
  assert.deepEqual(validateAnswers(snapshot, { 1: 3 }, false), { 1: 3 });
});
const participant = { employee_id: 20, responsible_id: 10, released: false };
test("Colaborador não vê notas individuais mesmo após liberação", () => {
  const user = { id: 2, employee_id: 20, role_id: "colaborador" };
  assert.equal(canReadResult(user, participant), false);
  assert.equal(canReadResult(user, { ...participant, released: true }), true);
  assert.equal(
    canReadIndividual(user, { ...participant, released: true }),
    false,
  );
});
test("Só RH ou gestor responsável veem avaliações individuais", () => {
  assert.equal(canReadIndividual({ id: 90, role_id: "rh" }, participant), true);
  assert.equal(
    canReadIndividual(
      { id: 10, role_id: "gestor", employee_id: 30 },
      participant,
    ),
    true,
  );
  assert.equal(
    canReadIndividual(
      { id: 11, role_id: "gestor", employee_id: 30 },
      participant,
    ),
    false,
  );
  assert.equal(
    canReadIndividual(
      { id: 10, role_id: "colaborador", employee_id: 30 },
      participant,
    ),
    false,
  );
  assert.equal(
    canReadIndividual(
      { id: 10, role_id: "gestor", employee_id: 20 },
      participant,
    ),
    false,
  );
});
test("Transferência remove o acesso do responsável anterior às notas dos demais", () => {
  const moved = { ...participant, responsible_id: 11 };
  assert.equal(canReadIndividual({ id: 10, role_id: "gestor" }, moved), false);
  assert.equal(canReadIndividual({ id: 11, role_id: "gestor" }, moved), true);
});
test("Somente avaliador designado pode responder antes da conclusão e decisão RH", () => {
  const a = { evaluator_id: 10, status: "pending", review_needed: false };
  assert.equal(canAnswer({ id: 10 }, a), true);
  assert.equal(canAnswer({ id: 11 }, a), false);
  assert.equal(canAnswer({ id: 10 }, { ...a, status: "submitted" }), false);
  assert.equal(canAnswer({ id: 10 }, { ...a, review_needed: true }), false);
});
test("Plano de transferência preserva rascunho e exige revisão; concluídas permanecem históricas", () => {
  assert.deepEqual(transferPlan({ status: "pending" }, true), {
    replace: true,
    review: true,
    carry: true,
  });
  assert.deepEqual(transferPlan({ status: "pending" }, false), {
    replace: true,
    review: false,
    carry: false,
  });
  assert.deepEqual(transferPlan({ status: "submitted" }, true), {
    replace: false,
    review: true,
    carry: false,
  });
});
