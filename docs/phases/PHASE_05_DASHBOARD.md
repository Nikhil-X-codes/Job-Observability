# Phase 05 — React monitoring experience

**Status:** The refreshed console is verified with Chrome, native PostgreSQL, and native RabbitMQ. The browser check covers linked filters, cancellation confirmation, replay focus and Escape dismissal, and mobile layout. [Dashboard screenshot](../assets/jobflow-overview.png)

## Goal

Build portfolio-quality user workflows and live operator visibility.

## Prerequisites

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_AND_API_CONTRACTS.md`, and the prior phase handoff. No phase can assume a later-phase feature is already built.

## Execution checklist

1. Create React routing, login/logout and API client with cookie/session handling.
2. Create Overview dashboard: job counts, queue depth, throughput, workers; mark unavailable metrics as unknown, not zero.
3. Create New Job form (whitelisted types, validated payload, priority, runAt) and jobs table with filters/pagination.
4. Create Job Detail with attempts, history timeline, errors, retry wait and run metadata.
5. Create Admin DLQ viewer and replay confirmation; show permission errors.
6. Add Socket.IO updates and reconnect handling; fetch REST state after reconnect to eliminate missed event issues.
7. Add mobile layout, loading/empty/error states, accessibility labels, and UI smoke tests.

## Exit criteria — must demonstrate

- [x] Browser submission shows pending and queued states, the started timeline event, and completed state.
- [x] Failed job and DLQ are visible, with a linked replay. Retry attempt data uses the same tested history API.
- [x] Reconnect restores canonical state. Socket.IO events trigger REST refreshes.
- [x] Forms validate and unauthorized actions are blocked server-side.
- [x] Overview counts come from PostgreSQL. An unavailable worker count is displayed as unknown.

## Deliverables

- Screenshots, responsive pages, Socket.IO integration, UI tests.

## Required testing evidence

Record test command, exit code, execution date, git SHA, and relevant logs/screenshots/PR. Add a one-paragraph description of the risks still open. Update `PROJECT_TRACKER.md` only after checking the exit criteria.

## Agent work order

Implement in small vertical slices; write tests alongside code, re-run impacted CI gates, and stop to document a serious invariant violation before adding features. Follow session handoff format in `AGENTS.md`.
