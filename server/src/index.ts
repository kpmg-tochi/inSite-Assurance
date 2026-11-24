import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { registerAllJobs, startJobRunner } from "./jobs";
import { startAiOmissionCheckSweep } from "./modules/workday-reports/aiOmissionCheck";

const app = createApp();
// Scheduled jobs (reporting obligations, overdue reports, message retries, milestones, KPIs). Each job
// takes a database lock per tick and claims each unit of work, so several instances are safe.
registerAllJobs();
const stopJobs = startJobRunner({ enabled: env.JOBS_ENABLED });
const stopAiCheckSweep = startAiOmissionCheckSweep(env.AI_CHECK_SWEEP_INTERVAL_SECONDS);

if (env.NODE_ENV === "production" && env.MESSAGING_EMAIL_PROVIDER !== "resend") {
  console.warn("[InSite Assurance API] No email provider configured: kick-off notices by email will not be sent.");
}

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(
    `[InSite Assurance API] Server listening on http://0.0.0.0:${env.PORT}/api/v1/health (${env.NODE_ENV})`,
  );
});

async function shutdown() {
  console.log("[InSite Assurance API] Shutting down gracefully...");
  stopJobs();
  stopAiCheckSweep();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
