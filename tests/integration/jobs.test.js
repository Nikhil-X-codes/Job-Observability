import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createDatabase } from "@jobflow/db";
import supertest from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/passwords.js";
import { createV1Router } from "../../apps/api/src/v1.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "TEST_DATABASE_URL must point to a migrated disposable database",
  );
const db = createDatabase(databaseUrl);
const logger = { info() {}, error() {} };
const origin = "http://127.0.0.1:5173";
let server;
let api;
const email = "operator@example.test";
const password = "fixture-password-only";
const first = { slug: `test-${randomUUID()}`, role: "ADMIN" };
const second = { slug: `test-${randomUUID()}`, role: "MEMBER" };
const report = { type: "GENERATE_REPORT", payload: { reportId: "demo-42" } };

function login(tenant, appOrigin = origin) {
  return api
    .post("/api/v1/auth/login")
    .set("Origin", appOrigin)
    .send({ tenant, email, password });
}

function submit(session, key, body = report) {
  return api
    .post("/api/v1/jobs")
    .set("Origin", origin)
    .set("Cookie", session)
    .set("Idempotency-Key", key)
    .send(body);
}

beforeAll(async () => {
  server = createApp(logger, undefined, createV1Router(db, origin)).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  api = supertest(server);
  const passwordHash = await hashPassword(password);
  for (const fixture of [first, second]) {
    const tenant = await db.tenant.create({
      data: { slug: fixture.slug, name: "Test tenant" },
    });
    fixture.id = tenant.id;
    const user = await db.user.create({
      data: { tenantId: tenant.id, email, passwordHash, role: fixture.role },
    });
    fixture.userId = user.id;
    const signedIn = await login(fixture.slug).expect(200);
    const cookie = signedIn.headers["set-cookie"][0];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    fixture.session = cookie.split(";")[0];
  }
});

afterAll(async () => {
  await Promise.all([
    db.$disconnect(),
    server && new Promise((resolve) => server.close(resolve)),
  ]);
});

it("scopes sign-in, checks origin, and invalidates sessions at logout", async () => {
  await login(first.slug, "http://example.test").expect(403);
  await login(`missing-${randomUUID()}`).expect(401);
  const another = await login(second.slug).expect(200);
  const session = another.headers["set-cookie"][0].split(";")[0];
  const result = await api.get("/api/v1/me").set("Cookie", session).expect(200);
  expect(result.body).toEqual({
    id: second.userId,
    tenantId: second.id,
    email,
    role: "MEMBER",
  });
  await api
    .post("/api/v1/auth/logout")
    .set("Origin", origin)
    .set("Cookie", session)
    .expect(204);
  await api.get("/api/v1/me").set("Cookie", session).expect(401);
});

