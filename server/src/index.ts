import type { Server } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { registerAllJobs, startJobRunner } from "./jobs";
import { syncPermissionCatalog } from "./modules/rbac/permissionCatalog";

let stopJobs: () => void = () => {};
let server: Server | null = null;

async function start() {
  // Redesign R7a: code owns the permission rows. Bring them in step with the catalogue before any
  // job or request can read them (renames and removals were done by migrations).
  const sync = await syncPermissionCatalog(prisma);
  if (sync.created || sync.updated) {
    console.log(`[InSite Assurance API] Permission catalogue: ${sync.created} added, ${sync.updated} updated.`);
  }

  const app = createApp();
  // Scheduled jobs (visits, message retries, milestones, KPIs, schedule badge). Each job
  // takes a database lock per tick and claims each unit of work, so several instances are safe.
  registerAllJobs();
  stopJobs = startJobRunner({ enabled: env.JOBS_ENABLED });

  if (env.NODE_ENV === "production" && env.MESSAGING_EMAIL_PROVIDER !== "resend") {
    console.warn("[InSite Assurance API] No email provider configured: kick-off notices by email will not be sent.");
  }

  server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(
      `[InSite Assurance API] Server listening on http://0.0.0.0:${env.PORT}/api/v1/health (${env.NODE_ENV})`,
    );
  });
}

async function shutdown() {
  console.log("[InSite Assurance API] Shutting down gracefully...");
  stopJobs();
  const done = async () => {
    await prisma.$disconnect();
    process.exit(0);
  };
  if (server) server.close(() => void done());
  else await done();
}

start().catch(async (err) => {
  console.error("[InSite Assurance API] Start-up failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
