import { setTimeout as delay } from "node:timers/promises";
import { queue } from "@jobflow/queue";
import { runService } from "@jobflow/queue/service";
import { handleDelivery, workerLabels } from "./delivery.js";
import { createGateway } from "./gateway.js";

async function consume(context) {
  const { channel, signal, disconnected, logger, workerId, metrics } = context;
  const cancelled = new AbortController();
  const stopped = AbortSignal.any([signal, disconnected, cancelled.signal]);
  const active = new Set();
  metrics.active.set(workerLabels, 0);
  await channel.prefetch(10);
  const { consumerTag } = await channel.consume(
    queue,
    (message) => {
      if (!message) {
        cancelled.abort();
        return;
      }
      if (stopped.aborted) return;
      const task = handleDelivery(context, message)
        .catch(async () => {
          logger.warn({ workerId }, "Delivery interrupted");
          await delay(1000, undefined, { signal: stopped }).catch(() => {});
          if (!stopped.aborted) channel.nack(message, false, true);
        })
        .catch(() => cancelled.abort())
        .finally(() => active.delete(task));
      active.add(task);
    },
    { noAck: false },
  );
  try {
    if (!stopped.aborted) {
      metrics.workers.set(workerLabels, 1);
      logger.info({ workerId }, "Worker consuming");
      await new Promise((resolve) =>
        stopped.addEventListener("abort", resolve, { once: true }),
      );
    }
    if (!disconnected.aborted && !cancelled.signal.aborted)
      await channel.cancel(consumerTag);
  } finally {
    metrics.workers.set(workerLabels, 0);
    await Promise.all(active);
    metrics.active.set(workerLabels, 0);
  }
}

const gateway = createGateway(process.env);
await runService("worker", false, (context) =>
  consume({ ...context, gateway }),
);
