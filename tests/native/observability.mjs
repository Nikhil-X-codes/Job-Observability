import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "@jobflow/db";
import { chromium } from "playwright";
import { parseSubmission } from "../../apps/api/src/job-input.js";
import { submitJob } from "../../apps/api/src/jobs.js";

const env = process.env;
const {
  TEST_DATABASE_URL,
  TEST_AMQP_URL,
  PROMETHEUS_EXECUTABLE_PATH,
  GRAFANA_HOME,
} = env;
if (
  !TEST_DATABASE_URL ||
  !TEST_AMQP_URL ||
  !PROMETHEUS_EXECUTABLE_PATH ||
  !GRAFANA_HOME
) {
  throw new Error(
    "Set disposable PostgreSQL and RabbitMQ URLs and the native Prometheus and Grafana paths",
  );
}
const folder = path.resolve(".npm-cache", "native-observability", randomUUID());
await mkdir(folder, { recursive: true });
const db = createDatabase(TEST_DATABASE_URL);
const children = [];
let browser;

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(executable, args, variables = {}, cwd) {
  const child = spawn(executable, args, {
    cwd,
    env: { ...env, ...variables },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const run = {
    child,
    exit: once(child, "exit"),
    name: path.basename(executable),
    log: "",
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (line) => {
      run.log = (run.log + line).slice(-2400);
    });
  }
  children.push(run);
  return run;
}

async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok, `HTTP ${response.status}`);
  return response.json();
}

async function waitFor(check, timeout = 45_000, service) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (service && service.child.exitCode !== null) {
      throw new Error(
        `${service.name} exited with code ${service.child.exitCode}`,
      );
    }
    try {
      return await check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(400);
    }
  }
}

const loopback = (port) => `http://127.0.0.1:${port}`;
const terminal = 'sum(jobs_terminal_total{status="COMPLETED"})';
const completedRate = 'sum(rate(jobs_terminal_total{status="COMPLETED"}[5m]))';

