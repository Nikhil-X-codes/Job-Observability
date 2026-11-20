import { once } from "node:events";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";
import { createDependencyProbes, createReadinessCheck } from "./readiness.js";

it("shares concurrent checks and probes again after the dependency recovers", async () => {
  const postgres = vi
    .fn()
    .mockRejectedValueOnce(new Error("down"))
    .mockResolvedValue(undefined);
  const rabbitmq = vi.fn().mockResolvedValue(undefined);
  const check = createReadinessCheck({ postgres, rabbitmq });

  const pending = check();
  expect(check()).toBe(pending);
  expect(await pending).toEqual({ postgres: "unavailable", rabbitmq: "ok" });
  expect(postgres).toHaveBeenCalledTimes(1);
  expect(rabbitmq).toHaveBeenCalledTimes(1);
  expect(await check()).toEqual({ postgres: "ok", rabbitmq: "ok" });
});

it("releases both network checks when peers accept TCP and never speak their protocol", async () => {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = `127.0.0.1:${server.address().port}`;
  const probes = createDependencyProbes(
    {
      databaseUrl: `postgresql://jobflow:test@${address}/jobflow`,
      amqpUrl: `amqp://jobflow:test@${address}/`,
    },
    { warn: vi.fn() },
  );
  try {
    expect(await probes.check()).toEqual({
      postgres: "unavailable",
      rabbitmq: "unavailable",
    });
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      probes.close(),
      new Promise((resolve) => server.close(resolve)),
    ]);
  }
});
