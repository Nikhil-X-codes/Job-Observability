import { setTimeout as delay } from "node:timers/promises";
import { DeliveryError } from "./gateway.js";

const handlers = {
  async GENERATE_REPORT({ reportId }, signal) {
    await delay(120, undefined, { signal });
    return { reportId, rows: 3, completed: 2, pending: 1 };
  },
  async SIMULATE_EMAIL({ templateId, recipientId }, signal) {
    await delay(220, undefined, { signal });
    return { templateId, recipientId, delivered: true };
  },
  async MOCK_WEBHOOK({ eventId }, signal) {
    await delay(320, undefined, { signal });
    return { eventId, delivered: true };
  },
};

export function runHandler(job, signal, gateway) {
  const { type, payload } = job;
  if (type === "SEND_EMAIL" || type === "DELIVER_WEBHOOK") {
    if (!gateway) throw new DeliveryError("PERMANENT");
    return gateway(job, signal);
  }
  if (!Object.hasOwn(handlers, type)) throw new Error("Unsupported job type");
  return handlers[type](payload, signal);
}
