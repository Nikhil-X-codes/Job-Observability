# AGENTS.md — JobFlow Coding-Agent Contract

> **Required reading for all coding agents** before any modification. This is the source-of-truth implementation playbook. An agent must not skip phases, claim unverified metrics, or silently change technology choices.

## Mission

Implement **JobFlow**, a JavaScript-only, full-stack distributed job processor using React/Vite, Express, RabbitMQ, PostgreSQL/Prisma, Socket.IO, Prometheus/Grafana, Docker Compose, and AWS EC2. Optimize for correctness, operability, demonstrable testing, and a strong SWE portfolio.

## First five actions at start of each session

1. Read `README.md`, `PROJECT_TRACKER.md`, the active `docs/phases/PHASE_XX_*.md`, `docs/ARCHITECTURE.md`, and `docs/DATA_AND_API_CONTRACTS.md`.
2. Inspect the working tree; **do not overwrite** unrelated user changes.
3. State the smallest vertical slice and its acceptance checks.
4. Implement in small, reviewable steps, including tests and docs.
5. Update `PROJECT_TRACKER.md` with factual status and evidence; report completed commands, test results, limitations, and files changed.

## Technical constraints — do not deviate without an ADR

- **Use JavaScript (ESM)**, not TypeScript. Node.js current active LTS. Pin exact versions in lockfile; avoid hard-coded version claims in docs.
- npm workspaces (one root lockfile), Node/Express backend, React/Vite UI. Use Zod or equivalent runtime validation at trust boundaries.
- PostgreSQL is authoritative for job lifecycle; RabbitMQ is a durable transport, **not** the authoritative job ledger.
- Persist job + publication intent in the **same DB transaction** (transactional outbox). Dispatcher publishes messages with broker confirms, then marks outbox delivered. Duplicate publishes are expected and handled.
- Workers use **manual ACK** after durable database commit, with bounded prefetch. Use persistent messages and a durable quorum queue when supported by configured RabbitMQ version.
- Every execution claim has an atomic DB transition, ownership token, attempt count, and expiring lease. A lease protects state transitions but **does not imply exactly-once external effects**.
- Use unique idempotency keys per tenant/job submission and dedupe at business-effect boundary. Document at-least-once processing; do not promise exactly-once effects without an enforceable idempotent sink.
- A worker crash may cause re-delivery; reconcile via DB status, fencing token, lease expiry, and idempotent handler. A stale worker must not finalize a job whose lease token has changed.
- The scheduler selects due jobs and expired leases using DB transactions and row locking (`FOR UPDATE SKIP LOCKED` or equivalent). Prefer bounded batches.
- Support priority tiers using a RabbitMQ queue priority policy **only after testing**; avoid claiming strict global priority. Delayed jobs live in PostgreSQL until due; do not depend on RabbitMQ delayed-message plugin.
- Only **predefined, whitelisted job types** may execute (`send_demo_email` via fake sink, `generate_report`, `webhook_demo` to a controlled mock). No arbitrary code/commands or user-supplied destination URLs in MVP.
- Dashboard Socket.IO events are best effort. On reconnect, fetch REST state to reconcile missed events.
- Prometheus metric labels must be low-cardinality (job type, outcome, worker group); **never use job IDs, user IDs, or emails as labels**.
- API secrets in environment/secret store, not repo. Do not expose Postgres/RabbitMQ/Prometheus/Grafana ports publicly on AWS.
- Don't claim AWS Free Tier means unlimited EC2; cost must be checked in chosen region/account.

## Quality bar

For each feature: validated inputs, auth/authorization checks, typed-by-contract JS objects, structured errors, tests (success, duplicate, race, failure), logs and metrics where relevant, updated docs. Prefer simple maintainable modules over abstraction for its own sake.

## Testing order

1. `npm run lint` and `npm run format:check`
2. `npm run test:unit`
3. `npm run test:integration` (requires Docker services)
4. `npm run test:failure` when changing processing, scheduler, retry, or ACK path
5. `npm run test:load` only on an isolated benchmark environment; document hardware and profile

The above are **target scripts** to add in Phase 01/07, not claims that they currently exist. Never report passing checks unless executed.

## Required implementation behavior

- Authenticated tenant only sees own jobs; API response hides secrets and internal lease tokens.
- Every state transition follows documented state machine; update count/clock in one DB commit.
- Failed attempts have diagnostic error category (redacted), retry count and next scheduled time; after cap: `DEAD` and DLQ record.
- Distinguish *attempt-level failure rate* from *final job success rate*.
- Document broker outages, DB outages, worker crashes, duplicate delivery, scheduler outage, and partial side effects.
- For API list endpoints use pagination + stable ordering; rate-limit auth and write endpoints.
- Database migrations are reviewed; never reset production DB during development.
- Use UTC for timestamps; show local times at UI boundary.

## Definition-of-done checklist for every phase

- [ ] Working feature matches acceptance criteria in phase document
- [ ] Unit/integration/failure tests added and results recorded
- [ ] No unjustified race conditions or unbounded retries
- [ ] Validation, auth, resource limits, secret handling reviewed
- [ ] Logs and metrics cover key paths without sensitive values
- [ ] README/contracts/runbooks/tracker updated
- [ ] Commands and verification evidence documented
- [ ] No invented metrics, AWS prices, or benchmark claims

## Agent session handoff template

```md
## Session handoff — YYYY-MM-DD
Phase:
Objective:
Changes made:
Commands run and results:
Acceptance criteria met:
Open issues / risks:
Next smallest step:
Relevant paths / PR:
```

## If unsure

Do not invent success or hide uncertainty. Choose the smallest reversible option; document important architecture tradeoffs in `docs/reference/ADR_LOG.md`; request user input only when a missing choice blocks safe implementation. Never deploy destructive changes or incur AWS charges without user approval.
