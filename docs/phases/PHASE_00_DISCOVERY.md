# Phase 00 — Discovery & scope

**Status:** Discovery baseline reviewed. See the tracker for evidence.

## Goal

Establish exact problem, acceptance criteria, repository structure, architectural decisions, and non-goals.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Read PRD, Architecture, AGENTS and ADR log; identify all P0 user stories.
2. Choose deterministic demo handlers and cap job payload/attempts.
3. Define core domain and delivery semantics (DB transaction + outbox → broker → worker ACK).
4. Document failure cases and no exactly-once-execution guarantee.
5. Decide local baseline and cloud budget constraints; **do not provision AWS yet**.
6. Create issues for each phase and define demo script.

## Exit criteria — must demonstrate

- [x] Architecture and job state diagram reviewed against API contracts.
- [x] All P0 requirements have clear acceptance tests.
- [x] Security threat model and explicit non-goals documented.
- [x] Decisions and assumptions recorded for local implementation.

## Implementation backlog

These are issue drafts kept in the workspace until a repository destination exists. Each phase depends on the preceding phase.

| Issue | Scope | Acceptance check |
|---|---|---|
| 01 Foundation | Workspaces, local Compose, health, CI | Boot on a fresh checkout, run lint, format, unit tests and frontend build, then take each dependency offline and verify readiness returns 503 while liveness stays 200 |
| 02 API and data | Sign-in, API submission and validation, listing and history | Sign in as a demo admin and submit each allowlisted type. Reject malformed jobs and cross-tenant reads. Submit the same key concurrently and assert one job and one outbox row, then change the payload and expect 409. Force a rollback and verify neither row exists. Walk filtered cursor pages and inspect attempts and events without duplicates or leakage |
| 03 Queue and workers | Dispatch, two workers, durable effects | Run two independent workers. Deliver before confirm is recorded, kill the dispatcher after confirm, and deliver duplicates. Verify no accepted job is stranded, competing claims never both succeed, and redelivery after DB commit produces one durable effect |
| 04 Reliability | Delays, priority, retries, lease recovery, operator replay | Assert no claim before the due timestamp using the DB clock. Exercise each priority tier and record observed ordering. Inject transient failures through the cap and a permanent failure on attempt one. Kill a worker and verify lease recovery, stale token fencing and stale-attempt ACK. Replay as an admin and verify the new job, new effect key, unchanged original and audit linkage |
| 05 Dashboard | Login, submission, history and Socket.IO | Sign in, submit through the UI and inspect live updates. Disconnect the socket while state changes, then reconnect and verify state matches REST |
| 06 Observability | Structured logs and Grafana dashboard | Exercise successful, retrying and terminal jobs. Reconcile dashboard counts with the database and verify attempt failure and final success are reported separately |
| 07 Benchmarks | Isolated load and recovery scenarios, evidence export | Run the versioned workload and export git SHA, host, run settings, repetitions and artifacts. Recalculate published summaries from the artifacts |
| 08 AWS release | Budget-approved EC2 deployment and runbook | After budget approval, verify HTTPS access, private dependency ports, and restore from the documented backup procedure |
| 09 Portfolio | Demo walkthrough and evidence | Follow the demo from a clean setup and trace every published measurement to its benchmark report |

## Demo walkthrough

1. Start the local stack and sign in as the seeded admin.
2. Submit a report job with an idempotency key. Submit it again and show the original ID.
3. Schedule a simulated email. Open its timeline and observe the state change once it is due.
4. Run the deterministic failure scenario. Show the attempts, DLQ entry and the new job created by replay.
5. Reconnect the dashboard during processing, check the reconciled state, and show the metrics and exported benchmark evidence.

Local development uses Docker Compose. The EC2 account, region and monthly spending limit are deployment gates and can be decided in Phase 08.

## Deliverables

- `README.md`, PRD, architecture, ADRs and tracker updated.
- Issue backlog with dependencies, tests, and rough scope.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
