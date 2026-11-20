# Portfolio, Interview and Resume Evidence

## Required artifacts

- Public GitHub repo with `README.md`, architecture diagram, system state diagram, setup guide, testing instructions, and transparent limitations.
- Screenshots/GIFs: create job, running workers, retry timeline, DLQ/replay, Grafana, failure recovery.
- `benchmarks/results/<run-id>/`: environment JSON, workload script, raw exports, summary, charts/screenshots, git SHA.
- 2–4 minute demo script showing a job completing and a running worker being killed/recovered.
- AWS HTTPS demo if budget and account permit. Clearly mark single-host topology.

## Resume bullet templates — DO NOT FILL UNTIL MEASURED

```text
JobFlow | Distributed Job Processing Platform — JavaScript, React, Node.js, RabbitMQ, PostgreSQL, Docker, AWS
• Built an asynchronous job platform with durable outbox-based submission, N concurrent workers, retries, delayed execution, DLQ and live React monitoring.
• Measured [X] sustained completed jobs/sec under [workload] on [hardware], a [Y]× speedup from [1] to [N] workers; documented p95 [execution/e2e] latency of [Z] ms.
• Validated worker-crash recovery (median [R] s across [K] repeated tests), fenced stale writes and prevented duplicate committed demo effects in [D] injected duplicate-delivery tests.
```

Remove any clause you have not actually built, tested and verified. Do not call the system "exactly once" or "zero data loss" without carefully scoped empirical evidence.

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
- Recorded the real local operator flow from sign-in through job completion and dead-letter replay. [Browser recording](assets/jobflow-demo.webm)

### Suggested demo recording sequence

1. Open the dashboard, sign in, and submit a report job. Show queued and completed states and the attempt timeline.
2. Run the broker recovery suite and show the killed claim, the `LEASE_EXPIRED` attempt outcome, and the replacement worker's completion.
3. Open Dead letters, supply a replay reason, and follow the new job back to the original record.
4. Open Grafana and compare execution latency with end-to-end latency. Explain which timestamps each panel represents.

**Interview tradeoffs.** The outbox keeps acceptance independent of the broker. Publishing and confirming a message can race a process failure, so PostgreSQL claims and token fencing control state writes and the demo effect is committed in the same transaction. Realtime notifications prompt REST reads because a notification can be missed. Dashboard counters are operational signals. Benchmark claims require matching versioned test cohorts and raw measurement artifacts.
