import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { startMorningBriefCron } from "./jobs/morningBriefCron";

const app = createApp();
const stopMorningBriefCron = startMorningBriefCron();

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(
    `[InSite Assurance API] Server listening on http://0.0.0.0:${env.PORT}/api/v1/health (${env.NODE_ENV})`,
  );
});

async function shutdown() {
  console.log("[InSite Assurance API] Shutting down gracefully...");
  stopMorningBriefCron();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
