import { NextFunction, Request, Response, Router } from 'express';
import type { NeedsFileLinkDto } from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import { guardProjectRoutes } from '../../../utils/accessControl';
import { getProjectNeedsOrigin, projectNeedsOriginFile } from './needsIntegration.service';

/**
 * Needs pipeline wave 4, Track A (C5 server side): `GET /projects/:projectId/needs-origin` and its
 * files. Mounted at /api/v1/projects (app.ts); `needs-origin` is in `DRAFT_ROUTE_RE`. The project
 * guard decides who reads the project; only web users read these (the field app has no use for them).
 */
const router = guardProjectRoutes(Router());

function requireWebUser(req: Request) {
  if (!req.webUser) throw new AppError('Only web users can read the needs assessment origin', 403, 'FORBIDDEN_PERMISSION');
  return req.webUser;
}

router.get('/:projectId/needs-origin', (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => getProjectNeedsOrigin(requireWebUser(req), String(req.params.projectId)))
    .then((data) => res.json({ success: true, data }))
    .catch(next);
});

/** 302 to a signed link, or the link as JSON with `?format=json` (as the needs file routes). */
router.get('/:projectId/needs-origin/files/:scope/:id', (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => projectNeedsOriginFile(requireWebUser(req), String(req.params.projectId), String(req.params.scope), String(req.params.id)))
    .then((link: NeedsFileLinkDto) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.format === 'json') res.json({ success: true, data: link });
      else res.redirect(302, link.url);
    })
    .catch(next);
});

export const projectNeedsOriginRoutes = router;
