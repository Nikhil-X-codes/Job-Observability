import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("API", () => {
  it("reports liveness without requiring infrastructure", async () => {
    const app = createApp({ info: vi.fn() });

    await request(app)
      .get("/health/live")
      .expect(200)
      .expect("Cache-Control", "no-store")
      .expect({ status: "ok" });
  });

  it("returns a structured 404 and logs the same server-generated request ID", async () => {
    const logger = { info: vi.fn() };
    const app = createApp(logger);
    const response = await request(app)
      .get("/missing?token=sensitive-value")
      .set("X-Request-Id", "client-supplied")
      .expect(404);
    const requestId = response.headers["x-request-id"];

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found", requestId },
    });
    expect(logger.info).toHaveBeenCalledWith({
      method: "GET",
      requestId,
      statusCode: 404,
      durationMs: expect.any(Number),
    });
  });

  it.each([
    ["ok", "ok", 200],
    ["unavailable", "ok", 503],
    ["ok", "unavailable", 503],
  ])(
    "returns readiness for PostgreSQL %s and RabbitMQ %s",
    async (postgres, rabbitmq, code) => {
      const dependencies = { postgres, rabbitmq };
      const app = createApp({ info: vi.fn() }, async () => dependencies);

      await request(app)
        .get("/health/ready")
        .expect(code)
        .expect("Cache-Control", "no-store")
        .expect({ status: code === 200 ? "ok" : "unavailable", dependencies });
      await request(app).get("/health/live").expect(200);
    },
  );

  it("redacts unexpected errors and includes the request ID", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const app = createApp(logger, async () => {
      throw new Error("sensitive error");
    });
    const response = await request(app).get("/health/ready").expect(500);

    expect(response.body).toEqual({
      error: {
        code: "INTERNAL",
        message: "Unexpected server error",
        requestId: response.headers["x-request-id"],
      },
    });
  });
});
