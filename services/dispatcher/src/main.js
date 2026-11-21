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

async function timeStage(metrics, stage, operation) {
  const done = metrics.dispatchDuration.startTimer({ stage });
  try {
    return await operation();
  } finally {
    done();
  }
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
    const batch = await timeStage(metrics, "lease", () =>
      leaseDispatches(db, { limit, leaseMs }),
    );
    if (stopped.aborted) return;
    const outcomes = await Promise.allSettled(
      batch.map(async (item) => {
        const fields = { jobId: item.jobId, attemptNo: item.attemptNo };
        try {
          await timeStage(metrics, "publish", () =>
            publishDispatch(channel, item),
          );
        } catch {
          await timeStage(metrics, "retry", () =>
            retryDispatch(db, item, retryDelay(item.retryCount)),
          );
          metrics.dispatches.inc({ outcome: "retry" });
          logger.warn(fields, "Dispatch will retry");
          return;
        }
        await timeStage(metrics, "record", () => recordDispatch(db, item));
        metrics.dispatches.inc({ outcome: "confirmed" });
        logger.info(fields, "Dispatch confirmed");
      }),
    );
    const failure = outcomes.find(({ status }) => status === "rejected");
    if (failure) throw failure.reason;
    if (batch.length < limit && !stopped.aborted) {
      await delay(250, undefined, { signal: stopped }).catch((error) => {
        if (!stopped.aborted) throw error;
      });
    }
  }
}

await runService("dispatcher", true, dispatch);
