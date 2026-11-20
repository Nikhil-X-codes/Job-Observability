# Portfolio, Interview and Resume Evidence

## Required artifacts

- Public GitHub repo with `README.md`, architecture diagram, system state diagram, setup guide, testing instructions, and transparent limitations.
- Screenshots/GIFs: create job, running workers, retry timeline, DLQ/replay, Grafana, failure recovery.
- `benchmarks/results/<run-id>/`: environment JSON, workload script, raw exports, summary, charts/screenshots, git SHA.
- 2–4 minute demo script showing a job completing and a running worker being killed/recovered.
- AWS HTTPS demo if budget and account permit. Clearly mark single-host topology.

## Evidence-backed resume bullets

- Built an asynchronous job processor with a PostgreSQL transactional outbox, RabbitMQ quorum queue, fenced worker leases, retries, dead-letter replay, and a live React dashboard. [Architecture](ARCHITECTURE.md)
- Benchmarked 1, 2, 4, and 8 worker processes at 15 submissions per second on one Windows host. Verified completion of all 5,410 accepted jobs across 12 measured runs with zero duplicate committed demo effects. [Benchmark report](../benchmarks/results/2026-11-20-native-mixed/REPORT.md)
- Measured capacity and burst behavior across 22 comparable runs on one Windows host. Reconciled all 26,475 accepted jobs against PostgreSQL and measured a 16.270-second median recovery across five controlled worker crashes. [Capacity and recovery report](../benchmarks/results/2026-11-20-native-capacity/REPORT.md)
- Tested worker-crash recovery and pre-ACK redelivery against RabbitMQ and PostgreSQL. In the crash test, a replacement worker completed the expired claim and committed one demo effect. [Broker integration tests](../tests/broker/delivery.test.js)

## Interview explanations to practice

1. Why is the DB authoritative rather than RabbitMQ?
2. What occurs if dispatcher crashes between publish confirmation and DB update?
3. Why are ACK after DB commit and idempotency needed?
4. Why can lease expiry cause duplicate execution even when claims are exclusive?
5. How does outbox handle RabbitMQ downtime?
6. Difference between queue wait, execution latency and end-to-end latency.
7. Why does scaling workers stop helping beyond CPU/DB/broker saturation?
8. How to interpret p95 (and its histogram bucket accuracy).
9. What makes the AWS single-VM setup different from multi-node availability?
10. Which experiment produces each resume metric and what are its limitations?

## Example demo narrative

Create three jobs of varying priority → show job rows and attempts → bring up two workers → inject one transient failure → observe backoff and completion → kill one worker during a deterministic long-running job → show lease recovery → inspect DLQ and replay → open Grafana metrics → present versioned benchmark report and host spec.

## Local evidence

- Implemented transactional job submission and checked concurrent duplicate requests, a forced outbox insert failure, and tenant scoping against PostgreSQL. [API integration suite](../tests/integration/jobs.test.js)
- Verified confirmed RabbitMQ delivery, manual ACK after database completion, and a replacement worker completing an expired claim after a forced process exit. The tested job produced one durable demo effect. [Broker recovery suite](../tests/broker/delivery.test.js)
- Verified sign-in, job submission, job history, linked replay, and REST reconciliation after a browser disconnect. [Chrome smoke](../tests/ui/smoke.mjs) · [Overview screenshot](assets/jobflow-overview.png)
- Recorded a 2:22 local walkthrough showing a forced worker exit, a lease-expiry retry, one committed effect, dead-letter replay, and the verified Grafana dashboard. [Browser recording](assets/jobflow-demo.webm)

### Suggested demo recording sequence

1. Open the dashboard, sign in, and submit a report job. Show the pending, queued, and running states.
2. Kill the paused worker. Show the scheduler's lease-expiry retry and the replacement worker's completion.
3. Open Dead letters, replay a separate failed job with a reason, and follow the link to the original record.
4. Show the Grafana capture and compare execution latency with end-to-end latency.

**Interview tradeoffs.** The outbox keeps acceptance independent of the broker. Publishing and confirming a message can race a process failure, so PostgreSQL claims and token fencing control state writes and the demo effect is committed in the same transaction. Realtime notifications prompt REST reads because a notification can be missed. Dashboard counters are operational signals. Benchmark claims require matching versioned test cohorts and raw measurement artifacts.
