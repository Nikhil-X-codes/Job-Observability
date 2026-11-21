import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { createSessions } from "./auth.js";
import { HttpError, sendError } from "./http-errors.js";
import {
  externalJobTypes,
  idempotencyKey,
  jobId,
  parseListQuery,
  parseSubmission,
} from "./job-input.js";
import { publicJob, readPage, submitJob } from "./jobs.js";
import { cancelJob, replayJob } from "./operators.js";
import { readOverview } from "./overview.js";

const publicAttempt = {
  id: true,
  attemptNo: true,
  workerId: true,
  startedAt: true,
  finishedAt: true,
  outcome: true,
  errorCode: true,
  durationMs: true,
};
const publicEvent = {
  id: true,
  eventType: true,
  occurredAt: true,
  details: true,
};
const replayBody = z.strictObject({
  reason: z.string().trim().min(1).max(200),
});

function requireAdmin(request, _response, next) {
  if (request.user.role !== "ADMIN") {
    throw new HttpError(403, "FORBIDDEN", "Administrator access required");
  }
  next();
}

function limiter(limit, keyGenerator) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (_request, response) =>
      sendError(response, 429, "RATE_LIMITED", "Too many requests"),
  });
}

function pagination(query) {
  const filters = parseListQuery(query);
  if (!filters || filters.status || filters.type) {
    throw new HttpError(400, "INVALID_FILTERS", "Invalid pagination query");
  }
  return filters;
}

export function createV1Router(
  db,
  appOrigin,
  metrics,
  writeRateLimit = 60,
  deliveryTenantId,
) {
  const router = express.Router();
  const sessions = createSessions(db, appOrigin);
  const writeLimit = limiter(
    writeRateLimit,
    (request) => request.user.tenantId,
  );
  const readJson = express.json({ limit: 16 * 1024, inflate: false });

  router.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.get("Origin") !== appOrigin
    ) {
      throw new HttpError(
        403,
        "INVALID_ORIGIN",
        "Request origin is not allowed",
      );
    }
    next();
  });
  router.post("/auth/login", limiter(10), readJson, sessions.login);
  router.use(sessions.authenticate);
  router.post("/auth/logout", writeLimit, sessions.logout);
  router.get("/me", (request, response) => response.json(request.user));
  const canDeliver = (user) =>
    user.role === "ADMIN" && user.tenantId === deliveryTenantId;
  router.get("/job-capabilities", (request, response) =>
    response.json({ externalDelivery: canDeliver(request.user) }),
  );

  router.post("/jobs", writeLimit, readJson, async (request, response) => {
    const key = idempotencyKey.safeParse(request.get("Idempotency-Key"));
    const input = parseSubmission(request.body, new Date());
    if (!key.success || !input) {
      throw new HttpError(400, "INVALID_JOB", "Invalid job submission");
    }
    if (externalJobTypes.includes(input.type)) {
      if (!canDeliver(request.user)) {
        throw new HttpError(
          403,
          "DELIVERY_FORBIDDEN",
          "External delivery is unavailable for this account",
        );
      }
      if (!key.data)
        throw new HttpError(
          400,
          "IDEMPOTENCY_REQUIRED",
          "External delivery requires an Idempotency-Key header",
        );
    }
    const result = await submitJob(db, request.user, input, key.data);
    if (result.conflict) {
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key already used",
      );
    }
    response.status(202).json(result.job);
  });

  router.get("/jobs", async (request, response) => {
    const filters = parseListQuery(request.query);
    if (!filters)
      throw new HttpError(400, "INVALID_FILTERS", "Invalid list filters");
    const { status, type } = filters;
    response.json(
      await readPage(
        db.job,
        { tenantId: request.user.tenantId, status, type },
        publicJob,
        filters,
      ),
    );
  });

  router.param("id", async (request, _response, next, value) => {
    const id = jobId.safeParse(value);
    if (!id.success)
      throw new HttpError(400, "INVALID_JOB_ID", "Invalid job ID");
    const job = await db.job.findUnique({
      where: { id: id.data, tenantId: request.user.tenantId },
      select: publicJob,
    });
    if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
    request.job = job;
    next();
  });
  router.get("/jobs/:id", (request, response) => response.json(request.job));
  router.post("/jobs/:id/cancel", writeLimit, async (request, response) => {
    const job = await cancelJob(db, request.user, request.job.id);
    metrics?.terminalJob(job);
    response.json(job);
  });
  router.get("/jobs/:id/attempts", async (request, response) => {
    response.json(
      await readPage(
        db.attempt,
        { jobId: request.job.id },
        publicAttempt,
        pagination(request.query),
        "startedAt",
      ),
    );
  });
  router.get("/jobs/:id/events", async (request, response) => {
    response.json(
      await readPage(
        db.jobEvent,
        { jobId: request.job.id },
        publicEvent,
        pagination(request.query),
        "occurredAt",
      ),
    );
  });

  router.get("/admin/overview", requireAdmin, async (request, response) => {
    response.json(await readOverview(db, request.user.tenantId));
  });
  router.get("/admin/dlq", requireAdmin, async (request, response) => {
    response.json(
      await readPage(
        db.deadLetter,
        { job: { tenantId: request.user.tenantId } },
        undefined,
        pagination(request.query),
      ),
    );
  });
  router.post(
    "/admin/dlq/:letterId/replay",
    requireAdmin,
    writeLimit,
    readJson,
    async (request, response) => {
      const letter = jobId.safeParse(request.params.letterId);
      const body = replayBody.safeParse(request.body);
      if (!letter.success || !body.success) {
        throw new HttpError(400, "INVALID_REPLAY", "Invalid replay request");
      }
      response
        .status(202)
        .json(await replayJob(db, request.user, letter.data, body.data.reason));
    },
  );
  return router;
}
