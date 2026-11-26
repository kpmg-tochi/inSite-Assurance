import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireWebAuth } from '../../middleware/auth.middleware';
import { getProjectOverview } from './overview.service';
import { getProjectOverviewCharts } from './overviewCharts.service';

/**
 * Redesign R6c (D-R6.18): the project Overview. Mounted at /api/v1/projects. Any web user who can
 * see the project reads it; sections follow the caller's permissions (null when not allowed).
 */
const router = guardProjectRoutes(Router());

router.get(
  '/:projectId/overview',
  requireWebAuth,
  (req: Request, res: Response, next: NextFunction) => {
    getProjectOverview(String(req.params.projectId), req.webUser!)
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  }
);

/** Design round 2026-11-26: the Overview dashboard's charts (same readers; sections follow permissions). */
router.get(
  '/:projectId/overview/charts',
  requireWebAuth,
  (req: Request, res: Response, next: NextFunction) => {
    getProjectOverviewCharts(String(req.params.projectId), req.webUser!)
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  }
);

export { router as projectOverviewRoutes };
