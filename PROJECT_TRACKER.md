# JobFlow Project Tracker

**Status:** JobFlow has a public HTTPS demo on EC2, a verified dashboard refresh, and measured native capacity, burst, and worker-crash results. The live Compose suite passed on GitHub Actions. Deployed recovery and release operations are still pending verification.

| Phase | State | Evidence (PR, test log, screenshots, URL) | Blocker |
|---|---|---|---|
| 00 Discovery | DONE | [Acceptance checks and demo](docs/phases/PHASE_00_DISCOVERY.md), [ADR-006](docs/reference/ADR_LOG.md#adr-006--commit-dispatch-eligibility-before-publishing) | — |
| 01 Foundation | DONE | Clean source archive passed install, Prisma generation, lint, format, 34 unit tests and build. Hosted CI passed live Compose startup and dependency recovery. [GitHub Actions](https://github.com/Nikhil-X-codes/Job-Observability/actions/runs/44709186444) | — |
| 02 API & Data | DONE | Migration applied, 5 live PostgreSQL API integration tests passed, and demo seed ran twice | — |
| 03 Queue & Workers | DONE | Two native workers processed jobs. Pre-ACK redelivery and dispatch recovery preserved one effect. Broker suite passed in hosted Compose | — |
| 04 Reliability | DONE | Native worker kill/recovery, broker restart, database outage recovery, 5 PostgreSQL failure tests and 7 API tests passed. Hosted integration suite passed | — |
| 05 Dashboard | DONE | Refreshed console verified in Chrome, including mobile layout, linked filters, and keyboard dismissal of the replay dialog. [Dashboard screenshot](docs/assets/jobflow-overview.png) | — |
| 06 Observability | DONE | Native Prometheus scraped four processes and matched PostgreSQL completion counts. Grafana returned live rate and p95 queries. [Rendered dashboard](docs/assets/jobflow-grafana.png) | — |
| 07 Benchmarks | DONE | 22 comparable capacity and burst runs reconciled 26,475 jobs. Five real worker crashes recovered with one effect each. [Report and per-run data](benchmarks/results/2026-11-20-native-capacity/REPORT.md) | Four-worker 70 jobs/s has one comparable trial and two retained overload diagnostics |
| 08 AWS Release | IN PROGRESS | [Public HTTPS demo](https://nikhil-jobflow.duckdns.org/) on EC2 in `ap-southeast-2`. API session boundary, private endpoint responses, and unrestricted inbound ports checked. [Release evidence](docs/phases/PHASE_08_AWS_RELEASE.md) | Deployed recovery, backup and restore, rollback, and budget evidence |
| 09 Portfolio | DONE | Public source, green hosted CI, verified 2:22 [operator walkthrough](docs/assets/jobflow-demo.webm), screenshots, and [benchmark evidence](benchmarks/results/2026-11-20-native-mixed/REPORT.md) | Optional hosted demo is tracked in Phase 08 |

## Decisions

- App code is **JavaScript (ESM)**.
- **PostgreSQL** is system of record, **RabbitMQ** is message transport.
- **AWS EC2 + Docker Compose** is first cloud target; production-grade multi-node HA is out of scope.
- Performance and worker crash recovery figures apply to the versioned native workloads in the benchmark ledger. Production uptime is unmeasured.

## Benchmark ledger

| Date | Git SHA | Workload | Workers | Duration | Throughput | p95 end-to-end | Recovery | Report |
|---|---|---|---|---|---|---|---|---|
| 2026-11-20 | `fd07243` | Mixed, 15 submissions/s | 1, 2, 4, 8 | 15s warmup + 30s measured, 3 repetitions each | Median 14.40–14.58 completed jobs/s | Median of run p95s 864–1,013 ms | Functional coverage only | [Native report](benchmarks/results/2026-11-20-native-mixed/REPORT.md) |
| 2026-11-20 | `cb58172`, `97a9053` | Steady 15/40/70 jobs/s and 10/55/10 burst | 1, 4 | 35s steady and 40s burst | At 40 offered jobs/s, medians 18.00 and 16.20 completed jobs/s | At 40 offered jobs/s, median run p95s 39.96s and 43.49s | Median 16.270s across 5 worker kills | [Capacity, burst and recovery report](benchmarks/results/2026-11-20-native-capacity/REPORT.md) |

## Open decision log

- [x] Publication destination selected. [GitHub repository](https://github.com/Nikhil-X-codes/Job-Observability)
- [ ] Record the AWS project plan and monthly budget. Region is `ap-southeast-2`.
- [x] Public hostname selected and verified over HTTPS. [Live demo](https://nikhil-jobflow.duckdns.org/)
- [x] Exact Node, RabbitMQ, PostgreSQL, and Caddy image tags are pinned in [the Dockerfile](infra/Dockerfile) and [Compose configuration](infra/compose.yaml)

## Remaining reliability and production work

| Challenge | Acceptance check |
| --- | --- |
| Host or broker loss | Restore a populated PostgreSQL backup, replace the broker, and show that unclaimed jobs complete and preserve one effect per job. Verify restore and rollback from the deployment runbook. |
| Dashboard lag | While Socket.IO is unavailable and REST is reachable, a visible job list shows a newly submitted job automatically. |
| Backlog and worker scaling | Atomic PostgreSQL batch leasing raised median pipelined dispatch from 108.66 to 304.67 jobs/s in the isolated component benchmark. An end-to-end load comparison is still open. [Dispatcher report](benchmarks/results/2026-11-21-dispatcher/REPORT.md) |
| Sandbox job integrations | Verified Resend acceptance and duplicate-key behavior. The account owner confirmed Delivered and Bounced in Resend for the matching JobFlow receipts. Verified one Webhook.site capture per success and forced-error job. |
| Single-host availability | The local upgrade and rollback rehearsal preserved PostgreSQL and RabbitMQ. AWS restore and rollback are pending. A multi-host deployment requires a topology and budget decision. |

## AWS candidate verification follow-up — 2026-11-21

- **Backlog** — Added steady and burst acceptance checks for the release commit. No new end-to-end result was collected. The checkout contains uncommitted changes and k6 was unavailable on the current PATH. [Release candidate benchmark checks](docs/METRICS_AND_BENCHMARKS.md#verify-backlog-on-the-release-candidate)
- **Sandbox** — Found the two existing Resend receipts in PostgreSQL. Read-only lookup returned HTTP 401 for each with the configured key. The account owner shared the matching Resend dashboard receipts showing `delivered` for `jobflow-email-success-001` and `bounced` for `jobflow-email-bounce-001`. [Delivery verification steps](docs/AWS_DEPLOYMENT.md#enable-the-external-delivery-gateway)
- **Checks** — Lint, formatting, 49 unit tests, and the web build passed. No AWS deployment was performed.

## Provider receipts, dispatch capacity, and rollback — 2026-11-21

- **Live sandbox** — The local admin submitted the approved fixtures. Resend accepted two email jobs. Repeating the success job's key returned the same receipt. The sending key returned HTTP 401 for event lookup. Webhook.site confirmed exactly one capture per case. The success job completed and the `503` job reached `DEAD` on attempt one.
- **Backlog** — Six trials per lease implementation reconciled 4,320 dispatches total. The old leasing path accounted for a median 73.8% of pipelined wall time. Atomic SQL batch leasing reduced median run p95 lease time from 60.43 ms to 7.20 ms. [Benchmark and measurements](benchmarks/results/2026-11-21-dispatcher/REPORT.md)
- **Rollback** — Using two retained local image builds and a disposable production-shaped Compose project, the release script restored the earlier API image. API readiness, PostgreSQL and RabbitMQ container identity, and the persisted database marker were checked. [Release runbook](docs/AWS_DEPLOYMENT.md#update-the-existing-ec2-demo)
- **Commands and results** — Lint, format check, 49 unit tests, build, 5 broker tests, 8 API tests, and 5 processing failure tests passed after the batch change. The failure suite verified one queued audit event across competing lease claims and re-leasing. The AWS demo has not been updated in this session.

## Recovery and dashboard follow-up — 2026-11-21

- **Phases** — Phase 08 recovery and Phase 05 dashboard. Changes are in the working tree based on `fbc104a`.
- **Changes made** — Added the offline repair for confirmed, unclaimed dispatches when replacing a broker. Added a PostgreSQL backup and restore check to the Compose harness and an isolated lost-delivery broker regression. Visible dashboards refresh from REST every 15 seconds while online.
- **Commands and results** — Lint, formatting, 35 unit tests, and the web build passed. A local Docker fixture with a temporary RabbitMQ resource override passed 4 broker tests, 7 REST integration tests, and 5 processing failure tests. The restored database matched the source on 20 jobs, 12 attempts, 21 outbox records, 58 job events, and 11 effect records. The original Compose command timed out during the cold build, and a warm rerun stopped on RabbitMQ startup.
- **Browser evidence** — `npm run test:ui` passed against a separate database and broker vhost. A newly submitted job appeared while Socket.IO requests were blocked and REST was available. The dashboard returned to its live state after the block was removed.
- **Open issues** — The live AWS host still needs a deployment smoke test and backup, restore, and rollback exercises. Benchmarking with a separate generator and provider selection for real integrations are open. [Recovery runbook](docs/AWS_DEPLOYMENT.md#recover-when-rebuilding-rabbitmq)

## Delivery sandbox and release follow-up — 2026-11-21

- **Scope** — Added one-tenant administrator delivery for the approved Resend and Webhook.site fixtures. Simulated jobs remain available. Resend retries use the same key and payload for up to 23 hours after eligibility. Webhook.site jobs submit at most once in the active database because the capture endpoint does not provide job-key deduplication.
- **Commands and results** — Lint, formatting, 49 unit tests, and the web build passed. Fresh local PostgreSQL and RabbitMQ fixtures passed 5 broker, 8 API, and 5 processing failure tests with the sandbox adapters. The broker test recorded two Resend attempts with one key after a simulated lost response and one committed JobFlow effect. A dummy production Compose render verified worker-only provider settings and kept ports 80 and 443 on the web service.
- **Browser evidence** — Chrome verified the enabled admin's fixture and recipient selectors, the one-attempt webhook notice, and the existing simulated job and dashboard workflows.
- **Release and recovery evidence** — Before the sandbox adapter change, `npm run test:integration` passed the normal Compose startup and dependency outage checks, populated PostgreSQL backup and restore, and the broker, API, and failure suites after switching RabbitMQ health checks to a TCP probe. Script-level rollback checks passed with a mocked Docker CLI. A production-like local rehearsal stopped at API readiness before rollback. The live release, live sandbox receipts, and end-to-end AWS rollback still need verification. [Sandbox setup and release steps](docs/AWS_DEPLOYMENT.md#enable-the-external-delivery-gateway)

## Observability README — 2026-11-21

- **Phase** — Phases 06 and 09 documentation.
- **Changes made** — Made the administrator observability workflow the entry point in the [README](README.md). Documented tenant-scoped admin access, the separate Grafana sign-in, local setup with the observability profile, and the measured evidence.
- **Acceptance evidence** — Compared the permissions, Compose settings, and Grafana panel descriptions with the repository. Checked all 18 local README link references and all 8 npm script references. The live stack was not exercised during this documentation update.

## CI Node setup repair — 2026-11-21

- **Phase** — Phase 01.
- **Changes made** — Restored the root `.nvmrc` removed in `87014d6`. The CI workflow uses that file to select the same Node release line as the workspace. [Failed GitHub Actions run](https://github.com/Nikhil-X-codes/Job-Observability/actions/runs/44879609504)
- **Commands and results** — Local lint, format check, all 35 unit tests, and the web build passed. Hosted CI runs the live Docker Compose integration suite. [CI runs](https://github.com/Nikhil-X-codes/Job-Observability/actions/workflows/ci.yml)
- **Release status** — The AWS deployment workflow is manually dispatched. Phase 08 tracks the production release.

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
- **Open issues and risks** — Saturation, burst behavior, and repeated recovery timing require separate studies. AWS remains deferred.

## GitHub publication handoff — 2026-11-20

- **Phase** — Phases 01 and 09.
- **Commands and results** — From a fresh Git archive of `c8afaca`, dependency installation, Prisma generation, lint, formatting, all 34 unit tests, and the production build passed. `git push --set-upstream origin main` published that commit and the remote SHA matched. [Public repository](https://github.com/Nikhil-X-codes/Job-Observability)
- **Acceptance evidence** — GitHub Actions passed the full CI job on `c8afaca`, including `npm run test:integration`. That command started the Compose stack, exercised dependency outages and recovery, and ran the broker, API and failure suites. [Hosted run](https://github.com/Nikhil-X-codes/Job-Observability/actions/runs/44709186444)

## Dashboard refresh — 2026-11-20

- **Changes made** — Added desktop sidebar navigation, compact queue summaries, deep links to retrying and failed jobs, and clearer job tables and histories. Cancellation and replay use native dialogs.
- **Commands and results** — The Chrome walkthrough passed against fresh native PostgreSQL and RabbitMQ. It checked sign-in, linked filters, cancellation confirmation, worker exit and recovery, replay focus and Escape dismissal, reconnect, and mobile layout. The updated WebM was decoded at 2:21.68. [Walkthrough](docs/assets/jobflow-demo.webm) · [Dashboard screenshot](docs/assets/jobflow-overview.png)

## Capacity, burst, and recovery handoff — 2026-11-20

- **Objective** — Measure in-window throughput, overload backlog, drain time, and recovery using real HTTP submissions, PostgreSQL, RabbitMQ, and worker processes on the reserved native host.
- **Commands and results** — Ran `scripts/run-benchmark.mjs` and `scripts/benchmark-recovery.mjs` on commits `cb58172` and `97a9053`. The 22 comparable load trials accepted and completed 26,475 jobs. Of those, 11,779 finished during the arrival windows and 14,696 completed during drain. All five crash trials recovered and committed one effect per job. [Measured data](benchmarks/results/2026-11-20-native-capacity/measurements.json)
- **Open issues and risks** — Two four-worker 70 jobs/s attempts exceeded the generator miss tolerance. One reached the drain limit with 162 jobs still outstanding. Both snapshots are preserved alongside the comparable trial, and neither contributes to its throughput figure. A separate load-generator host and longer runs would be needed to establish a production capacity limit. [Benchmark report](benchmarks/results/2026-11-20-native-capacity/REPORT.md)

## Session handoff — 2026-11-20

- **Phase** — Phase 00 and the first slice of Phase 01.
- **Objective** — Establish a testable MVP baseline and run the local API bootstrap.
- **Changes made** — Wrote the Phase 00 issue drafts and demo walkthrough, specified handler payloads and limits, and resolved the publish/claim race in ADR-006. Initialized npm workspaces and the root lockfile, and added an Express health endpoint, Pino request logs, Zod startup validation, and Supertest/Vitest coverage. The workspace follows the active LTS line in `.nvmrc`. [Node.js release schedule](https://github.com/nodejs/Release#release-schedule)
- **Commands and results** — `npm ci --cache .npm-cache --offline`, `npm run lint`, and `npm run format:check` each exited 0. `npm run test:unit` exited 0 with 10 tests across 2 suites. A Windows smoke check ran `node --env-file-if-exists=.env apps/api/src/server.js` and verified a live HTTP 200, the response body, and a generated request ID. Git SHA is unavailable because the workspace has no Git metadata.
- **Acceptance evidence** — Phase 00 design checks are reviewed and the issue drafts are local. The foundation liveness, 404, logging, and configuration behavior were exercised. The Phase 01 boot, readiness, frontend build, and CI gates are pending.
- **Open issues / risks** — Docker commands are unavailable here, so startup and outage behavior with PostgreSQL and RabbitMQ remain unverified. Dispatch and fencing invariants are design contracts pending implementation and real-service tests.
- **Next smallest step** — Add local PostgreSQL and RabbitMQ Compose services and implement `/health/ready` with bounded dependency checks. Verify readiness fails when each service stops and liveness stays healthy.
- **Relevant paths** — [API workspace](apps/api), [workspace scripts](package.json), [local setup](README.md#run-the-api-locally), and [API contracts](docs/DATA_AND_API_CONTRACTS.md).
