import React, { useEffect, useRef } from "react";
export function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
export function Select({ label, options, ...props }) {
  return (
    <Field label={label}>
      <select {...props}>
        <option value="">Selecione</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Table({ columns, rows }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={r.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="empty">
                Nenhum registro encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Notice({ message, error = false }) {
  return message ? (
    <div
      role={error ? "alert" : "status"}
      className={"notice " + (error ? "error" : "")}
    >
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <p role="status" className="loading">
      Carregando…
    </p>
  );
}
