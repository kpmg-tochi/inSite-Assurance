import { NextFunction, Request, Response, Router } from 'express';
import { NeedsAssessmentConfirmRequestSchema, NeedsAssessmentPreviewRequestSchema } from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { confirmNeedsAssessment, previewNeedsAssessment } from './needsAssessment.service';

/**
 * Client demo updates D1 (wave 2): POST /api/v1/projects/from-needs-assessment/preview|confirm
 * (mounted before the projects router). Permission `projects:create`; the draft is created in the
 * caller's workspace.
 */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Reads the needs assessment and says what it fills and what is still needed; nothing is written. */
router.post(
  '/preview',
  requirePermission('projects:create'),
  validateBody(NeedsAssessmentPreviewRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await previewNeedsAssessment(req.webUser!, req.body) });
  })
);

/** Re-reads the checked file (same sha256) and creates the draft with its sites, work phases, units and BoQ. */
router.post(
  '/confirm',
  requirePermission('projects:create'),
  validateBody(NeedsAssessmentConfirmRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await confirmNeedsAssessment(req.webUser!, req.body) });
  })
);

export const needsAssessmentRoutes = router;
