import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { createDatabase } from "@jobflow/db";
import { leaseDispatches, recordDispatch } from "@jobflow/db/processing";
import { publishDispatch, queue, withQueue } from "@jobflow/queue";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseSubmission } from "../../apps/api/src/job-input.js";
import { submitJob } from "../../apps/api/src/jobs.js";
import { handleDelivery } from "../../services/worker/src/delivery.js";
import { createGateway } from "../../services/worker/src/gateway.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const amqpUrl = process.env.TEST_AMQP_URL;
if (!databaseUrl || !amqpUrl)
  throw new Error(
    "A new, isolated PostgreSQL database and RabbitMQ vhost are required",
  );
const db = createDatabase(databaseUrl);
const services = [];
let user;

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `broker-${randomUUID()}`, name: "Broker fixture" },
  });
  user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: "broker@example.test",
      passwordHash: "fixture",
    },
  });
});

afterEach(async () => {
  const running = services.splice(0);
  for (const service of running) service.child.kill();
  await Promise.all(running.map((service) => service.exited));
});
afterAll(async () => db.$disconnect());

function start(name, id, entry = `services/${name}/src/main.js`, port) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AMQP_URL: amqpUrl,
      WORKER_ID: id,
      LOG_LEVEL: "info",
      METRICS_PORT: port ? String(port) : undefined,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const logs = [];
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      logs.push(JSON.parse(line));
    } catch {
      // Logs other than structured service messages do not establish readiness.
    }
  });
  const service = { child, logs, exited: once(child, "exit") };
  services.push(service);
  return service;
}

async function metricPort() {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function scrape(port) {
  const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
    signal: AbortSignal.timeout(3000),
  });
  expect(response.status).toBe(200);
  return response.text();
}

async function createJob() {
  const input = parseSubmission(
    {
      type: "MOCK_WEBHOOK",
      payload: { eventId: "broker-test" },
    },
    new Date(),
  );
  return (await submitJob(db, user, input, randomUUID())).job;
}

it("observes the configured RabbitMQ quorum queue priorities with queued work", async () => {
  await withQueue(amqpUrl, true, async (channel) => {
    const priorityQueue = `jobflow.priority-fixture-${randomUUID()}`;
    await channel.assertQueue(priorityQueue, {
      durable: true,
      arguments: { "x-queue-type": "quorum" },
    });
    for (const priority of [0, 4, 8]) {
      channel.sendToQueue(priorityQueue, Buffer.from(String(priority)), {
        priority,
        persistent: true,
      });
    }
    await channel.waitForConfirms();
    const observed = [];
    for (let i = 0; i < 3; i += 1) {
      const item = await channel.get(priorityQueue);
      expect(item).toBeTruthy();
      observed.push(Number(item.content.toString()));
      channel.ack(item);
    }
    await channel.deleteQueue(priorityQueue);
    expect(observed).toEqual([8, 4, 0]);
  });
});

it("redelivers after the pre-ACK connection closes and resumes dispatch with competing workers", async () => {
  const seeded = await createJob();
  const [dispatch] = await leaseDispatches(db, { limit: 1, leaseMs: 20_000 });
  await withQueue(amqpUrl, true, (channel) =>
    publishDispatch(channel, dispatch),
  );

  await withQueue(amqpUrl, false, async (channel, disconnected) => {
    const message = await channel.get(queue, { noAck: false });
    expect(message).toBeTruthy();
    await expect(
      handleDelivery(
        {
          db,
          workerId: "test-before-ack",
          logger: { info() {}, warn() {} },
          channel: {
            ack() {
              throw new Error("Simulated exit before ACK");
            },
            reject() {
              throw new Error("Expected a valid fixture envelope");
            },
          },
          disconnected,
        },
        message,
      ),
    ).rejects.toThrow("Simulated exit before ACK");
  });
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: seeded.id } })).status,
  ).toBe("COMPLETED");
  await db.outboxEvent.update({
    where: { id: dispatch.id },
    data: { lockedUntil: new Date(0) },
  });

  const workers = [
    start("worker", "first-worker"),
    start("worker", "second-worker"),
  ];
  const options = { timeout: 10_000, interval: 100 };
  for (const worker of workers) {
    await vi.waitFor(
      () =>
        expect(worker.logs.some(({ msg }) => msg === "Worker consuming")).toBe(
          true,
        ),
      options,
    );
  }
  await vi.waitFor(() => {
    expect(
      workers.some(({ logs }) =>
        logs.some(
          ({ jobId, disposition }) =>
            jobId === seeded.id && disposition === "stale",
        ),
      ),
    ).toBe(true);
  }, options);
  expect(await db.businessEffect.count({ where: { jobId: seeded.id } })).toBe(
    1,
  );

  const jobs = await Promise.all(Array.from({ length: 8 }, () => createJob()));
  const ids = jobs.map(({ id }) => id);
  start("dispatcher", "first-dispatcher");
  await vi.waitFor(async () => {
    expect(
      await db.job.count({ where: { id: { in: ids }, status: "COMPLETED" } }),
    ).toBe(8);
  }, options);
  const attempts = await db.attempt.findMany({ where: { jobId: { in: ids } } });
  expect(new Set(attempts.map(({ workerId }) => workerId))).toEqual(
    new Set(["first-worker", "second-worker"]),
  );
  expect(
    (await db.outboxEvent.findUniqueOrThrow({ where: { id: dispatch.id } }))
      .status,
  ).toBe("SUPERSEDED");
}, 35_000);

