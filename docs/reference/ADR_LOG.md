# Architecture Decision Records (ADRs)

## ADR-001 — JavaScript only
**Decision:** Node.js ESM + React JS (no TypeScript). **Reason:** aligns with requested tech and existing strengths. **Consequence:** enforce runtime schemas + high test coverage.

## ADR-002 — PostgreSQL authoritative state + RabbitMQ transport
**Decision:** DB stores job state/attempts/outbox; broker delivers at least once. **Reason:** better auditability, crash recovery and realistic failure discussion. **Consequence:** need outbox dispatcher, duplicate protection, reconciliation.

## ADR-003 — DB scheduler rather than delay plugin
**Decision:** due-time execution from indexed Postgres queries; outbox for publish. **Reason:** avoids nonstandard broker plugin and non-durable application timers. **Consequence:** scheduling precision bounded by scan cadence.

## ADR-004 — Business-effect idempotency, not exactly-once execution
**Decision:** unique effect ledger + fenced state transitions; sinks must independently accept idempotency key. **Reason:** ACK/lease/retries naturally produce duplicate attempts. **Consequence:** clearly disclose limitations for non-idempotent external effects.

## ADR-005 — Single EC2 Compose deployment
**Decision:** portfolio hosting on one VM; performance experiments can run on larger isolated host. **Reason:** manageable AWS cost and operational simplicity. **Consequence:** no host-level HA or multi-node failure claims.

## ADR-006 — Commit dispatch eligibility before publishing

Date: 2026-11-20

Status: Accepted

The dispatcher moves a due job to `QUEUED` in the transaction that leases the corresponding outbox row. It stores the publish confirmation on the outbox row. RabbitMQ can deliver a message immediately, so claiming against the committed eligibility prevents a worker from discarding the first valid delivery while the dispatcher waits for a confirmation. Include the next attempt number in the outbox key and broker envelope so delayed duplicates cannot claim a later retry. A pending outbox lease expires after a dispatcher crash.

Verify with an integration test that delivers the message before the confirm is recorded, and test redelivery of an earlier envelope after the next retry becomes eligible.

## ADR-007 — Opt-in external delivery through an approved gateway

The original email and webhook job types keep their simulated behavior. Two additive job types let an administrator of one configured tenant submit sandbox jobs. The worker maps approved fixtures to Resend test addresses and a private Webhook.site endpoint. Request payloads use fixture and scenario identifiers.

Resend retains keys for 24 hours. The worker uses a stable job key and payload and stops attempts 23 hours after the job first became eligible. A successful job records provider acceptance. Resend's dashboard shows the eventual delivery, bounce, or complaint. Webhook.site captures requests even when the configured response is unsuccessful. The worker allows one attempt and records an ambiguous result for operator reconciliation. Reconcile external jobs before resuming delivery from a database snapshot, since a snapshot may predate an external effect. External dead letters require reconciliation before any new submission. [Resend keys](https://resend.com/docs/dashboard/emails/idempotency-keys) · [Webhook.site request capture](https://docs.webhook.site/api/requests.html)

## Future ADR template

```md
## ADR-NNN — Title
Date:
Status: Proposed | Accepted | Superseded
Context:
Decision:
Alternatives:
Consequences:
Verification:
```
