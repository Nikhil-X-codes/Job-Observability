import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { decodeDelivery, publishDispatch, queue } from "./broker.js";

const dispatch = { id: randomUUID(), jobId: randomUUID(), attemptNo: 1 };

it("publishes a mandatory persistent envelope and waits for confirmation", async () => {
  const channel = new EventEmitter();
  channel.sendToQueue = vi.fn((_queue, _content, _options, confirm) =>
    queueMicrotask(() => confirm(null)),
  );
  await publishDispatch(channel, dispatch);
  const [target, content, options] = channel.sendToQueue.mock.calls[0];
  expect(target).toBe(queue);
  expect(decodeDelivery(content)).toEqual({
    jobId: dispatch.jobId,
    attemptNo: 1,
  });
  expect(options).toMatchObject({
    mandatory: true,
    persistent: true,
    messageId: dispatch.id,
  });
  expect(channel.listenerCount("return")).toBe(0);
});

it("treats a returned message as a failed dispatch even when confirmed", async () => {
  const channel = new EventEmitter();
  channel.sendToQueue = (_queue, _content, { messageId }, confirm) => {
    channel.emit("return", { properties: { messageId } });
    confirm(null);
  };
  await expect(publishDispatch(channel, dispatch)).rejects.toThrow(
    "unroutable",
  );
});

it("rejects malformed and excess-sized delivery envelopes", () => {
  expect(decodeDelivery(Buffer.from("{"))).toBeNull();
  expect(decodeDelivery(Buffer.alloc(257))).toBeNull();
  expect(decodeDelivery(Buffer.from(JSON.stringify(dispatch)))).toBeNull();
});

it("isolates concurrent confirms and ignores a return for a previous lease", async () => {
  const channel = new EventEmitter();
  const pending = new Map();
  channel.sendToQueue = (_queue, _content, { messageId }, confirm) =>
    pending.set(messageId, confirm);
  const current = { ...dispatch, lockToken: randomUUID() };
  const other = { ...dispatch, id: randomUUID(), lockToken: randomUUID() };
  const result = Promise.allSettled([
    publishDispatch(channel, current),
    publishDispatch(channel, other),
  ]);
  channel.emit("return", {
    properties: { messageId: `${current.id}:expired` },
  });
  channel.emit("return", {
    properties: { messageId: `${other.id}:${other.lockToken}` },
  });
  for (const confirm of pending.values()) confirm(null);
  const [accepted, rejected] = await result;
  expect(accepted.status).toBe("fulfilled");
  expect(rejected).toMatchObject({
    status: "rejected",
    reason: expect.any(Error),
  });
  expect(rejected.reason.message).toContain("unroutable");
  expect(channel.listenerCount("return")).toBe(0);
});
