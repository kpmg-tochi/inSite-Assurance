import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { getAndVerifyProjectAuditTrail } from './audit.service';

const router = guardProjectRoutes(Router());

/**
 * GET /api/v1/projects/:projectId/audit-trail
 * Accessible by roles holding `audit:view_ledger`.
 */
router.get(
  '/:projectId/audit-trail',
  requirePermission('audit:view_ledger'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const auditTrail = await getAndVerifyProjectAuditTrail(projectId);
      res.json({
        success: true,
        data: auditTrail,
      });
    } catch (error) {
      next(error);
    }
  }
);

export const auditRoutes = router;