it("permits external delivery only for the configured tenant administrator with a key", async () => {
  const body = {
    type: "SEND_EMAIL",
    payload: {
      templateId: "jobflow-email-success-001",
      recipientId: "delivered",
    },
  };
  await submit(first.session, "delivery-disabled", body).expect(403);

  const enabled = supertest(
    createApp(
      logger,
      undefined,
      createV1Router(db, origin, undefined, 60, first.id),
    ),
  );
  const request = (cookie) =>
    enabled.post("/api/v1/jobs").set("Origin", origin).set("Cookie", cookie);
  await enabled
    .get("/api/v1/job-capabilities")
    .set("Cookie", first.session)
    .expect(200, { externalDelivery: true });
  await enabled
    .get("/api/v1/job-capabilities")
    .set("Cookie", second.session)
    .expect(200, { externalDelivery: false });
  await request(second.session)
    .set("Idempotency-Key", "delivery-other")
    .send(body)
    .expect(403);
  const memberEmail = "delivery-member@example.test";
  await db.user.create({
    data: {
      tenantId: first.id,
      email: memberEmail,
      passwordHash: await hashPassword(password),
      role: "MEMBER",
    },
  });
  const member = await enabled
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ tenant: first.slug, email: memberEmail, password })
    .expect(200);
  await request(member.headers["set-cookie"][0].split(";")[0])
    .set("Idempotency-Key", "delivery-member")
    .send(body)
    .expect(403);
  await request(first.session).send(body).expect(400);
  await request(first.session)
    .set("Idempotency-Key", "delivery-url")
    .send({
      type: "DELIVER_WEBHOOK",
      payload: {
        eventId: "jobflow-webhook-retry-001",
        destinationId: "webhook-site",
        url: "https://example.test",
      },
    })
    .expect(400);
  const webhook = {
    type: "DELIVER_WEBHOOK",
    payload: {
      eventId: "jobflow-webhook-retry-001",
      destinationId: "webhook-site",
    },
  };
  await request(first.session)
    .set("Idempotency-Key", "webhook-repeat")
    .send({ ...webhook, maxAttempts: 2 })
    .expect(400);
  const acceptedWebhook = await request(first.session)
    .set("Idempotency-Key", "webhook-once")
    .send(webhook)
    .expect(202);
  expect(acceptedWebhook.body.maxAttempts).toBe(1);
  const firstJob = await request(first.session)
    .set("Idempotency-Key", "delivery-approved")
    .send(body)
    .expect(202);
  const duplicate = await request(first.session)
    .set("Idempotency-Key", "delivery-approved")
    .send(body)
    .expect(202);
  expect(firstJob.body.id).toBe(duplicate.body.id);
  const [, letter] = await db.$transaction([
    db.job.update({
      where: { id: firstJob.body.id },
      data: { status: "DEAD", finishedAt: new Date() },
    }),
    db.deadLetter.create({
      data: { jobId: firstJob.body.id, lastErrorCode: "PERMANENT" },
    }),
  ]);
  await enabled
    .post(`/api/v1/admin/dlq/${letter.id}/replay`)
    .set("Origin", origin)
    .set("Cookie", first.session)
    .send({ reason: "Check duplicate protection" })
    .expect(409);
  expect(await db.job.count({ where: { replayOfId: firstJob.body.id } })).toBe(
    0,
  );
});

it("commits one job, one outbox message, and one event for concurrent matching submissions", async () => {
  const [a, b] = await Promise.all([
    submit(first.session, "parallel").expect(202),
    submit(first.session, "parallel").expect(202),
  ]);
  expect(a.body.id).toBe(b.body.id);
  expect(a.body).not.toHaveProperty("leaseToken");
  expect(a.body).not.toHaveProperty("payloadHash");
  expect(
    await db.job.count({
      where: { tenantId: first.id, idempotencyKey: "parallel" },
    }),
  ).toBe(1);
  const outbox = await db.outboxEvent.findMany({
    where: { aggregateId: a.body.id },
  });
  expect(outbox).toHaveLength(1);
  expect(outbox[0].body).toEqual({ jobId: a.body.id, attemptNo: 1 });
  expect(await db.jobEvent.count({ where: { jobId: a.body.id } })).toBe(1);
  await submit(first.session, "parallel", {
    ...report,
    priority: "HIGH",
  }).expect(409);
  const other = await submit(second.session, "parallel").expect(202);
  expect(other.body.id).not.toBe(a.body.id);
});

it("rolls back the job when the outbox insert fails", async () => {
  const before = await db.outboxEvent.count();
  await db.$executeRaw`
    CREATE FUNCTION fail_outbox_for_test() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END; $$
  `;
  try {
    await db.$executeRaw`
      CREATE TRIGGER fail_outbox_for_test BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION fail_outbox_for_test()
    `;
    try {
      await submit(first.session, "rollback").expect(500);
      expect(
        await db.job.count({
          where: { tenantId: first.id, idempotencyKey: "rollback" },
        }),
      ).toBe(0);
      expect(await db.outboxEvent.count()).toBe(before);
    } finally {
      await db.$executeRaw`DROP TRIGGER fail_outbox_for_test ON outbox_events`;
    }
  } finally {
    await db.$executeRaw`DROP FUNCTION fail_outbox_for_test()`;
  }
});

