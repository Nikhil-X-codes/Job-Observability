import { HttpError } from "./http-errors.js";
import { parseSubmission } from "./job-input.js";
import { publicJob, submitJob } from "./jobs.js";

export async function cancelJob(db, user, id) {
  return db.$transaction(async (tx) => {
    const [updated] = await tx.$queryRaw`
      UPDATE jobs SET status = 'CANCELLED', next_run_at = NULL,
        finished_at = statement_timestamp(), updated_at = statement_timestamp()
      WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid
        AND status IN ('PENDING', 'QUEUED', 'RETRY_WAIT')
      RETURNING id, updated_at AS "updatedAt"
    `;
    if (!updated)
      throw new HttpError(409, "CANCEL_CONFLICT", "Job cannot be cancelled");
    await tx.jobEvent.create({
      data: {
        jobId: id,
        actorId: user.id,
        eventType: "JOB_CANCELLED",
        details: {},
        occurredAt: updated.updatedAt,
      },
    });
    return tx.job.findUniqueOrThrow({ where: { id }, select: publicJob });
  });
}

export async function replayJob(db, user, letterId, reason) {
  return db.$transaction(async (tx) => {
    const [entry] = await tx.$queryRaw`
      SELECT d.job_id AS "jobId", d.replayed_at AS "replayedAt", statement_timestamp() AS now
      FROM dead_letters d JOIN jobs j ON j.id = d.job_id
      WHERE d.id = ${letterId}::uuid AND j.tenant_id = ${user.tenantId}::uuid
      FOR UPDATE OF d
    `;
    if (!entry) throw new HttpError(404, "NOT_FOUND", "Dead letter not found");
    if (entry.replayedAt)
      throw new HttpError(
        409,
        "REPLAY_CONFLICT",
        "Dead letter was already replayed",
      );
    const { type, payload, priority, maxAttempts } =
      await tx.job.findUniqueOrThrow({
        where: { id: entry.jobId },
        select: {
          type: true,
          payload: true,
          priority: true,
          maxAttempts: true,
        },
      });
    const input = parseSubmission(
      { type, payload, priority, maxAttempts },
      entry.now,
    );
    if (!input)
      throw new HttpError(
        409,
        "REPLAY_INVALID",
        "Stored job is ineligible for replay",
      );
    const { job } = await submitJob(tx, user, {
      ...input,
      replayOfId: entry.jobId,
    });
    await tx.deadLetter.update({
      where: { id: letterId },
      data: { replayJobId: job.id, replayedAt: entry.now },
    });
    await tx.jobEvent.create({
      data: {
        jobId: job.id,
        actorId: user.id,
        eventType: "JOB_REPLAYED",
        details: { originalJobId: entry.jobId, reason },
        occurredAt: entry.now,
      },
    });
    return job;
  });
}
