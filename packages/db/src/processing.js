import { randomUUID } from "node:crypto";
import { retryDelay } from "./retry.js";

export async function leaseDispatches(db, { limit, leaseMs }) {
  const lockToken = randomUUID();
  return db.$queryRaw`
    WITH candidates AS MATERIALIZED (
      SELECT o.id, o.aggregate_id, o.attempt_no, o.available_at, j.priority,
             j.status AS job_status,
             (j.status IN ('PENDING', 'RETRY_WAIT', 'QUEUED')
              AND j.next_run_at IS NOT NULL
              AND j.next_run_at <= statement_timestamp()
              AND o.attempt_no = j.attempt_number + 1
              AND o.attempt_no <= j.max_attempts) AS eligible
      FROM outbox_events o JOIN jobs j ON j.id = o.aggregate_id
      WHERE o.topic = 'job.dispatch' AND o.status = 'PENDING'
        AND o.available_at <= statement_timestamp()
        AND (o.locked_until IS NULL OR o.locked_until <= statement_timestamp())
      ORDER BY o.available_at, o.id
      LIMIT ${limit}
      FOR UPDATE OF o, j SKIP LOCKED
    ), leased AS (
      UPDATE outbox_events o
      SET status = CASE WHEN c.eligible THEN 'PENDING'::"OutboxStatus"
                        ELSE 'SUPERSEDED'::"OutboxStatus" END,
          lock_token = CASE WHEN c.eligible THEN ${lockToken}::uuid END,
          locked_until = CASE WHEN c.eligible
            THEN statement_timestamp() + ${leaseMs}::int * interval '1 millisecond' END
      FROM candidates c WHERE o.id = c.id
      RETURNING o.id, o.retry_count, o.lock_token
    ), queued AS (
      UPDATE jobs j SET status = 'QUEUED', updated_at = statement_timestamp()
      FROM candidates c
      WHERE j.id = c.aggregate_id AND c.eligible AND c.job_status <> 'QUEUED'
      RETURNING j.id, c.attempt_no, j.updated_at
    ), audited AS (
      INSERT INTO job_events (job_id, event_type, details, occurred_at)
      SELECT id, 'JOB_QUEUED', jsonb_build_object('attemptNo', attempt_no), updated_at
      FROM queued
    )
    SELECT c.id, c.aggregate_id AS "jobId", c.attempt_no AS "attemptNo",
           l.retry_count AS "retryCount", c.priority, l.lock_token AS "lockToken"
    FROM candidates c JOIN leased l ON l.id = c.id
    WHERE c.eligible
    ORDER BY c.available_at, c.id
  `;
}

export async function recordDispatch(db, dispatch) {
  return db.$executeRaw`
    UPDATE outbox_events SET status = 'SENT', published_at = clock_timestamp(),
      lock_token = NULL, locked_until = NULL
    WHERE id = ${dispatch.id}::uuid AND lock_token = ${dispatch.lockToken}::uuid
  `;
}

export async function retryDispatch(db, dispatch, delayMs) {
  return db.$executeRaw`
    UPDATE outbox_events SET retry_count = retry_count + 1,
      available_at = clock_timestamp() + ${delayMs}::int * interval '1 millisecond',
      lock_token = NULL, locked_until = NULL
    WHERE id = ${dispatch.id}::uuid AND lock_token = ${dispatch.lockToken}::uuid
  `;
}

export async function claimExecution(
  db,
  { jobId, attemptNo },
  workerId,
  leaseMs,
) {
  const token = randomUUID();
  return db.$transaction(async (tx) => {
    const [lease] = await tx.$queryRaw`
      UPDATE jobs AS j
      SET status = 'RUNNING', attempt_number = ${attemptNo}::int,
        lease_token = ${token}::uuid,
        lease_expires_at = clock_timestamp() + ${leaseMs}::int * interval '1 millisecond',
        next_run_at = NULL, updated_at = clock_timestamp()
      FROM (SELECT id, next_run_at FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE) AS prior
      WHERE j.id = prior.id AND j.status = 'QUEUED'
        AND j.next_run_at <= clock_timestamp()
        AND attempt_number + 1 = ${attemptNo}::int AND attempt_number < max_attempts
      RETURNING j.id AS "jobId", j.tenant_id AS "tenantId", type, payload, attempt_number AS "attemptNo",
        max_attempts AS "maxAttempts", lease_token AS token, updated_at AS "startedAt", run_at AS "runAt",
        created_at AS "createdAt", prior.next_run_at AS "eligibleAt"
    `;
    if (!lease) return null;
    await tx.attempt.create({
      data: { jobId, attemptNo, workerId, startedAt: lease.startedAt },
    });
    await tx.jobEvent.create({
      data: {
        jobId,
        eventType: "JOB_STARTED",
        details: { attemptNo },
        occurredAt: lease.startedAt,
      },
    });
    return lease;
  });
}

