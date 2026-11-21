import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpus, platform, release, totalmem } from "node:os";
import { createDatabase } from "@jobflow/db";
import { leaseDispatches, recordDispatch } from "@jobflow/db/processing";
import { publishDispatch, queue, withQueue } from "@jobflow/queue";

const { BENCHMARK_ISOLATED, DATABASE_URL, AMQP_URL } = process.env;
const loopback = (address) => {
  const url = new URL(address);
  return url.hostname === "127.0.0.1" && Number(url.port) > 1024;
};
assert.ok(
  BENCHMARK_ISOLATED === "1" &&
    DATABASE_URL &&
    AMQP_URL &&
    [DATABASE_URL, AMQP_URL].every(loopback) &&
    new URL(DATABASE_URL).pathname === "/dispatcher_bench",
  "Use a fresh dispatcher_bench database and an isolated loopback broker",
);

const count = 360;
const batchSize = 6;
const modes = [
  "serial",
  "pipeline",
  "pipeline",
  "serial",
  "serial",
  "pipeline",
];
const db = createDatabase(DATABASE_URL);

async function preload(run) {
  const tenant = await db.tenant.create({
    data: { slug: `dispatch-benchmark-${run}`, name: "Dispatch benchmark" },
  });
  const dueAt = new Date();
  const jobs = Array.from({ length: count }, () => ({
    id: randomUUID(),
    tenantId: tenant.id,
    type: "GENERATE_REPORT",
    payload: { reportId: "dispatch-benchmark" },
    payloadHash: "0".repeat(64),
    runAt: dueAt,
    nextRunAt: dueAt,
  }));
  await db.$transaction([
    db.job.createMany({ data: jobs }),
    db.outboxEvent.createMany({
      data: jobs.map(({ id }) => ({
        topic: "job.dispatch",
        aggregateId: id,
        attemptNo: 1,
        body: { jobId: id, attemptNo: 1 },
        availableAt: dueAt,
      })),
    }),
  ]);
  return { tenantId: tenant.id, ids: jobs.map(({ id }) => id) };
}

function stats(values) {
  values.sort((a, b) => a - b);
  const percentile = (fraction) =>
    Number(values[Math.ceil(values.length * fraction) - 1].toFixed(3));
  return {
    samples: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

try {
  assert.equal(
    await db.job.count(),
    0,
    "The benchmark requires a fresh database",
  );
  const [durability] =
    await db.$queryRaw`SELECT current_setting('fsync') AS fsync,
    current_setting('synchronous_commit') AS "synchronousCommit"`;
  assert.deepEqual(durability, { fsync: "on", synchronousCommit: "on" });
  const results = [];
  await withQueue(AMQP_URL, true, async (channel) => {
    assert.deepEqual(await channel.checkQueue(queue), {
      queue,
      messageCount: 0,
      consumerCount: 0,
    });
    for (const [index, mode] of modes.entries()) {
      const fixture = await preload(index + 1);
      const samples = { lease: [], publish: [], record: [] };
      async function time(stage, operation) {
        const start = performance.now();
        const result = await operation();
        samples[stage].push(performance.now() - start);
        return result;
      }
      async function dispatch(item) {
        await time("publish", () => publishDispatch(channel, item));
        assert.equal(await time("record", () => recordDispatch(db, item)), 1);
      }
      const start = performance.now();
      for (let dispatched = 0; dispatched < count; dispatched += batchSize) {
        const batch = await time("lease", () =>
          leaseDispatches(db, { limit: batchSize, leaseMs: 20_000 }),
        );
        assert.equal(batch.length, batchSize);
        if (mode === "pipeline") {
          await Promise.all(batch.map(dispatch));
        } else {
          for (const item of batch) await dispatch(item);
        }
      }
      const durationMs = performance.now() - start;
      assert.equal((await channel.checkQueue(queue)).messageCount, count);
      assert.equal(
        await db.job.count({
          where: { tenantId: fixture.tenantId, status: "QUEUED" },
        }),
        count,
      );
      assert.equal(
        await db.outboxEvent.count({
          where: { aggregateId: { in: fixture.ids }, status: "SENT" },
        }),
        count,
      );
      assert.equal((await channel.purgeQueue(queue)).messageCount, count);
      results.push({
        trial: index + 1,
        mode,
        dispatchedPerSecond: Number(((count * 1000) / durationMs).toFixed(2)),
        durationMs: Math.round(durationMs),
        leaseShareOfWallPercent: Number(
          (
            (100 * samples.lease.reduce((sum, value) => sum + value, 0)) /
            durationMs
          ).toFixed(1),
        ),
        stageMs: Object.fromEntries(
          Object.entries(samples).map(([key, values]) => [key, stats(values)]),
        ),
      });
    }
  });
  console.log(
    JSON.stringify(
      {
        host: {
          os: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          logicalCores: cpus().length,
          memoryBytes: totalmem(),
        },
        node: process.version,
        jobsPerTrial: count,
        batchSize,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
