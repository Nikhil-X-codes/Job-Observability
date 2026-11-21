# Release candidate end-to-end load, 2026-11-21

The isolated Compose stack ran on Docker Desktop with two Linux-engine vCPUs and about 4.8 GiB of engine memory. One worker processed the mixed synthetic workload through Caddy, the REST API, PostgreSQL, RabbitMQ, the dispatcher, and the scheduler. The runner verified durable PostgreSQL commits. k6 v2.4.0 used 50 virtual users per scenario. The application tree of candidate `c9db6cd128b215184cefd0460b19bafef79a4e3f` matched squash commit `364e65a5164c54e803b34999a25197449b481b72`.

The steady profile offered 15 submissions/s for 35 seconds. The 40-second burst profile offered 10 submissions/s for 10 seconds, 55/s for 10 seconds, then 10/s for 20 seconds. Each measured trial followed a drained 10-second warmup. Completion rate uses the measured window. Drain time and p95 end-to-end latency include completions after that window.

| Profile | Trial | Accepted and completed | Completed/s in window | Peak backlog | Drain time | p95 end-to-end |
| ------- | ----- | ---------------------- | --------------------- | ------------ | ---------- | -------------- |
| Steady  | 1     | 525                    | 13.97                 | 34           | 3.592 s    | 2.319 s        |
| Steady  | 2     | 526                    | 14.83                 | 10           | 0.532 s    | 0.614 s        |
| Steady  | 3     | 526                    | 14.83                 | 35           | 0.399 s    | 0.992 s        |
| Burst   | 1     | 852                    | 21.10                 | 261          | 1.294 s    | 6.271 s        |
| Burst   | 2     | 851                    | 21.18                 | 236          | 0.374 s    | 6.898 s        |
| Burst   | 3     | 853                    | 21.15                 | 158          | 0.604 s    | 3.883 s        |

All 4,133 accepted jobs in the passing trials completed. PostgreSQL reconciliation reported zero dead or remaining jobs, duplicate effects, and completed jobs with missing effects. k6 reported zero HTTP submission failures and dropped iterations in these six trials. The initial steady warmup for trial 2 dropped 18 k6 iterations. The initial measured burst trial 2 had one failed HTTP submission and completed all 852 accepted jobs. The runner stopped each failed series and retained its diagnostics. Trials 2 and 3 ran again at the original settings.

Raw `results.json`, environment, k6 summaries, and Prometheus samples remain in the local runner output under `benchmarks/results/local/`. The results characterize this local hardware and workload. AWS throughput and sustained operation at the spike rate remain unmeasured.
