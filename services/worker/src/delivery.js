import { setTimeout as delay } from "node:timers/promises";
import {
  claimExecution,
  extendExecution,
  finalizeExecution,
} from "@jobflow/db/processing";
import { decodeDelivery } from "@jobflow/queue";
import { runHandler } from "./handlers.js";

const leaseMs = 15_000;

export const workerLabels = { worker_group: "demo" };

async function execute(db, lease, disconnected, metrics) {
  const heartbeatStop = new AbortController();
  const leaseLost = new AbortController();
  const timeout = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([disconnected, leaseLost.signal, timeout]);
  let heartbeatError;
  const heartbeat = (async () => {
    try {
      while (!heartbeatStop.signal.aborted) {
        await delay(3000, undefined, { signal: heartbeatStop.signal });
        if (!(await extendExecution(db, lease, leaseMs))) {
          leaseLost.abort();
          break;
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        heartbeatError = error;
        leaseLost.abort();
      }
    }
  })();

  let outcome;
  try {
    outcome = { result: await runHandler(lease, signal) };
  } catch {
    outcome = { errorCode: timeout.aborted ? "TIMEOUT" : "INTERNAL" };
  } finally {
    heartbeatStop.abort();
    await heartbeat;
  }
  if (heartbeatError) throw heartbeatError;
  if (disconnected.aborted) return "disconnected";
  if (leaseLost.signal.aborted) return "stale";
  return (await finalizeExecution(db, lease, outcome, metrics?.committed))
    ? "committed"
    : "stale";
}

export async function handleDelivery(
  { db, workerId, logger, channel, disconnected, metrics },
  message,
) {
  const envelope = decodeDelivery(message.content);
  if (!envelope) {
    channel.reject(message, false);
    logger.warn("Rejected malformed broker envelope");
    return;
  }
  const lease = await claimExecution(db, envelope, workerId, leaseMs);
  let disposition = "stale";
  if (lease) {
    metrics?.claimed(lease);
    metrics?.active.inc(workerLabels);
    try {
      disposition = await execute(db, lease, disconnected, metrics);
    } finally {
      metrics?.active.dec(workerLabels);
    }
  }
  if (!disconnected.aborted) {
    channel.ack(message);
    logger.info({ ...envelope, disposition }, "Delivery settled");
  }
}
