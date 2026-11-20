# Data Model and API Contract

All timestamps are UTC ISO 8601; UUID identifiers. Enforce ownership and admin role on every request. API examples are **design contracts**, not currently deployed endpoints.

## Minimum SQL/Prisma model design

| Entity | Key fields | Constraints |
|---|---|---|
| Tenant | id, slug, name | unique slug |
| User | id, tenantId, email, passwordHash, role | email unique per tenant; password strong hash |
| Session | tokenHash, userId, expiresAt | digest only, expires after 8 hours |
| Job | id, tenantId, type, payload JSON, payloadHash, idempotencyKey?, priority, status, runAt, nextRunAt, maxAttempts, attemptNumber, leaseToken?, leaseExpiresAt?, createdAt, updatedAt, finishedAt? | unique `(tenantId, idempotencyKey)` for non-null key; useful indexes on `(status,nextRunAt,priority)` |
| Attempt | id, jobId, attemptNo, workerId, startedAt, finishedAt?, outcome, errorCode?, durationMs? | unique `(jobId, attemptNo)` |
| OutboxEvent | id, topic, aggregateId, attemptNo, body JSON, status, availableAt, publishedAt?, lockToken?, lockedUntil?, retryCount | unique `(topic,aggregateId,attemptNo)` for dispatch events; index `(status,availableAt)` |
| DeadLetter | id, jobId, lastErrorCode, createdAt, replayedAt?, replayJobId? | unique `jobId` for each dead terminal attempt |
| JobEvent | id, jobId, eventType, details JSON, occurredAt, actorId? | indexed `(jobId,occurredAt)` |
| BusinessEffect | id, effectKey, jobId, kind, createdAt, result JSON | unique `(effectKey)` |
| BenchmarkRun | id, gitSha, workload, hostSpec JSON, config JSON, startedAt, endedAt, result JSON, artifactsPath | indexed on startedAt |

DB constraints must ensure `(tenantId, idempotencyKey)` dedupe. Prisma may need a hand-written migration for partial unique indexes or optimized locking operations. For claim/reaper/outbox polling, review use of safe parameterized SQL with `FOR UPDATE SKIP LOCKED` where Prisma's query builder is insufficient.

## State/status enums

`PENDING`, `QUEUED`, `RUNNING`, `RETRY_WAIT`, `COMPLETED`, `DEAD`, `CANCELLED`.

Priority values: `LOW`, `NORMAL`, `HIGH` (define comparable numeric mapping). Job types: `GENERATE_REPORT`, `SIMULATE_EMAIL`, `MOCK_WEBHOOK` only. Error categories: `TRANSIENT`, `PERMANENT`, `TIMEOUT`, `LEASE_EXPIRED`, `INTERNAL`.

Dispatch messages contain `{jobId, attemptNo}`, where `attemptNo` starts at 1. Outbox states are `PENDING`, `SENT`, and `SUPERSEDED` for obsolete rows. A pending row may have a temporary dispatch lease.

## Submission limits and demo handlers

Cap the complete submission body at 16 KiB of UTF-8 JSON. Require an integer `maxAttempts` from 1 to 5 and default to 3. Omitted `runAt` means immediately eligible. A supplied timestamp must be UTC and no more than 30 days in the future at submission. A valid timestamp in the past is immediately eligible. Reject unknown fields.

| Type | Payload | Demo effect |
|---|---|---|
| `GENERATE_REPORT` | `{reportId}` | Produce a report summary from fixed demo data |
| `SIMULATE_EMAIL` | `{templateId, recipientId}` | Record a delivery to a synthetic recipient in the effect ledger |
| `MOCK_WEBHOOK` | `{eventId}` | Record a mock delivery to the internal demo sink |

Identifiers are 1–64 ASCII letters, digits, underscores, or hyphens. Each job uses a stable effect key across attempts. An authorized replay creates a new job with a new effect key and links it to the original. Test fixtures select deterministic delays and outcomes by job and attempt. Public payloads carry no destination URLs, real addresses, or fault controls.

## Authentication strategy