it("enforces tenant authorization for details, history, and admin endpoints", async () => {
  const { body: job } = await submit(first.session, "scoped").expect(202);
  for (const suffix of ["", "/events", "/attempts"]) {
    await api
      .get(`/api/v1/jobs/${job.id}${suffix}`)
      .set("Cookie", second.session)
      .expect(404);
  }
  const events = await api
    .get(`/api/v1/jobs/${job.id}/events`)
    .set("Cookie", first.session)
    .expect(200);
  expect(events.body.items[0].eventType).toBe("JOB_SUBMITTED");
  await api.get("/api/v1/admin/dlq").set("Cookie", second.session).expect(403);
  await api.get("/api/v1/admin/dlq").set("Cookie", first.session).expect(200);
});

it("validates payloads and walks stable cursor pages across equal timestamps", async () => {
  await submit(first.session, "invalid", { ...report, maxAttempts: 10 }).expect(
    400,
  );
  await submit(first.session, "oversize", {
    ...report,
    unused: "x".repeat(20000),
  }).expect(413);
  const assigned = [];
  for (const key of ["page-one", "page-two", "page-three"]) {
    const { body } = await submit(first.session, key, {
      type: "MOCK_WEBHOOK",
      payload: { eventId: key },
    }).expect(202);
    assigned.push(body.id);
  }
  await db.job.updateMany({
    where: { id: { in: assigned } },
    data: { createdAt: new Date("2026-01-01T00:00:00Z") },
  });
  const query = { limit: 2, type: "MOCK_WEBHOOK" };
  const page = await api
    .get("/api/v1/jobs")
    .query(query)
    .set("Cookie", first.session)
    .expect(200);
  expect(page.body.nextCursor).toBeTruthy();
  const last = await api
    .get("/api/v1/jobs")
    .query({ ...query, cursor: page.body.nextCursor })
    .set("Cookie", first.session)
    .expect(200);
  expect([...page.body.items, ...last.body.items].map(({ id }) => id)).toEqual(
    assigned.sort().reverse(),
  );
  expect(last.body.nextCursor).toBeNull();
});

it("cancels only an eligible tenant job and records the cancellation", async () => {
  const { body: job } = await submit(first.session, "cancelled").expect(202);
  const path = `/api/v1/jobs/${job.id}/cancel`;
  await api
    .post(path)
    .set("Origin", origin)
    .set("Cookie", second.session)
    .expect(404);
  const cancelled = await api
    .post(path)
    .set("Origin", origin)
    .set("Cookie", first.session)
    .expect(200);
  expect(cancelled.body.status).toBe("CANCELLED");
  expect(cancelled.body.finishedAt).toBeTruthy();
  await api
    .post(path)
    .set("Origin", origin)
    .set("Cookie", first.session)
    .expect(409);
  expect(
    await db.jobEvent.count({
      where: { jobId: job.id, eventType: "JOB_CANCELLED" },
    }),
  ).toBe(1);
});

it("creates a single linked replay for a tenant admin and preserves the dead job", async () => {
  const { body: job } = await submit(first.session, "dead-for-replay").expect(
    202,
  );
  const [, letter] = await db.$transaction([
    db.job.update({
      where: { id: job.id },
      data: { status: "DEAD", finishedAt: new Date() },
    }),
    db.deadLetter.create({
      data: { jobId: job.id, lastErrorCode: "PERMANENT" },
    }),
  ]);
  function replay(session) {
    return api
      .post(`/api/v1/admin/dlq/${letter.id}/replay`)
      .set("Origin", origin)
      .set("Cookie", session)
      .send({ reason: "Control issue resolved" });
  }
  await replay(second.session).expect(403);
  const results = await Promise.all([
    replay(first.session),
    replay(first.session),
  ]);
  expect(results.map(({ status }) => status).sort()).toEqual([202, 409]);
  const { body } = results.find(({ status }) => status === 202);
  expect(body.id).not.toBe(job.id);
  expect(body.replayOfId).toBe(job.id);
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
  ).toBe("DEAD");
  expect(
    (await db.deadLetter.findUniqueOrThrow({ where: { id: letter.id } }))
      .replayJobId,
  ).toBe(body.id);
  expect(await db.outboxEvent.count({ where: { aggregateId: body.id } })).toBe(
    1,
  );
  const event = await db.jobEvent.findFirstOrThrow({
    where: { jobId: body.id, eventType: "JOB_REPLAYED" },
  });
  expect(event.details).toEqual({
    originalJobId: job.id,
    reason: "Control issue resolved",
  });
});
