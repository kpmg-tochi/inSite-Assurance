import { Router, Request, Response, NextFunction } from 'express';
import { RegisterCaptureRequestSchema } from '@insite/shared';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import { requireFieldSession } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { listOwnCaptures, registerCapture } from './evidence.service';

const router = guardProjectRoutes(Router());

/**
 * POST /api/v1/projects/:projectId/captures
 * Registers one uploaded capture. 201 when created, 200 when replaying an earlier registration.
 */
router.post(
  '/:projectId/captures',
  requireFieldSession,
  validateBody(RegisterCaptureRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await registerCapture({
        projectId: projectIdForFieldWrite(req),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.status(result.created ? 201 : 200).json({ success: true, data: result.capture });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/captures/mine?since=ISO
 * The calling field agent's own registered captures (device reconciliation).
 */
router.get(
  '/:projectId/captures/mine',
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      projectIdForFieldWrite(req);
      const since = typeof req.query.since === 'string' ? new Date(req.query.since) : undefined;
      const captures = await listOwnCaptures(
        req.fieldAgent!,
        since && !Number.isNaN(since.getTime()) ? since : undefined
      );
      res.json({ success: true, data: captures });
    } catch (error) {
      next(error);
    }
  }
);

export const capturesRoutes = router;
