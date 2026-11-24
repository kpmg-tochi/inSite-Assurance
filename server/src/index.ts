import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { registerAllJobs, startJobRunner } from "./jobs";

const app = createApp();
// Scheduled jobs (visits, message retries, milestones, KPIs, schedule badge). Each job
// takes a database lock per tick and claims each unit of work, so several instances are safe.
registerAllJobs();
const stopJobs = startJobRunner({ enabled: env.JOBS_ENABLED });

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
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
