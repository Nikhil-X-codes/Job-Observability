# Phase 01 — Repository, infrastructure & CI

**Status:** Complete. A clean source archive passed install, Prisma generation, lint, formatting, 34 unit tests, and build. Hosted CI passed the live Compose integration suite. [GitHub Actions](https://github.com/Nikhil-X-codes/Job-Observability/actions/runs/44709186444)

## Goal

Produce a reliable local developer experience before business logic.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Initialize npm workspaces using planned directory layout; configure root `package.json`, lockfile and `.nvmrc`.
2. Scaffold React/Vite app and Express API; add eslint/prettier/Vitest/optional Zod.
3. Add Dockerfiles and Compose for Postgres and RabbitMQ with health checks and named volumes; add API/web as appropriate.
4. Create `/health/live` and `/health/ready`; standardized JSON errors and request IDs.
5. Add Pino logging and environment validation; provide `.env.example` with fake placeholders.
6. Add GitHub Actions lint/unit/build pipeline; document OS-specific local setup and seed process.
7. Set basic security: no public broker/DB ports outside local dev; safe CORS and secret handling.

## Exit criteria — must demonstrate

- [x] Fresh checkout boots all local services with one documented command.
- [x] Liveness/readiness endpoints are meaningful and tested.
- [x] Broken DB/broker dependency makes readiness fail as designed. Verified with native services.
- [x] CI runs format, lint, unit tests, frontend build.
- [x] Configuration examples and local Compose use disposable development values.

## Deliverables

- Docker Compose and Dockerfiles; health endpoints; CI workflow; developer setup guide.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
