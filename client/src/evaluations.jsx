import React, { useState, useEffect, useCallback } from "react";
import {
  Routes,
  Route,
  NavLink,
  useParams,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import { Field, Select, Table, Modal, Notice, Loading } from "./components";
const root = "/evaluations";
const labels = {
  draft: "Em preparação",
  open: "Aberto",
  closed: "Encerrado",
  pending: "Pendente",
  submitted: "Concluída",
  superseded: "Substituída",
  self: "Autoavaliação",
  manager: "Avaliação do gestor",
};
const profiles = [
  { id: "gerente", name: "Gerente" },
  { id: "gestor", name: "Gestor imediato" },
  { id: "rh", name: "RH" },
  { id: "master", name: "Master" },
];
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
    load();
  }, [load]);
  return { data, error, load };
}
function Title({ title, text, children }) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">AVALIAÇÃO DE DESEMPENHO</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}
function formValues(e) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
function Status({ value }) {
  return <span className="status-tag">{labels[value] || value}</span>;
}
export function EvaluationModule({ user }) {
  const admin = ["master", "rh"].includes(user.role_id);
  return (
    <>
      <nav className="evaluation-nav">
        <NavLink to={root} end>
          Minhas avaliações
        </NavLink>
        <NavLink to={root + "/cycles"}>Ciclos e resultados</NavLink>
        {admin && (
          <>
            <NavLink to={root + "/competencies"}>Competências</NavLink>
            <NavLink to={root + "/questions"}>Perguntas</NavLink>
            <NavLink to={root + "/questionnaires"}>
              Questionários por cargo
            </NavLink>
            <NavLink to={root + "/transfers"}>Transferências</NavLink>
          </>
        )}
      </nav>
      <Routes>
        <Route index element={<Mine />} />
        <Route path="assignments/:id" element={<Answer />} />
        <Route path="cycles" element={<Cycles admin={admin} />} />
        <Route path="cycles/:id" element={<Cycle admin={admin} />} />
        <Route path="results/:id" element={<Result />} />
        {admin && (
          <>
            <Route path="competencies" element={<Competencies />} />
            <Route path="questions" element={<Questions />} />
            <Route path="questionnaires" element={<Questionnaires />} />
            <Route path="transfers" element={<Transfers />} />
          </>
        )}
        <Route
          path="*"
          element={
            <Notice message="Página não disponível para este perfil." error />
          }
        />
      </Routes>
    </>
  );
}
function Competencies() {
  const list = useData("/evaluations/competencies"),
    look = useData("/lookups"),
    [edit, setEdit] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    const v = formValues(e);
    v.active = v.active === "true";
    setBusy(true);
    try {
      await api(
        "/evaluations/competencies" + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        v,
      );
      setEdit(null);
      setMsg(
        "Versão da competência salva. Publique uma nova versão dos questionários para usá-la.",
      );
      await list.load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="Competências"
        text="Competências gerais e específicas, com pesos versionados."
      >
        <button
          className="primary"
          onClick={() => {
            setMsg("");
            setEdit({ active: true, weight: 1 });
          }}
        >
          Nova competência
        </button>
      </Title>
      <Notice message={msg || list.error} />
      <Table
        rows={list.data || []}
        columns={[
          { key: "code", label: "Código" },
          { key: "name", label: "Competência" },
          { key: "category", label: "Categoria" },
          { key: "weight", label: "Peso" },
          {
            key: "position_id",
            label: "Aplicação",
            render: (r) =>
              r.position_id
                ? look.data?.positions.find((p) => p.id === r.position_id)?.name
                : "Geral",
          },
          { key: "version", label: "Versão" },
          {
            key: "active",
            label: "Situação",
            render: (r) => (r.active ? "Ativa" : "Inativa"),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <button
                onClick={() => {
                  setMsg("");
                  setEdit(r);
                }}
              >
                Editar / versionar
              </button>
            ),
          },
        ]}
      />
      {edit && (
        <Modal title="Competência" onClose={() => setEdit(null)}>
          <Notice message={msg} />
          <form onSubmit={save}>
            <div className="form-grid">
              <Field
                label="Código"
                name="code"
                required
                defaultValue={edit.code}
              />
              <Field
                label="Nome"
                name="name"
                required
                minLength={3}
                defaultValue={edit.name}
              />
              <Field
                label="Descrição"
                name="description"
                required
                minLength={3}
                defaultValue={edit.description}
              />
              <Field
                label="Categoria"
                name="category"
                required
                minLength={2}
                defaultValue={edit.category}
              />
              <Field
                label="Peso"
                name="weight"
                type="number"
                step="0.001"
                min="0.001"
                max="1000"
                required
                defaultValue={edit.weight}
              />
              <Select
                label="Cargo específico (vazio = competência geral)"
                name="position_id"
                defaultValue={edit.position_id || ""}
                options={look.data?.positions || []}
              />
              <Select
                label="Situação"
                name="active"
                defaultValue={String(edit.active)}
                required
                options={[
                  { id: "true", name: "Ativa" },
                  { id: "false", name: "Inativa" },
                ]}
              />
            </div>
            <button disabled={busy} className="primary">
              Salvar versão
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Questions() {
  const list = useData("/evaluations/questions"),
    comps = useData("/evaluations/competencies"),
    [edit, setEdit] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Title
        title="Banco de perguntas"
        text="Escala obrigatória de 1 a 5, com descrições comportamentais próprias."
      >
        <button
          className="primary"
          onClick={() => {
            setMsg("");
            setEdit({ active: true, scale: ["", "", "", "", ""] });
          }}
        >
          Nova pergunta
        </button>
      </Title>
      <Notice message={msg || list.error} />
      <Table
        rows={list.data || []}
        columns={[
          { key: "code", label: "Competência" },
          { key: "prompt", label: "Pergunta" },
          { key: "version", label: "Versão" },
          {
            key: "active",
            label: "Situação",
            render: (r) => (r.active ? "Ativa" : "Inativa"),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <button
                onClick={() => {
                  setMsg("");
                  setEdit(r);
                }}
              >
                Editar / versionar
              </button>
            ),
          },
        ]}
      />
      {edit && (
        <Modal
          title="Pergunta e escala comportamental"
          onClose={() => setEdit(null)}
        >
          <Notice message={msg} />
          <form
            onSubmit={async (e) => {
              const v = formValues(e);
              v.scale = [1, 2, 3, 4, 5].map((n) => v["scale" + n]);
              v.active = v.active === "true";
              setBusy(true);
              try {
                await api(
                  "/evaluations/questions" + (edit.id ? "/" + edit.id : ""),
                  edit.id ? "PUT" : "POST",
                  v,
                );
                setEdit(null);
                setMsg(
                  "Versão salva. Os ciclos existentes mantêm as perguntas originais.",
                );
                await list.load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Select
              label="Competência"
              name="competency_id"
              required
              defaultValue={edit.competency_id}
              options={(comps.data || [])
                .filter((c) => !edit.id || c.id === edit.competency_id)
                .map((c) => ({ id: c.id, name: c.code + " · " + c.name }))}
            />
            <Field
              label="Pergunta"
              name="prompt"
              required
              minLength={5}
              defaultValue={edit.prompt}
            />
            {[1, 2, 3, 4, 5].map((n) => (
              <Field
                key={n}
                label={"Nota " + n + " — comportamento observável"}
                name={"scale" + n}
                required
                minLength={5}
                defaultValue={edit.scale[n - 1]}
              />
            ))}
            <Select
              label="Situação"
              name="active"
              required
              defaultValue={String(edit.active)}
              options={[
                { id: "true", name: "Ativa" },
                { id: "false", name: "Inativa" },
              ]}
            />
            <button className="primary" disabled={busy}>
              Salvar versão
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Questionnaires() {
  const list = useData("/evaluations/questionnaires"),
    look = useData("/lookups"),
    [edit, setEdit] = useState(false),
    [preview, setPreview] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Title
        title="Questionários por cargo"
        text="Cada publicação congela competências, perguntas, escalas e pesos."
      >
        <button
          className="primary"
          onClick={() => {
            setMsg("");
            setEdit(true);
          }}
        >
          Novo questionário
        </button>
      </Title>
      <Notice message={msg || list.error} />
      <p>
        Inclui todas as competências gerais e as específicas do cargo que
        estiverem ativas. Cada competência precisa ter ao menos uma pergunta
        ativa.
      </p>
      <Table
        rows={list.data || []}
        columns={[
          { key: "name", label: "Nome" },
          { key: "position_name", label: "Cargo" },
          {
            key: "versions",
            label: "Versões publicadas",
            render: (r) => (
              <div className="actions">
                {r.versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={async () => {
                      try {
                        setPreview(
                          await api(
                            "/evaluations/questionnaire-versions/" + v.id,
                          ),
                        );
                      } catch (e) {
                        setMsg(e.message);
                      }
                    }}
                  >
                    v{v.version}
                  </button>
                ))}
              </div>
            ),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(
                      "/evaluations/questionnaires/" + r.id + "/publish",
                      "POST",
                    );
                    setMsg("Nova versão publicada.");
                    await list.load();
                  } catch (e) {
                    setMsg(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Publicar nova versão
              </button>
            ),
          },
        ]}
      />
      {edit && (
        <Modal
          title="Criar e publicar questionário"
          onClose={() => setEdit(false)}
        >
          <Notice message={msg} />
          <form
            onSubmit={async (e) => {
              const v = formValues(e);
              setBusy(true);
              try {
                await api("/evaluations/questionnaires", "POST", v);
                setEdit(false);
                await list.load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Nome" name="name" required minLength={3} />
            <Select
              label="Cargo"
              name="position_id"
              required
              options={look.data?.positions || []}
            />
            <button className="primary" disabled={busy}>
              Criar primeira versão
            </button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          title={"Questionário · versão " + preview.version}
          onClose={() => setPreview(null)}
        >
          {preview.snapshot.map((c) => (
            <section key={c.id} className="section">
              <h3>
                {c.code} · {c.name} · peso {c.weight}
              </h3>
              {c.questions.map((q) => (
                <div key={q.id}>
                  <p>{q.prompt}</p>
                  <ol>
                    {q.scale.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          ))}
        </Modal>
      )}
    </>
  );
}
function Cycles({ admin }) {
  const list = useData("/evaluations/cycles"),
    [edit, setEdit] = useState(false),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Title
        title="Ciclos de avaliação"
        text="Organize participantes, prazos e acompanhamento."
      >
        {admin && (
          <button
            className="primary"
            onClick={() => {
              setMsg("");
              setEdit(true);
            }}
          >
            Novo ciclo
          </button>
        )}
      </Title>
      <Notice message={msg || list.error} />
      <Table
        rows={list.data || []}
        columns={[
          { key: "name", label: "Ciclo" },
          {
            key: "reference_start",
            label: "Referência",
            render: (r) => r.reference_start + " a " + r.reference_end,
          },
          { key: "deadline", label: "Prazo" },
          {
            key: "status",
            label: "Status",
            render: (r) => <Status value={r.status} />,
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <NavLink className="button" to={root + "/cycles/" + r.id}>
                Participantes e pendências
              </NavLink>
            ),
          },
        ]}
      />
      {edit && (
        <Modal title="Novo ciclo" onClose={() => setEdit(false)}>
          <Notice message={msg} />
          <form
            onSubmit={async (e) => {
              const v = formValues(e);
              v.role_weights = Object.fromEntries(
                profiles.map((p) => [p.id, v["weight_" + p.id]]),
              );
              setBusy(true);
              try {
                await api("/evaluations/cycles", "POST", v);
                setEdit(false);
                setMsg(
                  "Ciclo criado em preparação. Inclua os participantes e confira os avaliadores antes de abrir.",
                );
                await list.load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Nome" name="name" required minLength={3} />
            <div className="form-grid">
              {[
                ["reference_start", "Referência inicial"],
                ["reference_end", "Referência final"],
                ["opens_on", "Data de abertura"],
                ["deadline", "Prazo de encerramento"],
              ].map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  name={key}
                  type="date"
                  required
                />
              ))}
              <Field
                label="Periodicidade em meses"
                name="periodicity_months"
                type="number"
                min={1}
                max={120}
                defaultValue={12}
                required
              />
              <Field
                label="Limite de divergência (0 a 4 pontos)"
                name="divergence_limit"
                type="number"
                step="0.01"
                min={0}
                max={4}
                defaultValue={1}
                required
              />
              {profiles.map((p) => (
                <Field
                  key={p.id}
                  label={"Peso: " + p.name}
                  name={"weight_" + p.id}
                  type="number"
                  min="0.001"
                  max="1000"
                  step="0.001"
                  defaultValue={1}
                  required
                />
              ))}
            </div>
            <p>
              A autoavaliação é comparativa e não recebe peso na média final. Os
              pesos do ciclo não mudam após a criação.
            </p>
            <button className="primary" disabled={busy}>
              Criar ciclo
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Cycle({ admin }) {
  const { id } = useParams(),
    all = useData("/evaluations/cycles"),
    list = useData("/evaluations/cycles/" + id + "/participants"),
    [modal, setModal] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const cycle = all.data?.find((c) => c.id === Number(id));
  const reload = async () => {
    await Promise.all([all.load(), list.load()]);
  };
  return (
    <>
      <Title
        title={cycle?.name || "Participantes"}
        text={
          cycle
            ? `${labels[cycle.status]} · prazo ${cycle.deadline}`
            : "Participantes e acompanhamento de pendências"
        }
      >
        {admin && cycle && (
          <div className="actions">
            {cycle.status === "draft" && (
              <>
                <button onClick={() => setModal({ type: "enroll" })}>
                  Adicionar participante
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(
                        "/evaluations/cycles/" + id + "/status",
                        "POST",
                        { action: "open" },
                      );
                      await reload();
                    } catch (e) {
                      setMsg(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Abrir ciclo
                </button>
              </>
            )}
            {cycle.status === "open" && (
              <>
                <button onClick={() => setModal({ type: "extend" })}>
                  Prorrogar
                </button>
                <button onClick={() => setModal({ type: "close" })}>
                  Encerrar ciclo
                </button>
              </>
            )}
          </div>
        )}
      </Title>
      <Notice message={msg || list.error || all.error} />
      <Table
        rows={list.data || []}
        columns={[
          { key: "employee_name", label: "Participante" },
          { key: "pending", label: "Avaliações pendentes" },
          { key: "submitted", label: "Concluídas" },
          { key: "reviews", label: "Decisões RH pendentes" },
          {
            key: "released",
            label: "Resultado",
            render: (r) => (r.released ? "Liberado" : "Restrito"),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <div className="actions">
                {r.can_result && (
                  <NavLink className="button" to={root + "/results/" + r.id}>
                    Resultado e mapa
                  </NavLink>
                )}
                {r.can_individual && (
                  <button
                    onClick={() =>
                      setModal({ type: "assignments", participant: r })
                    }
                  >
                    Avaliadores
                  </button>
                )}
                {admin && (
                  <button
                    onClick={() =>
                      setModal({ type: "release", participant: r })
                    }
                  >
                    {r.released ? "Restringir" : "Liberar resultado"}
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      {modal?.type === "enroll" && (
        <Enroll cycleId={id} onClose={() => setModal(null)} onSave={reload} />
      )}{" "}
      {modal?.type === "assignments" && (
        <AssignmentAdmin
          participant={modal.participant}
          admin={admin}
          onClose={() => {
            setModal(null);
            reload();
          }}
        />
      )}
      {modal && ["close", "extend", "release"].includes(modal.type) && (
        <Modal
          title={
            {
              close: "Encerrar ciclo",
              extend: "Prorrogar prazo",
              release: "Liberação de resultado",
            }[modal.type]
          }
          onClose={() => setModal(null)}
        >
          <Notice message={msg} />
          <form
            onSubmit={async (e) => {
              const v = formValues(e);
              setBusy(true);
              try {
                if (modal.type === "release")
                  await api(
                    "/evaluations/participants/" +
                      modal.participant.id +
                      "/release",
                    "POST",
                    { released: !modal.participant.released, reason: v.reason },
                  );
                else
                  await api("/evaluations/cycles/" + id + "/status", "POST", {
                    ...v,
                    action: modal.type,
                  });
                setModal(null);
                setMsg("Alteração registrada em auditoria.");
                await reload();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {modal.type === "extend" && (
              <Field
                label="Novo prazo"
                name="deadline"
                type="date"
                required
                min={cycle?.deadline}
              />
            )}
            <Field
              label="Justificativa"
              name="reason"
              required
              minLength={10}
            />
            {modal.type === "close" && (
              <p>
                O encerramento bloqueia novas respostas. Pendências serão
                preservadas e resultados incompletos não poderão ser liberados.
              </p>
            )}
            {modal.type === "release" && (
              <p>
                O colaborador terá acesso somente ao resultado consolidado e à
                comparação. As avaliações individuais dos gestores permanecem
                restritas.
              </p>
            )}
            <button disabled={busy} className="primary">
              Confirmar
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Enroll({ cycleId, onClose, onSave }) {
  const employees = useData("/employees"),
    qs = useData("/evaluations/questionnaires"),
    [employee, setEmployee] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = employees.data?.find((e) => e.id === Number(employee));
  const versions = (qs.data || [])
    .filter((q) => q.position_id === selected?.position_id)
    .flatMap((q) =>
      q.versions.map((v) => ({ id: v.id, name: q.name + " · v" + v.version })),
    );
  return (
    <Modal title="Adicionar participante" onClose={onClose}>
      <Notice message={msg || employees.error || qs.error} />
      <form
        onSubmit={async (e) => {
          const v = formValues(e);
          setBusy(true);
          try {
            await api(
              "/evaluations/cycles/" + cycleId + "/participants",
              "POST",
              v,
            );
            await onSave();
            onClose();
          } catch (e) {
            setMsg(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select
          label="Funcionário"
          name="employee_id"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
          required
          options={(employees.data || []).filter((e) => e.status === "ativo")}
        />
        <Select
          key={employee}
          label="Questionário e versão do cargo"
          name="questionnaire_version_id"
          required
          options={versions}
        />
        <p>
          A autoavaliação e os avaliadores serão identificados pelos acessos e
          vínculos atuais. Confira a distribuição antes de abrir o ciclo.
        </p>
        <button className="primary" disabled={busy}>
          Adicionar e distribuir
        </button>
      </form>
    </Modal>
  );
}
function AssignmentAdmin({ participant, admin, onClose }) {
  const list = useData(
      "/evaluations/participants/" + participant.id + "/assignments",
    ),
    [mode, setMode] = useState(null),
    [msg, setMsg] = useState("");
  return (
    <Modal
      title={"Avaliações · " + participant.employee_name}
      onClose={onClose}
    >
      <Notice message={msg || list.error} />
      {admin && (
        <button onClick={() => setMode({ type: "add" })}>
          Adicionar avaliador
        </button>
      )}
      <Table
        rows={list.data || []}
        columns={[
          { key: "evaluator_name", label: "Avaliador" },
          { key: "kind", label: "Tipo", render: (r) => labels[r.kind] },
          {
            key: "profile",
            label: "Perfil / peso",
            render: (r) => r.profile + " / " + r.weight,
          },
          {
            key: "status",
            label: "Situação",
            render: (r) => (
              <>
                <Status value={r.status} />
                {r.review_needed && <small>Aguardando decisão RH</small>}
              </>
            ),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <div className="actions">
                <NavLink
                  className="button"
                  to={root + "/assignments/" + r.id}
                  onClick={onClose}
                >
                  Consultar
                </NavLink>
                {admin && r.kind === "manager" && r.status !== "superseded" && (
                  <button
                    onClick={() =>
                      setMode({ type: "substitute", assignment: r })
                    }
                  >
                    Substituir
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      {mode && (
        <EvaluatorForm
          mode={mode}
          participantId={participant.id}
          onCancel={() => setMode(null)}
          onSave={async () => {
            setMode(null);
            setMsg(
              "Distribuição atualizada; confira decisões pendentes em Transferências.",
            );
            await list.load();
          }}
        />
      )}
    </Modal>
  );
}
function EvaluatorForm({ mode, participantId, onCancel, onSave }) {
  const users = useData("/users"),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="section glass">
      <h3>
        {mode.type === "add" ? "Novo avaliador" : "Substituição de avaliador"}
      </h3>
      <Notice message={msg || users.error} />
      <form
        onSubmit={async (e) => {
          const v = formValues(e);
          setBusy(true);
          try {
            await api(
              mode.type === "add"
                ? "/evaluations/participants/" + participantId + "/evaluators"
                : "/evaluations/assignments/" +
                    mode.assignment.id +
                    "/substitute",
              "POST",
              v,
            );
            await onSave();
          } catch (e) {
            setMsg(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select
          label="Avaliador"
          name="evaluator_id"
          required
          options={(users.data || [])
            .filter((u) => u.active && u.role_id !== "colaborador")
            .map((u) => ({ id: u.id, name: u.name || u.username }))}
        />
        {mode.type === "add" && (
          <Select
            label="Perfil de ponderação no ciclo"
            name="profile"
            required
            options={profiles}
          />
        )}
        <Field label="Justificativa" name="reason" required minLength={10} />
        <div className="actions">
          <button disabled={busy}>Confirmar</button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
function Mine() {
  const list = useData("/evaluations/mine");
  return (
    <>
      <Title
        title="Minhas avaliações"
        text="Responda com base em comportamentos observados no período."
      />
      <Notice message={list.error} error />
      <Table
        rows={list.data || []}
        columns={[
          { key: "cycle_name", label: "Ciclo" },
          { key: "employee_name", label: "Colaborador" },
          { key: "kind", label: "Tipo", render: (r) => labels[r.kind] },
          { key: "deadline", label: "Prazo" },
          {
            key: "status",
            label: "Situação",
            render: (r) => (
              <>
                <Status value={r.status} />
                {r.review_needed && <small>Em análise pelo RH</small>}
              </>
            ),
          },
          {
            key: "actions",
            label: "Ações",
            render: (r) => (
              <NavLink className="button" to={root + "/assignments/" + r.id}>
                {r.status === "pending"
                  ? "Abrir avaliação"
                  : "Consultar respostas"}
              </NavLink>
            ),
          },
        ]}
      />
    </>
  );
}
function Answer() {
  const { id } = useParams(),
    load = useData("/evaluations/assignments/" + id),
    [answers, setAnswers] = useState({}),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (load.data) setAnswers(load.data.assignment.answers);
  }, [load.data]);
  if (!load.data)
    return (
      <>
        <Notice message={load.error} error />
        {!load.error && <Loading />}
      </>
    );
  const { assignment: a, participant: p, editable } = load.data;
  const count = p.snapshot.reduce((n, c) => n + c.questions.length, 0);
  async function save(submit) {
    setBusy(true);
    try {
      await api("/evaluations/assignments/" + id + "/answers", "POST", {
        version: a.version,
        answers,
        submit,
      });
      setMsg(
        submit
          ? "Avaliação concluída. Respostas preservadas."
          : "Rascunho salvo.",
      );
      await load.load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title={labels[a.kind] + " · " + p.employee_name}
        text={
          p.cycle_name +
          " · " +
          Object.keys(answers).length +
          " de " +
          count +
          " perguntas respondidas"
        }
      />
      <Notice message={msg || load.error} />
      {a.review_needed && (
        <Notice message="O RH precisa decidir sobre as respostas anteriores antes de permitir edição." />
      )}
      {!editable && (
        <p>
          Consulta de respostas. Esta avaliação não está disponível para edição.
        </p>
      )}
      {p.snapshot.map((c) => (
        <section className="glass section" key={c.id}>
          <h2>
            {c.code} · {c.name}
          </h2>
          <p>{c.description}</p>
          {c.questions.map((q) => (
            <fieldset
              className="question"
              key={q.id}
              disabled={!editable || busy}
            >
              <legend>{q.prompt}</legend>
              <div className="rating-options">
                {q.scale.map((description, i) => (
                  <label
                    key={i}
                    className={answers[q.id] === i + 1 ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name={"q" + q.id}
                      checked={answers[q.id] === i + 1}
                      value={i + 1}
                      onChange={() => setAnswers({ ...answers, [q.id]: i + 1 })}
                    />
                    <strong>{i + 1}</strong>
                    <span>{description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      ))}
      {editable && (
        <div className="evaluation-save">
          <span>
            Todas as perguntas são obrigatórias. Não há opção “Não se aplica”.
          </span>
          <div className="actions">
            <button disabled={busy} onClick={() => save(false)}>
              Salvar rascunho
            </button>
            <button
              disabled={busy || Object.keys(answers).length !== count}
              className="primary"
              onClick={() => save(true)}
            >
              Concluir avaliação
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function Radar({ competencies }) {
  const n = competencies.length;
  if (n < 3)
    return (
      <p>
        O gráfico radar é exibido a partir de três competências. A tabela abaixo
        apresenta a comparação completa.
      </p>
    );
  const xy = (i, value) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [
      250 + (Math.cos(angle) * 155 * value) / 5,
      205 + (Math.sin(angle) * 155 * value) / 5,
    ];
  };
  const poly = (key) =>
    competencies.map((c, i) => xy(i, Number(c[key] || 0)).join(",")).join(" ");
  return (
    <figure className="radar">
      <svg
        viewBox="0 0 500 430"
        role="img"
        aria-label="Mapa radar comparativo de autoavaliação e notas consolidadas. Valores exatos na tabela abaixo."
      >
        {[1, 2, 3, 4, 5].map((level) => (
          <polygon
            key={level}
            points={competencies
              .map((_, i) => xy(i, level).join(","))
              .join(" ")}
            fill="none"
            stroke="#6587a3"
            strokeOpacity=".35"
          />
        ))}
        {competencies.map((c, i) => {
          const [x, y] = xy(i, 5);
          const [tx, ty] = xy(i, 6);
          return (
            <g key={c.id}>
              <line
                x1="250"
                y1="205"
                x2={x}
                y2={y}
                stroke="#6587a3"
                strokeOpacity=".35"
              />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#c9dfef"
                fontSize="12"
              >
                {c.code}
              </text>
            </g>
          );
        })}
        <polygon
          points={poly("score")}
          fill="#82b8e0"
          fillOpacity=".18"
          stroke="#82b8e0"
          strokeWidth="2"
        />
        {competencies.every((c) => c.self_score !== null) && (
          <polygon
            points={poly("self_score")}
            fill="#e6bc7f"
            fillOpacity=".10"
            stroke="#e6bc7f"
            strokeWidth="2"
          />
        )}
      </svg>
      <figcaption>
        <span className="legend-managers">● Gestores</span>{" "}
        <span className="legend-self">● Autoavaliação</span> · escala 1–5
      </figcaption>
    </figure>
  );
}
const number = (v) =>
  v === null
    ? "—"
    : Number(v).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
function Result() {
  const { id } = useParams(),
    load = useData("/evaluations/participants/" + id + "/result");
  if (!load.data)
    return (
      <>
        <Title
          title="Resultado consolidado"
          text="Disponível após as avaliações dos gestores e decisões pendentes do RH."
        />
        <Notice message={load.error} error />
        {!load.error && <Loading />}
      </>
    );
  const r = load.data;
  return (
    <>
      <Title
        title={r.participant.employee_name}
        text={r.participant.cycle_name}
      />
      <div className="stats">
        <section className="glass">
          <span>Nota final dos gestores</span>
          <strong>
            {number(r.score)} <small>de 5,00</small>
          </strong>
        </section>
        <section className="glass">
          <span>Limite de divergência</span>
          <strong>{number(r.divergence_limit)}</strong>
        </section>
        <section className="glass">
          <span>Resultado ao colaborador</span>
          <strong className="role">
            {r.participant.released ? "Liberado pelo RH" : "Restrito"}
          </strong>
        </section>
      </div>
      <section className="glass section">
        <h2>Mapa comparativo de competências</h2>
        <p>
          A autoavaliação não participa da nota final. Diferenças indicam
          percepções a discutir; não classificam automaticamente o desempenho
          como inadequado.
        </p>
        {!r.self_completed && (
          <Notice message="Autoavaliação ainda não concluída. A nota dos gestores permanece independente." />
        )}
        <Radar competencies={r.competencies} />
        <Table
          rows={r.competencies}
          columns={[
            { key: "name", label: "Competência" },
            { key: "weight", label: "Peso" },
            {
              key: "self_score",
              label: "Autoavaliação",
              render: (c) => number(c.self_score),
            },
            { key: "score", label: "Gestores", render: (c) => number(c.score) },
            {
              key: "difference",
              label: "Auto − gestores",
              render: (c) => number(c.difference),
            },
            {
              key: "divergent",
              label: "Percepção",
              render: (c) =>
                c.divergent ? (
                  <span className="divergent">Diferença relevante</span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </section>
      {r.individual && (
        <section className="glass section">
          <h2>Avaliações individuais — acesso restrito</h2>
          <Table
            rows={r.individual}
            columns={[
              { key: "evaluator_name", label: "Avaliador" },
              { key: "kind", label: "Tipo", render: (a) => labels[a.kind] },
              { key: "weight", label: "Peso" },
              {
                key: "status",
                label: "Situação",
                render: (a) => <Status value={a.status} />,
              },
              {
                key: "actions",
                label: "Respostas",
                render: (a) => (
                  <NavLink
                    className="button"
                    to={root + "/assignments/" + a.id}
                  >
                    Consultar
                  </NavLink>
                ),
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
function Transfers() {
  const list = useData("/evaluations/transfers"),
    [decision, setDecision] = useState(null),
    [detail, setDetail] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Title
        title="Transferências e substituições"
        text="Preserve o histórico e decida sobre a validade das respostas anteriores."
      />
      <Notice message={msg || list.error} />
      <Table
        rows={list.data || []}
        columns={[
          {
            key: "employee_name",
            label: "Colaborador / ciclo",
            render: (t) => (
              <>
                {t.employee_name}
                <small>{t.cycle_name}</small>
              </>
            ),
          },
          { key: "reason", label: "Motivo" },
          { key: "previous_evaluator_id", label: "Anterior (ID)" },
          { key: "next_evaluator_id", label: "Novo (ID)" },
          {
            key: "decision",
            label: "Decisão",
            render: (t) =>
              t.decision === "accept"
                ? "Preservadas"
                : t.decision === "discard"
                  ? "Desconsideradas"
                  : "Pendente RH",
          },
          {
            key: "actions",
            label: "Ações",
            render: (t) => (
              <div className="actions">
                <button
                  onClick={() =>
                    setDetail({
                      id: t.participant_id,
                      employee_name: t.employee_name,
                    })
                  }
                >
                  Consultar respostas
                </button>
                {!t.decision && (
                  <button
                    onClick={() => {
                      setMsg("");
                      setDecision(t);
                    }}
                  >
                    Decidir validade
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      {detail && (
        <AssignmentAdmin
          participant={detail}
          admin
          onClose={() => {
            setDetail(null);
            list.load();
          }}
        />
      )}
      {decision && (
        <Modal
          title="Validade das respostas anteriores"
          onClose={() => setDecision(null)}
        >
          <Notice message={msg} />
          <p>
            Preservar mantém o conteúdo disponível; desconsiderar registra a
            decisão e inicia respostas novas. Os registros anteriores não são
            apagados. Se já houver uma avaliação do novo responsável, os
            rascunhos não são mesclados automaticamente.
          </p>
          <form
            onSubmit={async (e) => {
              const v = formValues(e);
              setBusy(true);
              try {
                await api(
                  "/evaluations/transfers/" + decision.id + "/decision",
                  "POST",
                  v,
                );
                setDecision(null);
                setMsg("Decisão registrada.");
                await list.load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Select
              label="Decisão"
              name="decision"
              required
              options={[
                { id: "accept", name: "Preservar respostas" },
                { id: "discard", name: "Desconsiderar respostas anteriores" },
              ]}
            />
            <Field
              label="Justificativa"
              name="reason"
              required
              minLength={10}
            />
            <button disabled={busy} className="primary">
              Registrar decisão
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
