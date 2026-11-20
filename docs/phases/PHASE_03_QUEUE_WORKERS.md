# Phase 03 — Dispatcher, RabbitMQ & concurrent workers

**Status:** Exit checks verified with native PostgreSQL and RabbitMQ. Container startup and broker restart checks are tracked separately.

## Goal

Move accepted jobs to concurrent workers without silent loss.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Configure durable RabbitMQ quorum queue, persistent messages, confirm publisher, manual ACK and bounded prefetch.
2. Implement outbox dispatcher with DB claim/lease of batch, publish confirm and retry/backoff; repeated publish must be safe.
3. Implement worker consumer, atomic DB claim with leaseToken/leaseExpiresAt, per-attempt record and state transition.
4. Implement 3 deterministic handlers: report generator, simulated email sink (DB effect ledger), mock webhook.
5. Conditional finalize by matching lease token; commit DB changes before ACK.
6. Implement worker heartbeat/lease extension and graceful shutdown; isolate handler timeouts.
7. Test competing workers, broker restart, duplicate delivery and crash after DB finalize/before ACK.

## Exit criteria — must demonstrate

- [x] Multiple independent workers concurrently process different jobs.
- [x] Duplicate publish/delivery never creates duplicate committed effects.
- [x] Dispatcher restart does not strand accepted jobs.
- [x] Stale broker messages are safely ACKed after DB verification.
- [x] Worker ACK happens only after corresponding durable DB commit.

## Deliverables

- Functional dispatcher, workers, handlers, broker integration tests and documented ACK semantics.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
