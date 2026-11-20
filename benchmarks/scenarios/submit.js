/* global __ENV */
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const accepted = new Counter("jobflow_accepted");
const rejected = new Counter("jobflow_rejected");
const submitLatency = new Trend("jobflow_submit_ms", true);
const origin = __ENV.BENCHMARK_BASE_URL;
const workload = __ENV.BENCHMARK_WORKLOAD;
const jobs = [
  { type: "GENERATE_REPORT", payload: { reportId: "benchmark-report" } },
  {
    type: "SIMULATE_EMAIL",
    payload: { templateId: "benchmark", recipientId: "synthetic-recipient" },
  },
  { type: "MOCK_WEBHOOK", payload: { eventId: "benchmark-event" } },
];

export const options = {
  scenarios: {
    submissions: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.BENCHMARK_RATE ?? "10"),
      duration: __ENV.BENCHMARK_DURATION ?? "60s",
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.BENCHMARK_VUS ?? "20"),
    },
  },
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
        "Idempotency-Key": `${__ENV.BENCHMARK_RUN_ID}:${index}`,
      },
    },
  );
  submitLatency.add(response.timings.duration);
  if (response.status === 202) accepted.add(1);
  else rejected.add(1);
}
