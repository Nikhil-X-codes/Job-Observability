import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "@jobflow/db";
import { enqueueRetries, recoverExpired } from "@jobflow/db/processing";
import { createMetrics, listenForMetrics } from "@jobflow/telemetry";
import pino from "pino";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  METRICS_PORT: z.coerce.number().int().min(1024).max(65535).optional(),
  METRICS_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});
const config = schema.safeParse(process.env);

async function start(env) {
  const db = createDatabase(env.DATABASE_URL);
  const logger = pino({ name: "scheduler", level: env.LOG_LEVEL });
  const metrics = createMetrics();
  const stopMetrics = listenForMetrics(
    metrics,
    { port: env.METRICS_PORT, host: env.METRICS_HOST },
    logger,
  );
  const stop = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"])
    process.once(event, () => stop.abort());

  const batchLimit = 10;
  let waitMs = 500;
  try {
    while (!stop.signal.aborted) {
      try {
        const recovered = await recoverExpired(
          db,
          batchLimit,
          metrics.committed,
        );
        const enqueued = await enqueueRetries(db, batchLimit);
        if (recovered || enqueued)
          logger.info({ recovered, enqueued }, "Scheduler processed jobs");
        waitMs = 500;
      } catch {
        logger.warn("Scheduler database cycle failed");
        waitMs = Math.min(waitMs * 2, 10_000);
      }
      await delay(waitMs, undefined, { signal: stop.signal }).catch((error) => {
        if (!stop.signal.aborted) throw error;
      });
    }
  } finally {
    await Promise.all([db.$disconnect(), stopMetrics()]);
  }
}

if (config.success) {
  await start(config.data);
} else {
  pino({ name: "scheduler" }).fatal(
    {
      keys: config.error.issues.map((issue) => issue.path.join(".")),
    },
    "Invalid scheduler environment",
  );
  process.exitCode = 1;
}