Login takes the tenant slug and email because each tenant has its own email namespace. The API stores scrypt password hashes and SHA-256 digests of random session tokens. The cookie uses HttpOnly and SameSite=Strict, with Secure and a host-only prefix when `APP_ORIGIN` uses HTTPS. Mutations require an exact `Origin` match with `APP_ORIGIN`. Operator endpoints require tenant-scoped admin access. A supplied seed password is required.

## Endpoints

| Method/path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/v1/auth/login` | Public | tenant, email, password | 200 user and session cookie |
| `POST /api/v1/auth/logout` | Signed in | — | 204 |
| `GET /api/v1/me` | Signed in | — | user + role |
| `POST /api/v1/jobs` | Signed in | type,payload,priority?,runAt?,maxAttempts?; `Idempotency-Key` | 202 job object |
| `GET /api/v1/jobs` | Signed in | status?,type?,cursor?,limit? | paginated jobs |
| `GET /api/v1/jobs/:id` | Owner/admin | — | details + status |
| `GET /api/v1/jobs/:id/attempts` | Owner/admin | cursor?,limit? | paginated attempts |
| `GET /api/v1/jobs/:id/events` | Owner/admin | cursor?,limit? | paginated timeline |
| `POST /api/v1/jobs/:id/cancel` | Owner/admin | — | updated status or 409 |
| `GET /api/v1/admin/dlq` | Admin | cursor?,limit? | dead jobs |
| `POST /api/v1/admin/dlq/:id/replay` | Admin | reason | 202 new linked job |
| `GET /api/v1/admin/overview` | Admin | — | tenant counts by status, completions in the last minute, active worker count when available, sampled time |
| `GET /health/live` | Internal/controlled | — | 200 `{"status":"ok"}` |
| `GET /health/ready` | Internal/controlled | — | 200 if ready, 503 if unavailable, with dependency states |
| `GET /metrics` | Private scrape only | — | Prometheus format |

The host API binds to loopback by default. Health responses include `X-Request-Id` and `Cache-Control: no-store`. Readiness returns `{status, dependencies: {postgres, rabbitmq}}`, with each state set to `ok` or `unavailable`. An unset connection URL yields `unavailable` for that dependency. Liveness is independent of readiness. Unknown routes return 404 with `{error: {code, message, requestId}}`. The server generates the request ID.

List responses use `{items, nextCursor}` and sort newest first by timestamp, then ID. Limits range from 1 to 100 and default to 25. Keep the filters fixed when advancing a cursor. A null cursor signals the end.

### Sign-in example

```http
POST /api/v1/auth/login
Origin: http://127.0.0.1:5173
Content-Type: application/json

{"tenant":"demo","email":"operator@example.test","password":"<seed password>"}
```

### Create job example

```http
POST /api/v1/jobs
Origin: http://127.0.0.1:5173
Cookie: jobflow.sid=<session cookie value>
Idempotency-Key: example-create-123
Content-Type: application/json

{"type":"GENERATE_REPORT","payload":{"reportId":"demo-42"},"priority":"NORMAL","runAt":"2026-12-01T12:00:00Z","maxAttempts":4}
```

```json
{"id":"<uuid>","status":"PENDING","type":"GENERATE_REPORT","attemptNumber":0,"createdAt":"<UTC timestamp>"}
```

Use numeric HTTP statuses: invalid request 400/422, oversized body 413, unauthenticated 401, forbidden 403, missing 404, idempotency-key conflict 409, backpressure 429/503.

## Socket.IO event contract

Room: `tenant:<authorized-tenant-id>` after server-validated session. Event `job:updated` `{jobId,status,attemptNumber,updatedAt}`; event `queue:summary` `{queued,running,retryWait,dead,completed,at}`. Events do not replace REST; on reconnect refresh lists/details.

Cancellation is a conditional PostgreSQL transition from `PENDING`, `QUEUED`, or `RETRY_WAIT`. A racing worker claim wins if the job has already moved to `RUNNING`. Replay accepts a reason of 1–200 characters, creates one child job for a tenant admin, and returns 409 if that dead letter was replayed already.

## Important indices

`jobs (status, next_run_at)`, `jobs (tenant_id, created_at DESC, id DESC)`, `attempts (job_id, attempt_no)`, `outbox (status, available_at)`, `job_events (job_id, occurred_at)`; verify using `EXPLAIN ANALYZE` before claiming performance wins.
