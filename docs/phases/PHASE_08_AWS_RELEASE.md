# Phase 08 — AWS deployment & operational release

**Status:** Deferred until the final release stage. The production Compose model passed offline port verification.

## Goal

Ship a secure public demo within an explicitly approved budget.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Verify actual AWS account Free Tier/credits, region, budget, expected compute/EBS/public IPv4/data costs.
2. Select VM memory capacity based on real Compose usage; do not force full Grafana onto underpowered tiny instance.
3. Provision EC2 with least-exposed security group, limited admin access and appropriate tags; set budgets/alerts.
4. Add production Compose override, pinned images, resource limits, restart policy, persistent volumes and backup plan.
5. Configure HTTPS with domain/Caddy, secure session cookie, env secrets and private service ports.
6. Build CI for tests/images; gated CD to EC2 with manual environment approval and rollback path.
7. Smoke test job handling, retries, realtime, metrics, TLS; perform DB backup + restore exercise.
8. Document maintenance, log retention, monitoring, restore and complete cleanup/cost checklist.

## Exit criteria — must demonstrate

- [ ] User explicitly approved spending/account selection before provision.
- [ ] Public dashboard served over HTTPS with auth; backend dependencies not internet-accessible.
- [ ] End-to-end smoke and recovery work on deployed environment.
- [ ] Budget and cleanup steps documented; no blanket free/HA claims.
- [ ] Deployment and rollback instructions are reproducible.

## Deliverables

- Deployment runbook, secured demo URL (when actually provisioned), CI workflow, screenshots, operations notes.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
