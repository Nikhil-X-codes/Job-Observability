# Phase 09 — Portfolio packaging & interview prep

**Status:** The local portfolio package has a verified 2:17 walkthrough, rendered Grafana screenshot, and measured performance report. Publication remains pending. [Walkthrough](../assets/jobflow-demo.webm) · [Benchmark report](../../benchmarks/results/2026-11-20-native-mixed/REPORT.md)

## Goal

Convert verified engineering work into defensible portfolio bullets.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Finalize README with architecture, demo, quickstart, feature matrix, limitations, screenshots and live URL if available.
2. Publish sanitized benchmark results with git SHA, machine specs, scripts and result interpretation.
3. Verify all resume bullet numbers using evidence checklist and sample-size/denominator notes.
4. Record 2–4 minute demo video or GIF sequence: submit→workers→retry→kill→recover→DLQ→Grafana.
5. Document important failure modes and tradeoffs using ADRs and interview Q&A.
6. Review security secrets, licenses and dependency vulnerabilities before making repository public.
7. Update tracker to DONE only if acceptance checks and artifact references are present.

## Exit criteria — must demonstrate

- [ ] Public repo can be set up from scratch using documented commands.
- [x] Resume claims link to reproducible tests and measurements.
- [x] Architecture and failure tradeoffs are documented.
- [ ] Live demo (if present) is stable and cost-monitored.
- [x] Test evidence, screenshots, benchmarks and known limitations are included.

The recording shows a report job moving from submission to a worker claim. A local test fixture pauses the first worker before it commits. The script kills the process, starts the scheduler, verifies the retry and one committed effect, replays a separate dead-lettered job, and shows the captured Grafana dashboard. Open the recorded file directly to play it.

## Deliverables

- Portfolio-ready repository, verified resume bullets, demo recording, architecture interview notes.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
