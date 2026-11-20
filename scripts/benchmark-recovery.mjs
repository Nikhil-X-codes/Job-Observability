import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "@jobflow/db";
import { nativeWorkerGroup } from "./benchmark-native-workers.mjs";

const env = process.env;
const {
  BENCHMARK_BASE_URL: origin,
  DATABASE_URL: database,
  AMQP_URL: broker,
} = env;
const repetitions = Number(env.BENCHMARK_RECOVERY_REPETITIONS ?? 5);
assert.ok(
  env.BENCHMARK_ISOLATED === "1" &&
    env.BENCHMARK_RUNTIME === "native" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) &&
    [database, broker].every(
      (url) => url && new URL(url).hostname === "127.0.0.1",
    ) &&
    Number.isInteger(repetitions) &&
    repetitions >= 3 &&
    repetitions <= 20,
  "Use an isolated native benchmark stack with disposable data on loopback",
);
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 5000 }).trim();
assert.equal(
  git("status", "--porcelain"),
  "",
  "Commit the benchmark source before collecting evidence",
);
const sha = git("rev-parse", "HEAD");
const startedAt = new Date();
const directory = `benchmarks/results/local/${startedAt.toISOString().replace(/[:.]/g, "-")}-recovery`;
await mkdir(directory, { recursive: true });
const db = createDatabase(database);
const worker = nativeWorkerGroup(env);
const results = [];

async function request(endpoint, body, headers = {}) {
  return fetch(`${origin}/api/v1/${endpoint}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

async function waitFor(read, timeoutMs, description) {
  const deadline = performance.now() + timeoutMs;
  do {
    const result = await read();
    if (result) return result;
    await delay(40);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

try {
  const login = await request("auth/login", {
    tenant: env.BENCHMARK_TENANT,
    email: env.BENCHMARK_EMAIL,
    password: env.BENCHMARK_PASSWORD,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  for (let repetition = 1; repetition <= repetitions; repetition++) {
    await worker.scale(1);
    let jobId;
    const { killedAt, leaseExpiresAt, exitObservedAt } = await db.$transaction(
      async (tx) => {
        // Hold only this disposable ledger so an ordinary worker can claim the job
        // but cannot commit its effect before the crash.
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`LOCK TABLE business_effects IN SHARE MODE`;
        const submitted = await request(
          "jobs",
          {
            type: "MOCK_WEBHOOK",
            payload: { eventId: "recovery-benchmark" },
          },
          { Cookie: cookie, "Idempotency-Key": `recovery:${randomUUID()}` },
        );
        assert.equal(submitted.status, 202);
        ({ id: jobId } = await submitted.json());
        const leaseExpiresAt = await waitFor(
          async () => {
            const job = await tx.job.findUniqueOrThrow({
              where: { id: jobId },
            });
            if (job.status !== "RUNNING" || job.attemptNumber !== 1)
              return null;
            const [{ blocked }] = await tx.$queryRaw`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE relation = 'business_effects'::regclass
            AND mode = 'RowExclusiveLock' AND NOT granted
          ) AS blocked
        `;
            return blocked ? job.leaseExpiresAt : null;
          },
          7000,
          "the normal worker to block while committing the effect",
        );
        const killedAt = new Date();
        assert.ok(
          leaseExpiresAt > killedAt,
          "fault must occur before the lease expires",
        );
        await worker.stop("SIGKILL");
        return { killedAt, leaseExpiresAt, exitObservedAt: new Date() };
      },
      { timeout: 15000 },
    );
    await worker.scale(1);
    const replacementReadyAt = new Date();
    const job = await waitFor(
      async () => {
        const row = await db.job.findUniqueOrThrow({
          where: { id: jobId },
          include: { attempts: { orderBy: { attemptNo: "asc" } } },
        });
        if (row.status === "DEAD" || row.status === "CANCELLED")
          throw new Error(`Recovery ended in ${row.status}`);
        return row.status === "COMPLETED" && row;
      },
      35000,
      "database completion by the replacement worker",
    );
    const [failed, retry] = job.attempts;
    assert.equal(job.attempts.length, 2);
    assert.equal(failed.outcome, "FAILED");
    assert.equal(failed.errorCode, "LEASE_EXPIRED");
    assert.equal(retry.outcome, "SUCCEEDED");
    assert.ok(replacementReadyAt < leaseExpiresAt);
    const committedEffects = await db.businessEffect.count({
      where: { jobId },
    });
    assert.equal(committedEffects, 1);
    results.push({
      repetition,
      killedAt,
      exitObservedAt,
      replacementReadyAt,
      leaseExpiresAt,
      leaseReapedAt: failed.finishedAt,
      retryStartedAt: retry.startedAt,
      completedAt: job.finishedAt,
      committedEffects,
      killToCompletionMs: job.finishedAt - killedAt,
      leaseRemainingMs: leaseExpiresAt - killedAt,
      expiryToReapMs: failed.finishedAt - leaseExpiresAt,
      reapToRetryMs: retry.startedAt - failed.finishedAt,
      retryToCompletionMs: job.finishedAt - retry.startedAt,
    });
    await writeFile(
      `${directory}/results.json`,
      JSON.stringify({ sha, startedAt, repetitions, results }, null, 2),
    );
  }
  console.log(`Recovery artifacts saved to ${directory}`);
} finally {
  await Promise.all([worker.stop(), db.$disconnect()]);
}
