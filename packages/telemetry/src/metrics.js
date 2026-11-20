import { createServer } from "node:http";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

const jobStates = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
  "COMPLETED",
  "DEAD",
  "CANCELLED",
];
const seconds = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300];

export function createMetrics(db) {
  const register = new Registry();
  collectDefaultMetrics({ register, prefix: "jobflow_" });
  const metric = (Type, name, help, labelNames = []) =>
    new Type({
      name,
      help,
      labelNames,
      registers: [register],
      buckets: seconds,
    });
  const attempts = metric(
    Counter,
    "job_attempts_total",
    "Committed execution attempts",
    ["job_type", "outcome"],
  );
  const terminal = metric(
    Counter,
    "jobs_terminal_total",
    "Committed terminal jobs observed by the process",
    ["job_type", "status"],
  );
  const retries = metric(
    Counter,
    "job_retries_total",
    "Attempts scheduled for another execution",
    ["job_type", "reason"],
  );
  const expirations = metric(
    Counter,
    "worker_lease_expirations_total",
    "Expired attempt leases processed by the scheduler",
    ["job_type"],
  );
  const execution = metric(
    Histogram,
    "job_execution_duration_seconds",
    "Seconds between claim and committed attempt outcome",
    ["job_type", "outcome"],
  );
  const endToEnd = metric(
    Histogram,
    "job_end_to_end_duration_seconds",
    "Seconds between submission and terminal transition",
    ["job_type", "status"],
  );
  const queueWait = metric(
    Histogram,
    "job_queue_wait_seconds",
    "Seconds between eligibility and claim",
    ["job_type"],
  );
  const dispatches = metric(
    Counter,
    "outbox_dispatches_total",
    "Observed publication attempts",
    ["outcome"],
  );
  const requests = metric(
    Counter,
    "jobflow_http_requests_total",
    "Completed HTTP requests",
    ["method", "status"],
  );
  const workers = metric(
    Gauge,
    "worker_connected",
    "Whether the worker has an active broker consumer",
    ["worker_group"],
  );
  const active = metric(
    Gauge,
    "worker_active_jobs",
    "Jobs currently handled in this worker process",
    ["worker_group"],
  );
  const states =
    db &&
    metric(
      Gauge,
      "job_state_count",
      "Jobs keyed by authoritative PostgreSQL status",
      ["status"],
    );
  const pending =
    db &&
    metric(
      Gauge,
      "outbox_pending_count",
      "Pending outbox events in PostgreSQL",
    );
  const oldest =
    db &&
    metric(
      Gauge,
      "outbox_oldest_due_seconds",
      "Seconds since the oldest due outbox intent became eligible",
    );
  const ledger =
    db &&
    metric(
      Gauge,
      "jobflow_ledger_metrics_up",
      "Whether PostgreSQL metrics were collected successfully",
    );

  function terminalJob({ type, status, createdAt, finishedAt }) {
    terminal.inc({ job_type: type, status });
    endToEnd.observe(
      { job_type: type, status },
      Math.max(0, finishedAt - createdAt) / 1000,
    );
  }

  function committed({
    type,
    status,
    startedAt,
    createdAt,
    finishedAt,
    errorCode,
  }) {
    const labels = {
      job_type: type,
      outcome: errorCode ? "FAILED" : "SUCCEEDED",
    };
    attempts.inc(labels);
    execution.observe(labels, Math.max(0, finishedAt - startedAt) / 1000);
    if (errorCode === "LEASE_EXPIRED") expirations.inc({ job_type: type });
    if (status === "RETRY_WAIT")
      retries.inc({ job_type: type, reason: errorCode });
    else terminalJob({ type, status, createdAt, finishedAt });
  }

  async function render() {
    if (db) {
      try {
        const now = new Date();
        const [groups, count, head] = await Promise.all([
          db.job.groupBy({ by: ["status"], _count: { _all: true } }),
          db.outboxEvent.count({ where: { status: "PENDING" } }),
          db.outboxEvent.findFirst({
            where: { status: "PENDING", availableAt: { lte: now } },
            orderBy: { availableAt: "asc" },
            select: { availableAt: true },
          }),
        ]);
        const counts = new Map(
          groups.map((group) => [group.status, group._count._all]),
        );
        for (const status of jobStates)
          states.set({ status }, counts.get(status) ?? 0);
        pending.set(count);
        oldest.set(head ? (now - head.availableAt) / 1000 : 0);
        ledger.set(1);
      } catch {
        states.reset();
        pending.remove();
        oldest.remove();
        ledger.set(0);
      }
    }
    return register.metrics();
  }

  return {
    active,
    workers,
    requests,
    dispatches,
    terminalJob,
    committed,
    claimed: ({ type, startedAt, eligibleAt }) =>
      queueWait.observe(
        { job_type: type },
        Math.max(0, startedAt - eligibleAt) / 1000,
      ),
    contentType: register.contentType,
    render,
  };
}

export function listenForMetrics(metrics, { port, host }, logger) {
  if (!port) return async () => {};
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await metrics.render();
      response
        .writeHead(200, { "Content-Type": metrics.contentType })
        .end(body);
    } catch {
      response.writeHead(503).end();
    }
  });
  server.on("error", () => logger.error("Metrics listener failed"));
  server.listen(port, host);
  return () => new Promise((resolve) => server.close(resolve));
}
