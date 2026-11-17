import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, NavLink, useParams } from "react-router-dom";
import { api } from "./api";
import { Field, Select, Table, Notice, Loading } from "./components";
import { Radar } from "./evaluations";
import {
  ReleaseArea,
  Contestations,
  Revision,
  ContestRequest,
} from "./release";
const base = "/development";
const labels = {
  not_started: "PDI obrigatório · não iniciado",
  draft: "Em elaboração",
  awaiting_signatures: "Aguardando assinaturas",
  signed: "Feedback formalizado",
  planned: "Planejada",
  in_progress: "Em andamento",
  completed: "Concluída",
  overdue: "Atrasada",
  cancelled: "Cancelada",
};
const events = {
  created: "Feedback iniciado",
  draft_saved: "Rascunho atualizado",
  employee_contribution: "Contribuição do funcionário",
  submitted: "Encaminhado para assinatura",
  reopened: "Retornado para elaboração",
  revision_created: "Nova versão iniciada",
  signed: "Assinatura registrada",
  formalized: "Feedback formalizado",
  progress_updated: "Andamento atualizado",
  evidence_added: "Evidência anexada",
  checkin_scheduled: "Verificação agendada",
  checkin_completed: "Verificação concluída",
};
const number = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const time = (v) => new Date(v).toLocaleString("pt-BR");
const situation = (a, today) =>
  !["completed", "cancelled"].includes(a.status) && a.deadline < today
    ? "overdue"
    : a.status;
