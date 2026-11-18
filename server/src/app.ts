import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error.middleware";
import { authRoutes } from "./modules/auth/auth.routes";
import { rbacRoutes } from "./modules/rbac/rbac.routes";
import { projectsRoutes } from "./modules/projects/projects.routes";
import { boqRoutes } from "./modules/boq/boq.routes";
import { evidenceRoutes } from "./modules/evidence/evidence.routes";
import { reconciliationRoutes } from "./modules/reconciliation/reconciliation.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { incidentRoutes } from "./modules/incidents/incident.routes";
import { telemetryRoutes } from "./modules/telemetry/telemetry.routes";
import { workdayReportsRoutes } from "./modules/workday-reports/workdayReports.routes";
import { morningBriefRoutes } from "./modules/morning-briefs/morningBrief.routes";
import { notificationsRoutes } from "./modules/notifications/notifications.routes";
import { wbsChatRoutes } from "./modules/wbs-chat/wbsChat.routes";
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

  // Health check. Integration and demo details are only reported outside production.
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    if (env.NODE_ENV === "production") {
      res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
      return;
    }
    res.json({
      success: true,
      status: "ok",
      service: "InSite Assurance API",
      version: "0.4.0",
      demoMode: env.DEMO_MODE,
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
  app.use("/api/v1/rbac", rbacRoutes);
  app.use("/api/v1/projects", projectsRoutes);
  app.use("/api/v1/projects", boqRoutes);
  app.use("/api/v1/projects", evidenceRoutes);
  app.use("/api/v1/projects", reconciliationRoutes);
  app.use("/api/v1/projects", auditRoutes);
  app.use("/api/v1/projects", incidentRoutes);
  app.use("/api/v1/projects", telemetryRoutes);
  app.use("/api/v1/projects", workdayReportsRoutes);
  app.use("/api/v1/projects", morningBriefRoutes);
  app.use("/api/v1/projects", notificationsRoutes);
  app.use("/api/v1/projects", wbsChatRoutes);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
