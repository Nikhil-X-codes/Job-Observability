-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GENERATE_REPORT', 'SIMULATE_EMAIL', 'MOCK_WEBHOOK');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ErrorCode" AS ENUM ('TRANSIENT', 'PERMANENT', 'TIMEOUT', 'LEASE_EXPIRED', 'INTERNAL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128),
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "next_run_at" TIMESTAMPTZ(3),
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "attempt_number" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "replay_of_id" UUID,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "worker_id" VARCHAR(128) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "outcome" "AttemptOutcome" NOT NULL DEFAULT 'RUNNING',
    "error_code" "ErrorCode",
    "duration_ms" INTEGER,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "lock_token" UUID,
    "locked_until" TIMESTAMPTZ(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "details" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "last_error_code" "ErrorCode" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayed_at" TIMESTAMPTZ(3),
    "replay_job_id" UUID,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_effects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "effect_key" VARCHAR(128) NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" "JobType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "business_effects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_created_at_id_idx" ON "jobs"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_next_run_at_priority_idx" ON "jobs"("status", "next_run_at", "priority");

-- CreateIndex
CREATE INDEX "jobs_status_lease_expires_at_idx" ON "jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "jobs_replay_of_id_idx" ON "jobs"("replay_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenant_id_idempotency_key_key" ON "jobs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_job_id_attempt_no_key" ON "attempts"("job_id", "attempt_no");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_topic_aggregate_id_attempt_no_key" ON "outbox_events"("topic", "aggregate_id", "attempt_no");

-- CreateIndex
CREATE INDEX "job_events_job_id_occurred_at_id_idx" ON "job_events"("job_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letters_job_id_key" ON "dead_letters"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letters_replay_job_id_key" ON "dead_letters"("replay_job_id");

-- CreateIndex
CREATE INDEX "dead_letters_created_at_id_idx" ON "dead_letters"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "business_effects_effect_key_key" ON "business_effects"("effect_key");

-- CreateIndex
CREATE INDEX "business_effects_job_id_idx" ON "business_effects"("job_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_replay_of_id_fkey" FOREIGN KEY ("replay_of_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_aggregate_id_fkey" FOREIGN KEY ("aggregate_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_replay_job_id_fkey" FOREIGN KEY ("replay_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_effects" ADD CONSTRAINT "business_effects_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- State invariants enforced for ORM and SQL callers.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempt_bounds_check"
  CHECK ("max_attempts" BETWEEN 1 AND 5 AND "attempt_number" BETWEEN 0 AND "max_attempts");
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lease_state_check"
  CHECK (
    ("status" = 'RUNNING' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  );
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_number_check"
  CHECK ("attempt_no" BETWEEN 1 AND 5);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_dispatch_bounds_check"
  CHECK ("attempt_no" BETWEEN 1 AND 5 AND "retry_count" >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_lease_pair_check"
  CHECK (("locked_until" IS NULL) = ("lock_token" IS NULL));
