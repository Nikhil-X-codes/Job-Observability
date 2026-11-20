import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig", () => {
  it("reads defaults and explicit settings", () => {
    expect(readConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
    });
    expect(readConfig({ PORT: "65535", LOG_LEVEL: "warn" })).toMatchObject({
      port: 65535,
      logLevel: "warn",
    });
  });

  it("accepts PostgreSQL and RabbitMQ URLs", () => {
    const databaseUrl = "postgresql://localhost/jobflow";
    const amqpUrl = "amqps://localhost/jobflow";
    expect(
      readConfig({ DATABASE_URL: databaseUrl, AMQP_URL: amqpUrl }),
    ).toMatchObject({ databaseUrl, amqpUrl });
  });

  it("rejects mismatched service URL schemes without exposing credentials", () => {
    expect(() =>
      readConfig({ AMQP_URL: "https://user:secret@local.test" }),
    ).toThrow(/^Invalid environment variables: AMQP_URL$/);
  });

  it.each(["", "0", "65536", "1.5", "2e3", "secret"])(
    "rejects invalid ports without logging the value (%j)",
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow(
        /^Invalid environment variables: PORT$/,
      );
    },
  );

  it("rejects unsupported log levels", () => {
    expect(() => readConfig({ LOG_LEVEL: "verbose" })).toThrow(
      /^Invalid environment variables: LOG_LEVEL$/,
    );
  });
});
