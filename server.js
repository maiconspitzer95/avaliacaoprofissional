import "dotenv/config";
import { app } from "./server/src/app.js";
import { pool } from "./server/src/database/pool.js";
import { logger } from "./server/src/utils/logger.js";
const port = Number(process.env.PORT || 5005),
  host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () =>
  logger.info({ host, port }, "server.started"),
);
server.on("error", (e) => {
  logger.error({ code: e.code }, "server.failed");
  process.exitCode = 1;
});
async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
