import { expect, it } from "vitest";
import { retryDelay } from "./retry.js";

it("does not retry a webhook when a restored job has a larger attempt cap", () => {
  const lease = { type: "DELIVER_WEBHOOK", attemptNo: 1, maxAttempts: 5 };
  expect(retryDelay(lease, "LEASE_EXPIRED")).toBeNull();
  expect(retryDelay(lease, "TIMEOUT")).toBeNull();
});

it("adds bounded jitter to exponential delays for eligible failures", () => {
  const random = () => 0.8;
  expect(
    retryDelay({ attemptNo: 1, maxAttempts: 5 }, "TRANSIENT", random),
  ).toBe(700);
  expect(
    retryDelay({ attemptNo: 4, maxAttempts: 5 }, "LEASE_EXPIRED", random),
  ).toBe(4200);
});

it("stops at the attempt cap and treats permanent errors as terminal", () => {
  expect(retryDelay({ attemptNo: 2, maxAttempts: 2 }, "TIMEOUT")).toBeNull();
  expect(retryDelay({ attemptNo: 1, maxAttempts: 5 }, "PERMANENT")).toBeNull();
});
