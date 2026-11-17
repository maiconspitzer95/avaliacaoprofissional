// Opt-in PostgreSQL integration test. All fixture data is rolled back.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../server/src/database/pool.js";
import { app } from "../server/src/app.js";
import { digest } from "../server/src/middleware/security.js";
import { emptyDocument } from "../server/src/services/development-policy.js";
test(
  "PostgreSQL / HTTP: elaboração conjunta, permissões, duas assinaturas, histórico e acompanhamento",
  { skip: process.env.RUN_DEVELOPMENT_DB_TESTS !== "1" },
  async () => {
    const c = await pool.connect(),
      originalQuery = pool.query,
      originalConnect = pool.connect;
    let server;
    await c.query("BEGIN");
    try {
      const tag = randomUUID(),
        password = "Teste!45678",
        passwordHash = await bcrypt.hash(password, 4);
      const insert = async (sql, args = []) =>
        (await c.query(sql + " RETURNING id", args)).rows[0].id;
      const position = await insert(
        "INSERT INTO ad.positions(name) VALUES($1)",
        ["Teste " + tag],
      );
      const employee = await insert(
        "INSERT INTO ad.employees(name,cpf,re,position_id,status,admission_date,position_start,level_start) VALUES($1,$2,$3,$4,'ativo','2020-01-01','2020-01-01','2020-01-01')",
        [
          "Pessoa teste",
          String(Date.now()).slice(-11),
          "TEST-" + tag,
          position,
        ],
      );
      const users = {};
      let sequence = 1;
      for (const [key, role, employeeId] of [
        ["manager", "gestor", null],
        ["employee", "colaborador", employee],
        ["hr", "rh", null],
        ["outsider", "gestor", null],
      ]) {
        const id = await insert(
          "INSERT INTO ad.users(username,password_hash,role_id,employee_id,must_change_password) VALUES($1,$2,$3,$4,false)",
          [
            String(Date.now() + sequence++).slice(-11),
            passwordHash,
            role,
            employeeId,
          ],
        );
        const token = randomUUID(),
          csrf = randomUUID();
        await c.query(
          "INSERT INTO ad.sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
          [digest(token), id, csrf],
        );
        users[key] = { id, token, csrf };
      }
      const q = await insert(
        "INSERT INTO ad.questionnaires(name,position_id) VALUES($1,$2)",
        ["Teste " + tag, position],
      );
      const snapshot = [
        {
          id: 901,
          code: "T1",
          name: "Comunicação",
          description: "Teste",
          weight: "1",
          questions: [
            {
              id: 902,
              prompt: "Comunica com clareza?",
              scale: [
                "Nunca",
                "Raramente",
                "Às vezes",
                "Frequentemente",
                "Sempre",
              ],
            },
          ],
        },
      ];
      const qv = await insert(
        "INSERT INTO ad.questionnaire_versions(questionnaire_id,version,snapshot,created_by) VALUES($1,1,$2,$3)",
        [q, JSON.stringify(snapshot), users.hr.id],
      );
      const cy = await insert(
        "INSERT INTO ad.evaluation_cycles(name,reference_start,reference_end,opens_on,deadline,periodicity_months,status,role_weights,divergence_limit,created_by) VALUES($1,'2026-01-01','2026-11-01','2026-11-01','2026-11-30',12,'closed',$2,1,$3)",
        ["Teste " + tag, JSON.stringify({ gestor: 1 }), users.hr.id],
      );
      const participant = await insert(
        "INSERT INTO ad.cycle_participants(cycle_id,employee_id,questionnaire_version_id,responsible_id) VALUES($1,$2,$3,$4)",
        [cy, employee, qv, users.manager.id],
      );
      for (const [key, kind, score] of [
        ["manager", "manager", 3],
        ["employee", "self", 5],
      ]) {
        const a = await insert(
          "INSERT INTO ad.evaluation_assignments(participant_id,evaluator_id,profile,kind,weight,status,version) VALUES($1,$2,$3,$4,1,'submitted',1)",
          [
            participant,
            users[key].id,
            key === "manager" ? "gestor" : "colaborador",
            kind,
          ],
        );
        await c.query(
          "INSERT INTO ad.evaluation_responses(assignment_id,revision,answers,submitted,author_id) VALUES($1,1,$2,true,$3)",
          [a, JSON.stringify({ 902: score }), users[key].id],
        );
      }
      pool.query = (...args) => c.query(...args);
      pool.connect = async () => ({
        release() {},
        async query(sql, args) {
          if (sql === "BEGIN") return c.query("SAVEPOINT development_request");
          if (sql === "COMMIT")
            return c.query("RELEASE SAVEPOINT development_request");
          if (sql === "ROLLBACK") {
            await c.query("ROLLBACK TO SAVEPOINT development_request");
            return c.query("RELEASE SAVEPOINT development_request");
          }
          return c.query(sql, args);
        },
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const origin = `http://127.0.0.1:${server.address().port}`,
        path = "/api/development/" + participant;
      async function request(
        who,
        url = path,
        method = "GET",
        body,
        expected = 200,
      ) {
        const u = users[who];
        const response = await fetch(origin + url, {
          method,
          headers: {
            cookie: "ad_session=" + u.token,
            "x-csrf-token": u.csrf,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const value = await response.json();
        assert.equal(response.status, expected, JSON.stringify(value));
        return value;
      }
      await request("employee", path, "GET", undefined, 403);
      await request("outsider", path, "GET", undefined, 403);
      await request("hr", path + "/start", "POST", {}, 403);
      await request("manager", path + "/start", "POST", {});
      let detail = await request("manager");
      assert.equal(detail.consolidated.score, "3");
      const action = {
        id: randomUUID(),
        description: "Curso de comunicação",
        competency_id: 901,
        responsible: "Pessoa teste",
        start: "2026-01-01",
        deadline: "2026-02-01",
        indicator: "Certificado e aplicação no trabalho",
        status: "planned",
        progress: 0,
        notes: "",
        cancellation_reason: "",
      };
      const doc = {
        ...emptyDocument(),
        strengths: "Escuta ativa",
        opportunities: "Comunicação clara",
        objective: "Melhorar comunicação",
        meeting_date: "2026-11-16",
        actions: [action],
      };
      await request(
        "manager",
        path + "/document",
        "PUT",
        {
          version: 0,
          document: { ...doc, employee_notes: "Consentimento forjado" },
        },
        403,
      );
      await request("manager", path + "/document", "PUT", {
        version: 0,
        document: doc,
      });
      await request(
        "manager",
        path + "/document",
        "PUT",
        { version: 0, document: doc },
        409,
      );
      await request("manager", path + "/submit", "POST", { version: 1 }, 409);
      await request(
        "hr",
        "/api/contestations/participants/" + participant + "/access",
        "POST",
        { allow: true, reason: "Autorizar reunião de feedback." },
      );
      detail = await request("employee");
      assert.equal(detail.assignments.length, 1);
      assert.equal(detail.assignments[0].kind, "self");
      await request(
        "employee",
        path + "/document",
        "PUT",
        { version: 1, document: doc },
        403,
      );
      await request("employee", path + "/contributions", "POST", {
        version: 1,
        text: "Proponho aplicar o aprendizado nas reuniões de equipe.",
      });
      await request("manager", path + "/submit", "POST", { version: 2 });
      detail = await request("manager");
      assert.equal(detail.plan.status, "awaiting_signatures");
      await request(
        "manager",
        path + "/document",
        "PUT",
        { version: detail.plan.version, document: detail.plan.document },
        409,
      );
      await request(
        "manager",
        path + "/sign",
        "POST",
        {
          version: detail.plan.version,
          password: "errada",
          acknowledgment: true,
          document_hash: detail.plan.document_hash,
        },
        400,
      );
      await request(
        "hr",
        path + "/sign",
        "POST",
        {
          version: detail.plan.version,
          password,
          acknowledgment: true,
          document_hash: detail.plan.document_hash,
        },
        403,
      );
      await request("manager", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("employee");
      assert.equal(detail.plan.status, "awaiting_signatures");
      assert.equal(detail.signatures.length, 1);
      await request("employee", path + "/reopen", "POST", {
        version: detail.plan.version,
        reason: "Precisamos discutir o prazo novamente.",
      });
      detail = await request("manager");
      assert.equal(detail.plan.status, "draft");
      assert.equal(detail.signatures.length, 1);
      await request("manager", path + "/submit", "POST", {
        version: detail.plan.version,
      });
      detail = await request("manager");
      assert.equal(detail.plan.signature_round, 2);
      await request("manager", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("employee");
      await request(
        "manager",
        path + "/sign",
        "POST",
        {
          version: detail.plan.version,
          password,
          acknowledgment: true,
          document_hash: detail.plan.document_hash,
        },
        409,
      );
      await request("employee", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("employee");
      assert.equal(detail.plan.status, "signed");
      assert.equal(detail.signatures.length, 3);
      const frozen = detail.plan.signed_text;
      if (process.env.DEVELOPMENT_PLAYWRIGHT_MODULE) {
        const { chromium } = await import(
          process.env.DEVELOPMENT_PLAYWRIGHT_MODULE
        );
        const browser = await chromium.launch({
          headless: true,
          executablePath:
            process.env.DEVELOPMENT_BROWSER_PATH ||
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
        });
        try {
          const browserContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
          });
          await browserContext.addCookies([
            { name: "ad_session", value: users.employee.token, url: origin },
          ]);
          const page = await browserContext.newPage(),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(origin + "/development/" + participant);
          await page
            .getByRole("heading", {
              name: "Plano de Desenvolvimento Individual",
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Registrar andamento", exact: true })
              .count(),
            1,
          );
          await page
            .getByText("Revisar conteúdo congelado para assinatura", {
              exact: true,
            })
            .click();
          if (process.env.DEVELOPMENT_SCREENSHOT_DIR)
            await page.screenshot({
              path:
                process.env.DEVELOPMENT_SCREENSHOT_DIR +
                "/feedback-desktop.png",
              fullPage: true,
            });
          await page.setViewportSize({ width: 390, height: 844 });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            true,
            "Layout móvel deve caber na tela",
          );
          if (process.env.DEVELOPMENT_SCREENSHOT_DIR)
            await page.screenshot({
              path:
                process.env.DEVELOPMENT_SCREENSHOT_DIR + "/feedback-mobile.png",
              fullPage: true,
            });
          await page.goto(origin + "/development/tracking");
          await page
            .getByRole("heading", {
              name: "Acompanhamento do PDI",
              exact: true,
            })
            .waitFor();
          await page
            .getByRole("link", { name: "Acompanhar", exact: true })
            .waitFor();
          await page.goto(origin + "/development/contestations");
          await page
            .getByRole("heading", { name: "Contestações e revisões" })
            .waitFor();
          const hrContext = await browser.newContext({
            viewport: { width: 1440, height: 900 },
          });
          await hrContext.addCookies([
            { name: "ad_session", value: users.hr.token, url: origin },
          ]);
          const hrPage = await hrContext.newPage();
          hrPage.on("pageerror", (e) => errors.push(e.message));
          await hrPage.goto(origin + "/development/release");
          await hrPage
            .getByRole("heading", { name: "Liberação de Resultados" })
            .waitFor();
          await hrPage
            .getByRole("button", { name: "Liberar definitivamente" })
            .waitFor();
          await hrPage.close();
          await hrContext.close();
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      }
      await request(
        "manager",
        path + "/reopen",
        "POST",
        {
          version: detail.plan.version,
          reason: "Tentativa de alterar documento assinado",
        },
        409,
      );
      await request(
        "employee",
        path + "/actions/" + action.id + "/progress",
        "POST",
        {
          version: detail.plan.version,
          status: "completed",
          progress: 100,
          notes: "Concluído",
          cancellation_reason: "",
        },
        400,
      );
      await request(
        "employee",
        path + "/actions/" + action.id + "/evidence",
        "POST",
        {
          version: detail.plan.version,
          filename: "certificado.txt",
          content: Buffer.from("Evidência de teste").toString("base64"),
        },
      );
      detail = await request("manager");
      const evidenceId = detail.evidence[0].id;
      await request(
        "outsider",
        path + "/evidence/" + evidenceId,
        "GET",
        undefined,
        403,
      );
      const download = await fetch(origin + path + "/evidence/" + evidenceId, {
        headers: { cookie: "ad_session=" + users.employee.token },
      });
      assert.equal(download.status, 200);
      assert.equal(await download.text(), "Evidência de teste");
      await request("manager", path + "/checkins", "POST", {
        version: detail.plan.version,
        action_id: action.id,
        due_on: "2026-02-01",
        notes: "Verificar aplicação",
      });
      detail = await request("employee");
      const notices = await request(
        "employee",
        "/api/development/notifications",
      );
      assert.ok(notices.some((n) => n.key.startsWith("action:")));
      assert.ok(notices.some((n) => n.key.startsWith("check:")));
      await request("employee", "/api/development/notifications/read", "POST", {
        key: notices[0].key,
      });
      await request(
        "employee",
        path + "/checkins/" + detail.checkins[0].id + "/complete",
        "POST",
        { version: detail.plan.version, notes: "Teste" },
        403,
      );
      await request(
        "manager",
        path + "/checkins/" + detail.checkins[0].id + "/complete",
        "POST",
        {
          version: detail.plan.version,
          notes: "Aplicação confirmada na reunião",
        },
      );
      detail = await request("employee");
      await request(
        "employee",
        path + "/actions/" + action.id + "/progress",
        "POST",
        {
          version: detail.plan.version,
          status: "completed",
          progress: 100,
          notes: "Aprendizado aplicado",
          cancellation_reason: "",
        },
      );
      detail = await request("hr");
      assert.equal(detail.plan.document.actions[0].status, "completed");
      assert.equal(detail.plan.signed_text, frozen);
      assert.ok(
        JSON.parse(frozen).acknowledgment.includes(
          "não pressupõe concordância",
        ),
      );
      assert.equal(JSON.stringify(detail.history).includes(password), false);
      assert.equal(JSON.stringify(detail.signatures).includes(password), false);
      assert.ok(
        detail.history.some((h) => h.event === "employee_contribution"),
      );
      assert.ok(detail.history.some((h) => h.event === "formalized"));
      const listing = await request("hr", "/api/development");
      assert.equal(
        listing.find((r) => r.id === participant).situation,
        "completed",
      );
      await request("manager", path + "/revise", "POST", {
        version: detail.plan.version,
        reason: "Ajustar objetivo para a próxima etapa de desenvolvimento.",
      });
      detail = await request("manager");
      assert.equal(detail.plan.status, "draft");
      assert.equal(
        detail.versions.find((v) => v.signature_round === 2).signed_text,
        frozen,
      );
      await request(
        "manager",
        path + "/submit",
        "POST",
        { version: detail.plan.version },
        409,
      );
      await request("manager", path + "/document", "PUT", {
        version: detail.plan.version,
        document: {
          ...detail.plan.document,
          objective: "Aplicar comunicação em novos projetos",
        },
      });
      detail = await request("employee");
      await request("employee", path + "/contributions", "POST", {
        version: detail.plan.version,
        text: "Registrei ciência da proposta revisada e mantenho minhas observações.",
      });
      detail = await request("manager");
      await request("manager", path + "/submit", "POST", {
        version: detail.plan.version,
      });
      detail = await request("manager");
      assert.equal(detail.plan.signature_round, 3);
      assert.equal(
        detail.signatures.filter((s) => s.signature_round === 3).length,
        0,
      );
      await request("manager", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("employee");
      assert.equal(detail.plan.status, "awaiting_signatures");
      await request("employee", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("hr");
      assert.equal(detail.plan.status, "signed");
      assert.equal(
        detail.versions.find((v) => v.signature_round === 2).signed_text,
        frozen,
      );
      assert.equal(
        detail.plan.document.objective,
        "Aplicar comunicação em novos projetos",
      );
      const pdf = await fetch(origin + path + "/pdf", {
        headers: { cookie: "ad_session=" + users.employee.token },
      });
      assert.equal(pdf.status, 200);
      const pdfBytes = Buffer.from(await pdf.arrayBuffer());
      assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
      if (process.env.DEVELOPMENT_PDF_PATH) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(process.env.DEVELOPMENT_PDF_PATH, pdfBytes);
      }
      const release =
        "/api/evaluations/participants/" + participant + "/release";
      await request(
        "employee",
        release,
        "POST",
        { released: true, reason: "Autorização do resultado." },
        403,
      );
      await request("hr", release, "POST", {
        released: true,
        reason: "Resultado pronto para liberação.",
      });
      const contest = await request("employee", "/api/contestations", "POST", {
        participant_id: participant,
        justification: "Solicito revisão fundamentada da avaliação.",
      });
      await request(
        "hr",
        release,
        "POST",
        { released: true, reason: "Tentativa de liberar resultado." },
        409,
      );
      await request(
        "hr",
        "/api/contestations/" + contest.id + "/transition",
        "POST",
        { action: "analyze", reason: "Análise iniciada pelo RH." },
      );
      const assignment = (
        await c.query(
          "SELECT id,version FROM ad.evaluation_assignments WHERE participant_id=$1 AND kind='manager'",
          [participant],
        )
      ).rows[0];
      await request(
        "manager",
        "/api/contestations/" + contest.id + "/authorize",
        "POST",
        {
          assignment_id: assignment.id,
          reason: "Revisão necessária após análise.",
        },
        403,
      );
      await request(
        "hr",
        "/api/contestations/" + contest.id + "/authorize",
        "POST",
        {
          assignment_id: assignment.id,
          reason: "Revisão necessária após análise.",
        },
      );
      await request(
        "hr",
        "/api/contestations/" + contest.id + "/transition",
        "POST",
        {
          action: "complete",
          reason: "Tentativa de encerrar antes da revisão.",
        },
        409,
      );
      await request(
        "outsider",
        "/api/contestations/" + contest.id + "/revision",
        "POST",
        {
          version: assignment.version,
          answers: { 902: 4 },
          reason: "Ajuste após revisão dos fatos.",
        },
        403,
      );
      await request(
        "manager",
        "/api/contestations/" + contest.id + "/revision",
        "POST",
        {
          version: assignment.version,
          answers: { 902: 4 },
          reason: "Ajuste após revisão dos fatos.",
        },
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int n FROM ad.evaluation_responses WHERE assignment_id=$1",
            [assignment.id],
          )
        ).rows[0].n,
        2,
      );
      await request(
        "hr",
        "/api/contestations/" + contest.id + "/transition",
        "POST",
        { action: "complete", reason: "Revisão concluída e registrada." },
      );
      await request(
        "hr",
        release,
        "POST",
        { released: true, reason: "Tentativa após revisão das notas." },
        409,
      );
      detail = await request("manager");
      await request("manager", path + "/revise", "POST", {
        version: detail.plan.version,
        reason: "Atualizar documento após revisão autorizada.",
      });
      detail = await request("employee");
      await request("employee", path + "/contributions", "POST", {
        version: detail.plan.version,
        text: "Contribuição após a revisão da avaliação.",
      });
      detail = await request("manager");
      await request("manager", path + "/submit", "POST", {
        version: detail.plan.version,
      });
      detail = await request("manager");
      await request("manager", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      detail = await request("employee");
      await request("employee", path + "/sign", "POST", {
        version: detail.plan.version,
        password,
        acknowledgment: true,
        document_hash: detail.plan.document_hash,
      });
      await request("hr", release, "POST", {
        released: true,
        reason: "Liberação após revisão e assinaturas.",
      });
      await c.query(
        "UPDATE ad.cycle_participants SET released=false,feedback_access=false WHERE id=$1",
        [participant],
      );
      await request("employee", path, "GET", undefined, 403);
      await request(
        "employee",
        path + "/evidence/" + evidenceId,
        "GET",
        undefined,
        403,
      );
    } finally {
      if (server) await new Promise((r) => server.close(r));
      pool.query = originalQuery;
      pool.connect = originalConnect;
      await c.query("ROLLBACK");
      c.release();
      await pool.end();
    }
  },
);
