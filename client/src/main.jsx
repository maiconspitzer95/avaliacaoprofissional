import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { api, setCsrf } from "./api";
import { Field, Select, Table, Modal, Notice, Loading } from "./components";
import "./style.css";
import { EvaluationModule } from "./evaluations";
import "./evaluations.css";
const Auth = createContext();
const roles = {
  master: "Master",
  rh: "Gestão de Pessoas / RH",
  gerente: "Gerente",
  gestor: "Gestor imediato",
  colaborador: "Colaborador",
};
function useLoad(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load, setData };
}
function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const expire = () => {
      setUser(null);
      setCsrf("");
    };
    window.addEventListener("session-expired", expire);
    api("/auth/me")
      .then((u) => {
        setUser(u);
        setCsrf(u.csrf_token);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  if (loading) return <Loading />;
  return (
    <Auth.Provider value={{ user, setUser }}>
      <BrowserRouter>
        {!user ? (
          <Login />
        ) : user.must_change_password ? (
          <Password />
        ) : (
          <Layout />
        )}
      </BrowserRouter>
    </Auth.Provider>
  );
}
function Login() {
  const { setUser } = useContext(Auth),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const u = await api(
        "/auth/login",
        "POST",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setCsrf(u.csrf_token);
      setUser(u);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="intro">
        <div className="eyebrow">SANTA CASA DE PELOTAS</div>
        <h1>
          Pessoas que cuidam.
          <br />
          <em>Talentos que evoluem.</em>
        </h1>
        <p>
          Avaliação de Desempenho e<br />
          Desenvolvimento de Colaboradores
        </p>
        <span className="tag">Portal institucional</span>
      </section>
      <section className="glass login-card">
        <div className="eyebrow">BEM-VINDO</div>
        <h2>Acesse sua conta</h2>
        <p>Use seu CPF e sua senha institucional.</p>
        <Notice message={error} error />
        <form onSubmit={submit}>
          <Field
            label="CPF ou usuário de instalação"
            name="username"
            required
            autoComplete="username"
            maxLength={30}
          />
          <Field
            label="Senha"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            maxLength={128}
          />
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <small>Problemas de acesso? Procure a Gestão de Pessoas.</small>
      </section>
      <footer>Santa Casa de Pelotas · Gestão de Pessoas</footer>
    </div>
  );
}
function Password() {
  const { user, setUser } = useContext(Auth),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget));
    if (v.password !== v.confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/password", "POST", v);
      setUser(null);
      setCsrf("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center">
      <section className="glass login-card">
        <h1>
          {user.must_change_password
            ? "Defina sua nova senha"
            : "Alterar senha"}
        </h1>
        <p>
          Use pelo menos 6 caracteres, conforme a política institucional. Após a
          troca, entre novamente.
        </p>
        <Notice message={error} error />
        <form onSubmit={submit}>
          <Field
            label="Senha atual"
            name="current_password"
            type="password"
            required
            autoComplete="current-password"
          />
          <Field
            label="Nova senha"
            name="password"
            type="password"
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
          />
          <Field
            label="Confirme a nova senha"
            name="confirm"
            type="password"
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
          />
          <button className="primary" disabled={busy}>
            Salvar nova senha
          </button>
        </form>
        <button
          onClick={async () => {
            try {
              await api("/auth/logout", "POST");
              setUser(null);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Sair
        </button>
      </section>
    </div>
  );
}
const menus = [
  ["/evaluations", "Avaliações"],
  ["/", "Visão geral"],
  ["/employees", "Funcionários"],
  ["/users", "Usuários"],
  ["/nuclei", "Núcleos"],
  ["/sectors", "Setores"],
  ["/positions", "Cargos"],
  ["/hierarchy", "Hierarquia"],
  ["/imports", "Importação"],
  ["/audit", "Auditoria"],
  ["/settings", "Configurações"],
];
function Layout() {
  const { user, setUser } = useContext(Auth),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const admin = ["master", "rh"].includes(user.role_id);
  return (
    <div className="layout">
      <aside className={open ? "open" : ""}>
        <div className="brand">
          SANTA CASA<small>DE PELOTAS</small>
        </div>
        <div className="app-name">
          Avaliação &<br />
          Desenvolvimento
        </div>
        <nav>
          {menus
            .filter((_, i) => admin || i < 3)
            .map(([url, label]) => (
              <NavLink
                key={url}
                to={url}
                end={url === "/"}
                onClick={() => setOpen(false)}
              >
                {label}
              </NavLink>
            ))}
        </nav>
        <small className="phase">Gestão de Pessoas · Desenvolvimento</small>
      </aside>
      <div className="workspace">
        <header className="top">
          <button
            className="menu-toggle"
            onClick={() => setOpen(!open)}
            aria-label="Abrir menu"
          >
            ☰
          </button>
          <span>Desenvolvimento de colaboradores</span>
          <div className="account">
            <span>
              {user.username}
              <small>{roles[user.role_id]}</small>
            </span>
            <NavLink to="/password">Senha</NavLink>
            <button
              onClick={async () => {
                try {
                  await api("/auth/logout", "POST");
                  setUser(null);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Sair
            </button>
          </div>
        </header>
        <main>
          <Notice message={error} error />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/password" element={<Password />} />
            <Route path="/employees" element={<Employees admin={admin} />} />
            <Route
              path="/evaluations/*"
              element={<EvaluationModule user={user} />}
            />
            {admin && (
              <>
                <Route path="/users" element={<Users />} />
                {["nuclei", "sectors", "positions"].map((t) => (
                  <Route
                    key={t}
                    path={"/" + t}
                    element={<Catalog key={t} type={t} />}
                  />
                ))}
                <Route path="/hierarchy" element={<Hierarchy />} />
                <Route path="/imports" element={<Imports />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/settings" element={<Settings />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Heading({ title, subtitle, children }) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">GESTÃO DE PESSOAS</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function Dashboard() {
  const { user } = useContext(Auth),
    { data, error } = useLoad("/dashboard");
  return (
    <>
      <Heading
        title="Visão geral"
        subtitle="Uma base organizada para desenvolver pessoas."
      />
      <Notice message={error} error />
      {!data ? (
        <Loading />
      ) : (
        <div className="stats">
          <section className="glass">
            <span>Funcionários no seu escopo</span>
            <strong>{data.total}</strong>
          </section>
          <section className="glass">
            <span>Em atividade</span>
            <strong>{data.active}</strong>
          </section>
          <section className="glass">
            <span>Seu perfil</span>
            <strong className="role">{roles[user.role_id]}</strong>
          </section>
        </div>
      )}
      <section className="glass welcome">
        <h2>Comece pela estrutura organizacional</h2>
        <p>
          Cadastros, vínculos e acessos formam a base deste portal. Acesse Avaliações
          para acompanhar ciclos e responder aos questionários disponíveis.
        </p>
        <NavLink className="button" to="/employees">
          Consultar funcionários →
        </NavLink>
      </section>
    </>
  );
}
function Catalog({ type }) {
  const { data, error, load } = useLoad("/" + type),
    look = useLoad("/lookups"),
    [edit, setEdit] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const title = { nuclei: "Núcleos", sectors: "Setores", positions: "Cargos" }[
    type
  ];
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const v = Object.fromEntries(new FormData(e.currentTarget));
      v.active = v.active === "true";
      await api(
        "/" + type + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        v,
      );
      setEdit(null);
      setMsg("Cadastro salvo.");
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={title} subtitle="Organize os cadastros institucionais.">
        <button
          className="primary"
          onClick={() => {
            setMsg("");
            setEdit({ active: true });
          }}
        >
          Novo cadastro
        </button>
      </Heading>
      <Notice message={error || msg} error={!!error} />
      {data ? (
        <Table
          rows={data}
          columns={[
            { key: "name", label: "Nome" },
            ...(type === "sectors"
              ? [
                  {
                    key: "nucleus_id",
                    label: "Núcleo",
                    render: (r) =>
                      look.data?.nuclei.find((n) => n.id === r.nucleus_id)
                        ?.name,
                  },
                ]
              : []),
            {
              key: "active",
              label: "Situação",
              render: (r) => (r.active ? "Ativo" : "Inativo"),
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
                  Editar
                </button>
              ),
            },
          ]}
        />
      ) : (
        <Loading />
      )}
      {edit && (
        <Modal
          title={"Editar " + title.toLowerCase()}
          onClose={() => setEdit(null)}
        >
          <Notice message={msg} />
          <form onSubmit={submit}>
            <Field
              label="Nome"
              name="name"
              required
              defaultValue={edit.name}
              maxLength={120}
            />
            {type === "sectors" && (
              <Select
                label="Núcleo"
                name="nucleus_id"
                required
                defaultValue={edit.nucleus_id}
                options={look.data?.nuclei || []}
              />
            )}
            <Select
              label="Situação"
              name="active"
              defaultValue={String(edit.active)}
              required
              options={[
                { id: "true", name: "Ativo" },
                { id: "false", name: "Inativo" },
              ]}
            />
            <button disabled={busy} className="primary">
              Salvar
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
const employeeFields = [
  "name",
  "cpf",
  "re",
  "position_id",
  "sector_id",
  "manager_id",
  "supervisor_id",
  "status",
  "admission_date",
  "position_start",
  "level_start",
];
function EmployeeForm({ value, look, onSave, busy }) {
  const [nucleus, setNucleus] = useState(
    String(
      value.nucleus_id ||
        look.sectors.find((s) => s.id === value.sector_id)?.nucleus_id ||
        "",
    ),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <div className="form-grid">
        <Field
          label="Nome completo"
          name="name"
          required
          defaultValue={value.name}
          maxLength={180}
        />
        <Field
          label="CPF"
          name="cpf"
          required
          defaultValue={value.cpf}
          maxLength={14}
        />
        <Field label="RE" name="re" required defaultValue={value.re} />
        <Select
          label="Cargo"
          name="position_id"
          required
          defaultValue={value.position_id}
          options={look.positions.filter(
            (x) => x.active || x.id === value.position_id,
          )}
        />
        <Select
          label="Núcleo"
          value={nucleus}
          onChange={(e) => setNucleus(e.target.value)}
          required
          options={look.nuclei}
        />
        <Select
          key={nucleus}
          label="Setor"
          name="sector_id"
          required
          defaultValue={value.sector_id}
          options={look.sectors.filter(
            (s) =>
              String(s.nucleus_id) === nucleus &&
              (s.active || s.id === value.sector_id),
          )}
        />
        <Select
          label="Gerente responsável"
          name="manager_id"
          defaultValue={value.manager_id || ""}
          options={look.leaders.filter((x) => x.role_id === "gerente")}
        />
        <Select
          label="Gestor imediato"
          name="supervisor_id"
          defaultValue={value.supervisor_id || ""}
          options={look.leaders.filter((x) => x.role_id === "gestor")}
        />
        <Select
          label="Situação funcional"
          name="status"
          required
          defaultValue={value.status || "ativo"}
          options={["ativo", "afastado", "desligado"].map((x) => ({
            id: x,
            name: x,
          }))}
        />
        {[
          ["admission_date", "Data de admissão"],
          ["position_start", "Início no cargo"],
          ["level_start", "Início no nível"],
        ].map(([key, label]) => (
          <Field
            key={key}
            label={label}
            name={key}
            type="date"
            required
            defaultValue={value[key]}
          />
        ))}
      </div>
      <button className="primary" disabled={busy}>
        Salvar funcionário
      </button>
    </form>
  );
}
function Employees({ admin }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [sector, setSector] = useState(""),
    [nucleus, setNucleus] = useState("");
  const { data, error, load } = useLoad(
      "/employees?" +
        new URLSearchParams({
          q: query,
          status,
          sector_id: sector,
          nucleus_id: nucleus,
        }),
    ),
    look = useLoad("/lookups");
  const [edit, setEdit] = useState(null),
    [history, setHistory] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(v) {
    setBusy(true);
    try {
      await api(
        "/employees" + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        v,
      );
      setEdit(null);
      setMsg("Funcionário salvo; histórico preservado.");
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Funcionários"
        subtitle="Consulte pessoas, cargos e vínculos organizacionais."
      >
        {admin && (
          <button
            className="primary"
            onClick={() => {
              setMsg("");
              setEdit({});
            }}
          >
            Novo funcionário
          </button>
        )}
      </Heading>
      <Notice
        message={error || look.error || msg}
        error={!!(error || look.error)}
      />
      <div className="filters">
        <Field
          label="Pesquisar por nome ou RE"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={["ativo", "afastado", "desligado"].map((x) => ({
            id: x,
            name: x,
          }))}
        />
        <Select
          label="Núcleo"
          value={nucleus}
          onChange={(e) => {
            setNucleus(e.target.value);
            setSector("");
          }}
          options={look.data?.nuclei || []}
        />
        <Select
          label="Setor"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          options={(look.data?.sectors || []).filter(
            (x) => !nucleus || String(x.nucleus_id) === nucleus,
          )}
        />
      </div>
      {data ? (
        <Table
          rows={data}
          columns={[
            {
              key: "name",
              label: "Funcionário",
              render: (r) => (
                <>
                  <b>{r.name}</b>
                  <small>
                    RE {r.re} · CPF {r.cpf}
                  </small>
                </>
              ),
            },
            { key: "position_name", label: "Cargo" },
            {
              key: "sector_name",
              label: "Setor / Núcleo",
              render: (r) => (
                <>
                  {r.sector_name}
                  <small>{r.nucleus_name}</small>
                </>
              ),
            },
            { key: "status", label: "Situação" },
            {
              key: "actions",
              label: "Ações",
              render: (r) => (
                <div className="actions">
                  {admin && (
                    <button
                      onClick={() => {
                        setMsg("");
                        setEdit(r);
                      }}
                    >
                      Editar
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        setHistory({
                          employee: r,
                          rows: await api("/employees/" + r.id + "/history"),
                        });
                      } catch (e) {
                        setMsg(e.message);
                      }
                    }}
                  >
                    Consultar
                  </button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <Loading />
      )}
      <small>
        Exibição limitada a 1.000 resultados. Use os filtros para refinar.
      </small>
      {edit && look.data && (
        <Modal
          title={edit.id ? "Editar funcionário" : "Novo funcionário"}
          onClose={() => setEdit(null)}
        >
          <Notice message={msg} />
          <EmployeeForm
            value={edit}
            look={look.data}
            onSave={save}
            busy={busy}
          />
        </Modal>
      )}
      {history && (
        <Modal title={history.employee.name} onClose={() => setHistory(null)}>
          <dl>
            {[
              ["CPF", "cpf"],
              ["RE", "re"],
              ["Cargo", "position_name"],
              ["Admissão", "admission_date"],
              ["Início no cargo", "position_start"],
              ["Início no nível", "level_start"],
            ].map(([l, k]) => (
              <div key={k}>
                <dt>{l}</dt>
                <dd>{history.employee[k]}</dd>
              </div>
            ))}
          </dl>
          <h3>Histórico de vínculos</h3>
          <Table
            rows={history.rows}
            columns={[
              { key: "sector_name", label: "Setor" },
              { key: "manager_id", label: "Gerente (ID)" },
              { key: "supervisor_id", label: "Gestor (ID)" },
              {
                key: "started_at",
                label: "Desde",
                render: (r) => new Date(r.started_at).toLocaleString("pt-BR"),
              },
              {
                key: "ended_at",
                label: "Até",
                render: (r) =>
                  r.ended_at
                    ? new Date(r.ended_at).toLocaleString("pt-BR")
                    : "Atual",
              },
            ]}
          />
        </Modal>
      )}
    </>
  );
}
function Users() {
  const { data, error, load } = useLoad("/users"),
    employees = useLoad("/employees"),
    [edit, setEdit] = useState(null),
    [reset, setReset] = useState(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const v = Object.fromEntries(new FormData(e.currentTarget));
      v.active = v.active === "true";
      await api(
        "/users" + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        v,
      );
      setEdit(null);
      setMsg("Usuário salvo.");
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Usuários" subtitle="CPF, perfis de acesso e segurança.">
        <button
          className="primary"
          onClick={() => {
            setMsg("");
            setEdit({ active: true, role_id: "colaborador" });
          }}
        >
          Novo usuário
        </button>
      </Heading>
      <Notice message={error || msg} error={!!error} />
      {data ? (
        <Table
          rows={data}
          columns={[
            { key: "username", label: "Login" },
            { key: "name", label: "Funcionário" },
            {
              key: "role_id",
              label: "Perfil",
              render: (r) => roles[r.role_id],
            },
            {
              key: "active",
              label: "Situação",
              render: (r) => (r.active ? "Ativo" : "Inativo"),
            },
            {
              key: "must_change_password",
              label: "Troca de senha",
              render: (r) =>
                r.must_change_password ? "Obrigatória" : "Concluída",
            },
            {
              key: "actions",
              label: "Ações",
              render: (r) =>
                r.role_id !== "master" && (
                  <div className="actions">
                    <button
                      onClick={() => {
                        setMsg("");
                        setEdit(r);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        setMsg("");
                        setReset(r);
                      }}
                    >
                      Redefinir senha
                    </button>
                  </div>
                ),
            },
          ]}
        />
      ) : (
        <Loading />
      )}
      {edit && (
        <Modal title="Usuário" onClose={() => setEdit(null)}>
          <Notice message={msg} />
          <form onSubmit={save}>
            {!edit.id && (
              <>
                <Select
                  label="Funcionário (CPF será o login)"
                  name="employee_id"
                  required
                  options={employees.data || []}
                />
                <Field
                  label="Senha temporária"
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </>
            )}
            <Select
              label="Perfil"
              name="role_id"
              required
              defaultValue={edit.role_id}
              options={Object.entries(roles)
                .filter(([id]) => id !== "master")
                .map(([id, name]) => ({ id, name }))}
            />
            <Select
              label="Situação"
              name="active"
              required
              defaultValue={String(edit.active)}
              options={[
                { id: "true", name: "Ativo" },
                { id: "false", name: "Inativo" },
              ]}
            />
            <button disabled={busy} className="primary">
              Salvar
            </button>
          </form>
        </Modal>
      )}
      {reset && (
        <Modal
          title={"Redefinir senha · " + reset.username}
          onClose={() => setReset(null)}
        >
          <Notice message={msg} />
          <p>
            A troca será obrigatória no próximo acesso e as sessões atuais serão
            encerradas.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api(
                  "/users/" + reset.id + "/reset-password",
                  "POST",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
                setReset(null);
                setMsg("Senha redefinida.");
                await load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Nova senha temporária"
              type="password"
              name="password"
              required
              minLength={6}
              maxLength={128}
            />
            <button disabled={busy} className="primary">
              Redefinir
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Hierarchy() {
  const employees = useLoad("/employees"),
    users = useLoad("/users"),
    exceptions = useLoad("/hierarchy/exceptions");
  const [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Heading
        title="Hierarquia"
        subtitle="Núcleo → Setor → Gerente → Gestor imediato → Colaboradores"
      />
      <p>
        Altere os responsáveis pela edição do funcionário. O vínculo anterior
        permanece no histórico.
      </p>
      <NavLink className="button" to="/employees">
        Configurar vínculos de funcionários
      </NavLink>
      <Notice
        message={employees.error || users.error || exceptions.error || msg}
      />
      <section className="glass section">
        <h2>Vínculos atuais</h2>
        <Table
          rows={employees.data || []}
          columns={[
            { key: "name", label: "Colaborador" },
            { key: "nucleus_name", label: "Núcleo" },
            { key: "sector_name", label: "Setor" },
            {
              key: "manager_id",
              label: "Gerente",
              render: (r) =>
                users.data?.find((u) => u.id === r.manager_id)?.name || "—",
            },
            {
              key: "supervisor_id",
              label: "Gestor",
              render: (r) =>
                users.data?.find((u) => u.id === r.supervisor_id)?.name || "—",
            },
          ]}
        />
      </section>
      <section className="glass section">
        <h2>Exceções autorizadas de visibilidade</h2>
        <p>
          Concede consulta de um funcionário a um usuário específico. Informe
          uma justificativa.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const v = Object.fromEntries(new FormData(form));
            v.active = v.active === "true";
            setBusy(true);
            try {
              await api("/hierarchy/exceptions", "POST", v);
              setMsg("Exceção registrada.");
              form.reset();
              await exceptions.load();
            } catch (e) {
              setMsg(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <Select
              label="Usuário"
              name="user_id"
              required
              options={(users.data || []).map((u) => ({
                id: u.id,
                name: u.name || u.username,
              }))}
            />
            <Select
              label="Funcionário"
              name="employee_id"
              required
              options={employees.data || []}
            />
            <Field
              label="Justificativa"
              name="reason"
              required
              minLength={10}
            />
            <Select
              label="Situação"
              name="active"
              defaultValue="true"
              required
              options={[
                { id: "true", name: "Autorizar" },
                { id: "false", name: "Revogar" },
              ]}
            />
          </div>
          <button disabled={busy}>Registrar exceção</button>
        </form>
        <Table
          rows={exceptions.data || []}
          columns={[
            { key: "username", label: "Usuário" },
            { key: "name", label: "Funcionário" },
            { key: "reason", label: "Justificativa" },
            {
              key: "active",
              label: "Situação",
              render: (r) => (r.active ? "Autorizada" : "Revogada"),
            },
          ]}
        />
      </section>
    </>
  );
}
function download(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Imports() {
  const history = useLoad("/imports"),
    look = useLoad("/lookups"),
    [rows, setRows] = useState([]),
    [filename, setFilename] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [validated, setValidated] = useState(false);
  async function file(e) {
    const f = e.target.files[0];
    if (!f) return;
    setRows([]);
    setValidated(false);
    if (f.size > 2000000) {
      setMsg("Limite de 2 MB por arquivo.");
      return;
    }
    setFilename(f.name);
    setBusy(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      const result = await api("/imports/parse", "POST", {
        filename: f.name,
        base64,
      });
      setRows(result);
      setValidated(!result.some((r) => r.errors.length));
      setMsg("Prévia carregada. Revise os dados antes de confirmar.");
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Importação de funcionários"
        subtitle="Valide, corrija e confirme antes de gravar."
      >
        <button
          onClick={() =>
            download(
              "modelo-funcionarios.csv",
              "\uFEFF" + employeeFields.join(";") + "\r\n",
            )
          }
        >
          Baixar modelo CSV
        </button>
      </Heading>
      <Notice message={msg || history.error} />
      <section className="glass section">
        <p>
          CSV UTF-8 (vírgula ou ponto e vírgula) ou XLSX. Até 1.000 linhas / 2
          MB. CPF e RE devem ser texto para preservar zeros. Datas: AAAA-MM-DD.
          Use os códigos dos cadastros abaixo.
        </p>
        <details>
          <summary>Consultar códigos para importação</summary>
          {look.data &&
            ["positions", "sectors", "leaders"].map((k) => (
              <div key={k}>
                <h3>
                  {
                    {
                      positions: "Cargos",
                      sectors: "Setores",
                      leaders: "Responsáveis",
                    }[k]
                  }
                </h3>
                <Table
                  rows={look.data[k]}
                  columns={[
                    { key: "id", label: "Código" },
                    { key: "name", label: "Nome" },
                    { key: "role_id", label: "Perfil" },
                  ]}
                />
              </div>
            ))}
        </details>
        <Field
          label="Selecionar arquivo"
          type="file"
          accept=".csv,.xlsx"
          onChange={file}
          disabled={busy}
        />
      </section>
      {rows.length > 0 && (
        <section className="glass section">
          <h2>Prévia editável · {rows.length} registros</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Linha / validação</th>
                  {employeeFields.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.line} · {r.action}
                      <small className="validation-error">
                        {r.errors.join("; ")}
                      </small>
                    </td>
                    {employeeFields.map((k) => (
                      <td key={k}>
                        <input
                          aria-label={`Linha ${r.line}, ${k}`}
                          value={r.input[k] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRows((old) =>
                              old.map((x, j) =>
                                i === j
                                  ? { ...x, input: { ...x.input, [k]: value } }
                                  : x,
                              ),
                            );
                            setValidated(false);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api("/imports/preview", "POST", {
                    filename,
                    rows: rows.map((r) => r.input),
                  });
                  setRows(r);
                  setValidated(!r.some((x) => x.errors.length));
                  setMsg(
                    r.some((x) => x.errors.length)
                      ? "Corrija as linhas indicadas."
                      : "Validação concluída. Pronto para confirmar.",
                  );
                } catch (e) {
                  setMsg(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Validar correções
            </button>
            <button
              className="primary"
              disabled={busy || !validated}
              onClick={async () => {
                setBusy(true);
                setValidated(false);
                try {
                  const result = await api("/imports/confirm", "POST", {
                    filename,
                    rows: rows.map((r) => r.input),
                  });
                  setRows([]);
                  setMsg(
                    `Importação ${result.id} concluída: ${result.report.length} registros.`,
                  );
                  await history.load();
                } catch (e) {
                  setMsg(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar importação
            </button>
          </div>
        </section>
      )}
      <h2>Histórico de importações</h2>
      <Table
        rows={history.data || []}
        columns={[
          { key: "filename", label: "Arquivo" },
          { key: "username", label: "Responsável" },
          {
            key: "created_at",
            label: "Data",
            render: (r) => new Date(r.created_at).toLocaleString("pt-BR"),
          },
          { key: "total", label: "Registros" },
          {
            key: "actions",
            label: "Relatório",
            render: (r) => (
              <button
                onClick={() =>
                  download(
                    "importacao-" + r.id + ".csv",
                    "linha;id;acao\r\n" +
                      r.report
                        .map((x) => [x.line, x.id, x.action].join(";"))
                        .join("\r\n"),
                  )
                }
              >
                Baixar relatório
              </button>
            ),
          },
        ]}
      />
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(0),
    { data, error } = useLoad("/audit?page=" + page),
    [detail, setDetail] = useState(null);
  return (
    <>
      <Heading
        title="Auditoria"
        subtitle="Rastreabilidade das operações administrativas."
      />
      <Notice message={error} error />
      {data ? (
        <Table
          rows={data}
          columns={[
            {
              key: "created_at",
              label: "Data",
              render: (r) => new Date(r.created_at).toLocaleString("pt-BR"),
            },
            { key: "username", label: "Responsável" },
            { key: "action", label: "Ação" },
            { key: "entity", label: "Entidade" },
            { key: "entity_id", label: "Registro" },
            {
              key: "details",
              label: "Detalhes",
              render: (r) => (
                <button onClick={() => setDetail(r.details)}>Consultar</button>
              ),
            },
          ]}
        />
      ) : (
        <Loading />
      )}
      <div className="actions">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>Página {page + 1}</span>
        <button
          disabled={!data || data.length < 100}
          onClick={() => setPage(page + 1)}
        >
          Próxima
        </button>
      </div>
      {detail && (
        <Modal title="Detalhes da operação" onClose={() => setDetail(null)}>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      )}
    </>
  );
}
function Settings() {
  const { data, error, load } = useLoad("/settings"),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Heading
        title="Configurações administrativas"
        subtitle="Política institucional de senha e sessão."
      />
      <Notice message={error || msg} error={!!error} />
      {data ? (
        <section className="glass section">
          <form
            key={JSON.stringify(data)}
            onSubmit={async (e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                await api("/settings", "PUT", v);
                setMsg("Configurações salvas.");
                await load();
              } catch (e) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Comprimento mínimo da senha (6 a 72)"
              type="number"
              name="password_min_length"
              min={6}
              max={72}
              required
              defaultValue={data.password_min_length}
            />
            <Field
              label="Expiração por inatividade (5 a 480 minutos)"
              type="number"
              name="session_idle_minutes"
              min={5}
              max={480}
              required
              defaultValue={data.session_idle_minutes}
            />
            <p>
              Alterar a política afeta as próximas definições de senha. Toda
              sessão expira também após 12 horas. Restrições adicionais do .env
              prevalecem.
            </p>
            <button className="primary" disabled={busy}>
              Salvar configurações
            </button>
          </form>
        </section>
      ) : (
        <Loading />
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
