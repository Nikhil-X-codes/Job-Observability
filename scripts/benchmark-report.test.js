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
