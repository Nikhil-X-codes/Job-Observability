import { createDatabase } from "@jobflow/db";
import { claimExecution } from "@jobflow/db/processing";
import { decodeDelivery, queue, withQueue } from "@jobflow/queue";

const db = createDatabase(process.env.DATABASE_URL);
const leaseMs = Number(process.argv[2] ?? 1000);
await withQueue(process.env.AMQP_URL, false, async (channel, disconnected) => {
  await channel.prefetch(1);
  await channel.consume(
    queue,
    async (message) => {
      if (!message) return;
      const envelope = decodeDelivery(message.content);
      if (!envelope) {
        channel.reject(message, false);
        return;
      }
      const lease = await claimExecution(
        db,
        envelope,
        "worker-to-kill",
        leaseMs,
      );
      if (!lease) channel.ack(message);
    },
    { noAck: false },
  );
  await new Promise((resolve) =>
    disconnected.addEventListener("abort", resolve, { once: true }),
  );
});
