# Phase 06 — Prometheus, Grafana & structured logs

**Status:** Verified with native Prometheus, Grafana, PostgreSQL, and RabbitMQ. Compose runtime verification is tracked in Phase 01.

## Goal

Instrument work so all future resume numbers come from recordings.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Integrate prom-client per API/worker/dispatcher/scheduler process; register process CPU/memory metrics.
2. Add completion, attempt, retry counters, execution/e2e/queue-wait histograms, queue/DLQ/worker/outbox gauges.
3. Configure private Prometheus scrape targets for all processes and Grafana datasource.
4. Create dashboard panels and verify against known deterministic runs; annotate failure-injection and deploy events.
5. Add structured request/job correlation logs with sensitive-value redaction; explicit trace of job state transitions.
6. Document histogram bucket choices, success denominators, missing data, and metric-label cardinality limits.
7. Show UI summary from a safe API endpoint, not public Prometheus server.

## Exit criteria — must demonstrate

- [x] Prometheus scraped the API, dispatcher, worker, and scheduler metrics endpoints.
- [x] The completed counter change matched independent PostgreSQL counts. The provisioned Grafana datasource returned a positive completion rate.
- [x] Grafana queried separate p95 execution and end-to-end series using their respective histograms.
- [x] The worker kill and recovery suite verified the retry and lease-expiration counters.
- [x] Application metric label tests exclude job IDs, email addresses, tenant IDs, and user IDs.

## Deliverables

- Version-controlled Grafana dashboards, Prometheus config, metrics contract and example screenshots.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