export async function extendExecution(db, lease, leaseMs) {
  return db.$executeRaw`
    UPDATE jobs SET lease_expires_at = clock_timestamp() + ${leaseMs}::int * interval '1 millisecond'
    WHERE id = ${lease.jobId}::uuid AND status = 'RUNNING'
      AND lease_token = ${lease.token}::uuid AND lease_expires_at > clock_timestamp()
  `;
}

export async function finalizeExecution(
  db,
  lease,
  { result, errorCode },
  onCommit,
) {
  const committed = await db.$transaction((tx) =>
    finish(tx, lease, { result, errorCode }),
  );
  if (committed) onCommit?.(committed);
  return Boolean(committed);
}

async function finish(tx, lease, { result, errorCode, expired = false }) {
  const delayMs = retryDelay(lease, errorCode);
  const state =
    delayMs !== null ? "RETRY_WAIT" : errorCode ? "DEAD" : "COMPLETED";
  const [job] = await tx.$queryRaw`
      UPDATE jobs SET status = ${state}::"JobStatus",
        lease_token = NULL, lease_expires_at = NULL,
        next_run_at = clock_timestamp() + ${delayMs}::int * interval '1 millisecond',
        finished_at = CASE WHEN ${delayMs}::int IS NULL THEN clock_timestamp() END,
        updated_at = clock_timestamp()
      WHERE id = ${lease.jobId}::uuid AND status = 'RUNNING'
        AND lease_token = ${lease.token}::uuid
        AND (lease_expires_at <= clock_timestamp()) = ${expired}::boolean
      RETURNING updated_at AS "transitionAt", next_run_at AS "nextRunAt"
    `;
  if (!job) return false;
  const { jobId, attemptNo, startedAt } = lease;
  const { transitionAt, nextRunAt } = job;
  await tx.attempt.update({
    where: { jobId_attemptNo: { jobId, attemptNo } },
    data: {
      finishedAt: transitionAt,
      durationMs: Math.max(0, transitionAt - startedAt),
      outcome: errorCode ? "FAILED" : "SUCCEEDED",
      errorCode,
    },
  });
  if (state === "DEAD") {
    await tx.deadLetter.create({ data: { jobId, lastErrorCode: errorCode } });
  } else if (state === "COMPLETED") {
    await tx.businessEffect.create({
      data: { jobId, effectKey: `job/${jobId}`, kind: lease.type, result },
    });
  }
  await tx.jobEvent.create({
    data: {
      jobId,
      eventType:
        state === "RETRY_WAIT" ? "JOB_RETRY_SCHEDULED" : `JOB_${state}`,
      details: {
        attemptNo,
        ...(errorCode && { errorCode }),
        ...(nextRunAt && { nextRunAt: nextRunAt.toISOString() }),
      },
      occurredAt: transitionAt,
    },
  });
  return {
    type: lease.type,
    status: state,
    startedAt,
    createdAt: lease.createdAt,
    finishedAt: transitionAt,
    errorCode,
  };
}

export async function enqueueRetries(db, limit) {
  return db.$executeRaw`
    WITH due AS (
      SELECT j.id, j.attempt_number + 1 AS attempt_no, j.next_run_at
      FROM jobs j
      WHERE j.status = 'RETRY_WAIT' AND j.next_run_at <= clock_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events o WHERE o.topic = 'job.dispatch'
            AND o.aggregate_id = j.id AND o.attempt_no = j.attempt_number + 1
        )
      ORDER BY j.next_run_at, j.id
      LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED
    )
    INSERT INTO outbox_events (topic, aggregate_id, attempt_no, body, available_at)
    SELECT 'job.dispatch', id, attempt_no, jsonb_build_object('jobId', id, 'attemptNo', attempt_no), next_run_at
    FROM due ON CONFLICT (topic, aggregate_id, attempt_no) DO NOTHING
  `;
}

export async function recoverExpired(db, limit, onCommit) {
  const recovered = await db.$transaction(async (tx) => {
    const leases = await tx.$queryRaw`
      SELECT j.id AS "jobId", j.attempt_number AS "attemptNo",
             j.max_attempts AS "maxAttempts", j.lease_token AS token, a.started_at AS "startedAt",
             j.type, j.created_at AS "createdAt"
      FROM jobs j JOIN attempts a ON a.job_id = j.id AND a.attempt_no = j.attempt_number
      WHERE j.status = 'RUNNING' AND j.lease_expires_at <= clock_timestamp()
      ORDER BY j.lease_expires_at, j.id
      LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED
    `;
    const commits = [];
    for (const lease of leases) {
      const commit = await finish(tx, lease, {
        errorCode: "LEASE_EXPIRED",
        expired: true,
      });
      if (commit) commits.push(commit);
    }
    return commits;
  });
  for (const commit of recovered) onCommit?.(commit);
  return recovered.length;
}
