import { spawnSync, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import path from "node:path";
import { createDatabase } from "@jobflow/db";
import {
  nativeTargets,
  nativeWorkerGroup,
} from "./benchmark-native-workers.mjs";
import { reconcileRun } from "./benchmark-report.mjs";

const env = process.env;
const target = env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:5173";
const prometheus = env.BENCHMARK_PROMETHEUS_URL ?? "http://127.0.0.1:9090";
const project = env.BENCHMARK_COMPOSE_PROJECT ?? "jobflow-bench";
const runtime = env.BENCHMARK_RUNTIME ?? "compose";
const workers = (env.BENCHMARK_WORKERS ?? "1,2,4,8").split(",").map(Number);
const workload = env.BENCHMARK_WORKLOAD ?? "mixed";
const rates = (env.BENCHMARK_RATES ?? env.BENCHMARK_RATE ?? "10")
  .split(",")
  .map(Number);
const burst = env.BENCHMARK_BURST === "1";
const baselineRate = Number(env.BENCHMARK_BASELINE_RATE ?? 10);
const duration = Number(
  (env.BENCHMARK_DURATION ?? "60s").match(/^(\d+)s$/)?.[1],
);
const warmupSeconds = Number(env.BENCHMARK_WARMUP_SECONDS ?? 15);
const vus = Number(env.BENCHMARK_VUS ?? 20);
const repetitions = Number(env.BENCHMARK_REPETITIONS ?? 3);
const validRate = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 1000;

if (
  env.BENCHMARK_ISOLATED !== "1" ||
  ![target, prometheus].every((url) =>
    /^http:\/\/127\.0\.0\.1:\d+$/.test(url),
  ) ||
  !["native", "compose"].includes(runtime) ||
  (runtime === "compose" && !/^jobflow-bench(?:-[a-z0-9]+)?$/.test(project)) ||
  (runtime === "native" &&
    (!env.AMQP_URL || !env.BENCHMARK_RABBITMQ_VERSION)) ||
  !workers.every((count) => [1, 2, 4, 8].includes(count)) ||
  !["report", "io", "mixed"].includes(workload) ||
  !rates.every(validRate) ||
  new Set(rates).size !== rates.length ||
  !validRate(baselineRate) ||
  (burst && rates.some((rate) => rate <= baselineRate)) ||
  !Number.isInteger(duration) ||
  duration < 5 ||
  duration > 600 ||
  !Number.isInteger(warmupSeconds) ||
  warmupSeconds < 1 ||
  warmupSeconds > 60 ||
  !Number.isInteger(vus) ||
  vus < 1 ||
  vus > 300 ||
  !Number.isInteger(repetitions) ||
  repetitions < 3 ||
  repetitions > 20 ||
  !env.DATABASE_URL ||
  !env.BENCHMARK_TENANT ||
  !env.BENCHMARK_EMAIL ||
  !env.BENCHMARK_PASSWORD
) {
  throw new Error(
    "Set isolated benchmark environment, loopback target, supported worker counts, workload, credentials, and database URL",
  );
}

const command = (program, args, options = {}) =>
  execFileSync(program, args, {
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  })?.trim() ?? "";
const sha = command("git", ["rev-parse", "HEAD"]);
if (command("git", ["status", "--porcelain"]))
  throw new Error("Commit the benchmark source before collecting evidence");
const composeArgs = [
  "compose",
  "-f",
  "infra/compose.yaml",
  "-p",
  project,
  "--profile",
  "observability",
];
const compose = (...args) =>
  command("docker", [...composeArgs, ...args], { stdio: "inherit" });
if (
  runtime === "compose" &&
  `http://${command("docker", [...composeArgs, "port", "web", "8080"])}` !==
    target
) {
  throw new Error(
    "Benchmark target must match the web port of the isolated Compose project",
  );
}
if (
  runtime === "native" &&
  ![env.DATABASE_URL, env.AMQP_URL].every(
    (value) => new URL(value).hostname === "127.0.0.1",
  )
) {
  throw new Error(
    "Native benchmark dependencies must be local to the isolated host",
  );
}
const readiness = await fetch(`${target}/health/ready`, {
  signal: AbortSignal.timeout(5000),
});
if (!readiness.ok || (await readiness.json()).status !== "ok")
  throw new Error("The benchmark API dependencies are unavailable");
const k6Version = command("k6", ["version"]);
const directory = path.resolve(
  "benchmarks/results/local",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(directory, { recursive: true });
const meta = {
  sha,
  k6Version,
  nodeVersion: process.version,
  date: new Date(),
  workers,
  workload,
  rates,
  profile: burst ? "burst" : "constant",
  baselineRate: burst ? baselineRate : undefined,
  repetitions,
  runtime,
  duration: burst ? "40s" : `${duration}s`,
  warmupSeconds,
  vus,
  writeRateLimit: env.WRITE_RATE_LIMIT
    ? Number(env.WRITE_RATE_LIMIT)
    : undefined,
  ...(runtime === "compose"
    ? {
        composeVersion: command("docker", ["compose", "version", "--short"]),
        images: command("docker", [
          ...composeArgs,
          "images",
          "--format",
          "json",
        ]),
      }
    : { rabbitmqVersion: env.BENCHMARK_RABBITMQ_VERSION, nativeTargets }),
  host: {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCores: cpus().length,
    memoryBytes: totalmem(),
  },
};
const db = createDatabase(env.DATABASE_URL);
const results = [];
const native = runtime === "native" ? nativeWorkerGroup(env) : null;

async function sampleMetrics(startedAt, endedAt) {
  const queries = {
    cpu: "rate(jobflow_process_cpu_seconds_total[10s])",
    rss: "jobflow_process_resident_memory_bytes",
    states: "job_state_count",
    outboxLag: "outbox_oldest_due_seconds",
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([name, query]) => {
      const args = new URLSearchParams({
        query,
        start: String(startedAt.getTime() / 1000),
        end: String(endedAt.getTime() / 1000),
        step: "2s",
      });
      const response = await fetch(`${prometheus}/api/v1/query_range?${args}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Benchmark metric query failed");
      const body = await response.json();
      if (body.status !== "success")
        throw new Error("Benchmark metric query failed");
      return [name, body.data.result];
    }),
  );
  return Object.fromEntries(entries);
}

try {
  const [postgres] = await db.$queryRaw`
    SELECT current_setting('server_version') AS "postgresVersion",
      current_setting('fsync') AS fsync,
      current_setting('synchronous_commit') AS "synchronousCommit"
  `;
  if (postgres.fsync !== "on" || postgres.synchronousCommit !== "on")
    throw new Error("The benchmark requires durable PostgreSQL commits");
  await writeFile(
    path.join(directory, "environment.json"),
    JSON.stringify({ ...meta, ...postgres }, null, 2),
  );
  for (const count of workers) {
    if (native) await native.scale(count);
    else
      compose("up", "-d", "--no-deps", "--scale", `worker=${count}`, "worker");
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (let offset = 0; offset < rates.length; offset += 1) {
        const rate = rates[(offset + repetition - 1) % rates.length];
        await measure(count, repetition, rate, true);
        await measure(count, repetition, rate, false);
      }
    }
  }
} finally {
  await Promise.all([db.$disconnect(), native?.stop()]);
}

async function measure(count, repetition, rate, warmup) {
  const runId = randomUUID();
  const file = `${count}-${rate}-${repetition}`;
  const summaryPath = path.join(
    directory,
    `${file}-${warmup ? "warmup" : "measured"}.json`,
  );
  const launchAt = new Date();
  const seconds = warmup ? warmupSeconds : burst ? 40 : duration;
  const run = spawnSync(
    "k6",
    ["run", "--summary-export", summaryPath, "benchmarks/scenarios/submit.js"],
    {
      env: {
        ...env,
        BENCHMARK_BASE_URL: target,
        BENCHMARK_WORKLOAD: workload,
        BENCHMARK_RATE: String(warmup ? Math.min(rate, 15) : rate),
        BENCHMARK_RUN_ID: runId,
        BENCHMARK_DURATION: `${seconds}s`,
        BENCHMARK_BURST: !warmup && burst ? "1" : "0",
        BENCHMARK_BASELINE_RATE: String(baselineRate),
      },
      stdio: "inherit",
      timeout: 20 * 60_000,
    },
  );
  if (run.error) throw run.error;
  const exitAt = new Date();
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const metrics = summary.metrics;
  const startMs = metrics.jobflow_window_start_ms?.med;
  if (
    !Number.isSafeInteger(startMs) ||
    startMs < +launchAt ||
    startMs > +exitAt
  )
    throw new Error(`Missing k6 scenario timestamp in ${summaryPath}`);
  const startedAt = new Date(startMs);
  const endedAt = new Date(startMs + seconds * 1000);
  const report = await reconcileRun(db, env.BENCHMARK_TENANT, runId, {
    startedAt,
    endedAt,
    drainMs: 120_000,
  });
  const accepted = metrics.jobflow_accepted;
  const reportedAccepted = accepted?.count ?? accepted?.values?.count ?? 0;
  const record = {
    workerCount: count,
    repetition,
    warmup,
    rate: warmup ? Math.min(rate, 15) : rate,
    profile: !warmup && burst ? "burst" : "constant",
    runId,
    startedAt,
    endedAt,
    k6ExitCode: run.status,
    reportedAccepted,
    rejected: metrics.jobflow_rejected?.count ?? 0,
    droppedIterations: metrics.dropped_iterations?.count ?? 0,
    submitMs: metrics.jobflow_submit_ms,
    ...report,
  };
  results.push(record);
  await writeFile(
    path.join(directory, "results.json"),
    JSON.stringify(results, null, 2),
  );
  if (!warmup) {
    const metrics = await sampleMetrics(
      startedAt,
      new Date(+endedAt + report.drainMs),
    );
    await writeFile(
      path.join(directory, `${file}-prometheus.json`),
      JSON.stringify(metrics, null, 2),
    );
  }
  if (
    run.status !== 0 ||
    !report.accepted ||
    report.accepted !== reportedAccepted ||
    record.rejected ||
    record.droppedIterations ||
    report.completed !== report.accepted ||
    report.remaining ||
    report.duplicateEffects ||
    report.missingCompletedEffects
  ) {
    throw new Error(`Failed run retained for review in ${directory}`);
  }
}
const groups = workers.flatMap((workerCount) =>
  rates.map((rate) => {
    const samples = results
      .filter(
        (run) =>
          !run.warmup && run.workerCount === workerCount && run.rate === rate,
      )
      .map((run) => run.completionsPerSecond)
      .sort((a, b) => a - b);
    const floor = Math.floor((samples.length - 1) / 2);
    const ceil = Math.ceil((samples.length - 1) / 2);
    return {
      workerCount,
      rate,
      minimum: samples[0],
      median: (samples[floor] + samples[ceil]) / 2,
      maximum: samples.at(-1),
    };
  }),
);
await writeFile(
  path.join(directory, "summary.json"),
  JSON.stringify(
    groups.map((group) => {
      const baseline = groups.find(
        ({ workerCount, rate }) => workerCount === 1 && rate === group.rate,
      )?.median;
      return {
        ...group,
        speedupFromOneWorker: baseline ? group.median / baseline : null,
      };
    }),
    null,
    2,
  ),
);
console.log(`Benchmark artifacts saved to ${directory}`);
