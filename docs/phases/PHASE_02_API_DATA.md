# Phase 02 — Database, authentication & job APIs

**Status:** Verified against a disposable PostgreSQL instance. Evidence is in the project tracker.

## Goal

Make job acceptance durable, safe, and queryable.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Define Prisma schema with tenant, user, job, attempt, job event, outbox, effect and dead-letter entities.
2. Generate/review migrations and indexes; seed demo tenant, admin (non-public secret), and sample job types.
3. Implement session auth, cookie security/CSRF mitigation, admin RBAC and tenant-scoped queries.
4. Define Zod schemas per whitelisted job type; enforce payload byte limits, due time bounds, maxAttempts cap.
5. `POST /jobs` transactionally creates job + outbox event; uniqueness on idempotency scope; 409 on key/body conflict.
6. Implement cursor pagination, status filters, job detail, attempt history, audit events.
7. Write Supertest + real Postgres tests, including concurrent identical submissions.

## Exit criteria — must demonstrate

- [x] Job and outbox are either both committed or both absent.
- [x] Duplicate same key/body returns original job; same key/other body returns 409.
- [x] User cannot access other tenant's job or admin DLQ.
- [x] Pagination stable; bad input validated and safely rejected.
- [x] Unit and integration tests pass against real PostgreSQL.

## Deliverables

- Reviewed schema migrations, auth, job REST endpoints, API integration tests, sample curl requests.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
