import pino from "pino";
export const logger = pino({
  level: "info",
  redact: [
    "password",
    "password_hash",
    "cookie",
    "authorization",
    "body",
    "headers",
  ],
});
