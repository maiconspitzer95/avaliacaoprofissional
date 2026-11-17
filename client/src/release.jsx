import React, { useState, useEffect, useCallback } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "./api";
import { Field, Select, Table, Notice, Loading } from "./components";
const names = {
  pending: "Aguardando análise",
  in_review: "Em análise",
  returned: "Devolvida para ajustes",
  approved: "Deferida",
  rejected: "Indeferida",
  completed: "Concluída",
};
function useData(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api(path));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}
function Reason({ value, onChange, label = "Justificativa" }) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={10}
        maxLength={5000}
        required
      />
    </Field>
  );
}
export function ContestRequest({ participantId }) {
  const [reason, setReason] = useState(""),
    [msg, setMsg] = useState("");
  return (
    <section className="glass section">
      <details>
        <summary>Solicitar revisão do resultado</summary>
        <p>
          Descreva os pontos que deseja que o RH analise. A contestação
          permanece registrada no histórico.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/contestations", "POST", {
                participant_id: Number(participantId),
                justification: reason,
              });
              setReason("");
              setMsg("Solicitação registrada. Acompanhe em Contestações.");
            } catch (e) {
              setMsg(e.message);
            }
          }}
        >
          <Reason value={reason} onChange={setReason} />
          <button>Solicitar revisão</button>
        </form>
        <Notice message={msg} />
      </details>
    </section>
  );
}
export function ReleaseArea() {
  const list = useData("/contestations/release"),
    [reason, setReason] = useState(""),
    [msg, setMsg] = useState("");
  async function act(r, type) {
    try {
      if (reason.trim().length < 10)
        throw new Error("Informe justificativa com pelo menos 10 caracteres.");
      if (type === "access")
        await api("/contestations/participants/" + r.id + "/access", "POST", {
          allow: !r.feedback_access,
          reason,
        });
      else
        await api("/evaluations/participants/" + r.id + "/release", "POST", {
          released: !r.released,
          reason,
        });
      setMsg("Operação registrada.");
      await list.load();
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <>
      <h1>Liberação de Resultados</h1>
      <p>
        Autorize a apresentação ao funcionário para elaboração e assinatura. A
        liberação definitiva é separada e exige todos os requisitos.
      </p>
      <Notice message={msg || list.error} />
      <Reason
        value={reason}
        onChange={setReason}
        label="Justificativa da operação"
      />
      <Table
        rows={list.data || []}
        columns={[
          { key: "employee_name", label: "Funcionário" },
          { key: "cycle_name", label: "Ciclo" },
          {
            key: "plan_status",
            label: "Feedback e PDI",
            render: (r) =>
              ({
                not_started: "Pendente",
                draft: "Em elaboração",
                awaiting_signatures: "Assinaturas pendentes",
                signed: "Formalizado",
              })[r.plan_status],
          },
          {
            key: "ready",
            label: "Prontidão",
            render: (r) => (r.ready ? "Apto à liberação" : r.reasons.join(" ")),
          },
          {
            key: "released",
            label: "Resultado",
            render: (r) => (r.released ? "Liberado" : "Não liberado"),
          },
          {
            key: "access",
            label: "Operações",
            render: (r) => (
              <div className="actions">
                <button onClick={() => act(r, "access")}>
                  {r.feedback_access
                    ? "Revogar acesso à reunião"
                    : "Autorizar acesso à reunião"}
                </button>
                <button
                  disabled={!r.ready && !r.released}
                  onClick={() => act(r, "release")}
                >
                  {r.released ? "Revogar liberação" : "Liberar definitivamente"}
                </button>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
export function Contestations({ user }) {
  const list = useData("/contestations"),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [assessments, setAssessments] = useState([]),
    [choice, setChoice] = useState(""),
    [reason, setReason] = useState(""),
    [msg, setMsg] = useState("");
  const hr = ["master", "rh"].includes(user.role_id);
  async function open(x) {
    try {
      setSelected(x);
      setDetail(await api("/contestations/" + x.id));
      if (hr)
        setAssessments(
          await api(
            "/evaluations/participants/" + x.participant_id + "/assignments",
          ),
        );
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function send(action) {
    try {
      if (reason.trim().length < 10)
        throw new Error("Informe justificativa com pelo menos 10 caracteres.");
      await api(
        "/contestations/" +
          selected.id +
          (action === "authorize" ? "/authorize" : "/transition"),
        "POST",
        action === "authorize"
          ? { assignment_id: Number(choice), reason }
          : { action, reason },
      );
      setReason("");
      setSelected(null);
      await list.load();
      setMsg("Operação registrada.");
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <>
      <h1>Contestações e revisões</h1>
      <p>Consulte o histórico e acompanhe as decisões do RH.</p>
      <Notice message={msg || list.error} />
      <Table
        rows={list.data || []}
        columns={[
          { key: "employee_name", label: "Funcionário" },
          { key: "cycle_name", label: "Ciclo" },
          {
            key: "created_at",
            label: "Solicitação",
            render: (r) => new Date(r.created_at).toLocaleString("pt-BR"),
          },
          { key: "status", label: "Status", render: (r) => names[r.status] },
          {
            key: "actions",
            label: "Ações",
            render: (r) =>
              r.evaluator_id === user.id &&
              r.employee_id !== user.employee_id &&
              !hr ? (
                <NavLink
                  to={"/development/contestations/" + r.id + "/revision"}
                >
                  Revisar avaliação autorizada
                </NavLink>
              ) : (
                <button onClick={() => open(r)}>Consultar</button>
              ),
          },
        ]}
      />
      {selected && detail && (
        <section className="glass section">
          <h2>Contestação #{selected.id}</h2>
          <p>
            <strong>Solicitação:</strong> {detail.contestation.justification}
          </p>
          <p>
            <strong>Status:</strong> {names[selected.status]} ·{" "}
            <strong>Analista:</strong>{" "}
            {detail.contestation.analyst_id || "Não atribuído"}
          </p>
          <p>
            <strong>Decisão:</strong>{" "}
            {detail.contestation.decision || "Pendente"} ·{" "}
            {detail.contestation.decision_reason}
          </p>
          <h3>Histórico</h3>
          {detail.history.map((h) => (
            <p key={h.id}>
              {new Date(h.created_at).toLocaleString("pt-BR")} · {h.event} ·{" "}
              {h.details.reason || h.details.justification || ""}
            </p>
          ))}
          {selected.status !== "completed" && (
            <>
              <Reason value={reason} onChange={setReason} />
              <div className="actions">
                {hr && selected.status === "pending" && (
                  <button onClick={() => send("analyze")}>
                    Iniciar análise
                  </button>
                )}
                {hr && selected.status === "in_review" && (
                  <>
                    <button onClick={() => send("return")}>
                      Devolver para ajustes
                    </button>
                    <button onClick={() => send("reject")}>
                      Indeferir e manter resultado
                    </button>
                  </>
                )}
                {!hr && selected.status === "returned" && (
                  <button onClick={() => send("resubmit")}>
                    Enviar ajustes ao RH
                  </button>
                )}
                {hr && ["approved", "rejected"].includes(selected.status) && (
                  <button onClick={() => send("complete")}>
                    Concluir contestação
                  </button>
                )}
              </div>
              {hr && selected.status === "in_review" && (
                <>
                  <Select
                    label="Avaliação a revisar"
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    options={assessments
                      .filter(
                        (a) =>
                          a.kind === "manager" &&
                          a.status === "submitted" &&
                          !a.review_needed,
                      )
                      .map((a) => ({ id: a.id, name: a.evaluator_name }))}
                  />
                  <button disabled={!choice} onClick={() => send("authorize")}>
                    Deferir e autorizar revisão
                  </button>
                </>
              )}
            </>
          )}
          <button onClick={() => setSelected(null)}>Fechar</button>
        </section>
      )}
    </>
  );
}
export function Revision() {
  const { id } = useParams(),
    data = useData("/contestations/" + id + "/revision"),
    [answers, setAnswers] = useState({}),
    [reason, setReason] = useState(""),
    [msg, setMsg] = useState("");
  useEffect(() => {
    if (data.data) setAnswers(data.data.assignment.answers);
  }, [data.data]);
  if (!data.data)
    return (
      <>
        <Notice message={data.error} error />
        <Loading />
      </>
    );
  const { revision, assignment, questionnaire } = data.data;
  return (
    <>
      <NavLink to="/development/contestations">← Contestações</NavLink>
      <h1>Revisão autorizada da avaliação</h1>
      <p>
        As respostas anteriores permanecem registradas. Envie uma nova revisão
        completa.
      </p>
      <Notice message={msg} />
      {questionnaire.map((c) => (
        <section className="glass section" key={c.id}>
          <h2>{c.name}</h2>
          {c.questions.map((q) => (
            <fieldset
              className="question"
              key={q.id}
              disabled={!!revision.completed_at}
            >
              <legend>{q.prompt}</legend>
              {q.scale.map((label, i) => (
                <label key={i}>
                  <input
                    type="radio"
                    name={"q" + q.id}
                    checked={answers[q.id] === i + 1}
                    onChange={() => setAnswers({ ...answers, [q.id]: i + 1 })}
                  />{" "}
                  {i + 1} · {label}{" "}
                </label>
              ))}
            </fieldset>
          ))}
        </section>
      ))}
      {revision.completed_at ? (
        <Notice message="Revisão concluída e registrada." />
      ) : (
        <>
          <Reason
            value={reason}
            onChange={setReason}
            label="Justificativa da revisão"
          />
          <button
            onClick={async () => {
              try {
                await api("/contestations/" + id + "/revision", "POST", {
                  version: assignment.version,
                  answers,
                  reason,
                });
                setMsg("Revisão concluída.");
                await data.load();
              } catch (e) {
                setMsg(e.message);
              }
            }}
          >
            Concluir revisão
          </button>
        </>
      )}
    </>
  );
}
