import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../../middleware/auth.middleware';
import { getAndVerifyProjectAuditTrail } from './audit.service';

const router = Router();

/**
 * GET /api/v1/projects/:projectId/audit-trail
 * Accessible by MONITOR and LENDER roles.
 * Returns the full immutable hash-chained audit ledger + cryptographic chain verification status.
 */
router.get(
  '/:projectId/audit-trail',
  requireRole('MONITOR', 'LENDER'),
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

