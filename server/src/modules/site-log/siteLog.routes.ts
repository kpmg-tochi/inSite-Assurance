import { NextFunction, Request, Response, Router } from 'express';
import { CreateSiteLogEntryRequestSchema } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuth, requireAnyAuthWithWebPermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import { createSiteLogEntry, hideSiteLogEntry, listSiteLog } from './siteLog.service';

/** Redesign R4c: the officer's site log on a project (mounted at /api/v1/projects). */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);

function fieldOnly(req: Request) {
  if (!req.fieldAgent) throw new AppError('The site log is written from the field app', 403, 'VISIT_NEEDS_FIELD_APP');
  return req.fieldAgent;
}

router.get(
  '/:projectId/site-log',
  requireAnyAuthWithWebPermission('visits:view'),
  wrap(async (req, res) => {
    const data = await listSiteLog(p(req, 'projectId'), { webUser: req.webUser, fieldAgent: req.fieldAgent }, {
      mine: req.query.mine === 'true',
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
      includeAttached: req.query.includeAttached === 'true',
      includeHidden: req.query.includeHidden === 'true',
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/site-log',
  requireAnyAuth,
  validateBody(CreateSiteLogEntryRequestSchema),
  wrap(async (req, res) => {
    const { entry, created } = await createSiteLogEntry(p(req, 'projectId'), fieldOnly(req), req.body);
    res.status(created ? 201 : 200).json({ success: true, data: entry });
  })
);

router.post(
  '/:projectId/site-log/:entryId/hide',
  requireAnyAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await hideSiteLogEntry(p(req, 'projectId'), p(req, 'entryId'), fieldOnly(req)) });
  })
);

export const siteLogRoutes = router;
