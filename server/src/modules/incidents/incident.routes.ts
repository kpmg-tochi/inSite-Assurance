import { Router, Request, Response, NextFunction } from "express";
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import {
  CreateIncidentReportRequestSchema,
  UpdateIncidentStatusRequestSchema,
} from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import {
  requireAnyAuth,
  requireFieldSession,
  requirePermission,
} from "../../middleware/auth.middleware";
import {
  createIncidentReport,
  listProjectIncidents,
  resolveIncidentReport,
} from "./incident.service";

const router = guardProjectRoutes(Router({ mergeParams: true }));

router.post(
  "/:projectId/incidents",
  requireFieldSession,
  validateBody(CreateIncidentReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      projectIdForFieldWrite(req);
      const result = await createIncidentReport(req.fieldAgent!, req.body);
      res.status(result.created ? 201 : 200).json({ success: true, data: result.incident });
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
      const result = await listProjectIncidents({
        projectId: String(req.params.projectId),
        webUser: req.webUser,
        fieldAgent: req.fieldAgent,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:projectId/incidents/:incidentId/status",
  requirePermission("audit:view_ledger", "reports:raise_query"),
  validateBody(UpdateIncidentStatusRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params.projectId)
        ? req.params.projectId[0]
        : req.params.projectId;
      const incidentId = Array.isArray(req.params.incidentId)
        ? req.params.incidentId[0]
        : req.params.incidentId;

      const result = await resolveIncidentReport({
        projectId,
        incidentId,
        status: req.body.status,
        webUser: req.webUser!,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

export const incidentRoutes = router;
