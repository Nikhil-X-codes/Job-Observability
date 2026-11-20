# Security, Testing, and Quality Gates

## Threat model highlights

- **Auth bypass / cross-tenant access:** server-side tenant scoping, admin RBAC, negative integration tests.
- **Arbitrary job execution:** fixed handler registry, strict Zod payload schema, no code execution or unrestricted URLs.
- **Excessive workloads:** payload caps, per-tenant submission rate limits, max concurrent work, worker timeouts, bounded queue and disk quotas.
- **Sensitive logging:** redact auth tokens, passwords, payload secrets, headers; avoid PII in telemetry labels.
- **Message forgery:** broker credentials scoped per service; DB checks are authoritative; no trust in message body alone.
- **Session theft / CSRF:** secure cookies, HTTPS, SameSite + CSRF defense, origin checks, password hashing, login throttling.
- **Public infrastructure:** 443 only, restrict SSH and admin tooling; rotate secrets, monitor dependencies.
- **DoS through retries:** bounded backoff with jitter, DLQ, capacity quotas, circuit-breaking for mock integrations.

## CI quality gates

1. Formatting/lint; dependency audit (review false positives rather than bypass).
2. Unit tests for state transitions, delay calculation, validation, selectors.
3. API integration tests: auth, tenant separation, idempotency conflict, pagination and error codes.
4. Broker/DB tests: confirms, outbox recovery, queue delivery and ACK ordering.
5. Failure tests: worker SIGKILL, duplicate delivery, stale lease, broker down, DB down.
6. UI smoke: create job, inspect timeline, watch realtime updates, reconnect and refresh.
7. Build images and run minimal Compose smoke in CI when resources permit.

## Required invariant tests

- **No lost acceptance:** accepted request has committed job/outbox row.
- **Idempotency:** same key + same body gets same job; same key + different body returns 409.
- **Claim exclusivity:** competing workers cannot both acquire current lease in DB.
- **Fence:** stale lease token cannot transition job or commit authoritative outcome.
- **Dedupe:** duplicate broker messages cannot create duplicate `BusinessEffect` for same effectKey.
- **Recovery:** expired claims become eligible and eventually settle.
- **Retry cap:** `maxAttempts` is enforced and DEAD state reaches DLQ.
- **Replay audit:** replay links original job, cannot mutate original history.
- **Tenant isolation:** cannot read/replay other tenant's jobs.

## Test environments

Unit tests may use mocks, but concurrency, transaction isolation, migration and broker failure claims require actual Postgres and RabbitMQ. Prefer disposable Compose/Testcontainers DBs. Do not assert correctness based only on in-memory mock queues.

## Docs and code review

Every PR must state what changed, why, tests run, migration impact, new metrics, screenshots for UI, and whether performance claims need new measurements. Never post example secrets in GitHub.
