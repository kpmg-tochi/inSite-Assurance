import { Router, Request, Response, NextFunction } from "express";
import { CreateIncidentReportRequestSchema } from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import { requireAnyAuth, requireRole } from "../../middleware/auth.middleware";
import { AppError } from "../../middleware/error.middleware";
import {
  createIncidentReport,
  listProjectIncidents,
  resolveIncidentReport,
} from "./incident.service";

const router = Router({ mergeParams: true });

router.post(
  "/:projectId/incidents",
  requireAnyAuth,
  validateBody(CreateIncidentReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params.projectId)
        ? req.params.projectId[0]
        : req.params.projectId;
      const reporterSessionId = req.fieldAgent?.sessionId;
      const reporterName =
        req.fieldAgent?.agentFullName ||
        req.webUser?.fullName ||
        "Field Reporter";
      const reporterTier = req.fieldAgent?.independenceTier || "WEB_USER";

      if (!reporterSessionId) {
        throw new AppError(
          "Incidents must be submitted from an active mobile field session",
          403,
          "FIELD_SESSION_REQUIRED",
        );
      }

      const result = await createIncidentReport(
        projectId,
        reporterSessionId,
        reporterName,
        reporterTier,
        req.body,
      );

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:projectId/incidents",
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params.projectId)
        ? req.params.projectId[0]
        : req.params.projectId;
      const callerRole = req.webUser?.role;
      const result = await listProjectIncidents(projectId, callerRole);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:projectId/incidents/:incidentId/status",
  requireRole("MONITOR", "LENDER"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const incidentId = Array.isArray(req.params.incidentId)
        ? req.params.incidentId[0]
        : req.params.incidentId;
      const { status } = req.body;
      const resolverName = req.webUser?.fullName || "Monitor";

      const result = await resolveIncidentReport(
        incidentId,
        status,
        resolverName,
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

export const incidentRoutes = router;
