import { expect, it } from "vitest";
import { reconcileRun } from "./benchmark-report.mjs";

it("reconciles terminal throughput, remaining jobs, attempts, and effects separately", async () => {
  const startedAt = new Date(1000);
  const finishedAt = new Date(1500);
  const db = {
    job: {
      async findMany() {
        return [
          {
            id: "one",
            status: "COMPLETED",
            createdAt: startedAt,
            finishedAt,
            attemptNumber: 2,
          },
          {
            id: "two",
            status: "DEAD",
            createdAt: startedAt,
            finishedAt,
            attemptNumber: 1,
          },
          {
            id: "three",
            status: "RUNNING",
            createdAt: startedAt,
            attemptNumber: 1,
          },
        ];
      },
    },
    attempt: {
      async findMany() {
        return [
          { durationMs: 120, outcome: "SUCCEEDED" },
          { durationMs: 245, outcome: "FAILED" },
        ];
      },
    },
    businessEffect: {
      async groupBy() {
        return [{ jobId: "one", _count: { _all: 2 } }];
      },
    },
  };
  const result = await reconcileRun(db, "demo", "scan", {
    startedAt,
    endedAt: new Date(2000),
    drainMs: 0,
  });
  expect(result).toMatchObject({
    accepted: 3,
    completed: 1,
    dead: 1,
    remaining: 1,
    completionsPerSecond: 1,
    retried: 1,
    attemptFailureRate: 0.5,
    terminalSuccessRate: 0.5,
    duplicateEffects: 1,
    missingCompletedEffects: 0,
    executionMs: { p50: 120, p95: 245, p99: 245 },
    endToEndMs: { p50: 500, p95: 500, p99: 500 },
  });
});

it("measures burst backlog and drain relative to the exact arrival window", async () => {
  const startedAt = new Date(1000);
  const endedAt = new Date(3000);
  const db = {
    job: {
      findMany: async () =>
        [
          ["finished-before", 1000, 2800],
          ["unfinished-at-cutoff", 2000, 3100],
          ["late-admission", 3100, 4700],
        ].map(([id, admitted, completed]) => ({
          id,
          status: "COMPLETED",
          createdAt: new Date(admitted),
          finishedAt: new Date(completed),
          attemptNumber: 1,
          attempts: [{ startedAt: new Date(admitted + 300) }],
        })),
    },
    attempt: { findMany: async () => [] },
    businessEffect: { groupBy: async () => [] },
  };
  expect(
    await reconcileRun(db, "demo", "cutoff", {
      startedAt,
      endedAt,
      drainMs: 0,
    }),
  ).toMatchObject({
    completedInWindow: 1,
    peakBacklog: 2,
    peakBacklogInWindow: 2,
    backlogAtWindowEnd: 1,
    drainMs: 1700,
    firstClaimMs: { p50: 300, p95: 300, p99: 300 },
    seconds: [
      { second: 1, accepted: 1, settled: 0, backlog: 1 },
      { second: 2, accepted: 1, settled: 1, backlog: 1 },
      { second: 3, accepted: 1, settled: 1, backlog: 1 },
      { second: 4, accepted: 0, settled: 1, backlog: 0 },
    ],
  });
});
