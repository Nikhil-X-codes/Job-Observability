# Phase 07 — Performance, scale & failure benchmarks

**Status:** Native and Compose runners implemented. k6 scenario inspection and reconciliation tests cover the harness. Isolated measurement runs remain open.

## Goal

Generate reproducible evidence for performance and reliability claims.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Create k6 load scripts that submit controlled jobs and capture API response latency separately from job completion.
2. Create scripts to query completed job counters from DB/Prometheus; reconcile pending and terminal totals.
3. Define stable workload, fixed host settings, fixed test window, warmup, resource limits and run IDs.
4. Run baselines at 1,2,4,8 workers (as host supports) and 3+ repetitions each; record medians and spread.
5. Inject a killed worker, duplicate delivery, transient handler failures, RabbitMQ restart; measure recovery/dedupe.
6. Record CPU, memory, queue lag, p50/p95/p99, throughput, success, retries, DLQ, side-effect duplicates.
7. Generate benchmark report from template, commit sanitized artifacts and explain bottlenecks/limitations.

## Exit criteria — must demonstrate

- [ ] Each reported metric has a script, traceable raw data and method.
- [ ] Results mention hardware, versions, SHA, dataset, workers, window, repetitions.
- [ ] Invariants hold for each scenario; no hidden backlog excluded from throughput story.
- [ ] Scaling speedup compared using same host/workload, not apples-to-oranges.
- [ ] No unsourced numbers entered in README or resume template.

## Deliverables

- k6 suite, runner, raw/sanitized outputs, charts and peer-reproducible report.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
