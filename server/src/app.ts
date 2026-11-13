import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error.middleware";
import { authRoutes } from "./modules/auth/auth.routes";
import { projectsRoutes } from "./modules/projects/projects.routes";
import { boqRoutes } from "./modules/boq/boq.routes";
import { evidenceRoutes } from "./modules/evidence/evidence.routes";
import { reconciliationRoutes } from "./modules/reconciliation/reconciliation.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { incidentRoutes } from "./modules/incidents/incident.routes";
import { storageService } from "./integrations/storage.service";
import { azureOpenAiService } from "./integrations/azure-openai.service";
import { whisperService } from "./integrations/whisper.service";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true }));

  if (env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // Health & Integration Readiness Check
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: "InSite Assurance API",
      version: "0.3.0",
      integrations: {
        azureOpenAiGpt4o: azureOpenAiService.isConfigured()
          ? "LIVE_AZURE_OPENAI"
          : "DETERMINISTIC_FALLBACK",
        standaloneWhisper: whisperService.isConfigured()
          ? "LIVE_STANDALONE_WHISPER"
          : "SIMULATED_FALLBACK",
        objectStorage: storageService.isCloudConfigured()
          ? "S3_COMPATIBLE"
          : "LOCAL_DEV_SIMULATED",
      },
      timestamp: new Date().toISOString(),
    });
  });

  // API v1 Routes
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/projects", projectsRoutes);
  app.use("/api/v1/projects", boqRoutes);
  app.use("/api/v1/projects", evidenceRoutes);
  app.use("/api/v1/projects", reconciliationRoutes);
  app.use("/api/v1/projects", auditRoutes);
  app.use("/api/v1/projects", incidentRoutes);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
