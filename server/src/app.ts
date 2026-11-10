import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import { authRoutes } from './modules/auth/auth.routes';
import { projectsRoutes } from './modules/projects/projects.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { storageService } from './integrations/storage.service';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Health Check
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: 'inSite Assurance API',
      version: '0.2.0',
      storageConfigured: storageService.isCloudConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  // Core Phase 2 API Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/projects', projectsRoutes);
  app.use('/api/v1/projects', auditRoutes);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}

