# Metrics, Test Protocol, and Resume-Grade Evidence

## Non-negotiable rule

Use the recorded workload, hardware, window, and denominators when citing measured performance. The fixed-rate native worker comparison is available with its per-run data. [Native benchmark report](../benchmarks/results/2026-11-20-native-mixed/REPORT.md)

## Metric definitions

| Metric | Definition / method | Unit |
|---|---|---|
| Throughput | Unique jobs transitioning to COMPLETED during observation window / elapsed seconds | jobs/s |
| p50/p95/p99 execution latency | Database claim → committed attempt outcome, histogram, excluding queue wait | ms |
| p50/p95/p99 end-to-end latency | API accepted → terminal state; only for terminal jobs | ms |
| p95 queue wait | `startedAt - eligibleAt` for actually started attempts | ms |
| Terminal success rate | completed unique jobs / (completed + DEAD unique jobs) within settled test cohort | % |
| Attempt failure rate | failed attempts / total completed attempts | % |
| Retry rate | jobs with at least one retry / unique accepted jobs | % |
| Recovery detection | crash/expired lease → scheduler detection | seconds |
| Recovery completion | injected failure → interrupted job eventually reaches terminal state | seconds |
| Duplicate committed effects | Count of effect records violating expected uniqueness; should be 0 in tested scenarios | count |
| Queue depth / DLQ | authoritative DB counts by state; reconcile RabbitMQ reported depth as separate metric | jobs |
| Worker RSS/CPU | per-worker resource usage under controlled load | MB / % |

## Recommended Prometheus instruments

- Counter `job_attempts_total{job_type,outcome}`.
- Counter `jobs_terminal_total{job_type,status}`.
- Counter `job_retries_total{job_type,reason}`.
- Counter `worker_lease_expirations_total{job_type}`.
- Histogram `job_execution_duration_seconds{job_type,outcome}`.
- Histogram `job_end_to_end_duration_seconds{job_type,status}`.
- Histogram `job_queue_wait_seconds{job_type}`.
- Gauge `job_state_count{status}` (generated periodically from DB).
- Gauge `worker_active_jobs{worker_group}`.
- Gauge `outbox_pending_count`.

No `jobId`, `tenantId`, email, request UUID or high-cardinality labels. Use distinct scrape targets per worker and aggregate; never aggregate histograms via averaging p95 values. Histograms need bucket ranges matching observed workload.

The initial buckets are 25, 50, 100, 250, and 500 ms, then 1, 2, 5, 10, 30, 60, and 300 seconds. Attempt execution and end-to-end histograms share boundaries but have different start events. The execution panel shows successful attempts. The terminal success denominator includes completed and dead jobs. The attempt failure denominator includes successful and failed attempts. Process counters can miss the interval between a committed job and a crash, so use PostgreSQL to reconcile benchmark cohorts. Failed database scrapes set `jobflow_ledger_metrics_up` to zero and leave outbox values unknown.

Example PromQL (job completions per second):

```promql
sum(rate(jobs_terminal_total{status="COMPLETED"}[5m]))
```

Example p95 execution seconds:

```promql
histogram_quantile(0.95, sum by (le) (rate(job_execution_duration_seconds_bucket[5m])))
```

## Benchmark methodology (Phase 07)

1. Freeze commit SHA, container image digests, versions, test scripts, host CPU/RAM/architecture, OS, disk, storage, network, resource limits.
2. Use **deterministic workloads** with 3 job profiles: simulated I/O (known delay), compute (bounded fixed work), and mixed. Avoid external APIs and uncontrolled network calls.
3. Warm up for a fixed interval; distinguish warmup from measured window. Drain backlog at end or report remaining jobs explicitly.
4. For scaling, fix workload + hardware + API publisher settings; vary workers 1/2/4/8 without oversubscribing CPU silently.
5. Repeat each condition at least 3 times; report median and spread (range/IQR). No cherry-picking best run.
6. Verify output correctness: accepted == completed + DEAD + cancelled + remaining, and no duplicate committed effects.
7. Compare both throughput and latency; benchmark can reveal saturation/regression.
8. Save raw CSV/JSON, k6 summary, Prometheus/Grafana screenshots, sample logs, git SHA, and report. Do not commit secrets, raw PII or credentials.
9. Isolate cloud load testing; obtain service consent; don't generate abusive traffic or unintended AWS spend.

