import Decimal from "decimal.js";
import { validateAnswers } from "./evaluation-policy.js";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function consolidate(snapshot, assignments, divergenceLimit = "1") {
  const active = assignments.filter((a) => a.status !== "superseded");
  const managers = active.filter((a) => a.kind === "manager");
  if (
    !managers.length ||
    active.some((a) => a.review_needed) ||
    managers.some((a) => a.status !== "submitted")
  )
    throw new Error("Há avaliações de gestores ou decisões do RH pendentes.");
  for (const a of managers) {
    validateAnswers(snapshot, a.answers, true);
    if (!new D(a.weight).isPositive())
      throw new Error("Peso de avaliador inválido.");
  }
  const self = active.find(
    (a) => a.kind === "self" && a.status === "submitted",
  );
  if (self) validateAnswers(snapshot, self.answers, true);
  let total = new D(0),
    weights = new D(0);
  const competencies = snapshot.map((c) => {
    if (!c.questions.length || !new D(c.weight).isPositive())
      throw new Error("Competência sem perguntas ou peso válido.");
    const average = (answers) =>
      c.questions
        .reduce((sum, q) => sum.plus(answers[String(q.id)]), new D(0))
        .div(c.questions.length);
    const w = managers.reduce((sum, a) => sum.plus(a.weight), new D(0));
    const score = managers
      .reduce(
        (sum, a) => sum.plus(average(a.answers).times(a.weight)),
        new D(0),
      )
      .div(w);
    const selfScore = self ? average(self.answers) : null;
    const difference = selfScore ? selfScore.minus(score) : null;
    total = total.plus(score.times(c.weight));
    weights = weights.plus(c.weight);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      weight: String(c.weight),
      score: score.toString(),
      self_score: selfScore?.toString() ?? null,
      difference: difference?.toString() ?? null,
      divergent: difference ? difference.abs().gte(divergenceLimit) : false,
    };
  });
  if (weights.isZero()) throw new Error("Questionário vazio.");
  return {
    score: total.div(weights).toString(),
    competencies,
    divergence_limit: String(divergenceLimit),
    self_completed: !!self,
  };
}
