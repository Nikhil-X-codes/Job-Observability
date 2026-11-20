import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "@jobflow/db";
import { createMetrics, listenForMetrics } from "@jobflow/telemetry";
import pino from "pino";
import { z } from "zod";
import { withQueue } from "./broker.js";

const settings = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  AMQP_URL: z.url({ protocol: /^amqps?$/ }),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
  WORKER_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional(),
  METRICS_PORT: z.coerce.number().int().min(1024).max(65535).optional(),
  METRICS_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
});

export async function runService(name, confirm, run) {
  const result = settings.safeParse(process.env);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join("."));
    pino({ name }).fatal({ keys }, "Invalid service environment");
    process.exitCode = 1;
    return;
  }
  const env = result.data;
  const controller = new AbortController();
  const { signal } = controller;
  const stop = () => controller.abort();
  for (const event of ["SIGINT", "SIGTERM"]) process.once(event, stop);
  const logger = pino({ name, level: env.LOG_LEVEL });
  const db = createDatabase(env.DATABASE_URL);
  const metrics = createMetrics();
  const stopMetrics = listenForMetrics(
    metrics,
    { port: env.METRICS_PORT, host: env.METRICS_HOST },
    logger,
  );
  const workerId = env.WORKER_ID ?? `${name}-${randomUUID()}`;
  let backoff = 500;
  try {
    while (!signal.aborted) {
      try {
        await withQueue(env.AMQP_URL, confirm, (channel, disconnected) =>
          run({ db, workerId, logger, channel, disconnected, signal, metrics }),
        );
        backoff = 500;
      } catch {
        if (!signal.aborted)
          logger.warn("Service session ended before completion");
      }
      if (!signal.aborted) {
        await delay(backoff, undefined, { signal }).catch((error) => {
          if (!signal.aborted) throw error;
        });
        backoff = Math.min(backoff * 2, 10_000);
      }
    }
  } finally {
    await Promise.all([db.$disconnect(), stopMetrics()]);
    for (const event of ["SIGINT", "SIGTERM"]) process.off(event, stop);
  }
}
