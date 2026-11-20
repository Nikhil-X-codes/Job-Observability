# JobFlow Project Tracker

**Status:** Native application, outage recovery, Grafana, and the worker-scaling benchmark are verified. Live Compose, hosted CI, publication, and AWS release have separate gates.

| Phase | State | Evidence (PR, test log, screenshots, URL) | Blocker |
|---|---|---|---|
| 00 Discovery | DONE | [Acceptance checks and demo](docs/phases/PHASE_00_DISCOVERY.md), [ADR-006](docs/reference/ADR_LOG.md#adr-006--commit-dispatch-eligibility-before-publishing) | — |
| 01 Foundation | IN PROGRESS | API tests, production web build, Vite HTTP smoke, and offline Compose config validation passed | Live Compose and hosted CI verification pending |
| 02 API & Data | DONE | Migration applied, 5 live PostgreSQL API integration tests passed, and demo seed ran twice | — |
| 03 Queue & Workers | DONE | Two native workers processed jobs. Pre-ACK redelivery and dispatch recovery preserved one effect | Compose run tracked in Phase 01 |
| 04 Reliability | DONE | Native worker kill/recovery, broker restart, database outage recovery, 5 PostgreSQL failure tests and 7 API tests passed | Compose runtime tracked in Phase 01 |
| 05 Dashboard | DONE | [Chrome smoke](tests/ui/smoke.mjs) and [dashboard screenshot](docs/assets/jobflow-overview.png) | — |
| 06 Observability | DONE | Native Prometheus scraped four processes and matched PostgreSQL completion counts. Grafana returned live rate and p95 queries. [Rendered dashboard](docs/assets/jobflow-grafana.png) | Compose runtime tracked in Phase 01 |
| 07 Benchmarks | DONE | 12 measured runs at 1, 2, 4, and 8 workers. All 5,410 accepted jobs completed after drain. [Report and per-run data](benchmarks/results/2026-11-20-native-mixed/REPORT.md) | Fixed-rate scaling evidence. Saturation and repeated fault-timing measurements remain open |
| 08 AWS Release | DEFERRED | Offline production Compose verification exposed only web ports 80 and 443 | Final release stage, account, region, and budget |
| 09 Portfolio | IN PROGRESS | Verified 2:17 [operator walkthrough](docs/assets/jobflow-demo.webm), screenshots, and [measured benchmark evidence](benchmarks/results/2026-11-20-native-mixed/REPORT.md) | Publication to the selected GitHub repository remains pending |

## Decisions

- App code is **JavaScript (ESM)**.
- **PostgreSQL** is system of record, **RabbitMQ** is message transport.
- **AWS EC2 + Docker Compose** is first cloud target; production-grade multi-node HA is out of scope.
- Performance figures apply to the versioned native workload in the benchmark ledger. Time-to-recovery and uptime claims are pending.

## Benchmark ledger

| Date | Git SHA | Workload | Workers | Duration | Throughput | p95 end-to-end | Recovery | Report |
|---|---|---|---|---|---|---|---|---|
| 2026-11-20 | `fd07243` | Mixed, 15 submissions/s | 1, 2, 4, 8 | 15s warmup + 30s measured, 3 repetitions each | Median 14.40–14.58 completed jobs/s | Median of run p95s 864–1,013 ms | Functional coverage only | [Native report](benchmarks/results/2026-11-20-native-mixed/REPORT.md) |

## Open decision log

- [x] Publication destination selected. [GitHub repository](https://github.com/Nikhil-X-codes/Job-Observability)
- [ ] AWS account plan/region and hard monthly budget (required before deployment)
- [ ] Public domain for HTTPS (or an approved alternative)
- [x] Exact Node, RabbitMQ, PostgreSQL, and Caddy image tags are pinned in [the Dockerfile](infra/Dockerfile) and [Compose configuration](infra/compose.yaml)

## Foundation follow-up — 2026-11-20

- **Phase** — Phase 01.
- **Objective** — Boot development services together and detect dependency outages.
- **Changes made** — Added PostgreSQL and AMQP readiness probes that share concurrent requests, the React/Vite status screen, local Compose with named volumes and loopback ports, and the GitHub Actions quality pipeline. Added an isolated Compose smoke script that checks startup, each dependency outage, and recovery.
- **Commands and results** — `npm run lint`, `npm run format:check`, `npm run test:unit` (18 tests in 3 suites), and `npm run build` exited 0. A live Vite HTTP smoke confirmed the page and verified readiness 503 and liveness 200 through the same-origin proxy. A TCP test verified stalled dependency connections close. `npm run test:integration` exited 1 at Docker startup because `docker` was absent from PATH.
- **Acceptance evidence** — API and web workspace checks passed on Windows. GitHub-hosted CI and the live Compose start and outage tests remain unverified. This directory has no Git SHA.
- **Open issues / risks** — Windows had no preinstalled Docker executable or WSL Linux distribution when checked.
- **Next smallest step** — Run the Compose integration checks with a working Docker daemon, then verify the database and job submission slice against PostgreSQL.
- **Relevant paths** — [Compose](infra/compose.yaml), [readiness probes](apps/api/src/readiness.js), [web status screen](apps/web/src/main.jsx), [CI](.github/workflows/ci.yml), and [integration script](scripts/verify-compose.mjs).

## API and data handoff — 2026-11-20

- **Phase** — Phase 02.
- **Objective** — Submit and read durable, tenant-scoped jobs.
- **Changes made** — Added the Prisma schema and migration, scrypt and database-backed cookie sessions, exact-origin validation, throttling, cursor pagination, and a development seed. Job creation commits the job, first outbox intent, and audit event in one transaction.
- **Commands and results** — Prisma generate, validate, and migrate deploy exited 0. In a disposable native PostgreSQL fixture, all 5 Supertest integration tests passed and the seed exited 0 twice. At this phase boundary, 26 unit tests, lint, formatting, and the production web build passed. npm audit exited 0 after applying a scoped override for Prisma CLI's transitive Effect advisory. [Effect advisory](https://github.com/advisories/GHSA-7589-6fvf-x4pw)
- **Acceptance evidence** — Tested concurrent duplicate submissions, conflict, forced outbox rollback, tenant isolation, origin checking, logout, payload limits, and equal-timestamp pagination against PostgreSQL.
- **Open issues / risks** — Docker Desktop was installed per-user. Starting it was declined, so live Compose and hosted CI remain unverified. The native database was isolated from any application database.
- **Relevant paths** — [Prisma schema](packages/db/prisma/schema.prisma), [migration](packages/db/prisma/migrations/20261120000000_initial/migration.sql), [REST routes](apps/api/src/v1.js), and [API tests](tests/integration/jobs.test.js).

## Queue and worker handoff — 2026-11-20

- **Phase** — Phase 03.
- **Objective** — Deliver confirmed broker messages to independent workers and ACK after durable completion.
- **Changes made** — Added the leased outbox dispatcher, durable quorum queue, bounded worker prefetch, fenced attempt and effect writes, heartbeat, and three deterministic handlers.
- **Commands and results** — Lint, formatting, and 29 unit tests passed. In native PostgreSQL and RabbitMQ fixtures, the broker test passed, including two worker processes and real redelivery after closing the connection before ACK. A subsequent PostgreSQL run with the server set to Asia/Kolkata passed 4 processing failure tests and 5 API integration tests.
- **Acceptance evidence** — One fixture message was delivered while its outbox row still held an unrecorded publish lease. The job committed one effect, redelivery was ACKed as stale, and a dispatcher retired the obsolete outbox entry and processed the pending backlog.
- **Open issues / risks** — The first scheduling test detected an incorrect database timestamp offset. New Prisma pool connections now set the PostgreSQL session time zone to UTC. Regression coverage verifies the stored epoch and checks that a future job stays pending. Native checks do not provide container or hosted CI evidence.
- **Relevant paths** — [Dispatcher](services/dispatcher/src/main.js), [worker](services/worker/src/main.js), [processing transactions](packages/db/src/processing.js), [broker integration](tests/broker/delivery.test.js), and [PostgreSQL failure tests](tests/failure/processing.test.js).

## Reliability and dashboard handoff — 2026-11-20

- **Phase** — Phases 04 and 05.
- **Changes made** — Added retry scheduling, expired-lease recovery, cancellation and single-replay operations. Added the React jobs dashboard, accessible forms, cursor paging, job history, DLQ replay, and tenant-scoped Socket.IO notifications.
- **Commands and results** — A native PostgreSQL and RabbitMQ run passed 3 broker tests, 5 PostgreSQL failure tests, and 7 API integration tests. The Chrome smoke with the same services passed login, pending and queued job states, completed state and started history, DLQ replay, offline/reconnect reconciliation, and mobile viewport checks. These functional runs do not report benchmark results.
- **Open issues / risks** — The local Docker engine was unavailable for live Compose outage verification. Grafana measurements and a hosted release remain open.
- **Relevant paths** — [Scheduler](services/scheduler/src/main.js), [operator transactions](apps/api/src/operators.js), [dashboard smoke](tests/ui/smoke.mjs), and [overview screenshot](docs/assets/jobflow-overview.png).

## Native verification follow-up — 2026-11-20

- **Phase** — Phases 01, 04, and 06–09.
- **Commands and results** — Native outage verification passed. Jobs submitted while RabbitMQ was down completed after restart. With PostgreSQL down, liveness stayed at 200, readiness returned 503, and the API rejected submission. A new submission succeeded after recovery. Promtool validated the checked-in scrape config and the offline Compose model inspection confirmed only ports 80 and 443 were published by the production web service.
- **Benchmark evidence** — k6 inspected the scenario successfully. A native fixture verified worker setup at one and two workers and removal of the scrape targets after shutdown. That verification submitted zero jobs. The benchmark ledger remains empty.
- **Monitoring evidence** — `node tests/native/observability.mjs` passed with isolated native services. The test reconciled the Prometheus completion counter against PostgreSQL and queried the provisioned Grafana dashboard's live datasource, including execution and end-to-end histograms.
- **Release evidence** — AWS is deferred until the final stage. Live Compose and hosted CI gates remain open.
- **Portfolio evidence** — Playwright recorded the local sign-in, pending and queued states, completion, replay, and reconnect flow. The browser smoke also passed the mobile layout check after a dashboard grid resize fix. Lint, formatting, the production web build, and 34 unit tests passed. npm audit reported zero vulnerabilities.

## Reserved benchmark handoff — 2026-11-20

- **Phase** — Phases 01, 07, and 09.
- **Objective** — Collect a comparable worker-scaling baseline and package evidence locally before publication.
- **Changes made** — Added a bounded Windows sharing-violation retry to the native scrape-target update, kept the change atomic, and saved a reproducible source commit. The first attempt stopped at the worker transition because the Prometheus target file was briefly open. Only the complete rerun is used in the report.
- **Commands and results** — `npm run lint`, `npm run format:check`, and `npm run test:unit` (34 tests) passed before the measured run. The reserved native fixture ran `scripts/run-benchmark.mjs` at commit `fd07243022952964c3d20055df66778754c9a8ef` and exited 0. All 12 measured cohorts passed k6 admission thresholds and PostgreSQL reconciliation.
- **Acceptance evidence** — All 5,410 jobs completed after drain and 5,185 completed within the throughput windows. PostgreSQL found zero duplicate or missing effects and zero unfinished jobs. The report records the host, workload, windows, retries, latencies, and per-run Prometheus samples. [Benchmark report](benchmarks/results/2026-11-20-native-mixed/REPORT.md)
- **Portfolio verification** — `node tests/ui/smoke.mjs` in recording mode exited 0 with fresh native PostgreSQL and RabbitMQ services. The browser showed a real worker claim, forced exit, retry and completion. The test asserted one database effect and exercised linked replay, reconnect, and mobile layout. Extracted frames confirmed the retry history and Grafana ending in the 2:17 WebM. [Operator walkthrough](docs/assets/jobflow-demo.webm)
- **Open issues and risks** — Saturation and recovery timing require separate studies. The GitHub target is public and had no commits at verification. Live Compose, hosted CI, and AWS remain pending.

## Session handoff — 2026-11-20

- **Phase** — Phase 00 and the first slice of Phase 01.
- **Objective** — Establish a testable MVP baseline and run the local API bootstrap.
- **Changes made** — Wrote the Phase 00 issue drafts and demo walkthrough, specified handler payloads and limits, and resolved the publish/claim race in ADR-006. Initialized npm workspaces and the root lockfile, and added an Express health endpoint, Pino request logs, Zod startup validation, and Supertest/Vitest coverage. The workspace follows the active LTS line in `.nvmrc`. [Node.js release schedule](https://github.com/nodejs/Release#release-schedule)
- **Commands and results** — `npm ci --cache .npm-cache --offline`, `npm run lint`, and `npm run format:check` each exited 0. `npm run test:unit` exited 0 with 10 tests across 2 suites. A Windows smoke check ran `node --env-file-if-exists=.env apps/api/src/server.js` and verified a live HTTP 200, the response body, and a generated request ID. Git SHA is unavailable because the workspace has no Git metadata.
- **Acceptance evidence** — Phase 00 design checks are reviewed and the issue drafts are local. The foundation liveness, 404, logging, and configuration behavior were exercised. The Phase 01 boot, readiness, frontend build, and CI gates are pending.
- **Open issues / risks** — Docker commands are unavailable here, so startup and outage behavior with PostgreSQL and RabbitMQ remain unverified. Dispatch and fencing invariants are design contracts pending implementation and real-service tests.
- **Next smallest step** — Add local PostgreSQL and RabbitMQ Compose services and implement `/health/ready` with bounded dependency checks. Verify readiness fails when each service stops and liveness stays healthy.
- **Relevant paths** — [API workspace](apps/api), [workspace scripts](package.json), [local setup](README.md#run-the-api-locally), and [API contracts](docs/DATA_AND_API_CONTRACTS.md).
