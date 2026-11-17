import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDocument,
  documentSchema,
  developmentAccess,
  requireReady,
  actionSituation,
  planSituation,
} from "../server/src/services/development-policy.js";
const p = {
  employee_id: 10,
  responsible_id: 20,
  released: true,
  snapshot: [{ id: 1 }],
};
const action = {
  id: "0d72d8ea-860c-4670-a7aa-bf3acc885583",
  description: "Curso de comunicação",
  competency_id: 1,
  responsible: "Funcionário",
  start: "2026-11-01",
  deadline: "2026-12-01",
  indicator: "Certificado e aplicação prática",
  status: "planned",
  progress: 0,
  notes: "",
  cancellation_reason: "",
};
const valid = () => ({
  ...emptyDocument(),
  meeting_date: "2026-11-16",
  strengths: "Escuta ativa",
  opportunities: "Comunicação",
  objective: "Aprimorar comunicação",
  actions: [{ ...action }],
});
test("Feedback respeita liberação, responsável e autoria individual", () => {
  assert.equal(
    developmentAccess({ id: 30, employee_id: 10, role_id: "colaborador" }, p)
      .read,
    true,
  );
  assert.equal(
    developmentAccess(
      { id: 30, employee_id: 10, role_id: "colaborador" },
      { ...p, released: false },
    ).read,
    false,
  );
  assert.equal(
    developmentAccess({ id: 21, employee_id: 11, role_id: "gestor" }, p).read,
    false,
  );
  assert.equal(
    developmentAccess({ id: 20, employee_id: 11, role_id: "gestor" }, p)
      .manager,
    true,
  );
  assert.equal(
    developmentAccess({ id: 20, employee_id: 10, role_id: "gestor" }, p)
      .manager,
    false,
  );
  assert.equal(
    developmentAccess({ id: 1, employee_id: null, role_id: "rh" }, p).manager,
    false,
  );
});
test("Encaminhamento exige PDI, contribuição real e liberação RH", () => {
  assert.throws(() => requireReady(emptyDocument(), p, true));
  assert.throws(() => requireReady(valid(), p, false));
  assert.throws(() => requireReady(valid(), { ...p, released: false }, true));
  assert.throws(() => requireReady({ ...valid(), actions: [] }, p, true));
  assert.throws(() =>
    requireReady(
      { ...valid(), actions: [{ ...action, competency_id: 2 }] },
      p,
      true,
    ),
  );
  assert.doesNotThrow(() => requireReady(valid(), p, true));
});
test("Ações validam datas, percentual, cancelamento e IDs duplicados", () => {
  for (const patch of [
    { deadline: "2026-02-30" },
    { deadline: "2025-01-01" },
    { status: "cancelled" },
    { progress: 101 },
    { status: "completed", progress: 20 },
  ])
    assert.equal(
      documentSchema.safeParse({
        ...valid(),
        actions: [{ ...action, ...patch }],
      }).success,
      false,
    );
  assert.equal(
    documentSchema.safeParse({ ...valid(), actions: [action, action] }).success,
    false,
  );
  assert.equal(
    documentSchema.safeParse({ ...valid(), score: 5 }).success,
    false,
  );
});
test("Atraso é derivado por ação sem alterar o documento acordado", () => {
  assert.equal(actionSituation(action, "2026-12-02"), "overdue");
  assert.equal(actionSituation(action, "2026-12-01"), "planned");
  assert.equal(
    actionSituation({ ...action, status: "completed" }, "2026-12-02"),
    "completed",
  );
  assert.equal(planSituation([action], "2026-12-02"), "overdue");
  assert.equal(
    planSituation([{ ...action, status: "completed" }], "2026-12-02"),
    "completed",
  );
  assert.equal(action.status, "planned");
});
