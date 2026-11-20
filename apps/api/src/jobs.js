import { randomUUID } from "node:crypto";

export const publicJob = {
  id: true,
  type: true,
  payload: true,
  priority: true,
  status: true,
  runAt: true,
  nextRunAt: true,
  maxAttempts: true,
  attemptNumber: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
  replayOfId: true,
};

export async function submitJob(db, user, input, idempotencyKey) {
  const id = randomUUID();
  try {
    const job = await db.job.create({
      data: {
        id,
        ...input,
        idempotencyKey,
        tenantId: user.tenantId,
        nextRunAt: input.runAt,
        outbox: {
          create: {
            topic: "job.dispatch",
            attemptNo: 1,
            body: { jobId: id, attemptNo: 1 },
            availableAt: input.runAt,
          },
        },
        events: {
          create: { eventType: "JOB_SUBMITTED", details: {}, actorId: user.id },
        },
      },
      select: publicJob,
    });
    return { job };
  } catch (error) {
    if (!idempotencyKey || error.code !== "P2002") throw error;
    const existing = await db.job.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey },
      },
      select: { ...publicJob, payloadHash: true },
    });
    if (!existing) throw error;
    const { payloadHash, ...job } = existing;
    return payloadHash === input.payloadHash ? { job } : { conflict: true };
  }
}

export function readPage(
  model,
  where,
  select,
  { limit, before },
  timestamp = "createdAt",
) {
  return model
    .findMany({
      where: {
        ...where,
        ...(before && {
          OR: [
            { [timestamp]: { lt: before.createdAt } },
            { [timestamp]: before.createdAt, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ [timestamp]: "desc" }, { id: "desc" }],
      take: limit + 1,
      select,
    })
    .then((rows) => toPage(rows, limit, timestamp));
}

function toPage(rows, limit, timestamp) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit
      ? Buffer.from(
          JSON.stringify([last[timestamp].toISOString(), last.id]),
        ).toString("base64url")
      : null;
  return { items, nextCursor };
}
