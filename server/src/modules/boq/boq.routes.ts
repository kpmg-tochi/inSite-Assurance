import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission } from '../../middleware/auth.middleware';
import { listBoqRevisions, listProjectBoqItems } from './boq.service';

/**
 * BOQ reads (web and mobile). Redesign R2d removed the BOQ upload, mapping and preview path and the
 * contractor package suggestion: scope is edited on /scope (R2b) or imported from the workbook (R2c).
 */
const router = guardProjectRoutes(Router());

/**
 * GET /api/v1/projects/:projectId/boq
 * Lists all BOQ items (scope lines) for a project.
 */
router.get(
  '/:projectId/boq',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const items = await listProjectBoqItems(projectId);
      res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/v1/projects/:projectId/boq/revisions (legacy BOQ revisions, read-only). */
router.get(
  '/:projectId/boq/revisions',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await listBoqRevisions(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

export const boqRoutes = router;
