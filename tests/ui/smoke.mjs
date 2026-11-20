/* global document, innerWidth */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as reservePort } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createDatabase } from "@jobflow/db";
import {
  claimExecution,
  finalizeExecution,
  leaseDispatches,
  recordDispatch,
} from "@jobflow/db/processing";
import { createMetrics } from "@jobflow/telemetry";
import { chromium } from "playwright";
import { createServer as createVite } from "vite";
import { createApp } from "../../apps/api/src/app.js";
import { parseSubmission } from "../../apps/api/src/job-input.js";
import { submitJob } from "../../apps/api/src/jobs.js";
import { hashPassword } from "../../apps/api/src/passwords.js";
import { attachRealtime } from "../../apps/api/src/realtime.js";
import { createV1Router } from "../../apps/api/src/v1.js";

const {
  TEST_DATABASE_URL,
  TEST_AMQP_URL,
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
} = process.env;
if (!TEST_DATABASE_URL || !TEST_AMQP_URL) {
  throw new Error(
    "Dashboard smoke requires a fresh migrated test database and isolated RabbitMQ vhost",
  );
}

const db = createDatabase(TEST_DATABASE_URL);
const logger = { info() {}, error() {}, warn() {} };
const processes = [];
let stopRealtime;
let web;
let browser;
const recording = process.env.JOBFLOW_DEMO_RECORDING;
async function holdFrame(page, message) {
  if (!recording) return;
  await page.evaluate((text) => {
    const caption =
      document.getElementById("demo-caption") ??
      document.createElement("aside");
    caption.id = "demo-caption";
    caption.textContent = text;
    Object.assign(caption.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(80%, 660px)",
      padding: "12px 18px",
      borderRadius: "10px",
      background: "#112237",
      color: "#fff",
      font: "600 18px/1.35 system-ui",
      textAlign: "center",
      zIndex: "10000",
      pointerEvents: "none",
    });
    document.body.append(caption);
  }, message);
  await delay(12_000);
  await page.locator("#demo-caption").evaluate((caption) => caption.remove());
}

