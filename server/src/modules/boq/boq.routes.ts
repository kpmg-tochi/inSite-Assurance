import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission } from '../../middleware/auth.middleware';
import { listBoqRevisions } from './boq.service';

/**
 * Legacy BOQ revisions (web, read-only). Redesign R5f removed the mobile-only GET /boq (the field app
 * reads its pack and visit forms). Redesign R2d removed the BOQ upload, mapping and preview path and the
 * contractor package suggestion: scope is edited on /scope (R2b) or imported from the workbook (R2c).
 */
const router = guardProjectRoutes(Router());

/** GET /api/v1/projects/:projectId/boq/revisions (legacy BOQ revisions, read-only). */
router.get(
  '/:projectId/boq/revisions',
  requireAnyAuthWithWebPermission('scope:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await listBoqRevisions(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

export const boqRoutes = router;
