# Product Requirements Document (PRD)

## Problem

Web applications need background tasks that continue despite slow APIs, transient failures, and worker crashes. JobFlow offers a demo-quality but correctness-oriented platform to submit tasks, schedule execution, monitor workers, and recover failures. It is built primarily to demonstrate real SWE skills rather than to run untrusted third-party workloads.

## Personas

1. **Operator:** track queue health, retry failed jobs, inspect errors.
2. **Developer:** submit jobs by API, select known job type and priority, inspect outcomes.
3. **Recruiter/interviewer:** open live UI, examine system architecture, reproduce measurements.

## MVP user stories (priority P0)

- Sign in as demo admin; create a job through API or dashboard; validate payload.
- Create jobs with idempotency key; a duplicate request returns the original job, not a second submission.
- List, filter, paginate and inspect jobs, attempts, and audit history.
- Dispatch persisted jobs to RabbitMQ and execute them using at least two worker processes.
- Handle delayed `runAt` timestamps and priority classes (low/normal/high) with documented queue limitations.
- Retry retryable failures with capped exponential backoff plus jitter; permanent failures go to DEAD/DLQ.
- Recover abandoned running jobs after lease expiry and make retries safe with fenced DB writes.
- Replay a DEAD job via explicit operator action (new run, traceable to original; idempotency semantics documented).
- View live status and metrics dashboards; reconnect pulls canonical REST state.
- Export/snapshot load-test evidence and environment metadata.

## P1 stretch goals

Job cancellation for queued jobs (best-effort running cancellation), job dependencies, webhook authentication, multi-tenant self-service, alerts on lag/DLQ, hardened blue-green deploy. P1 starts only after P0 is stable.

## Nonfunctional requirements

- **Durability:** accepting a job means DB commit succeeded, never just publish attempt.
- **Delivery:** at least once; duplicate messages must not cause unintended duplicate effects.
- **Consistency:** job state transitions ACID, broker/eventual dashboard propagation.
- **Security:** scoped access, request validation, role-based operator actions, safe handlers.
- **Reliability:** terminal failure observable; bounded retries; recover from worker crash.
- **Operability:** clear alerts, structured logs, dashboards, deployment runbook.
- **Performance:** record throughput/latency; no unjustified performance target before measurement.
- **Cost:** local Docker default; cloud deployment only after budget/eligibility validation.

## Success criteria

- Jobs survive API/worker restarts; no silently lost accepted jobs under defined crash tests.
- Competing workers never both **commit authoritative completion** for the same lease; any external effects are idempotently guarded.
- At least three deterministic handler types with simulated varying job durations/failures.
- Automated tests cover double-submit, concurrent claims, restart, lease recovery, retry and DLQ.
- UI, API, broker, database and observability stack run locally; public HTTPS AWS demo is optional until spending approved.
- Benchmark table includes hardware, git SHA, dataset, worker counts, repetitions, raw artifacts and derived metrics.

The [Phase 00 backlog](phases/PHASE_00_DISCOVERY.md#implementation-backlog) maps each P0 story to an acceptance check. The [submission contract](DATA_AND_API_CONTRACTS.md#submission-limits-and-demo-handlers) defines the demo handlers and limits.

## Explicit exclusions

No arbitrary script execution; no customer PII; no real email providers/payment providers required; no claims of exactly-once executions; no financial transfers; no promise of zero downtime during a single-VM crash.
