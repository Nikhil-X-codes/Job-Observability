import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const nativeTargets = path.resolve(
  "benchmarks/results/local/native-worker-targets.json",
);

async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const number = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return number;
}

export function nativeWorkerGroup(env) {
  let started = [];
  async function setTargets(targets) {
    await mkdir(path.dirname(nativeTargets), { recursive: true });
    const temporary = `${nativeTargets}.tmp`;
    await writeFile(temporary, JSON.stringify([{ targets }]));
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        await rename(temporary, nativeTargets);
        return;
      } catch (error) {
        // Prometheus may briefly have the destination open on Windows.
        if (
          process.platform !== "win32" ||
          !["EPERM", "EBUSY"].includes(error.code) ||
          Date.now() >= deadline
        )
          throw error;
        await delay(50);
      }
    }
  }
  async function stop(signal) {
    const stopping = started;
    started = [];
    for (const { child } of stopping) child.kill(signal);
    await Promise.allSettled(stopping.map(({ exited }) => exited));
    await setTargets([]);
  }
  async function scale(count) {
    await stop();
    const ports = await Promise.all(Array.from({ length: count }, port));
    const targets = ports.map((value) => `127.0.0.1:${value}`);
    for (const [index, number] of ports.entries()) {
      const child = spawn(process.execPath, ["services/worker/src/main.js"], {
        env: {
          ...env,
          LOG_LEVEL: "warn",
          WORKER_ID: `benchmark-worker-${index + 1}`,
          METRICS_HOST: "127.0.0.1",
          METRICS_PORT: String(number),
        },
        stdio: "inherit",
        windowsHide: true,
      });
      const exited = once(child, "exit");
      void exited.catch(() => {});
      started.push({ child, exited });
    }
    const until = Date.now() + 30_000;
    for (;;) {
      const readiness = await Promise.allSettled(
        targets.map(async (target) => {
          const response = await fetch(`http://${target}/metrics`, {
            signal: AbortSignal.timeout(2000),
          });
          return (
            response.ok &&
            (await response.text()).includes(
              'worker_connected{worker_group="demo"} 1',
            )
          );
        }),
      );
      if (
        readiness.every(({ status, value }) => status === "fulfilled" && value)
      )
        break;
      if (Date.now() >= until)
        throw new Error("Native benchmark workers failed to connect");
      await delay(500);
    }
    await setTargets(targets);
  }
  return { scale, stop };
}
