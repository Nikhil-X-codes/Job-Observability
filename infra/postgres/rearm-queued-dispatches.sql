-- Run against a restored JobFlow database with application services stopped.
-- A replacement broker has no copy of the confirmed, unclaimed deliveries.
UPDATE outbox_events AS dispatch
SET status = 'PENDING',
    published_at = NULL,
    lock_token = NULL,
    locked_until = NULL
FROM jobs AS job
WHERE dispatch.aggregate_id = job.id
  AND dispatch.topic = 'job.dispatch'
  AND dispatch.status = 'SENT'
  AND job.status = 'QUEUED'
  AND dispatch.attempt_no = job.attempt_number + 1
  AND dispatch.attempt_no <= job.max_attempts;