### Run on an isolated host

Use a clean Git checkout and an isolated benchmark tenant with seeded credentials. Install k6 and generate the Prisma client. Set `BENCHMARK_ISOLATED=1`, `BENCHMARK_TENANT`, `BENCHMARK_EMAIL`, `BENCHMARK_PASSWORD`, and `DATABASE_URL` in the benchmark host's environment. Configure the API write limit above the expected submissions per minute. Keep the deployed demo's normal write limit.

- **Native** — Run PostgreSQL, RabbitMQ, the API, dispatcher, scheduler, and Prometheus on loopback. Start the run with `BENCHMARK_RUNTIME=native`, the documented `BENCHMARK_RABBITMQ_VERSION`, and `AMQP_URL`. Set `BENCHMARK_BASE_URL` to the API or same-origin proxy URL and match it in `APP_ORIGIN`. Leave worker startup to the benchmark runner. Add a Prometheus worker scrape job using `file_sd_configs` and the absolute path to `benchmarks/results/local/native-worker-targets.json`.
- **Compose** — Start an isolated Compose project named `jobflow-bench` with the `observability` profile. Set `BENCHMARK_COMPOSE_PROJECT` if you use a suffixed project name. Use the project's loopback web URL as `BENCHMARK_BASE_URL`.

Run `npm run test:load`. Defaults are 1, 2, 4, and 8 workers, three repetitions, a 15-second warmup, then a 60-second measured run. Use `BENCHMARK_WORKERS`, `BENCHMARK_REPETITIONS`, `BENCHMARK_RATE`, `BENCHMARK_DURATION`, and `BENCHMARK_WORKLOAD` to select a comparable workload. The workload choices are `report`, `io`, and `mixed`. Keep configuration fixed when comparing worker counts.

The runner exports HTTP latency, PostgreSQL job and effect reconciliation, Prometheus CPU and memory samples, and a worker-count summary under `benchmarks/results/local/`. It records elapsed wall time from the k6 invocation start through completion and counts database terminal timestamps within that window. Review the resulting observation windows, host limits, and failure checks before filling in the benchmark report. The functional smoke runs are independent of load measurement. [k6 arrival-rate model](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/)

## Required scenarios

| ID | Scenario | Variable | Pass condition |
|---|---|---|---|
| B01 | Single-worker baseline | 1 worker, stable job payload | Correct outcomes, recorded metrics |
| B02 | Scaling | 1,2,4,8 workers | Throughput/saturation curve documented |
| B03 | Bursty arrival | bursts vs fixed service rate | No silent loss, queue depth observable |
| B04 | Retry injection | controlled transient failure fraction | correct attempts/backoff and final status |
| B05 | Kill running worker | SIGKILL mid-task | expired lease recovered; no duplicate committed effect |
| B06 | Duplicate messages | publish same ID multiple times | one durable effect, valid state |
| B07 | RabbitMQ restart | interrupt dispatcher/queue | accepted DB jobs eventually processed |
| B08 | Database outage | temporary DB unavailability | no false success; recovery documented |

## Resume claims: what evidence they require

- "Processed X jobs/s": attach B01/B02 run logs, workload, duration, host spec; specify sustained vs peak.
- "Scaled Y× with N workers": ratio from comparable B01/B02 measurements on same host + workload; disclose hardware saturation.
- "p95 latency Z ms": specify execution **or** end-to-end, cohort/window and method.
- "Recovered in R seconds": measured repeated B05 runs, specify median/p95 and failure injection.
- "No duplicate side effects": test-specific claim with B06 counts; do not infer universal exactly-once delivery.

## Grafana panels

Jobs/s, p95 execution and e2e, terminal success rate, queue wait, states over time, DLQ count, retries/min, active workers, outbox lag, process CPU/RSS; mark deploy and failure-injection events on timeline.
