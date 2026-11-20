# JobFlow — Distributed Job Processing Platform

**JavaScript-only distributed job processor**

JobFlow is a full-stack portfolio system for publishing, scheduling, processing, retrying, and observing asynchronous jobs. It demonstrates reliable job handling, multi-worker concurrency, measurable performance, and AWS deployment.

> **Evidence policy:** Never publish invented throughput, latency, reliability, or cost figures. Capture environment + reproducible measurements first; put verified numbers in your resume only after benchmarks pass.

## Locked stack

- **Frontend:** React + Vite + JavaScript, Tailwind CSS, Recharts
- **API:** Node.js LTS + Express.js, JavaScript (CommonJS or ESM consistently; choose **ESM**)
- **Realtime:** Socket.IO (dashboard updates, not delivery guarantee)
- **Queue:** RabbitMQ (durable quorum queue, manual acknowledgements)
- **Source of truth:** PostgreSQL + Prisma ORM
- **Telemetry:** prom-client, Prometheus, Grafana; structured JSON logs (Pino)
- **Tests:** Vitest, Supertest, Testcontainers (or Docker Compose test services), k6
- **Infrastructure:** Docker, Docker Compose, GitHub Actions, AWS EC2, Caddy (HTTPS)

## Non-goals for MVP

Multi-region availability; exactly-once job execution; arbitrary user-supplied shell commands; running untrusted user code; production-grade payment processing; microservices; managed AWS RabbitMQ or RDS. They complicate delivery without improving the portfolio goal.

## Start here

1. Read [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) and [Architecture](docs/ARCHITECTURE.md).
2. Read [AGENTS.md](AGENTS.md) **before** asking a coding agent to work.
3. Follow phases in order, using the phase-specific acceptance criteria.
4. Maintain [PROJECT_TRACKER.md](PROJECT_TRACKER.md) with links to PRs, tests, and benchmark artifacts.
5. Use [METRICS_AND_BENCHMARKS.md](docs/METRICS_AND_BENCHMARKS.md) before making any resume claims.

