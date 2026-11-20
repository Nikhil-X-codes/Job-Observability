# Phase 04 — Scheduling, retries, DLQ & crash recovery

**Status:** Recovery and operator checks passed in native fixtures, including real service outages. The separate Compose runtime gate is tracked in Phase 01.

## Goal

Demonstrate reliability features with deterministic fault injection.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Implement due-job scheduler; use DB row locking and bounded batches, not setTimeout-based durable delays.
2. Implement `RETRY_WAIT` and capped exponential backoff with jitter; distinguish transient/permanent errors.
3. Add expired-lease reaper and fencing; recover stale RUNNING jobs safely.
4. Add durable `DeadLetter` record, admin listing and audited replay as a new linked job.
5. Add best-effort cancellation for non-running jobs; document race semantics.
6. Add heartbeat and liveness for workers; poison-message safeguards and retry circuit limits.
7. Run fault matrix: kill worker mid-job, stale lease completion, broker outage, DB outage, duplicate messages, retry exhaustion.

## Exit criteria — must demonstrate

- [x] Delayed job remains pending through its verified database `runAt` boundary check.
- [x] Retry count and capped backoff match contract. Final failure appears in DLQ.
- [x] Worker kill recovers the running job with one durable demo effect.
- [x] Stale worker cannot overwrite job state after a new lease owns it.
- [x] Retry, expiry, replay, and terminal failure outcomes appeared in the verified history and audit checks.

## Deliverables

- Scheduler, reaper, retry/DLQ/replay API, state-machine and fault-injection tests.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
