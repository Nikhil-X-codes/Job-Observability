/* global __ENV */
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const accepted = new Counter("jobflow_accepted");
const rejected = new Counter("jobflow_rejected");
const submitLatency = new Trend("jobflow_submit_ms", true);
const windowStart = new Trend("jobflow_window_start_ms");
const origin = __ENV.BENCHMARK_BASE_URL;
const workload = __ENV.BENCHMARK_WORKLOAD;
const rate = Number(__ENV.BENCHMARK_RATE ?? "10");
const vus = Number(__ENV.BENCHMARK_VUS ?? "20");
const burst = __ENV.BENCHMARK_BURST === "1";
const baseline = __ENV.BENCHMARK_BASELINE_RATE ?? "10";
const jobs = [
  { type: "GENERATE_REPORT", payload: { reportId: "benchmark-report" } },
  {
    type: "SIMULATE_EMAIL",
    payload: { templateId: "benchmark", recipientId: "synthetic-recipient" },
  },
  { type: "MOCK_WEBHOOK", payload: { eventId: "benchmark-event" } },
];

const constant = (rate, duration, startTime = "0s") => ({
  executor: "constant-arrival-rate",
  rate,
  duration,
  startTime,
  timeUnit: "1s",
  preAllocatedVUs: vus,
  gracefulStop: "5s",
});

export const options = {
  scenarios: burst
    ? {
        lead: constant(Number(baseline), "10s"),
        spike: constant(rate, "10s", "10s"),
        tail: constant(Number(baseline), "20s", "20s"),
      }
    : { submissions: constant(rate, __ENV.BENCHMARK_DURATION ?? "60s") },
  thresholds: {
    http_req_failed: ["rate==0"],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["med", "p(95)", "p(99)", "max"],
};

export function setup() {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !__ENV.BENCHMARK_RUN_ID) {
    throw new Error("Use a run ID and the isolated loopback benchmark target");
  }
  const response = http.post(
    `${origin}/api/v1/auth/login`,
    JSON.stringify({
      tenant: __ENV.BENCHMARK_TENANT,
      email: __ENV.BENCHMARK_EMAIL,
      password: __ENV.BENCHMARK_PASSWORD,
    }),
    { headers: { Origin: origin, "Content-Type": "application/json" } },
  );
  const cookie = response.cookies["jobflow.sid"]?.[0]?.value;
  if (response.status !== 200 || !cookie)
    throw new Error("Benchmark sign-in failed");
  return { cookie };
}

export default function submit({ cookie }) {
  const index = exec.scenario.iterationInTest;
  const stage = exec.scenario.name;
  if (index === 0 && (stage === "lead" || stage === "submissions")) {
    windowStart.add(exec.scenario.startTime);
  }
  const profile =
    workload === "report"
      ? 0
      : workload === "io"
        ? 1 + (index % 2)
        : index % jobs.length;
  const response = http.post(
    `${origin}/api/v1/jobs`,
    JSON.stringify(jobs[profile]),
    {
      cookies: { "jobflow.sid": cookie },
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": `${__ENV.BENCHMARK_RUN_ID}:${stage}:${index}`,
      },
    },
  );
  submitLatency.add(response.timings.duration, { phase: stage });
  if (response.status === 202) accepted.add(1);
  else rejected.add(1);
}
