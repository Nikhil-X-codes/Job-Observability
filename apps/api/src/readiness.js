import { once } from "node:events";
import amqp from "amqplib";
import pg from "pg";

export function createReadinessCheck(probes) {
  let pending;
  return () => {
    if (!pending) {
      const names = Object.keys(probes);
      pending = Promise.allSettled(
        names.map((name) => Promise.resolve().then(probes[name])),
      )
        .then((results) =>
          Object.fromEntries(
            results.map(({ status }, index) => [
              names[index],
              status === "fulfilled" ? "ok" : "unavailable",
            ]),
          ),
        )
        .finally(() => {
          pending = undefined;
        });
    }
    return pending;
  };
}

export function createDependencyProbes({ databaseUrl, amqpUrl }, logger) {
  const pool = databaseUrl
    ? new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 1000,
        statement_timeout: 1000,
        query_timeout: 1000,
      })
    : undefined;
  pool?.on("error", () =>
    logger.warn("Idle PostgreSQL health connection closed"),
  );

  const check = createReadinessCheck({
    async postgres() {
      if (!pool) throw new Error("PostgreSQL URL required");
      await pool.query("SELECT 1");
    },
    async rabbitmq() {
      if (!amqpUrl) throw new Error("RabbitMQ URL required");
      const signal = AbortSignal.timeout(1500);
      const connection = await amqp.connect(amqpUrl, { signal });
      await Promise.all([
        once(connection, "close", { signal }),
        connection.close(),
      ]);
    },
  });
  return { check, close: () => pool?.end() };
}
