import { createDatabase } from "@jobflow/db";
import { emailAddress, tenantSlug } from "../apps/api/src/auth.js";
import { readConfig } from "../apps/api/src/config.js";
import { parseSubmission } from "../apps/api/src/job-input.js";
import { submitJob } from "../apps/api/src/jobs.js";
import { hashPassword } from "../apps/api/src/passwords.js";

async function seed() {
  const { databaseUrl } = readConfig(process.env);
  const slug = tenantSlug.parse(process.env.SEED_TENANT ?? "demo");
  const email = emailAddress.parse(
    process.env.SEED_ADMIN_EMAIL ?? "operator@example.test",
  );
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (
    !databaseUrl ||
    !password ||
    password.length < 16 ||
    password.length > 256
  ) {
    throw new Error(
      "DATABASE_URL and a 16–256 character SEED_ADMIN_PASSWORD are required",
    );
  }
  const passwordHash = await hashPassword(password);
  const db = createDatabase(databaseUrl);
  try {
    const tenant = await db.tenant.upsert({
      where: { slug },
      create: { slug, name: "JobFlow Demo" },
      update: {},
    });
    const identity = { tenantId: tenant.id, email };
    const admin = await db.user.upsert({
      where: { tenantId_email: identity },
      create: { ...identity, passwordHash, role: "ADMIN" },
      update: {},
    });
    if (admin.role !== "ADMIN")
      throw new Error("Seed identity is already a member");

    const demoJobs = [
      { type: "GENERATE_REPORT", payload: { reportId: "weekly-activity" } },
      {
        type: "SIMULATE_EMAIL",
        payload: { recipientId: "demo-recipient", templateId: "job-ready" },
      },
      { type: "MOCK_WEBHOOK", payload: { eventId: "demo-event" } },
    ];
    for (const body of demoJobs) {
      const result = await submitJob(
        db,
        admin,
        parseSubmission(body, new Date()),
        `seed-${body.type}`,
      );
      if (result.conflict)
        throw new Error("Seed job conflicts with an existing idempotency key");
    }
    console.log("Demo account and sample jobs are ready.");
  } finally {
    await db.$disconnect();
  }
}

try {
  await seed();
} catch {
  console.error(
    "Seed failed. Check DATABASE_URL, demo identity, and SEED_ADMIN_PASSWORD.",
  );
  process.exitCode = 1;
}
