import { randomUUID } from "node:crypto";
import express from "express";
import { HttpError, sendError } from "./http-errors.js";

export function createApp(logger, checkReadiness, api, metrics) {
  const app = express();
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    response.setHeader("X-Request-Id", requestId);
    response.on("finish", () => {
      metrics?.requests.inc({
        method: ["GET", "POST", "HEAD", "OPTIONS"].includes(request.method)
          ? request.method
          : "OTHER",
        status: String(response.statusCode),
      });
      logger.info({
        requestId,
        method: request.method,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });

  if (metrics) {
    app.get("/metrics", async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", metrics.contentType);
      response.send(await metrics.render());
    });
  }

  app.get("/health/live", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ status: "ok" });
  });

  app.get("/health/ready", async (_request, response) => {
    const dependencies = await checkReadiness();
    const ready = Object.values(dependencies).every(
      (status) => status === "ok",
    );
    response.setHeader("Cache-Control", "no-store");
    response.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "unavailable",
      dependencies,
    });
  });

  if (api) app.use("/api/v1", api);
  else {
    app.use("/api/v1", (_request, response) =>
      sendError(response, 503, "UNAVAILABLE", "Database not configured"),
    );
  }

  app.use((_request, response) => {
    sendError(response, 404, "NOT_FOUND", "Route not found");
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof HttpError) {
      return sendError(response, error.status, error.code, error.message);
    }
    if (error.type === "entity.too.large") {
      return sendError(
        response,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body exceeds 16 KiB",
      );
    }
    if (error.type === "entity.parse.failed") {
      return sendError(
        response,
        400,
        "INVALID_JSON",
        "Invalid JSON request body",
      );
    }
    if (
      error.type === "encoding.unsupported" ||
      error.type === "charset.unsupported"
    ) {
      return sendError(
        response,
        415,
        "UNSUPPORTED_MEDIA",
        "Unsupported request encoding",
      );
    }
    const requestId = response.getHeader("X-Request-Id");
    logger.error({ requestId }, "Unexpected request error");
    sendError(response, 500, "INTERNAL", "Unexpected server error");
  });

  return app;
}
