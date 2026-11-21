import { once } from "node:events";
import amqp from "amqplib";
import { z } from "zod";

export const queue = "jobflow.jobs";
const priorities = { LOW: 0, NORMAL: 4, HIGH: 8 };
const envelope = z.strictObject({
  jobId: z.uuid(),
  attemptNo: z.number().int().min(1).max(5),
});

export function decodeDelivery(content) {
  if (content.length > 256) return null;
  try {
    const parsed = envelope.safeParse(JSON.parse(content.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function withQueue(amqpUrl, confirm, operation) {
  const url = new URL(amqpUrl);
  if (!url.searchParams.has("heartbeat"))
    url.searchParams.set("heartbeat", "10");
  const socket = new AbortController();
  const setup = setTimeout(() => socket.abort(), 4000);
  let connection;
  try {
    connection = await amqp.connect(url.href, { signal: socket.signal });
    const disconnected = new AbortController();
    const disconnect = () => disconnected.abort();
    connection.on("error", disconnect);
    connection.on("close", disconnect);
    const channel = confirm
      ? await connection.createConfirmChannel()
      : await connection.createChannel();
    channel.on("error", disconnect);
    channel.on("close", disconnect);
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": -1,
        "x-max-length": 10000,
        "x-overflow": "reject-publish",
      },
    });
    clearTimeout(setup);
    await operation(channel, disconnected.signal);
  } finally {
    clearTimeout(setup);
    if (connection && !socket.signal.aborted) {
      const signal = AbortSignal.timeout(1000);
      try {
        await Promise.all([
          once(connection, "close", { signal }),
          connection.close(),
        ]);
      } catch {
        // A lost connection is also closed locally by aborting its socket.
      }
    }
    socket.abort();
  }
}

export function publishDispatch(
  channel,
  { id, jobId, attemptNo, priority, lockToken },
) {
  const content = Buffer.from(JSON.stringify({ jobId, attemptNo }));
  const messageId = lockToken ? `${id}:${lockToken}` : id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Publish confirmation timed out")),
      2000,
    );
    const returned = (message) => {
      if (message.properties.messageId === messageId)
        finish(new Error("Publish was unroutable"));
    };
    const closed = () => finish(new Error("Publisher channel closed"));
    function finish(error) {
      clearTimeout(timer);
      channel.off("return", returned);
      channel.off("close", closed);
      if (error) reject(error);
      else resolve();
    }
    channel.on("return", returned);
    channel.once("close", closed);
    try {
      channel.sendToQueue(
        queue,
        content,
        {
          mandatory: true,
          persistent: true,
          priority: priorities[priority] ?? priorities.NORMAL,
          contentType: "application/json",
          messageId,
        },
        finish,
      );
    } catch (error) {
      finish(error);
    }
  });
}
