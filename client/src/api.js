export let csrf = "";
export function setCsrf(value) {
  csrf = value || "";
}
export async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.message || "Não foi possível concluir.");
  }
  return data;
}
