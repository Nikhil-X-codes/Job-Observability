import { describe, expect, it } from "vitest";
import { parseListQuery, parseSubmission } from "./job-input.js";

const now = new Date("2026-11-20T10:00:00Z");
const email = {
  type: "SIMULATE_EMAIL",
  payload: { recipientId: "visitor_01", templateId: "job-done" },
};

describe("job submission", () => {
  it("normalizes defaults and field order for idempotency", () => {
    const one = parseSubmission(email, now);
    const two = parseSubmission(
      {
        type: email.type,
        payload: { templateId: "job-done", recipientId: "visitor_01" },
        priority: "NORMAL",
        maxAttempts: 3,
      },
      new Date(now.getTime() + 1000),
    );
    expect(one.payloadHash).toBe(two.payloadHash);
    expect(one.runAt).not.toEqual(two.runAt);
    expect(
      parseSubmission({ ...email, priority: "HIGH" }, now).payloadHash,
    ).not.toBe(one.payloadHash);
  });

  it.each([
    { ...email, payload: { ...email.payload, address: "demo@example.test" } },
    { type: "MOCK_WEBHOOK", payload: { url: "https://example.test" } },
    { ...email, maxAttempts: 6 },
    { ...email, runAt: "2027-01-01T00:00:00Z" },
    { ...email, runAt: "2026-11-20T10:00:00+01:00" },
  ])("rejects unsupported submission %j", (body) => {
    expect(parseSubmission(body, now)).toBeNull();
  });

  it("accepts UTC timestamps within the supported window", () => {
    const runAt = "2026-12-20T10:00:00Z";
    expect(parseSubmission({ ...email, runAt }, now).runAt).toEqual(
      new Date(runAt),
    );
  });
});

it("rejects malformed and unbounded job list queries", () => {
  expect(parseListQuery({})).toMatchObject({ limit: 25 });
  expect(parseListQuery({ limit: "101" })).toBeNull();
  expect(parseListQuery({ limit: ["1", "2"] })).toBeNull();
  expect(parseListQuery({ cursor: "e30" })).toBeNull();
});