The [implementation backlog](docs/phases/PHASE_00_DISCOVERY.md#implementation-backlog) contains the acceptance checks for each phase.

## Run JobFlow locally

Start Docker Desktop in Linux container mode on Windows or macOS, or Docker Engine with the Compose plugin on Linux. From the project root, run:

```sh
docker compose -f infra/compose.yaml up --build --wait
```

Open `http://127.0.0.1:5173` for the dashboard. The API listens at `http://127.0.0.1:3000`. The local Compose stack uses disposable credentials and binds the published API, web, PostgreSQL, and RabbitMQ ports to loopback. Stop the stack with `docker compose -f infra/compose.yaml down`, which preserves the named volumes.

Compose runs the Prisma migration before starting the API. To seed the demo, copy `.env.example` to `.env` if needed, set `SEED_ADMIN_PASSWORD` to a unique password of at least 16 characters, then run `npm ci`, `npm run db:generate`, and `npm run db:seed`. The default tenant is `demo` and the default email is `operator@example.test`. Rerunning the seed preserves the existing password and reuses the three sample jobs.

The dashboard shows tenant jobs, attempt history, and administrator replay. [Dashboard screenshot](docs/assets/jobflow-overview.png) · [Recorded local walkthrough](docs/assets/jobflow-demo.webm)

## Run the API locally

Use the Node.js release line in `.nvmrc` and the bundled npm. From the workspace root, run:

```sh
npm ci
npm run db:generate
npm run dev:api
```

Open `http://127.0.0.1:3000/health/live` for liveness or `http://127.0.0.1:3000/health/ready` for dependency status. For host development with Compose dependencies, start only `postgres` and `rabbitmq` by appending those service names to the Compose command above. Copy `.env.example` to `.env` using `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` on macOS or Linux, then run `npm run db:migrate`. Run the API and `npm run dev:web` in separate terminals. Vite proxies health and REST requests to the local API.

```sh
npm run lint
npm run format:check
npm run test:unit
npm run build
npm run test:integration
```

The integration test creates its own Docker Compose project and volumes for outage, recovery, and PostgreSQL API checks. You can also run `npm run test:api-integration` with `TEST_DATABASE_URL` set to a separately migrated, disposable PostgreSQL database. The suite creates test users and temporarily adds a trigger to test transaction rollback.

For native development, start PostgreSQL and RabbitMQ on loopback, configure `DATABASE_URL` and `AMQP_URL` in `.env`, then run `npm run db:migrate` and `npm run db:seed`. Start `dev:api`, `dev:web`, `dev:dispatcher`, `dev:worker`, and `dev:scheduler` in separate terminals. Run additional worker processes to test competing consumers. Each process takes its own environment, so assign distinct `METRICS_PORT` values if you enable their scrape endpoints on the same host.

`npm run test:broker` and `npm run test:ui` require a freshly migrated disposable database and an isolated RabbitMQ vhost supplied through `TEST_DATABASE_URL` and `TEST_AMQP_URL`. For the browser test, install Playwright Chromium or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium browser.

Enable local Prometheus and Grafana with the `observability` Compose profile. Open `http://127.0.0.1:3010` and sign in with the disposable local credentials in [Compose](infra/compose.yaml). The [metrics contract](docs/METRICS_AND_BENCHMARKS.md) lists the dashboard definitions. [Grafana verification screenshot](docs/assets/jobflow-grafana.png)

The native monitoring smoke boots the API, dispatcher, worker, scheduler, Prometheus, and Grafana for a disposable database and broker. Run `npm run test:observability` with `TEST_DATABASE_URL`, `TEST_AMQP_URL`, `PROMETHEUS_EXECUTABLE_PATH`, and `GRAFANA_HOME`. Set `TEST_GRAFANA_DATABASE_URL` to use a separate disposable PostgreSQL database for Grafana metadata. To capture a screenshot, also set `JOBFLOW_GRAFANA_SCREENSHOT` and configure Playwright Chromium.

## Phase index

| Phase | Scope | Gate |
|---|---|---|
| [00](docs/phases/PHASE_00_DISCOVERY.md) | Scope, repo, baseline architecture | Spec & ADR signed off |
| [01](docs/phases/PHASE_01_FOUNDATION.md) | Monorepo, Docker, health, CI | One-command local boot |
| [02](docs/phases/PHASE_02_API_DATA.md) | Auth, DB schema, job APIs, outbox | API tests green |
| [03](docs/phases/PHASE_03_QUEUE_WORKERS.md) | Publisher, claims, worker, ACKs | Crash/redelivery tested |
| [04](docs/phases/PHASE_04_RELIABILITY.md) | Leases, retries, scheduling, DLQ | Failure matrix green |
| [05](docs/phases/PHASE_05_DASHBOARD.md) | React console + Socket.IO | Full UI workflow works |
| [06](docs/phases/PHASE_06_OBSERVABILITY.md) | Metrics, logs, dashboards | All metrics verifiable |
| [07](docs/phases/PHASE_07_TEST_BENCH.md) | Load, scale, chaos, reports | Reproducible measurements |
| [08](docs/phases/PHASE_08_AWS_RELEASE.md) | Harden, deploy, runbook | Public HTTPS demo |
| [09](docs/phases/PHASE_09_PORTFOLIO.md) | Documentation, demo, resume | Evidence-backed bullets |

## Planned repository layout

```text
jobflow/
  AGENTS.md
  README.md
  PROJECT_TRACKER.md
  apps/
    web/              # React + Vite + Tailwind
    api/              # Express + Socket.IO + /metrics
  services/
    worker/           # Worker process, retry handling
    dispatcher/       # Transactional-outbox delivery
    scheduler/        # Due-job and expired-lease scans
  packages/
    config/           # Shared runtime config validation
    db/               # Prisma schema, migrations, DB client
    contracts/        # Shared JS schemas (e.g., Zod) and constants
    telemetry/        # Counters, histograms, structured logger
  infra/
    compose.yaml
    compose.prod.yaml
    prometheus/
    grafana/
    caddy/
  scripts/
    seed.mjs
    run-benchmark.sh
  tests/
    integration/
    failure/
  benchmarks/
    scenarios/
    results/           # Gitignore raw sensitive datasets, keep sanitized summaries
    REPORT_TEMPLATE.md
  docs/
    phases/
    reference/
  .github/workflows/
```

## Definition of finished project

A user can create and track jobs in the React dashboard; the system persists every job, processes with multiple workers, retries transient failures, routes exhausted jobs to DLQ, replays failures safely, survives worker crashes without silent job loss, and exposes working Grafana panels. An independent developer can run the tests, reproduce benchmark numbers on comparable hardware, and deploy a secure demo to AWS.

## Useful quicklinks

- [Architecture & failure semantics](docs/ARCHITECTURE.md)
- [Database & API contracts](docs/DATA_AND_API_CONTRACTS.md)
- [Metrics and benchmarks](docs/METRICS_AND_BENCHMARKS.md)
- [AWS operations](docs/AWS_DEPLOYMENT.md)
- [Security and quality gates](docs/SECURITY_AND_QUALITY.md)
- [Resume evidence](docs/RESUME_EVIDENCE.md)
