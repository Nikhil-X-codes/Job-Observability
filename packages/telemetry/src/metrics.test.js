import { expect, it } from "vitest";
import { createMetrics } from "./metrics.js";

it("publishes separate attempt, terminal, retry, and latency series", async () => {
  const metrics = createMetrics();
  const createdAt = new Date(0);
  const startedAt = new Date(1000);
  const finishedAt = new Date(1250);
  const type = "GENERATE_REPORT";
  metrics.claimed({ type, startedAt, eligibleAt: new Date(500) });
  metrics.committed({
    type,
    status: "RETRY_WAIT",
    startedAt,
    createdAt,
    finishedAt,
    errorCode: "LEASE_EXPIRED",
  });
  metrics.committed({
    type,
    status: "COMPLETED",
    startedAt,
    createdAt,
    finishedAt,
  });
  const rendered = await metrics.render();
  expect(rendered).toContain(
    'job_attempts_total{job_type="GENERATE_REPORT",outcome="FAILED"} 1',
  );
  expect(rendered).toContain(
    'jobs_terminal_total{job_type="GENERATE_REPORT",status="COMPLETED"} 1',
  );
  expect(rendered).toContain(
    'job_retries_total{job_type="GENERATE_REPORT",reason="LEASE_EXPIRED"} 1',
  );
  expect(rendered).toContain(
    'worker_lease_expirations_total{job_type="GENERATE_REPORT"} 1',
  );
  expect(rendered).toContain(
    'job_execution_duration_seconds_sum{job_type="GENERATE_REPORT",outcome="SUCCEEDED"} 0.25',
  );
  expect(rendered).toContain(
    'job_end_to_end_duration_seconds_sum{job_type="GENERATE_REPORT",status="COMPLETED"} 1.25',
  );
  expect(rendered).toContain(
    'job_queue_wait_seconds_sum{job_type="GENERATE_REPORT"} 0.5',
  );
  expect(rendered).not.toMatch(/job_id=|user_id=|tenant_id=|email=/);
});

it("reports unavailable ledger gauges when collection fails", async () => {
  const metrics = createMetrics({
    job: {
      async groupBy() {
        throw new Error("Database offline");
      },
    },
    outboxEvent: {
      async count() {
        return 0;
      },
      async findFirst() {
        return null;
      },
    },
  });
  const rendered = await metrics.render();
  expect(rendered).toContain("jobflow_ledger_metrics_up 0");
  expect(rendered).not.toMatch(/^outbox_pending_count /m);
});
