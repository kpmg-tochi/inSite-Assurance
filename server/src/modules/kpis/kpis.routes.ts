import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { KpiQuerySchema } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { getKpiDashboard, getProjectKpis } from './kpis.service';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * GET /api/v1/kpis?projectTypeId&regionId&owningOrganizationId&from&to
 * Programme KPIs over the projects the user can see (Phase 16).
 */
const tenantRouter = Router();
tenantRouter.get(
  '/',
  requirePermission('kpis:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getKpiDashboard(req.webUser!, KpiQuerySchema.parse(req.query)) });
  })
);

/** GET /api/v1/projects/:projectId/kpis?from&to (the project guard applies). */
const projectRouter = guardProjectRoutes(Router());
projectRouter.get(
  '/:projectId/kpis',
  requirePermission('kpis:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectKpis(String(req.params.projectId), KpiQuerySchema.parse(req.query)) });
  })
);

export { tenantRouter as kpiRoutes, projectRouter as projectKpiRoutes };