async function freePort() {
  const server = reservePort().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(entry, ...args) {
  const child = spawn(process.execPath, [entry, ...args], {
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      AMQP_URL: TEST_AMQP_URL,
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const processHandle = { child, exit: once(child, "exit") };
  processes.push(processHandle);
  return processHandle;
}

try {
  const browserPassword = randomBytes(24).toString("hex");
  const tenant = await db.tenant.create({
    data: { slug: `browser-${randomUUID()}`, name: "Browser smoke" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: "operator@example.test",
      role: "ADMIN",
      passwordHash: await hashPassword(browserPassword),
    },
  });
  async function seedJob(type, payload) {
    return (
      await submitJob(
        db,
        user,
        parseSubmission({ type, payload }, new Date()),
        randomUUID(),
      )
    ).job;
  }
  const failed = await seedJob("MOCK_WEBHOOK", { eventId: "browser-dlq" });
  const [dispatch] = await leaseDispatches(db, { limit: 1, leaseMs: 20_000 });
  assert.equal(dispatch.jobId, failed.id);
  const failedLease = await claimExecution(
    db,
    dispatch,
    "browser-fixture",
    15_000,
  );
  await recordDispatch(db, dispatch);
  assert.equal(
    await finalizeExecution(db, failedLease, { errorCode: "PERMANENT" }),
    true,
  );

  const webPort = await freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  const metrics = createMetrics(db);
  const server = createServer(
    createApp(logger, undefined, createV1Router(db, origin, metrics), metrics),
  );
  stopRealtime = attachRealtime(server, { db, appOrigin: origin, logger });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${server.address().port}`;
  web = await createVite({
    root: "apps/web",
    server: { port: webPort, watch: null },
  });
  await web.listen();

  browser = await chromium.launch({
    ...(PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
      executablePath: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    ...(recording && { recordVideo: { dir: ".npm-cache/demo-recordings" } }),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel("Tenant").fill(tenant.slug);
  await page.getByLabel("Password").fill(browserPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await page.getByText("Live", { exact: true }).waitFor();

  await page.getByRole("link", { name: /Waiting to retry/ }).click();
  await page.waitForURL("**/jobs?status=RETRY_WAIT");
  assert.equal(
    await page.getByLabel("Status", { exact: true }).inputValue(),
    "RETRY_WAIT",
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.waitForURL("**/jobs");
  assert.equal(
    await page.getByLabel("Status", { exact: true }).inputValue(),
    "",
  );
  await page.getByRole("link", { name: "New job" }).click();
  await page.getByLabel("Report ID").fill("browser-report");
  await page.getByRole("button", { name: "Submit job" }).click();
  await page.locator('[data-status="PENDING"]').waitFor();
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await page.getByRole("button", { name: "Keep job" }).click();
  await page.locator('[data-status="PENDING"]').waitFor();
  await holdFrame(
    page,
    "PostgreSQL stores the job and its dispatch intent together.",
  );
  start("services/dispatcher/src/main.js");
  await page.locator('[data-status="QUEUED"]').waitFor();
  await holdFrame(
    page,
    "The dispatcher publishes the job to RabbitMQ with broker confirmation.",
  );
  if (recording) {
    const stalled = start("tests/broker/stall-worker.mjs", "20000");
    await page.locator('[data-status="RUNNING"]').waitFor();
    await holdFrame(
      page,
      "The first worker claims the job and holds a lease. The fixture pauses before it commits a result.",
    );
    assert.equal(stalled.child.kill("SIGKILL"), true);
    await stalled.exit;
    await holdFrame(
      page,
      "The first worker was killed before committing a result.",
    );
    start("services/scheduler/src/main.js");
    await page.getByText("Retry scheduled", { exact: true }).waitFor();
    await holdFrame(
      page,
      "The scheduler detected the expired lease, recorded a failed attempt, and scheduled a retry.",
    );
  }
  start("services/worker/src/main.js");
  await page.locator('[data-status="COMPLETED"]').waitFor();
  await page.getByText("Started", { exact: true }).first().waitFor();
  if (recording) {
    await page.getByText("Attempt 2 · Succeeded", { exact: true }).waitFor();
    const jobId = new URL(page.url()).pathname.split("/").at(-1);
    assert.equal(await db.businessEffect.count({ where: { jobId } }), 1);
  }
  await holdFrame(
    page,
    "The replacement worker completed the job. The database contains one committed effect.",
  );

  await page.getByRole("link", { name: "Dead letters" }).click();
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  const replayDialog = page.getByRole("dialog", { name: "Replay job" });
  await replayDialog.waitFor();
  assert.equal(
    await page
      .getByLabel("Reason")
      .evaluate((input) => input === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await replayDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await page.getByLabel("Reason").fill("Browser smoke recovery");
  await holdFrame(
    page,
    "An operator can replay a dead-lettered job with a recorded reason.",
  );
  await page.getByRole("button", { name: "Confirm replay" }).click();
  await page.getByRole("link", { name: "Original job" }).waitFor();
  await page.locator('[data-status="COMPLETED"]').waitFor();
  await holdFrame(
    page,
    "The replay completed as a new job linked to the original.",
  );

  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await page.getByRole("link", { name: "Generate report" }).waitFor();
  await context.setOffline(true);
  await page.getByText("Reconnecting", { exact: true }).waitFor();
  await seedJob("SIMULATE_EMAIL", {
    templateId: "browser",
    recipientId: "fixture",
  });
  await context.setOffline(false);
  await page.getByRole("link", { name: "Simulate email" }).waitFor();
  const scrape = await fetch(
    `http://127.0.0.1:${server.address().port}/metrics`,
    { signal: AbortSignal.timeout(5000) },
  );
  assert.match(await scrape.text(), /job_state_count\{status="DEAD"\} 1/);

  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("heading", { name: "Jobs by status" }).waitFor();
  await holdFrame(page, "The dashboard reloads job state after reconnecting.");
  const screenshot = process.env.JOBFLOW_SCREENSHOT_PATH;
  if (screenshot) {
    await mkdir(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await page.getByRole("heading", { name: "Jobs", exact: true }).waitFor();
  await page.getByRole("link", { name: "Generate report" }).waitFor();
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  assert.deepEqual(errors, []);
  if (recording) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(
      pathToFileURL(path.resolve("docs/assets/jobflow-grafana.png")).href,
    );
    await holdFrame(
      page,
      "Grafana capture from the native verification run. It shows completion rate and separate execution and end-to-end latency.",
    );
    const video = page.video();
    await context.close();
    await mkdir(path.dirname(recording), { recursive: true });
    await video.saveAs(recording);
  }
  console.log(
    "Browser smoke passed for sign-in, linked filters, submission, cancellation confirmation, job history, replay, reconnect, and mobile layout.",
  );
} finally {
  for (const { child } of processes) child.kill();
  await Promise.all(processes.map(({ exit }) => exit));
  await browser?.close();
  await web?.close();
  await stopRealtime?.();
  await db.$disconnect();
}
