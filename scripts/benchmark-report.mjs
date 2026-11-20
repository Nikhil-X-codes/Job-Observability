import { setTimeout as delay } from "node:timers/promises";

export function percentiles(values) {
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
      attempts: {
        where: { attemptNo: 1 },
        select: { startedAt: true },
      },
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
    ({ finishedAt }) => finishedAt >= startedAt && finishedAt < endedAt,
  ).length;
  const backlog = backlogProfile(jobs, startedAt, endedAt);
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
    ...backlog,
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
    firstClaimMs: percentiles(
      jobs
        .filter(({ attempts }) => attempts?.length)
        .map(({ createdAt, attempts }) => attempts[0].startedAt - createdAt),
    ),
    endToEndMs: percentiles(
      finished.map(({ finishedAt, createdAt }) => finishedAt - createdAt),
    ),
  };
}

function backlogProfile(jobs, startedAt, endedAt) {
  const changes = new Map();
  function change(at, key) {
    const timestamp = at.getTime();
    const counts = changes.get(timestamp) ?? { arrivals: 0, departures: 0 };
    counts[key]++;
    changes.set(timestamp, counts);
  }
  for (const job of jobs) {
    change(job.createdAt, "arrivals");
    if (job.finishedAt) change(job.finishedAt, "departures");
  }
  const events = [...changes].sort(([left], [right]) => left - right);
  const end = endedAt.getTime();
  let active = 0;
  let peakBacklog = 0;
  let peakBacklogInWindow = 0;
  let backlogAtWindowEnd = 0;
  let drainMs = 0;
  const seconds = [];
  let index = 0;
  const last = Math.max(end, events.at(-1)?.[0] ?? end);
  for (
    let time = startedAt.getTime() + 1000;
    time <= last + 1000;
    time += 1000
  ) {
    let accepted = 0;
    let settled = 0;
    while (index < events.length && events[index][0] < time) {
      const [at, { arrivals, departures }] = events[index++];
      active += arrivals - departures;
      accepted += arrivals;
      settled += departures;
      peakBacklog = Math.max(peakBacklog, active);
      if (at < end) {
        peakBacklogInWindow = Math.max(peakBacklogInWindow, active);
        backlogAtWindowEnd = active;
      } else if (departures) {
        drainMs = at - end;
      }
    }
    seconds.push({
      second: (time - startedAt) / 1000,
      accepted,
      settled,
      backlog: active,
    });
    if (time >= end && index === events.length) break;
  }
  return {
    peakBacklog,
    peakBacklogInWindow,
    backlogAtWindowEnd,
    drainMs,
    seconds,
  };
}
