import { randomUUID } from "node:crypto";
import { createDatabase } from "@jobflow/db";
import {
  claimExecution,
  enqueueRetries,
  extendExecution,
  finalizeExecution,
  leaseDispatches,
  recoverExpired,
  recordDispatch,
} from "@jobflow/db/processing";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { parseSubmission } from "../../apps/api/src/job-input.js";
import { submitJob } from "../../apps/api/src/jobs.js";
import { handleDelivery } from "../../services/worker/src/delivery.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "TEST_DATABASE_URL must point to a new disposable database with migrations applied",
  );
const db = createDatabase(databaseUrl);
const lease = { limit: 6, leaseMs: 20_000 };
let user;

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `processing-${randomUUID()}`, name: "Processing fixture" },
  });
  user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: "processing@example.test",
      passwordHash: "fixture",
      role: "ADMIN",
    },
  });
});

afterAll(async () => db.$disconnect());

async function createJob(options = {}) {
  const input = parseSubmission(
    {
      type: "GENERATE_REPORT",
      payload: { reportId: "demo" },
      ...options,
    },
    new Date(),
  );
  const { job } = await submitJob(db, user, input, randomUUID());
  return job;
}

it("leaves future jobs in PostgreSQL without leasing their outbox rows", async () => {
  const [clock] =
    await db.$queryRaw`SELECT EXTRACT(EPOCH FROM statement_timestamp())::float8 AS now`;
  const databaseNow = Math.round(clock.now * 1000);
  expect(Math.abs(Date.now() - databaseNow)).toBeLessThan(5000);
  const expected = new Date(databaseNow + 60 * 60_000);
  const job = await createJob({ runAt: expected.toISOString() });
  const outbox = await db.outboxEvent.findFirstOrThrow({
    where: { aggregateId: job.id },
  });
  expect(job.runAt).toEqual(expected);
  expect(outbox.availableAt).toEqual(expected);
  const [stored] = await db.$queryRaw`
    SELECT EXTRACT(EPOCH FROM available_at)::float8 AS due FROM outbox_events
    WHERE id = ${outbox.id}::uuid
  `;
  expect(Math.round(stored.due * 1000)).toBe(expected.getTime());
  expect(await leaseDispatches(db, lease)).toEqual([]);
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
  ).toBe("PENDING");
});

it("commits eligibility before publish and lets one competing worker claim", async () => {
  const job = await createJob();
  const batches = await Promise.all([
    leaseDispatches(db, lease),
    leaseDispatches(db, lease),
  ]);
  expect(batches.flat()).toHaveLength(1);
  const [message] = batches.flat();
  expect(message.jobId).toBe(job.id);
  expect(
    await db.job.findUniqueOrThrow({ where: { id: job.id } }),
  ).toMatchObject({ status: "QUEUED" });
  const events = await db.jobEvent.findMany({
    where: { jobId: job.id, eventType: "JOB_QUEUED" },
  });
  expect(events).toHaveLength(1);
  expect(events[0].details).toEqual({ attemptNo: 1 });
  const claims = await Promise.all([
    claimExecution(db, message, "one", 15_000),
    claimExecution(db, message, "two", 15_000),
  ]);
  const active = claims.filter(Boolean);
  expect(active).toHaveLength(1);
  expect(await recordDispatch(db, message)).toBe(1);
  expect(await claimExecution(db, message, "three", 15_000)).toBeNull();
  expect(
    await finalizeExecution(
      db,
      { ...active[0], token: randomUUID() },
      { result: {} },
    ),
  ).toBe(false);
  expect(await finalizeExecution(db, active[0], { result: { rows: 3 } })).toBe(
    true,
  );
  expect(await finalizeExecution(db, active[0], { result: {} })).toBe(false);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
  expect(await db.attempt.count({ where: { jobId: job.id } })).toBe(1);
});

