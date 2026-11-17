import { fail } from "../utils/validation.js";
export const isHR = (user) => ["master", "rh"].includes(user.role_id);
export function canReadResult(user, participant) {
  return (
    canReadIndividual(user, participant) ||
    (participant.employee_id === user.employee_id && participant.released)
  );
}
export function canReadIndividual(user, participant) {
  return (
    isHR(user) ||
    (["gerente", "gestor"].includes(user.role_id) &&
      participant.responsible_id === user.id &&
      participant.employee_id !== user.employee_id)
  );
}
export function canAnswer(user, assignment) {
  return (
    assignment.evaluator_id === user.id &&
    assignment.status === "pending" &&
    !assignment.review_needed
  );
}
export function validateAnswers(snapshot, answers, complete = false) {
  const ids = snapshot.flatMap((c) => c.questions.map((q) => String(q.id)));
  if (new Set(ids).size !== ids.length)
    fail(400, "Questionário inconsistente.");
  for (const [id, value] of Object.entries(answers)) {
    if (!ids.includes(id) || !Number.isInteger(value) || value < 1 || value > 5)
      fail(400, "Respostas devem usar somente notas inteiras de 1 a 5.");
  }
  if (complete && ids.some((id) => answers[id] === undefined))
    fail(400, "Responda todas as perguntas antes de concluir.");
  return answers;
}
export function transferPlan(assignment, hasResponses) {
  return assignment.status === "submitted"
    ? { replace: false, review: true, carry: false }
    : { replace: true, review: hasResponses, carry: hasResponses };
}
