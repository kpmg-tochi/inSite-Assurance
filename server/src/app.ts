import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error.middleware";
import { authRoutes } from "./modules/auth/auth.routes";
import { rbacRoutes } from "./modules/rbac/rbac.routes";
import { organizationsRoutes } from "./modules/organizations/organizations.routes";
import { projectsRoutes } from "./modules/projects/projects.routes";
import { projectOverviewRoutes } from "./modules/projects/overview.routes";
import { boqRoutes } from "./modules/boq/boq.routes";
import { facilitiesRoutes } from "./modules/facilities/facilities.routes";
import { formLibraryRoutes } from "./modules/forms/formLibrary.routes";
import { visitFormRoutes } from "./modules/forms/visitForm.routes";
import { visitsRoutes } from "./modules/visits/visits.routes";
import { visitPlannerRoutes } from "./modules/visits/visitPlanner.routes";
import { projectExportRoutes, tenantExportRoutes } from "./modules/exports/screenExports.routes";
import { siteLogRoutes } from "./modules/site-log/siteLog.routes";
import { findingsRoutes } from "./modules/findings/findings.routes";
import { scopeRoutes, scopeWorkbookRoutes } from "./modules/scope/scope.routes";
import { evidenceRoutes } from "./modules/evidence/evidence.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { incidentRoutes } from "./modules/incidents/incident.routes";
import { notificationsRoutes } from "./modules/notifications/notifications.routes";
import { capturesRoutes } from "./modules/evidence/captures.routes";
import { processRoutes, workflowTemplateRoutes } from "./modules/process/process.routes";
import { closeoutRoutes } from "./modules/closeout/closeout.routes";
import { paymentsRoutes } from "./modules/payments/payments.routes";
import { projectSupervisionRoutes, supervisionRoutes } from "./modules/supervision/supervision.routes";
import { projectTypesRoutes } from "./modules/projectTypes/projectTypes.routes";
import { documentsRoutes, documentTypesRoutes } from "./modules/documents/documents.routes";
import { contractsRoutes } from "./modules/contracts/contracts.routes";
import { closureTenantRoutes, completionRoutes } from "./modules/completion/completion.routes";
import { kpiRoutes, projectKpiRoutes } from "./modules/kpis/kpis.routes";
import { regionsRoutes } from "./modules/regions/regions.routes";
import { projectRegisterRoutes } from "./modules/projectRegister/projectRegister.routes";
import { projectLotsRoutes } from "./modules/projectLots/projectLots.routes";
import { portfolioPaymentsRoutes } from "./modules/payments/portfolioPayments.routes";
import { sitesRoutes } from "./modules/sites/sites.routes";
import { contractorsRoutes } from "./modules/contractors/contractors.routes";
import { needsAssessmentRoutes } from "./modules/needsAssessment/needsAssessment.routes";
import { contractorFlagsRoutes, projectContractorFlagsRoutes } from "./modules/contractorFlags/contractorFlags.routes";
import { approvedListsRoutes, projectApprovedListRoutes } from "./modules/approvedLists/approvedLists.routes";
import { geocodeRoutes } from "./modules/geocode/geocode.routes";
import { requestContextMiddleware } from "./utils/requestContext";
import { localStorageRoutes } from "./modules/storage/localStorage.routes";
import { storageService } from "./integrations/storage.service";
import { whisperService } from "./integrations/whisper.service";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
      // Downloads (.xlsx, .pdf) name the file in Content-Disposition; the web reads it, so a
      // cross-origin web build must be allowed to see it.
      exposedHeaders: ["Content-Disposition"],
    }),
  );

  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true }));
  // Phase 7: per-request memo (process configuration is read once per request).
  app.use(requestContextMiddleware);

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
        standaloneWhisper: whisperService.isConfigured()
          ? "LIVE_STANDALONE_WHISPER"
          : env.DEMO_MODE
            ? "SIMULATED_DEMO"
            : "NOT_CONFIGURED",
        objectStorage: storageService.isCloudConfigured()
          ? "S3_COMPATIBLE"
          : "LOCAL_DISK_DEV",
      },
      timestamp: new Date().toISOString(),
    });
  });

  // API v1 Routes
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/rbac", rbacRoutes);
  app.use("/api/v1/organizations", organizationsRoutes);
  // Client demo updates D1 (wave 2): before the projects router (its /:projectId routes would take the path).
  app.use("/api/v1/projects/from-needs-assessment", needsAssessmentRoutes);
  app.use("/api/v1/projects", projectsRoutes);
  app.use("/api/v1/projects", projectOverviewRoutes); // Redesign R6c (after projectsRoutes: /portfolio/overview)
  app.use("/api/v1/projects", boqRoutes);
  app.use("/api/v1/projects", scopeRoutes); // Redesign R2b
  app.use("/api/v1/projects", visitFormRoutes); // Redesign R3c
  // UBEC IRL: screen exports (.xlsx); before visitsRoutes, whose /visits/:visitId would take the path.
  app.use("/api/v1/projects", projectExportRoutes);
  app.use("/api/v1", tenantExportRoutes);
  app.use("/api/v1/projects", visitsRoutes); // Redesign R4
  app.use("/api/v1/projects", siteLogRoutes); // Redesign R4c
  app.use("/api/v1/projects", findingsRoutes); // Redesign R4d
  app.use("/api/v1/visits", visitPlannerRoutes); // Redesign R4
  app.use("/api/v1/projects", evidenceRoutes);
  app.use("/api/v1/projects", auditRoutes);
  app.use("/api/v1/projects", incidentRoutes);
  app.use("/api/v1/projects", notificationsRoutes);
  app.use("/api/v1/projects", capturesRoutes);
  app.use("/api/v1/projects", processRoutes);
  app.use("/api/v1/projects", closeoutRoutes);
  app.use("/api/v1/projects", paymentsRoutes);
  // Phase 14: supervision workload (R5f deleted the inspections runtime)
  app.use("/api/v1/projects", projectSupervisionRoutes);
  // Phase 13
  app.use("/api/v1/projects", documentsRoutes);
  app.use("/api/v1/projects", contractsRoutes);
  app.use("/api/v1/document-types", documentTypesRoutes);
  // Phase 15: Certificate of Completion, closure checklist, ratings, lessons, closure pack
  app.use("/api/v1/projects", completionRoutes);
  app.use("/api/v1/closure", closureTenantRoutes);
  // Phase 16: programme KPIs
  app.use("/api/v1/kpis", kpiRoutes);
  app.use("/api/v1/projects", projectKpiRoutes);
  app.use("/api/v1/supervision", supervisionRoutes);
  app.use("/api/v1/workflow-templates", workflowTemplateRoutes);
  // Phase 11: delivery models
  app.use("/api/v1/project-types", projectTypesRoutes);
  app.use("/api/v1/regions", regionsRoutes);
  app.use("/api/v1/facilities", facilitiesRoutes); // Redesign R2a
  app.use("/api/v1/form-library", formLibraryRoutes); // Redesign R3
  app.use("/api/v1/scope-workbook", scopeWorkbookRoutes); // blank needs-assessment workbook
  app.use("/api/v1/project-register", projectRegisterRoutes); // UBEC IRL: bulk project import
  // Client demo updates (wave 1)
  app.use("/api/v1/project-lots", projectLotsRoutes); // C3: lots and codes
  app.use("/api/v1/payments", portfolioPaymentsRoutes); // G.2: programme-wide payments
  // Client demo updates (wave 2)
  app.use("/api/v1/projects", sitesRoutes); // C2: GET /projects/:projectId/sites
  app.use("/api/v1/contractors", contractorsRoutes); // F.1–F.3: contractor register
  // Client demo updates (wave 3)
  app.use("/api/v1/contractor-flags", contractorFlagsRoutes); // F.4: flags and decisions
  app.use("/api/v1/projects", projectContractorFlagsRoutes); // F.4: GET /projects/:projectId/contractor-flags
  app.use("/api/v1/approved-lists", approvedListsRoutes); // E3: approved lists
  app.use("/api/v1/projects", projectApprovedListRoutes); // E3: /projects/:projectId/approved-list-row
  app.use("/api/v1/geocode", geocodeRoutes); // D3: "Find address" (Google, server-side key)

  // Development object storage when S3 is not configured (never in production; see env checks).
  if (!storageService.isCloudConfigured() && env.NODE_ENV !== "production") {
    app.use("/api/v1/storage/local-dev", localStorageRoutes);
  }

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
