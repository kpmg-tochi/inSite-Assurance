import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(
    `[inSite Assurance API] Server listening on http://localhost:${env.PORT}/api/v1/health (${env.NODE_ENV})`
  );
});

async function shutdown() {
  console.log('[inSite Assurance API] Shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