function useData(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setError("");
      setData(await api(path));
    } catch (e) {
      setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  return { data, error, load };
}
function Text({ label, value, onChange, disabled = false }) {
  return (
    <Field label={label}>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={10000}
      />
    </Field>
  );
}
export function DevelopmentModule({ user }) {
  return (
    <div className="development">
      <nav className="evaluation-nav">
        <NavLink to={base} end>
          Feedback de Desempenho
        </NavLink>
        <NavLink to={base + "/tracking"}>Acompanhamento do PDI</NavLink>
        <NavLink to={base + "/contestations"}>Contestações</NavLink>
        {["rh", "master"].includes(user.role_id) && (
          <NavLink to={base + "/release"}>Liberação de Resultados</NavLink>
        )}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="tracking" element={<Overview tracking />} />
        <Route path="contestations" element={<Contestations user={user} />} />
        <Route path="contestations/:id/revision" element={<Revision />} />
        <Route path="release" element={<ReleaseArea />} />
        <Route path=":id" element={<Detail user={user} />} />
      </Routes>
    </div>
  );
}
function Overview({ tracking = false }) {
  const list = useData(base),
    notices = useData(base + "/notifications"),
    [cycle, setCycle] = useState(""),
    [filter, setFilter] = useState(""),
    [message, setMessage] = useState("");
  const rows = (list.data || []).filter(
    (r) => !cycle || String(r.cycle_id) === cycle,
  );
  const actions = rows.flatMap((r) =>
    r.actions.map((a) => ({
      ...a,
      participant_id: r.id,
      employee_name: r.employee_name,
      cycle_name: r.cycle_name,
      today: r.today,
      plan_status: r.status,
    })),
  );
  const near = (a) =>
    !["completed", "cancelled"].includes(a.status) &&
    a.deadline >= a.today &&
    a.deadline <=
      new Date(Date.parse(a.today) + 7 * 86400000).toISOString().slice(0, 10);
  const match = (a) =>
    filter === "soon"
      ? near(a)
      : filter === "open"
        ? !["completed", "cancelled"].includes(a.status)
        : !filter || situation(a, a.today) === filter;
  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">GESTÃO DE PESSOAS</div>
          <h1>
            {tracking ? "Acompanhamento do PDI" : "Feedback de Desempenho"}
          </h1>
          <p>
            Desenvolvimento construído em conjunto, com resultados liberados
            pelo RH.
          </p>
        </div>
      </div>
      <Notice message={list.error || notices.error || message} error />
      <section className="glass section">
        <details>
          <summary>
            Notificações internas (
            {(notices.data || []).filter((n) => !n.read_at).length} não lidas)
          </summary>
          <ul className="notifications">
            {(notices.data || []).map((n) => (
              <li key={n.key}>
                <NavLink to={base + "/" + n.participant_id}>
                  {Object.entries(events).reduce(
                    (s, [k, v]) => s.replace(" · " + k, " · " + v),
                    n.message,
                  )}
                </NavLink>{" "}
                {!n.read_at && (
                  <button
                    onClick={async () => {
                      try {
                        await api(base + "/notifications/read", "POST", {
                          key: n.key,
                        });
                        await notices.load();
                      } catch (e) {
                        setMessage(e.message);
                      }
                    }}
                  >
                    Marcar como lida
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      </section>
      <div className="development-grid">
        <Select
          label="Ciclo (inclui ciclos anteriores)"
          value={cycle}
          onChange={(e) => setCycle(e.target.value)}
          options={[
            ...new Map(
              (list.data || []).map((r) => [
                r.cycle_id,
                { id: r.cycle_id, name: r.cycle_name },
              ]),
            ).values(),
          ]}
        />
        {tracking && (
          <Select
            label="Filtrar ações"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { id: "open", name: "Abertas" },
              { id: "soon", name: "Próximas do vencimento" },
              { id: "overdue", name: "Atrasadas" },
              { id: "completed", name: "Concluídas" },
              { id: "cancelled", name: "Canceladas" },
            ]}
          />
        )}
      </div>
      {tracking ? (
        <>
          <div className="stats">
            {[
              [
                "Abertas",
                actions.filter(
                  (a) => !["completed", "cancelled"].includes(a.status),
                ).length,
              ],
              ["Próximas do vencimento", actions.filter(near).length],
              [
                "Atrasadas",
                actions.filter((a) => situation(a, a.today) === "overdue")
                  .length,
              ],
              [
                "Concluídas",
                actions.filter((a) => a.status === "completed").length,
              ],
            ].map(([label, count]) => (
              <section className="glass" key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </section>
            ))}
          </div>
          <Table
            rows={actions.filter(match)}
            columns={[
              { key: "employee_name", label: "Funcionário" },
              { key: "cycle_name", label: "Ciclo" },
              { key: "description", label: "Ação" },
              { key: "deadline", label: "Prazo" },
              {
                key: "status",
                label: "Situação",
                render: (a) => labels[situation(a, a.today)],
              },
              {
                key: "progress",
                label: "Andamento",
                render: (a) => (a.progress == null ? "—" : a.progress + "%"),
              },
              {
                key: "link",
                label: "PDI",
                render: (a) => (
                  <NavLink to={base + "/" + a.participant_id}>
                    Acompanhar
                  </NavLink>
                ),
              },
            ]}
          />
        </>
      ) : (
        <Table
          rows={rows}
          columns={[
            { key: "employee_name", label: "Funcionário" },
            { key: "re", label: "RE" },
            { key: "cycle_name", label: "Ciclo" },
            {
              key: "status",
              label: "Feedback",
              render: (r) => labels[r.status],
            },
            {
              key: "situation",
              label: "PDI",
              render: (r) => labels[r.situation],
            },
            {
              key: "released",
              label: "Resultado",
              render: (r) => (r.released ? "Liberado pelo RH" : "Restrito"),
            },
            {
              key: "open",
              label: "Ações",
              render: (r) => (
                <NavLink to={base + "/" + r.id}>
                  {r.submitted && !r.pending
                    ? "Abrir feedback e PDI"
                    : "Consultar disponibilidade"}
                </NavLink>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
function Detail({ user }) {
  const { id } = useParams(),
    load = useData(base + "/" + id),
    [doc, setDoc] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(""),
    [consent, setConsent] = useState(false),
    [reason, setReason] = useState("");
  useEffect(() => {
    setDoc(load.data?.plan?.document || null);
    setPassword("");
    setConsent(false);
  }, [load.data]);
  async function mutate(path, body = {}, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      await api(base + "/" + id + path, method, {
        version: load.data?.plan?.version,
        ...body,
      });
      await load.load();
      setMessage("Registro salvo.");
      return true;
    } catch (e) {
      setMessage(e.message);
      return false;
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  if (!load.data)
    return (
      <>
        <NavLink to={base}>Voltar</NavLink>
        <Notice message={load.error} error />
        {!load.error && <Loading />}
      </>
    );
  const {
    participant: p,
    plan,
    access,
    consolidated: r,
    questionnaire,
    assignments,
    history,
    signatures,
    versions,
    evidence,
    checkins,
    today,
  } = load.data;
  const draft = plan?.status === "draft",
    canEdit = draft && access.manager,
    track = plan?.status === "signed" && (access.manager || access.employee),
    dirty = doc && JSON.stringify(doc) !== JSON.stringify(plan.document);
  const set = (key, value) => setDoc((d) => ({ ...d, [key]: value }));
  const updateAction = (index, key, value) =>
    setDoc((d) => ({
      ...d,
      actions: d.actions.map((a, i) =>
        i === index ? { ...a, [key]: value } : a,
      ),
    }));
  const currentSignatures = signatures.filter(
    (s) =>
      plan?.status !== "draft" && s.signature_round === plan?.signature_round,
  );
  return (
    <>
      <NavLink to={base}>← Todos os feedbacks</NavLink>
      <div className="heading">
        <div>
          <div className="eyebrow">FEEDBACK DE DESEMPENHO</div>
          <h1>{p.name}</h1>
          <p>
            {p.cycle_name} · {p.reference_start} a {p.reference_end}
          </p>
        </div>
        <span className="status-tag">
          {labels[plan?.status || "not_started"]}
        </span>
      </div>
      <Notice message={message || load.error} />
      {access.employee && <ContestRequest participantId={id} />}
      {plan?.status === "signed" && (
        <p>
          <a className="button" href={"/api/development/" + id + "/pdf"}>
            Exportar feedback e PDI em PDF
          </a>
        </p>
      )}
      <section className="glass section">
        <div className="development-grid">
          <p>
            <strong>Identificação funcional</strong>
            <br />
            RE {p.re} · {p.position_name}
            <br />
            {p.sector_name || "Setor não informado"}
          </p>
          <p>
            <strong>Gestor responsável</strong>
            <br />
            {p.manager_name || "Não definido"}
            <br />
            {p.released
              ? "Resultado liberado pelo RH"
              : "Resultado aguardando liberação pelo RH"}
          </p>
          <p>
            <strong>Nota consolidada</strong>
            <br />
            {number(r.score)} / 5
          </p>
        </div>
        <NavLink to={"/evaluations/results/" + id}>
          Consultar resultado da avaliação
        </NavLink>
        {access.hr && (
          <p>
            <NavLink to="/evaluations/cycles">
              Controlar liberação dos resultados nos ciclos
            </NavLink>
          </p>
        )}
      </section>
      <section className="glass section">
        <h2>Mapa comparativo de competências</h2>
        <p>
          Diferenças de percepção são pontos para diálogo e não significam
          desempenho inadequado. Limite definido pelo RH:{" "}
          {number(r.divergence_limit)}.
        </p>
        {!r.self_completed && (
          <Notice message="Autoavaliação ainda não concluída." />
        )}
        <Radar competencies={r.competencies} />
        <Table
          rows={r.competencies}
          columns={[
            { key: "name", label: "Competência" },
            {
              key: "self_score",
              label: "Autoavaliação",
              render: (c) => number(c.self_score),
            },
            { key: "score", label: "Gestores", render: (c) => number(c.score) },
            {
              key: "difference",
              label: "Diferença",
              render: (c) => number(c.difference),
            },
            {
              key: "divergent",
              label: "Diálogo",
              render: (c) =>
                c.divergent ? (
                  <span className="divergent">Diferença relevante</span>
                ) : (
                  "—"
                ),
            },
            {
              key: "questions",
              label: "Perguntas e respostas",
              render: (c) => (
                <details>
                  <summary>Consultar</summary>
                  {questionnaire
                    .find((q) => q.id === c.id)
                    ?.questions.map((q) => (
                      <div key={q.id}>
                        <p>{q.prompt}</p>
                        {assignments.map((a) => (
                          <p key={a.id}>
                            {a.evaluator_name} (
                            {a.kind === "self" ? "autoavaliação" : "gestor"}):{" "}
                            {a.answers[q.id] || "Não respondida"}{" "}
                            {a.answers[q.id]
                              ? "— " + q.scale[a.answers[q.id] - 1]
                              : ""}
                          </p>
                        ))}
                      </div>
                    ))}
                </details>
              ),
            },
          ]}
        />
      </section>
      {!plan ? (
        <section className="glass section">
          <h2>PDI obrigatório</h2>
          <p>
            O gestor responsável deve iniciar a elaboração conjunta após a
            consolidação.
          </p>
          {access.manager && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => mutate("/start")}
            >
              Iniciar feedback e PDI
            </button>
          )}
        </section>
      ) : (
        doc && (
          <>
            <section className="glass section">
              <h2>Reunião de feedback</h2>
              <fieldset disabled={!canEdit || busy}>
                <Field
                  label="Data da reunião"
                  type="date"
                  value={doc.meeting_date}
                  onChange={(e) => set("meeting_date", e.target.value)}
                />
                <div className="development-grid">
                  <Text
                    label="Pontos fortes"
                    value={doc.strengths}
                    onChange={(v) => set("strengths", v)}
                  />
                  <Text
                    label="Oportunidades de melhoria"
                    value={doc.opportunities}
                    onChange={(v) => set("opportunities", v)}
                  />
                </div>
                <Text
                  label="Observações do gestor"
                  value={doc.manager_notes}
                  onChange={(v) => set("manager_notes", v)}
                />
              </fieldset>
              <Text
                label="Contribuições e observações do funcionário"
                value={doc.employee_notes}
                disabled={!draft || !access.employee || busy}
                onChange={(v) => set("employee_notes", v)}
              />
              {draft && access.employee && (
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate("/contributions", { text: doc.employee_notes })
                  }
                >
                  Salvar minha contribuição
                </button>
              )}
            </section>
            <section className="glass section">
              <h2>Plano de Desenvolvimento Individual</h2>
              <p>
                Competências, responsáveis, prazos e indicadores são definidos
                por ação. O plano deve conter pelo menos uma ação válida.
              </p>
              <fieldset disabled={!canEdit || busy}>
                <Text
                  label="Objetivo geral"
                  value={doc.objective}
                  onChange={(v) => set("objective", v)}
                />
                <Text
                  label="Observações do plano"
                  value={doc.notes}
                  onChange={(v) => set("notes", v)}
                />
              </fieldset>
              {doc.actions.map((a, i) => (
                <article className="action-card" key={a.id}>
                  <h3>
                    Ação {i + 1} · {labels[situation(a, today)]}
                  </h3>
                  <fieldset disabled={!canEdit || busy}>
                    <Text
                      label="Descrição"
                      value={a.description}
                      onChange={(v) => updateAction(i, "description", v)}
                    />
                    <div className="development-grid">
                      <Select
                        label="Competência vinculada"
                        value={a.competency_id}
                        options={questionnaire.map((c) => ({
                          id: c.id,
                          name: c.name,
                        }))}
                        onChange={(e) =>
                          updateAction(
                            i,
                            "competency_id",
                            Number(e.target.value),
                          )
                        }
                      />
                      <Field
                        label="Responsável"
                        value={a.responsible}
                        onChange={(e) =>
                          updateAction(i, "responsible", e.target.value)
                        }
                      />
                      <Field
                        label="Início"
                        type="date"
                        value={a.start}
                        onChange={(e) =>
                          updateAction(i, "start", e.target.value)
                        }
                      />
                      <Field
                        label="Prazo"
                        type="date"
                        value={a.deadline}
                        onChange={(e) =>
                          updateAction(i, "deadline", e.target.value)
                        }
                      />
                    </div>
                    <Text
                      label="Indicador de conclusão"
                      value={a.indicator}
                      onChange={(v) => updateAction(i, "indicator", v)}
                    />
                    <Text
                      label="Observações"
                      value={a.notes}
                      onChange={(v) => updateAction(i, "notes", v)}
                    />
                    {canEdit && (
                      <>
                        <Select
                          label="Situação na elaboração"
                          value={a.status}
                          options={[
                            ...new Set(["planned", "cancelled", a.status]),
                          ].map((id) => ({
                            id,
                            name: labels[id],
                          }))}
                          onChange={(e) =>
                            updateAction(i, "status", e.target.value)
                          }
                        />
                        {a.status === "cancelled" && (
                          <Text
                            label="Justificativa do cancelamento"
                            value={a.cancellation_reason}
                            onChange={(v) =>
                              updateAction(i, "cancellation_reason", v)
                            }
                          />
                        )}
                      </>
                    )}
                  </fieldset>
                  {plan.signature_round > 0 && (
                    <Progress
                      key={a.id + ":" + plan.version}
                      action={a}
                      canEdit={track}
                      manager={access.manager}
                      busy={busy}
                      mutate={mutate}
                      evidence={evidence.filter((e) => e.action_id === a.id)}
                      checkins={checkins.filter((c) => c.action_id === a.id)}
                      participantId={id}
                    />
                  )}
                </article>
              ))}
              {canEdit && (
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      set("actions", [
                        ...doc.actions,
                        {
                          id: crypto.randomUUID(),
                          description: "",
                          competency_id: questionnaire[0]?.id || 0,
                          responsible: p.manager_name || "",
                          start: today,
                          deadline: today,
                          indicator: "",
                          status: "planned",
                          progress: 0,
                          notes: "",
                          cancellation_reason: "",
                        },
                      ])
                    }
                  >
                    Adicionar ação
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      mutate("/document", { document: doc }, "PUT")
                    }
                  >
                    Salvar rascunho do feedback e PDI
                  </button>
                </div>
              )}
            </section>
            <section className="glass section">
              <h2>Assinaturas eletrônicas</h2>
              <p>
                Gestor e funcionário assinam individualmente o mesmo feedback e
                PDI para registrar ciência, sem pressupor concordância. A
                formalização exige ambas as assinaturas. Assinatura interna por
                senha, sem certificado digital.
              </p>
              {draft && access.manager && (
                <>
                  <p>
                    Salve o rascunho e aguarde a contribuição do funcionário
                    antes de encaminhar.
                  </p>
                  <button
                    disabled={busy || dirty}
                    onClick={() => mutate("/submit")}
                  >
                    Encaminhar documento salvo para assinatura
                  </button>
                  {dirty && <p>Há alterações não salvas.</p>}
                </>
              )}
              {plan.signed_text && (
                <details>
                  <summary>Revisar conteúdo congelado para assinatura</summary>
                  <FrozenDocument text={plan.signed_text} />
                </details>
              )}
              {plan.document_hash && (
                <p className="signature-hash">
                  <strong>SHA-256:</strong> {plan.document_hash}
                </p>
              )}
              <Table
                rows={currentSignatures}
                columns={[
                  {
                    key: "kind",
                    label: "Tipo",
                    render: (s) =>
                      s.kind === "manager" ? "Gestor" : "Funcionário",
                  },
                  {
                    key: "functional_identity",
                    label: "Identificação funcional",
                    render: (s) =>
                      (s.functional_identity.name || "Usuário " + s.user_id) +
                      " · RE " +
                      (s.functional_identity.re || "não vinculado"),
                  },
                  {
                    key: "signed_at",
                    label: "Data e hora",
                    render: (s) => time(s.signed_at),
                  },
                ]}
              />
              {plan.status === "awaiting_signatures" &&
                (access.employee || access.manager) && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        mutate("/sign", {
                          password,
                          acknowledgment: consent,
                          document_hash: plan.document_hash,
                        });
                      }}
                    >
                      <fieldset
                        disabled={
                          busy ||
                          currentSignatures.some((s) => s.user_id === user.id)
                        }
                      >
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                            required
                          />
                          Declaro ciência do conteúdo deste feedback e PDI.
                          Minha assinatura não pressupõe concordância com seu
                          conteúdo.
                        </label>
                        <Field
                          label="Confirme sua senha individual"
                          type="password"
                          value={password}
                          autoComplete="current-password"
                          required
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button className="primary" disabled={!consent}>
                          Assinar como{" "}
                          {access.employee ? "funcionário" : "gestor"}
                        </button>
                      </fieldset>
                    </form>
                    <Text
                      label="Justificativa para retornar à elaboração"
                      value={reason}
                      onChange={setReason}
                    />
                    <button
                      disabled={busy || reason.trim().length < 10}
                      onClick={() => mutate("/reopen", { reason })}
                    >
                      Retornar para ajustes e invalidar rodada de assinaturas
                    </button>
                  </>
                )}
              {plan.status === "signed" && (
                <Notice message="Feedback formalizado pelas duas partes. O conteúdo assinado foi preservado. O andamento das ações e as evidências são registrados no acompanhamento." />
              )}
              {plan.status === "signed" && access.manager && (
                <>
                  <Text
                    label="Justificativa para uma nova versão"
                    value={reason}
                    onChange={setReason}
                  />
                  <button
                    disabled={busy || reason.trim().length < 10}
                    onClick={() => mutate("/revise", { reason })}
                  >
                    Criar nova versão para ajustes
                  </button>
                  <p>
                    O documento anterior permanece preservado. A revisão exige
                    nova contribuição do funcionário e novas assinaturas de
                    ciência de ambas as partes.
                  </p>
                </>
              )}
              {!!versions?.length && (
                <details>
                  <summary>Versões preservadas do documento</summary>
                  {versions.map((v) => (
                    <article className="action-card" key={v.id}>
                      <h3>Versão {v.signature_round}</h3>
                      <p>
                        {history.some(
                          (h) =>
                            h.event === "reopened" &&
                            h.details.invalidated_round === v.signature_round,
                        )
                          ? "Rodada devolvida para ajustes"
                          : signatures.filter(
                                (s) => s.signature_round === v.signature_round,
                              ).length === 2
                            ? "Ciência registrada pelas duas partes"
                            : "Assinaturas pendentes"}
                      </p>
                      <FrozenDocument text={v.signed_text} />
                      <p className="signature-hash">
                        SHA-256: {v.document_hash}
                      </p>
                      {signatures
                        .filter((s) => s.signature_round === v.signature_round)
                        .map((s) => (
                          <p key={s.id}>
                            {s.kind === "manager" ? "Gestor" : "Funcionário"} ·{" "}
                            {s.functional_identity.name ||
                              "Usuário " + s.user_id}{" "}
                            · {time(s.signed_at)} · {s.acknowledgment}
                          </p>
                        ))}
                    </article>
                  ))}
                </details>
              )}
            </section>
            <section className="glass section">
              <h2>Histórico de atualizações</h2>
              <div className="history">
                {history.map((h) => (
                  <article key={h.id}>
                    <strong>{events[h.event] || h.event}</strong>
                    <p>
                      {time(h.created_at)} ·{" "}
                      {h.author_name || "Usuário " + h.user_id}
                    </p>
                    <details>
                      <summary>Detalhes registrados</summary>
                      {h.details.document ? (
                        <FrozenDocument
                          text={JSON.stringify({
                            document: h.details.document,
                          })}
                        />
                      ) : (
                        <pre>{JSON.stringify(h.details, null, 2)}</pre>
                      )}
                    </details>
                  </article>
                ))}
              </div>
              {signatures.some(
                (s) => s.signature_round !== plan.signature_round,
              ) && (
                <details>
                  <summary>
                    Assinaturas de rodadas anteriores (sem validade para a
                    versão atual)
                  </summary>
                  {signatures
                    .filter((s) => s.signature_round !== plan.signature_round)
                    .map((s) => (
                      <p key={s.id}>
                        Rodada {s.signature_round} ·{" "}
                        {s.kind === "manager" ? "Gestor" : "Funcionário"} ·{" "}
                        {time(s.signed_at)} · {s.functional_identity.name}
                      </p>
                    ))}
                </details>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
function FrozenDocument({ text }) {
  const f = JSON.parse(text),
    d = f.document;
  return (
    <div>
      <p>
        {f.identity?.name} {f.identity?.re && "· RE " + f.identity.re} ·{" "}
        {f.identity?.cycle_name}
      </p>
      {f.acknowledgment && (
        <p>
          <strong>Declaração de ciência:</strong> {f.acknowledgment}
        </p>
      )}
      {[
        ["Data da reunião", d.meeting_date],
        ["Pontos fortes", d.strengths],
        ["Oportunidades", d.opportunities],
        ["Observações do gestor", d.manager_notes],
        ["Contribuição do funcionário", d.employee_notes],
        ["Objetivo geral", d.objective],
        ["Observações do PDI", d.notes],
      ].map(([k, v]) => (
        <p key={k}>
          <strong>{k}:</strong> {v || "—"}
        </p>
      ))}
      {f.result && <p>Nota consolidada: {number(f.result.score)}</p>}
      {d.actions.map((a) => (
        <p key={a.id}>
          <strong>{a.description}</strong>
          <br />
          Competência:{" "}
          {f.result?.competencies.find((c) => c.id === a.competency_id)?.name ||
            a.competency_id}{" "}
          · Responsável: {a.responsible}
          <br />
          {a.start} a {a.deadline} · Indicador: {a.indicator}
          <br />
          {labels[a.status]} · {a.notes} {a.cancellation_reason}
        </p>
      ))}
    </div>
  );
}
function Progress({
  action: a,
  canEdit,
  manager,
  busy,
  mutate,
  evidence,
  checkins,
  participantId,
}) {
  const [status, setStatus] = useState(a.status),
    [progress, setProgress] = useState(a.progress ?? ""),
    [notes, setNotes] = useState(a.notes),
    [reason, setReason] = useState(a.cancellation_reason),
    [file, setFile] = useState(null),
    [due, setDue] = useState(""),
    [checkNotes, setCheckNotes] = useState(""),
    [error, setError] = useState("");
  async function upload() {
    if (!file) return;
    setError("");
    try {
      if (file.size > 2097152) throw new Error("O limite por arquivo é 2 MB.");
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      await mutate("/actions/" + a.id + "/evidence", {
        filename: file.name,
        content,
      });
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <h4>Acompanhamento da ação</h4>
      <Notice message={error} error />
      <fieldset disabled={!canEdit || busy || a.status === "cancelled"}>
        <div className="development-grid">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              "planned",
              "in_progress",
              "completed",
              ...(manager ? ["cancelled"] : []),
            ].map((id) => ({ id, name: labels[id] }))}
          />
          <Field
            label="Andamento (%) — opcional"
            type="number"
            min="0"
            max="100"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
          />
        </div>
        <Text
          label="Atualização e observações"
          value={notes}
          onChange={setNotes}
        />
        {status === "cancelled" && (
          <Text
            label="Justificativa do cancelamento"
            value={reason}
            onChange={setReason}
          />
        )}
        <button
          onClick={() =>
            mutate("/actions/" + a.id + "/progress", {
              status,
              progress: progress === "" ? null : Number(progress),
              notes,
              cancellation_reason: reason,
            })
          }
        >
          Registrar andamento
        </button>
      </fieldset>
      <h4>Evidências de conclusão</h4>
      {evidence.length ? (
        <ul>
          {evidence.map((e) => (
            <li key={e.id}>
              <a
                href={"/api/development/" + participantId + "/evidence/" + e.id}
              >
                {e.filename}
              </a>{" "}
              · {time(e.created_at)}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhuma evidência anexada.</p>
      )}
      {canEdit && (
        <fieldset disabled={busy}>
          <Field
            label="Anexar evidência (máximo 2 MB)"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <button disabled={!file} onClick={upload}>
            Anexar arquivo
          </button>
        </fieldset>
      )}
      <h4>Verificações intermediárias</h4>
      {checkins.map((ch) => (
        <div key={ch.id}>
          <p>
            {ch.due_on} ·{" "}
            {ch.completed_at
              ? "Concluída em " + time(ch.completed_at)
              : "Pendente"}{" "}
            · {ch.notes}
          </p>
          {manager && canEdit && !ch.completed_at && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                mutate("/checkins/" + ch.id + "/complete", {
                  notes: values.get("notes"),
                });
              }}
            >
              <Field
                label="Registro da verificação"
                name="notes"
                required
                minLength={3}
              />
              <button disabled={busy}>Concluir verificação</button>
            </form>
          )}
        </div>
      ))}
      {manager && canEdit && (
        <fieldset disabled={busy}>
          <Field
            label="Data da próxima verificação"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Text
            label="Pauta da verificação"
            value={checkNotes}
            onChange={setCheckNotes}
          />
          <button
            disabled={!due}
            onClick={() =>
              mutate("/checkins", {
                action_id: a.id,
                due_on: due,
                notes: checkNotes,
              })
            }
          >
            Agendar verificação
          </button>
        </fieldset>
      )}
    </>
  );
}
