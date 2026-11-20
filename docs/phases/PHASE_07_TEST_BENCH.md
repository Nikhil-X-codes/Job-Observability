# Phase 07 — Performance, scale & failure benchmarks

**Status:** The isolated native fixed-rate baseline, capacity sweep, burst comparison, and five worker-crash timings are complete. The capacity and burst report includes 22 comparable trials, two overload diagnostics, and the raw measurement summaries. [Capacity report](../../benchmarks/results/2026-11-20-native-capacity/REPORT.md) · [Fixed-rate baseline](../../benchmarks/results/2026-11-20-native-mixed/REPORT.md)

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

- [x] Each published metric has a script, traceable raw data and method.
- [x] Results mention hardware, versions, SHA, dataset, workers, window, repetitions.
- [x] The measured cohorts reconcile and report completions during the window and after drain separately.
- [x] Worker counts were compared using the same host, workload and settings.
- [x] README and resume figures link to the measured profile.

The rate sweep covers 15, 40, and 70 offered jobs/s, and the burst comparison peaks at 55 jobs/s. The four-worker 70 jobs/s condition retained one comparable trial and two generator-limited diagnostics. The five timed crash trials exercise actual worker exits and scheduler recovery. Broker restart and PostgreSQL outage retain functional coverage.

## Deliverables

- k6 suite, runner, raw/sanitized outputs, charts and peer-reproducible report.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
