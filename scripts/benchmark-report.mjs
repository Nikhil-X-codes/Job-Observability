import { setTimeout as delay } from "node:timers/promises";

function percentiles(values) {
  const ordered = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  return Object.fromEntries(
    [50, 95, 99].map((p) => [
      `p${p}`,
      ordered.length
        ? ordered[Math.ceil((p / 100) * ordered.length) - 1]
        : null,
    ]),
  );
}

export async function reconcileRun(
  db,
  tenant,
  runId,
  { startedAt, endedAt, drainMs },
) {
  const where = {
    tenant: { slug: tenant },
    idempotencyKey: { startsWith: `${runId}:` },
  };
  const terminals = ["COMPLETED", "DEAD", "CANCELLED"];
  const drainUntil = Date.now() + drainMs;
  while (
    Date.now() < drainUntil &&
    (await db.job.count({ where: { ...where, status: { notIn: terminals } } }))
  ) {
    await delay(1000);
  }
  const jobs = await db.job.findMany({
    where,
    select: {
      id: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      attemptNumber: true,
    },
  });
  const attempts = await db.attempt.findMany({
    where: { job: where, finishedAt: { not: null } },
    select: { durationMs: true, outcome: true },
  });
  const effects = await db.businessEffect.groupBy({
    by: ["jobId"],
    where: { job: where },
    _count: { _all: true },
  });
  const completed = jobs.filter(({ status }) => status === "COMPLETED");
  const dead = jobs.filter(({ status }) => status === "DEAD").length;
  const cancelled = jobs.filter(({ status }) => status === "CANCELLED").length;
  const finished = jobs.filter(({ status }) => terminals.includes(status));
  const failedAttempts = attempts.filter(
    ({ outcome }) => outcome === "FAILED",
  ).length;
  const completedInWindow = completed.filter(
    ({ finishedAt }) => finishedAt >= startedAt && finishedAt <= endedAt,
  ).length;
  const elapsedSeconds = (endedAt - startedAt) / 1000;
  const jobsWithEffects = new Set(effects.map(({ jobId }) => jobId));
  return {
    accepted: jobs.length,
    completed: completed.length,
    dead,
    cancelled,
    remaining: jobs.length - finished.length,
    completedInWindow,
    observedWindowSeconds: elapsedSeconds,
    completionsPerSecond: completedInWindow / elapsedSeconds,
    retried: jobs.filter(({ attemptNumber }) => attemptNumber > 1).length,
    failedAttempts,
    totalFinishedAttempts: attempts.length,
    terminalSuccessRate:
      completed.length + dead
        ? completed.length / (completed.length + dead)
        : null,
    attemptFailureRate: attempts.length
      ? failedAttempts / attempts.length
      : null,
    duplicateEffects: effects.reduce(
      (sum, row) => sum + Math.max(0, row._count._all - 1),
      0,
    ),
    missingCompletedEffects: completed.filter(
      ({ id }) => !jobsWithEffects.has(id),
    ).length,
    executionMs: percentiles(attempts.map(({ durationMs }) => durationMs)),
    endToEndMs: percentiles(
      finished.map(({ finishedAt, createdAt }) => finishedAt - createdAt),
    ),
  };
}
