import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import { CreateTelemetryBatchSchema } from '@insite/shared';
import {
  requireAnyAuthWithWebPermission,
  requireFieldSession,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  listProjectTelemetryPings,
  recordTelemetryBatch,
} from './telemetry.service';

const router = guardProjectRoutes(Router());

/**
 * POST /api/v1/projects/:projectId/telemetry
 * Ingests presence pings recorded while the app is open, plus capture and report pings.
 * Idempotent on clientPingId; the response counts how many were new.
 */
router.post(
  '/:projectId/telemetry',
  requireFieldSession,
  validateBody(CreateTelemetryBatchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await recordTelemetryBatch({
        projectId: projectIdForFieldWrite(req),
        fieldSessionId: req.fieldAgent!.sessionId,
        actorDisplayName: `${req.fieldAgent!.agentFullName} (${req.fieldAgent!.roleName})`,
        input: req.body,
        mayCheckIn: req.fieldAgent!.permissions.includes('field:manual_checkin'),
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/telemetry
 * Returns site telemetry timeline for the Web Portal.
 */
router.get(
  '/:projectId/telemetry',
  requireAnyAuthWithWebPermission('presence:view_telemetry'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pings = await listProjectTelemetryPings({
        projectId: String(req.params.projectId),
        date: req.query.date ? String(req.query.date) : undefined,
        // Field agents only ever see their own pings.
        fieldSessionId: req.fieldAgent
          ? req.fieldAgent.sessionId
          : req.query.fieldSessionId
            ? String(req.query.fieldSessionId)
            : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data: pings });
    } catch (error) {
      next(error);
    }
  }
);

export const telemetryRoutes = router;

