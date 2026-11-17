import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { api } from "./routes/api.js";
import { logger } from "./utils/logger.js";
export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(
  helmet({
    strictTransportSecurity:
      process.env.COOKIE_SECURE === "true" ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        "upgrade-insecure-requests":
          process.env.COOKIE_SECURE === "true" ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: "4mb" }), cookieParser());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  res.on("finish", () =>
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
      },
      "http",
    ),
  );
  next();
});
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", service: "avaliacao-desempenho" }),
);
app.use("/api", api);
app.use("/api", (req, res) =>
  res.status(404).json({ message: "Rota não encontrada." }),
);
const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
app.use(express.static(dist));
app.get("/{*path}", (req, res) =>
  existsSync(path.join(dist, "index.html"))
    ? res.sendFile(path.join(dist, "index.html"))
    : res.status(503).send("Frontend não compilado. Execute npm run build."),
);
app.use((err, req, res, next) => {
  let status = err.status || 500,
    message = err.message;
  if (err instanceof ZodError) {
    status = 400;
    message = err.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }
  if (err.code === "23505") {
    status = 409;
    message = "Já existe um registro com estes dados únicos (CPF, RE ou nome).";
  }
  if (err.code === "23503") {
    status = 400;
    message = "Vínculo inválido ou registro em uso.";
  }
  if (err.code === "22P02") {
    status = 400;
    message = "Formato de campo inválido.";
  }
  if (status >= 500) {
    message = "Não foi possível concluir a operação. Consulte o administrador.";
    logger.error(
      { requestId: req.requestId, code: err.code, type: err.name },
      "request.failed",
    );
  }
  res.status(status).json({ message, requestId: req.requestId });
});
