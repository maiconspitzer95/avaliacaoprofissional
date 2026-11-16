import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/src/app.js";
import { pool } from "../server/src/database/pool.js";
test("HTTP: saúde, sessão obrigatória, validação e limite de tentativas", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(url + "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    const denied = await fetch(url + "/api/employees");
    assert.equal(denied.status, 401);
    const long = await fetch(url + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "master", password: "á".repeat(40) }),
    });
    assert.equal(long.status, 400);
    for (let i = 0; i < 10; i++) {
      const invalid = await fetch(url + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(invalid.status, 400);
    }
    const limited = await fetch(url + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(limited.status, 429);
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
  }
});
