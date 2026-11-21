# Dispatcher backlog benchmark

On the local dispatcher component benchmark, replacing row-by-row database leasing with one atomic batch statement increased median pipelined dispatch throughput from **108.66 to 304.67 jobs/s**. Median run-level p95 batch lease time fell from **60.43 to 7.20 ms**. This benchmark ends at confirmed RabbitMQ publication and the PostgreSQL outbox commit.

| Leasing implementation | Publication mode | Trials | Median dispatched jobs/s | Median run p95 batch lease | Median lease share of wall time |
| ---------------------- | ---------------- | -----: | -----------------------: | -------------------------: | ------------------------------: |
| Row-by-row writes      | Serial           |      3 |                    48.13 |                   53.36 ms |                           30.9% |
| Row-by-row writes      | Pipeline         |      3 |                   108.66 |                   60.43 ms |                           73.8% |
| Atomic SQL batch       | Serial           |      3 |                   114.94 |                    7.66 ms |                            9.4% |
| Atomic SQL batch       | Pipeline         |      3 |                   304.67 |                    7.20 ms |                           26.1% |

## Fixture and method

- Run date 2026-11-21. Both snapshots came from the local working tree based on `fbc104a`. The first used sequential PostgreSQL row writes inside each lease transaction. The second used the single-statement lease with the same candidate checks and six-item batch.
- Windows host build `10.0.26300`, Intel Core i3-1115G4, four logical cores, 8,317,952,000 bytes of RAM, Node `v26.13.0`. PostgreSQL and RabbitMQ used the pinned default Compose images on the same Docker Desktop host. PostgreSQL reported `fsync=on` and `synchronous_commit=on`.
- The runner stages 360 synthetic `GENERATE_REPORT` jobs before each timed trial. One process leases batches, confirms RabbitMQ publication, and records each confirmation. Trial order is serial, pipeline, pipeline, serial, serial, pipeline. Each implementation uses a fresh database and broker, with alternating trials inside that fixture.
- All 4,320 messages were reconciled with queued jobs and `SENT` outbox records. The runner verified the RabbitMQ message count before clearing the isolated queue for each trial. No application worker consumes the queue in this profile.
- Lease time is measured once per six-row batch. Publish and record times are measured per row, and they overlap in pipeline mode. The lease share divides summed lease durations by elapsed dispatch time. The 73.8% baseline share points to the database lease transaction as the dominant stage in the pipelined fixture.

## Reproduce

Use a separate local Docker Compose project containing only PostgreSQL and RabbitMQ, with published loopback ports assigned dynamically. Create and migrate an empty `dispatcher_bench` database. Set `DATABASE_URL` and `AMQP_URL` to the fixture endpoints. Set `BENCHMARK_ISOLATED=1`, then run `node scripts/benchmark-dispatch.mjs` from the repository root. The runner requires no existing jobs, broker messages, or consumers.

The reported rates cover a short, preloaded dispatcher backlog. Production capacity and end-to-end job latency still require an isolated API-to-worker load test. [Runner](../../../scripts/benchmark-dispatch.mjs) · [Per-trial measurements](measurements.json) · [Full-system benchmark procedure](../../../docs/METRICS_AND_BENCHMARKS.md)
