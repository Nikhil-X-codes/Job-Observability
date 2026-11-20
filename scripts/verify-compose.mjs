import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const project = `jobflow-test-${randomUUID()}`;
const env = {
  ...process.env,
  JOBFLOW_API_PORT: "0",
  JOBFLOW_WEB_PORT: "0",
  JOBFLOW_POSTGRES_PORT: "0",
  JOBFLOW_AMQP_PORT: "0",
};

function compose(...args) {
  return execFileSync(
    "docker",
    ["compose", "-f", "infra/compose.yaml", "-p", project, ...args],
    {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 8 * 60_000,
    },
  ).trim();
}

async function waitFor(check) {
  const expiresAt = Date.now() + 90_000;
  let reason;
  do {
    try {
      return await check();
    } catch (error) {
      reason = error;
      await delay(1000);
    }
  } while (Date.now() < expiresAt);
  throw reason;
}

async function read(url) {
  return fetch(url, { signal: AbortSignal.timeout(5000) });
}

try {
  compose("version");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.error("Docker Compose integration tests require Docker on PATH.");
  process.exit(1);
}
try {
  compose("up", "--build", "--wait", "--wait-timeout", "150");
  const address = compose("port", "web", "8080");
  const base = `http://${address}`;
  async function checkHealth(expectedCode, dependencies) {
    const ready = await read(`${base}/health/ready`);
    assert.equal(ready.status, expectedCode);
    assert.deepEqual((await ready.json()).dependencies, dependencies);
    const live = await read(`${base}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
  }

  await waitFor(async () => {
    const page = await read(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>JobFlow<\/title>/);
  });
  const healthy = { postgres: "ok", rabbitmq: "ok" };
  await waitFor(() => checkHealth(200, healthy));
  for (const service of Object.keys(healthy)) {
    compose("stop", service);
    await waitFor(() =>
      checkHealth(503, { ...healthy, [service]: "unavailable" }),
    );
    compose("start", service);
    await waitFor(() => checkHealth(200, healthy));
  }
  console.log(
    "Compose smoke passed for startup, dependency outages, and recovery.",
  );
  const postgres = compose("port", "postgres", "5432");
  const rabbitmq = compose("port", "rabbitmq", "5672");
  compose("stop", "dispatcher", "worker", "scheduler");
  const testEnv = {
    ...env,
    TEST_DATABASE_URL: `postgresql://jobflow:jobflow_local@${postgres}/jobflow`,
    TEST_AMQP_URL: `amqp://jobflow:jobflow_local@${rabbitmq}/`,
  };
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "tests/broker"],
    { env: testEnv, stdio: "inherit", timeout: 120_000 },
  );
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "tests/integration"],
    {
      env: testEnv,
      stdio: "inherit",
      timeout: 120_000,
    },
  );
  compose(
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "jobflow",
    "jobflow_failure",
  );
  const failureUrl = testEnv.TEST_DATABASE_URL.replace(
    /\/jobflow$/,
    "/jobflow_failure",
  );
  const failureOptions = {
    env: {
      ...testEnv,
      DATABASE_URL: failureUrl,
      TEST_DATABASE_URL: failureUrl,
    },
    stdio: "inherit",
    timeout: 120_000,
  };
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    failureOptions,
  );
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "tests/failure"],
    failureOptions,
  );
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