try {
  const [api, dispatcher, scheduler, worker, promPort, grafanaPort] =
    await Promise.all(Array.from({ length: 6 }, freePort));
  const serviceEnv = {
    DATABASE_URL: TEST_DATABASE_URL,
    AMQP_URL: TEST_AMQP_URL,
    LOG_LEVEL: "warn",
  };
  start(process.execPath, ["apps/api/src/server.js"], {
    ...serviceEnv,
    HOST: "127.0.0.1",
    PORT: String(api),
  });
  for (const [service, port] of Object.entries({
    dispatcher,
    scheduler,
    worker,
  })) {
    start(process.execPath, [`services/${service}/src/main.js`], {
      ...serviceEnv,
      METRICS_HOST: "127.0.0.1",
      METRICS_PORT: String(port),
    });
  }
  const scrape = path.join(folder, "prometheus.yml");
  await writeFile(
    scrape,
    JSON.stringify({
      global: { scrape_interval: "2s", scrape_timeout: "1s" },
      scrape_configs: Object.entries({
        api,
        dispatcher,
        scheduler,
        worker,
      }).map(([job_name, port]) => ({
        job_name,
        static_configs: [{ targets: [`127.0.0.1:${port}`] }],
      })),
    }),
  );
  const prometheusProcess = start(PROMETHEUS_EXECUTABLE_PATH, [
    `--config.file=${scrape}`,
    `--web.listen-address=127.0.0.1:${promPort}`,
    `--storage.tsdb.path=${path.join(folder, "prometheus-data")}`,
    "--log.level=info",
  ]);
  const prometheus = loopback(promPort);
  const grafana = loopback(grafanaPort);
  const provisioning = path.join(folder, "provisioning");
  for (const section of ["datasources", "dashboards", "plugins", "alerting"]) {
    await mkdir(path.join(provisioning, section), { recursive: true });
  }
  const datasource = await readFile(
    "infra/grafana/provisioning/datasources/prometheus.yml",
    "utf8",
  );
  const dashboards = await readFile(
    "infra/grafana/provisioning/dashboards/jobflow.yml",
    "utf8",
  );
  await writeFile(
    path.join(provisioning, "datasources", "prometheus.yml"),
    datasource.replace("http://prometheus:9090", prometheus),
  );
  await writeFile(
    path.join(provisioning, "dashboards", "jobflow.yml"),
    dashboards.replace(
      "/var/lib/grafana/dashboards",
      path.resolve("infra/grafana/dashboards").replaceAll("\\", "/"),
    ),
  );
  const grafanaExecutable =
    process.platform === "win32" ? "grafana.exe" : "grafana";
  await mkdir(path.join(folder, "grafana-data"));
  await mkdir(path.join(folder, "grafana-logs"));
  const grafanaProcess = start(
    path.join(GRAFANA_HOME, "bin", grafanaExecutable),
    ["server", "--homepath", GRAFANA_HOME],
    {
      GF_SERVER_HTTP_ADDR: "127.0.0.1",
      GF_SERVER_HTTP_PORT: String(grafanaPort),
      GF_PATHS_DATA: path.join(folder, "grafana-data"),
      GF_PATHS_LOGS: path.join(folder, "grafana-logs"),
      GF_DATABASE_WAL: "true",
      ...(env.TEST_GRAFANA_DATABASE_URL && {
        GF_DATABASE_TYPE: "postgres",
        GF_DATABASE_URL: env.TEST_GRAFANA_DATABASE_URL.replace(
          /^postgresql:/,
          "postgres:",
        ),
      }),
      GF_PATHS_PROVISIONING: provisioning,
      GF_AUTH_ANONYMOUS_ENABLED: "true",
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Viewer",
      GF_SECURITY_ADMIN_PASSWORD: randomUUID(),
      GF_ANALYTICS_REPORTING_ENABLED: "false",
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false",
      GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES: "false",
      GF_PLUGINS_PREINSTALL_DISABLED: "true",
      GF_LOG_LEVEL: "info",
    },
    GRAFANA_HOME,
  );

  const query = async (base, expression) => {
    const { data } = await request(
      `${base}/api/v1/query?${new URLSearchParams({ query: expression })}`,
    );
    return Number(data.result[0]?.value[1]);
  };
  await waitFor(
    async () => assert.equal(await query(prometheus, "sum(up)"), 4),
    120_000,
    prometheusProcess,
  );
  const provisioned = await waitFor(
    () => request(`${grafana}/api/dashboards/uid/jobflow-operations`),
    420_000,
    grafanaProcess,
  );
  assert.equal(provisioned.dashboard.panels.length, 12);
  const tenant = await db.tenant.create({
    data: { slug: `metrics-${randomUUID()}`, name: "Metrics smoke" },
  });
  const actor = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: "metrics@example.test",
      passwordHash: "fixture",
    },
  });
  const input = parseSubmission(
    { type: "GENERATE_REPORT", payload: { reportId: "metrics" } },
    new Date(),
  );
  await submitJob(db, actor, input, randomUUID());
  const baseline = await waitFor(async () => {
    const count = await query(prometheus, terminal);
    assert.equal(count, 1);
    return count;
  });
  await Promise.all(
    Array.from({ length: 3 }, () => submitJob(db, actor, input, randomUUID())),
  );
  await waitFor(async () => assert.equal(await query(prometheus, terminal), 4));
  const finished = await db.job.count({
    where: { tenantId: tenant.id, status: "COMPLETED" },
  });
  assert.equal((await query(prometheus, terminal)) - baseline, finished - 1);
  const proxy = `${grafana}/api/datasources/proxy/uid/jobflow-prometheus`;
  await waitFor(async () => {
    assert.ok((await query(proxy, completedRate)) > 0);
    for (const name of [
      "job_execution_duration_seconds",
      "job_end_to_end_duration_seconds",
    ]) {
      assert.ok(
        Number.isFinite(
          await query(
            proxy,
            `histogram_quantile(0.95, sum by (le) (rate(${name}_bucket[5m])))`,
          ),
        ),
      );
    }
  });
  if (env.JOBFLOW_GRAFANA_SCREENSHOT) {
    browser = await chromium.launch({
      executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 950 },
    });
    await page.goto(`${grafana}/d/jobflow-operations?from=now-1m&to=now`);
    await page
      .getByText("Completed jobs per second", { exact: true })
      .first()
      .waitFor();
    await page.locator("canvas").first().waitFor({ timeout: 45_000 });
    await page.getByText("Cancel", { exact: true }).first().waitFor({
      state: "hidden",
      timeout: 45_000,
    });
    await page.screenshot({ path: env.JOBFLOW_GRAFANA_SCREENSHOT });
  }
  console.log(
    "Native observability passed. Four scrape targets, database count reconciliation, and live Grafana queries verified.",
  );
} catch (error) {
  for (const { child, name, log } of children) {
    if (log)
      console.error(`${name} (exit ${child.exitCode ?? "pending"})\n${log}`);
  }
  throw error;
} finally {
  await browser?.close();
  for (const { child } of children) child.kill();
  await Promise.all(children.map(({ exit }) => exit));
  await db.$disconnect();
}
