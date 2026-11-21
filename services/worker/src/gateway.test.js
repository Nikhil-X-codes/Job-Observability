import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createGateway } from "./gateway.js";
import { runHandler } from "./handlers.js";

const tenantId = randomUUID();
const config = {
  WEBHOOK_SITE_URL: "https://webhook.site/00000000-0000-4000-8000-000000000001",
  RESEND_API_KEY: "re_fixture_key",
  DELIVERY_TENANT_ID: tenantId,
};
const email = () => ({
  type: "SEND_EMAIL",
  payload: {
    templateId: "jobflow-email-success-001",
    recipientId: "delivered",
  },
  tenantId,
  jobId: randomUUID(),
  runAt: new Date(),
});
const webhook = () => ({
  type: "DELIVER_WEBHOOK",
  payload: {
    eventId: "jobflow-webhook-retry-001",
    destinationId: "webhook-site",
  },
  tenantId,
  jobId: randomUUID(),
  attemptNo: 1,
});
const signal = new AbortController().signal;

it("reuses the Resend key and payload after Resend accepts and the response is lost", async () => {
  const accepted = new Map();
  const providerId = randomUUID();
  const request = vi.fn(async (url, options) => {
    expect(url.href).toBe("https://api.resend.com/emails");
    const key = options.headers["Idempotency-Key"];
    if (accepted.has(key)) {
      expect(options.body).toBe(accepted.get(key));
      return Response.json({ id: providerId });
    }
    accepted.set(key, options.body);
    throw new Error("Provider committed before the connection dropped");
  });
  const delivery = createGateway(config, request);
  const job = email();
  await expect(runHandler(job, signal, delivery)).rejects.toMatchObject({
    code: "TRANSIENT",
  });
  await expect(runHandler(job, signal, delivery)).resolves.toEqual({
    accepted: true,
    providerId,
  });
  expect([...accepted.keys()]).toEqual([`jobflow/${job.jobId}`]);
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
    to: ["delivered@resend.dev"],
  });
  expect(request.mock.calls[0][1]).toMatchObject({
    redirect: "manual",
    signal,
  });
});

it("rejects other tenants, arbitrary recipients, and expired email retry windows before sending", async () => {
  const request = vi.fn();
  const deliver = createGateway(config, request);
  const job = email();
  for (const candidate of [
    { ...job, tenantId: randomUUID() },
    { ...job, payload: { ...job.payload, recipientId: "other@example.test" } },
    { ...job, runAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  ]) {
    await expect(deliver(candidate, signal)).rejects.toMatchObject({
      code: "PERMANENT",
    });
  }
  expect(request).not.toHaveBeenCalled();
  expect(() =>
    createGateway({
      ...config,
      WEBHOOK_SITE_URL: "https://other.example.test",
    }),
  ).toThrow("Invalid external delivery configuration");
});

it.each(["bounced", "complained"])(
  "maps the %s scenario to its Resend test address",
  async (recipientId) => {
    const request = vi.fn(async () => Response.json({ id: randomUUID() }));
    const delivery = createGateway(config, request);
    const job = email();
    job.payload.recipientId = recipientId;
    await delivery(job, signal);
    expect(JSON.parse(request.mock.calls[0][1].body).to).toEqual([
      recipientId + "@resend.dev",
    ]);
  },
);

it.each([
  [302, {}, "PERMANENT"],
  [400, {}, "PERMANENT"],
  [409, { name: "invalid_idempotent_request" }, "PERMANENT"],
  [409, { name: "concurrent_idempotent_requests" }, "TRANSIENT"],
  [429, {}, "TRANSIENT"],
  [503, {}, "TRANSIENT"],
])("classifies Resend HTTP %s", async (status, body, code) => {
  const delivery = createGateway(config, async () =>
    Response.json(body, { status }),
  );
  await expect(delivery(email(), signal)).rejects.toMatchObject({ code });
});

it("sends only synthetic data to Webhook.site and rejects a second attempt after capture", async () => {
  const request = vi.fn(async () => new Response(null, { status: 503 }));
  const delivery = createGateway(config, request);
  const job = webhook();
  await expect(delivery(job, signal)).rejects.toMatchObject({
    code: "PERMANENT",
  });
  await expect(
    delivery({ ...job, attemptNo: 2 }, signal),
  ).rejects.toMatchObject({ code: "PERMANENT" });
  expect(request).toHaveBeenCalledTimes(1);
  const [[url, options]] = request.mock.calls;
  expect(url.href).toBe(config.WEBHOOK_SITE_URL + "/503");
  expect(options.headers).not.toHaveProperty("Authorization");
  expect(JSON.parse(options.body)).toEqual({
    fixtureId: job.payload.eventId,
    synthetic: true,
  });
});

it("accepts the Webhook.site success fixture and does not retry a lost webhook response", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockRejectedValueOnce(new Error("lost after capture"));
  const delivery = createGateway(config, request);
  const job = webhook();
  job.payload.eventId = "jobflow-webhook-success-001";
  await expect(delivery(job, signal)).resolves.toEqual({ accepted: true });
  await expect(
    delivery({ ...job, jobId: randomUUID() }, signal),
  ).rejects.toMatchObject({ code: "PERMANENT" });
  expect(request.mock.calls[0][0].href).toBe(config.WEBHOOK_SITE_URL);
});
