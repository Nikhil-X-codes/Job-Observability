import { createHash } from "node:crypto";
import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const priority = z.enum(["LOW", "NORMAL", "HIGH"]);
export const jobId = z.uuid();
export const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
  .optional();

const fields = {
  priority: priority.default("NORMAL"),
  maxAttempts: z.number().int().min(1).max(5).default(3),
  runAt: z.iso.datetime().optional(),
};
export const externalJobTypes = Object.freeze([
  "SEND_EMAIL",
  "DELIVER_WEBHOOK",
]);
const emailPayload = z.strictObject({
  templateId: identifier,
  recipientId: identifier,
});

const input = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("GENERATE_REPORT"),
    payload: z.strictObject({ reportId: identifier }),
    ...fields,
  }),
  z.strictObject({
    type: z.literal("SIMULATE_EMAIL"),
    payload: emailPayload,
    ...fields,
  }),
  z.strictObject({
    type: z.literal("MOCK_WEBHOOK"),
    payload: z.strictObject({ eventId: identifier }),
    ...fields,
  }),
  z.strictObject({
    type: z.literal("SEND_EMAIL"),
    payload: z.strictObject({
      templateId: z.enum([
        "jobflow-email-success-001",
        "jobflow-email-bounce-001",
      ]),
      recipientId: z.enum(["delivered", "bounced", "complained"]),
    }),
    ...fields,
  }),
  z.strictObject({
    type: z.literal("DELIVER_WEBHOOK"),
    payload: z.strictObject({
      eventId: z.enum([
        "jobflow-webhook-success-001",
        "jobflow-webhook-retry-001",
      ]),
      destinationId: z.literal("webhook-site"),
    }),
    ...fields,
    maxAttempts: z.literal(1).default(1),
  }),
]);

const windowMs = 30 * 24 * 60 * 60 * 1000;

export function parseSubmission(body, now) {
  const result = input.safeParse(body);
  if (!result.success) return null;
  const job = result.data;
  const runAt = job.runAt ? new Date(job.runAt) : now;
  if (!Number.isFinite(runAt.getTime()) || runAt - now > windowMs) return null;
  const canonical = JSON.stringify({
    type: job.type,
    payload: Object.keys(job.payload)
      .sort()
      .map((key) => [key, job.payload[key]]),
    priority: job.priority,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt ? runAt.toISOString() : null,
  });
  return {
    ...job,
    runAt,
    payloadHash: createHash("sha256").update(canonical).digest("hex"),
  };
}

const listFilters = z.strictObject({
  status: z
    .enum([
      "PENDING",
      "QUEUED",
      "RUNNING",
      "RETRY_WAIT",
      "COMPLETED",
      "DEAD",
      "CANCELLED",
    ])
    .optional(),
  type: z
    .enum([
      "GENERATE_REPORT",
      "SIMULATE_EMAIL",
      "MOCK_WEBHOOK",
      ...externalJobTypes,
    ])
    .optional(),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(25),
});

const cursorFields = z.tuple([z.iso.datetime(), jobId]);

export function parseListQuery(query) {
  const result = listFilters.safeParse(query);
  if (!result.success) return null;
  const { cursor, ...filters } = result.data;
  if (!cursor) return filters;
  try {
    const [createdAt, id] = cursorFields.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { ...filters, before: { createdAt: new Date(createdAt), id } };
  } catch {
    return null;
  }
}