it("reissues a confirmed, unclaimed dispatch after losing the broker delivery", async () => {
  const job = await createJob();
  const [dispatch] = await leaseDispatches(db, { limit: 1, leaseMs: 20_000 });
  expect(dispatch.jobId).toBe(job.id);
  await withQueue(amqpUrl, true, (channel) =>
    publishDispatch(channel, dispatch),
  );
  expect(await recordDispatch(db, dispatch)).toBe(1);
  await withQueue(amqpUrl, false, async (channel) => {
    const message = await channel.get(queue, { noAck: false });
    expect(JSON.parse(message.content.toString()).jobId).toBe(job.id);
    channel.ack(message);
  });
  expect(await db.attempt.count({ where: { jobId: job.id } })).toBe(0);
  const confirmed = await db.outboxEvent.findUniqueOrThrow({
    where: { id: dispatch.id },
  });
  expect(confirmed.status).toBe("SENT");
  expect(confirmed.publishedAt).toBeInstanceOf(Date);

  const rearm = await readFile(
    new URL(
      "../../infra/postgres/rearm-queued-dispatches.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(await db.$executeRawUnsafe(rearm)).toBe(1);
  expect(await db.$executeRawUnsafe(rearm)).toBe(0);
  expect(
    await db.outboxEvent.findUniqueOrThrow({ where: { id: dispatch.id } }),
  ).toMatchObject({ status: "PENDING", publishedAt: null });

  start("worker", "restore-worker");
  start("dispatcher", "restore-dispatcher");
  await vi.waitFor(
    async () => {
      expect(
        await db.job.findUniqueOrThrow({ where: { id: job.id } }),
      ).toMatchObject({ status: "COMPLETED", attemptNumber: 1 });
      expect(
        await db.outboxEvent.findUniqueOrThrow({ where: { id: dispatch.id } }),
      ).toMatchObject({ status: "SENT" });
    },
    { timeout: 12_000, interval: 100 },
  );
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
}, 25_000);

it("retries a lost gateway response with the original key and commits one effect", async () => {
  const input = parseSubmission(
    {
      type: "SEND_EMAIL",
      payload: {
        templateId: "jobflow-email-success-001",
        recipientId: "delivered",
      },
    },
    new Date(),
  );
  const { job } = await submitJob(db, user, input, randomUUID());
  const seen = new Map();
  const request = vi.fn(async (_url, options) => {
    const key = options.headers["Idempotency-Key"];
    if (seen.has(key)) {
      expect(options.body).toBe(seen.get(key));
      return new Response(null, { status: 204 });
    }
    seen.set(key, options.body);
    throw new Error("Gateway accepted before losing the response");
  });
  const gateway = createGateway(
    {
      WEBHOOK_SITE_URL:
        "https://webhook.site/00000000-0000-4000-8000-000000000001",
      RESEND_API_KEY: "re_fixture_key",
      DELIVERY_TENANT_ID: user.tenantId,
    },
    request,
  );
  start("dispatcher", "gateway-dispatcher");
  start("scheduler", "gateway-scheduler");

  await withQueue(amqpUrl, false, async (channel, disconnected) => {
    const context = {
      db,
      workerId: "gateway-worker",
      logger: { info() {}, warn() {} },
      channel,
      disconnected,
      gateway,
    };
    for (let attemptNo = 1; attemptNo <= 2; attemptNo += 1) {
      const message = await vi.waitFor(
        async () => {
          const item = await channel.get(queue, { noAck: false });
          expect(item).toBeTruthy();
          return item;
        },
        { timeout: 8000, interval: 50 },
      );
      expect(JSON.parse(message.content.toString())).toEqual({
        jobId: job.id,
        attemptNo,
      });
      await handleDelivery(context, message);
    }
  });

  expect(
    await db.job.findUniqueOrThrow({ where: { id: job.id } }),
  ).toMatchObject({ status: "COMPLETED", attemptNumber: 2 });
  const attempts = await db.attempt.findMany({
    where: { jobId: job.id },
    orderBy: { attemptNo: "asc" },
  });
  expect(attempts.map(({ errorCode }) => errorCode)).toEqual([
    "TRANSIENT",
    null,
  ]);
  expect(request).toHaveBeenCalledTimes(2);
  expect([...seen.keys()]).toEqual([`jobflow/${job.id}`]);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
}, 25_000);

it("recovers a real worker process killed while it holds a claim", async () => {
  const job = await createJob();
  const [dispatch] = await leaseDispatches(db, { limit: 1, leaseMs: 20_000 });
  expect(dispatch.jobId).toBe(job.id);
  const stalled = start(
    "worker",
    "worker-to-kill",
    "tests/broker/stall-worker.mjs",
  );
  await withQueue(amqpUrl, true, (channel) =>
    publishDispatch(channel, dispatch),
  );
  const options = { timeout: 12_000, interval: 50 };
  await vi.waitFor(async () => {
    const running = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(running.status).toBe("RUNNING");
  }, options);
  stalled.child.kill("SIGKILL");
  await stalled.exited;
  await recordDispatch(db, dispatch);
  const [workerPort, dispatcherPort, schedulerPort] = await Promise.all([
    metricPort(),
    metricPort(),
    metricPort(),
  ]);
  start("worker", "replacement-worker", undefined, workerPort);
  start("dispatcher", "recovery-dispatcher", undefined, dispatcherPort);
  start("scheduler", "recovery-scheduler", undefined, schedulerPort);
  await vi.waitFor(async () => {
    expect(
      (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
    ).toBe("COMPLETED");
  }, options);
  const attempts = await db.attempt.findMany({
    where: { jobId: job.id },
    orderBy: { attemptNo: "asc" },
  });
  expect(
    attempts.map(({ errorCode, outcome }) => ({ errorCode, outcome })),
  ).toEqual([
    { errorCode: "LEASE_EXPIRED", outcome: "FAILED" },
    { errorCode: null, outcome: "SUCCEEDED" },
  ]);
  expect(await db.businessEffect.count({ where: { jobId: job.id } })).toBe(1);
  await vi.waitFor(async () => {
    const [worker, dispatcher, scheduler] = await Promise.all([
      scrape(workerPort),
      scrape(dispatcherPort),
      scrape(schedulerPort),
    ]);
    expect(worker).toContain(
      'job_attempts_total{job_type="MOCK_WEBHOOK",outcome="SUCCEEDED"} 1',
    );
    expect(worker).toContain(
      'jobs_terminal_total{job_type="MOCK_WEBHOOK",status="COMPLETED"} 1',
    );
    expect(dispatcher).toContain(
      'outbox_dispatches_total{outcome="confirmed"} 1',
    );
    expect(dispatcher).toContain(
      'outbox_dispatch_stage_seconds_count{stage="publish"} 1',
    );
    expect(dispatcher).toContain(
      'outbox_dispatch_stage_seconds_count{stage="record"} 1',
    );
    expect(scheduler).toContain(
      'worker_lease_expirations_total{job_type="MOCK_WEBHOOK"} 1',
    );
    expect(scheduler).toContain(
      'job_retries_total{job_type="MOCK_WEBHOOK",reason="LEASE_EXPIRED"} 1',
    );
  }, options);
}, 35_000);