it("releases expired dispatch ownership and fences expired execution tokens", async () => {
  const job = await createJob();
  const [staleDispatch] = await leaseDispatches(db, lease);
  await db.outboxEvent.update({
    where: { id: staleDispatch.id },
    data: { lockedUntil: new Date(0) },
  });
  const [recovered] = await leaseDispatches(db, lease);
  expect(recovered.id).toBe(staleDispatch.id);
  expect(
    await db.jobEvent.count({
      where: { jobId: job.id, eventType: "JOB_QUEUED" },
    }),
  ).toBe(1);
  expect(await recordDispatch(db, staleDispatch)).toBe(0);
  expect(await recordDispatch(db, recovered)).toBe(1);
  const claim = await claimExecution(db, recovered, "expired", 15_000);
  await db.job.update({
    where: { id: job.id },
    data: { leaseExpiresAt: new Date(0) },
  });
  expect(await extendExecution(db, claim, 15_000)).toBe(0);
  expect(await finalizeExecution(db, claim, { result: {} })).toBe(false);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(0);
  expect(await recoverExpired(db, 5)).toBe(1);
  const retrying = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(retrying.status).toBe("RETRY_WAIT");
  expect(
    (await db.attempt.findFirstOrThrow({ where: { jobId: job.id } })).errorCode,
  ).toBe("LEASE_EXPIRED");
  await db.job.update({
    where: { id: job.id },
    data: { nextRunAt: new Date(0) },
  });
  const enqueued = await Promise.all([
    enqueueRetries(db, 5),
    enqueueRetries(db, 5),
  ]);
  expect(enqueued.reduce((total, count) => total + count, 0)).toBe(1);
  const [retry] = await leaseDispatches(db, lease);
  expect(retry).toMatchObject({ jobId: job.id, attemptNo: 2 });
  expect(
    await claimExecution(db, recovered, "old-envelope", 15_000),
  ).toBeNull();
  const renewed = await claimExecution(db, retry, "retry-worker", 15_000);
  expect(await finalizeExecution(db, claim, { result: {} })).toBe(false);
  expect(await finalizeExecution(db, renewed, { result: { rows: 3 } })).toBe(
    true,
  );
  expect(await recordDispatch(db, retry)).toBe(1);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
});

it("enforces the retry cap and records a terminal dead letter and redacted history", async () => {
  const job = await createJob({ maxAttempts: 2 });
  const [first] = await leaseDispatches(db, lease);
  const initial = await claimExecution(db, first, "first", 15_000);
  await recordDispatch(db, first);
  expect(await finalizeExecution(db, initial, { errorCode: "TRANSIENT" })).toBe(
    true,
  );
  const waiting = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(waiting.status).toBe("RETRY_WAIT");
  const scheduledDelay = waiting.nextRunAt - waiting.updatedAt;
  expect(scheduledDelay).toBeGreaterThanOrEqual(490);
  expect(scheduledDelay).toBeLessThanOrEqual(750);

  await db.job.update({
    where: { id: job.id },
    data: { nextRunAt: new Date(0) },
  });
  expect(await enqueueRetries(db, 5)).toBe(1);
  const [second] = await leaseDispatches(db, lease);
  expect(second.attemptNo).toBe(2);
  const final = await claimExecution(db, second, "second", 15_000);
  await recordDispatch(db, second);
  expect(await finalizeExecution(db, final, { errorCode: "TIMEOUT" })).toBe(
    true,
  );
  expect(await enqueueRetries(db, 5)).toBe(0);
  expect(
    await db.deadLetter.findUniqueOrThrow({ where: { jobId: job.id } }),
  ).toMatchObject({ lastErrorCode: "TIMEOUT" });
  const events = await db.jobEvent.findMany({
    where: {
      jobId: job.id,
      eventType: { in: ["JOB_RETRY_SCHEDULED", "JOB_DEAD"] },
    },
    orderBy: { occurredAt: "asc" },
  });
  expect(events.map(({ details }) => details.errorCode)).toEqual([
    "TRANSIENT",
    "TIMEOUT",
  ]);
});

it("acknowledges a committed delivery and a redelivery without duplicating its effect", async () => {
  const job = await createJob();
  const [message] = await leaseDispatches(db, lease);
  expect(message.jobId).toBe(job.id);
  await recordDispatch(db, message);
  const delivery = {
    content: Buffer.from(JSON.stringify({ jobId: job.id, attemptNo: 1 })),
  };
  const channel = { ack: vi.fn(), reject: vi.fn() };
  const context = {
    db,
    workerId: "test-worker",
    logger: { info: vi.fn(), warn: vi.fn() },
    channel,
    disconnected: new AbortController().signal,
  };
  await handleDelivery(context, delivery);
  expect(channel.ack).toHaveBeenCalledTimes(1);
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
  ).toBe("COMPLETED");
  await handleDelivery(context, delivery);
  expect(channel.ack).toHaveBeenCalledTimes(2);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
});
