import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { getProjectSites } from './sites.service';

/**
 * Client demo updates C2 (wave 2): GET /projects/:projectId/sites. Mounted at /api/v1/projects.
 * Gated like GET /scope: the project guard (visibility) plus `scope:view` for web users.
 * Sites are saved through the setup section `sites` (PUT /projects/:id/setup/sites).
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.get(
  '/:projectId/sites',
  requireAnyAuthWithWebPermission('scope:view'),
  wrap(async (req, res) => {
    const data = await getProjectSites(String(req.params.projectId));
    if (!data) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    res.json({ success: true, data });
  })
);

export const sitesRoutes = router;
