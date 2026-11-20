import { setTimeout as delay } from "node:timers/promises";
import {
  leaseDispatches,
  recordDispatch,
  retryDispatch,
} from "@jobflow/db/processing";
import { publishDispatch } from "@jobflow/queue";
import { runService } from "@jobflow/queue/service";

const limit = 6;
const leaseMs = 20_000;

function retryDelay(retryCount) {
  return Math.min(
    20_000,
    250 * 2 ** Math.min(retryCount, 7) + Math.floor(Math.random() * 250),
  );
}

async function dispatch({
  db,
  logger,
  channel,
  disconnected,
  signal,
  metrics,
}) {
  const stopped = AbortSignal.any([signal, disconnected]);
  while (!stopped.aborted) {
    const batch = await leaseDispatches(db, { limit, leaseMs });
    for (const item of batch) {
      if (stopped.aborted) break;
      try {
        await publishDispatch(channel, item);
      } catch {
        await retryDispatch(db, item, retryDelay(item.retryCount));
        metrics.dispatches.inc({ outcome: "retry" });
        logger.warn(
          { jobId: item.jobId, attemptNo: item.attemptNo },
          "Dispatch will retry",
        );
        continue;
      }
      await recordDispatch(db, item);
      metrics.dispatches.inc({ outcome: "confirmed" });
      logger.info(
        { jobId: item.jobId, attemptNo: item.attemptNo },
        "Dispatch confirmed",
      );
    }
    if (batch.length < limit && !stopped.aborted) {
      await delay(250, undefined, { signal: stopped }).catch((error) => {
        if (!stopped.aborted) throw error;
      });
    }
  }
}

await runService("dispatcher", true, dispatch);
