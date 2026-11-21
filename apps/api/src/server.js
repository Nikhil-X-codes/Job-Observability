import { createServer } from "node:http";
import { createDatabase } from "@jobflow/db";
import { createMetrics } from "@jobflow/telemetry";
import pino from "pino";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDependencyProbes } from "./readiness.js";
import { attachRealtime } from "./realtime.js";
import { createV1Router } from "./v1.js";

function start() {
  let config;
  try {
    config = readConfig(process.env);
  } catch (error) {
    pino().fatal(error.message);
    process.exitCode = 1;
    return;
  }

  const logger = pino({ level: config.logLevel });
  const probes = createDependencyProbes(config, logger);
  const { host, port, databaseUrl, appOrigin, writeRateLimit, trustProxyHops } =
    config;
  const db = databaseUrl ? createDatabase(databaseUrl) : undefined;
  const metrics = createMetrics(db);
  const api = db
    ? createV1Router(
        db,
        appOrigin,
        metrics,
        writeRateLimit,
        config.deliveryTenantId,
      )
    : undefined;
  const app = createApp(logger, probes.check, api, metrics);
  if (trustProxyHops) app.set("trust proxy", trustProxyHops);
  const server = createServer(app);
  const closeRealtime = db
    ? attachRealtime(server, { db, appOrigin, logger })
    : undefined;
  server.listen(port, host);
  server.once("listening", () => {
    logger.info({ host, port }, "API listening");
  });
  server.once("error", (error) => {
    logger.fatal({ code: error.code }, "API failed to listen");
    process.exitCode = 1;
    void shutdown();
  });

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    try {
      if (closeRealtime) await closeRealtime();
      else await new Promise((resolve) => server.close(resolve));
      await Promise.all([probes.close(), db?.$disconnect()]);
    } catch {
      logger.error("Failed to stop API cleanly");
      process.exitCode = 1;
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);
}

start();
