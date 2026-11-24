import { NextFunction, Request, Response, Router } from 'express';
import { requireAnyAuth, requirePermission } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { getPlanner } from './visitResponses.service';
import { getMyVisits } from './visitSubmissions.service';

/**
 * Redesign R4: tenant-level visit routes at /api/v1/visits. `GET /` is the web planner
 * (`visits:view`, the directory's visibility); `GET /mine` is the officer's feed across projects for
 * a signed-in mobile account (or a web user who is an assignee). Visit writes stay project-scoped.
 */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const q = (req: Request, key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined);

router.get(
  '/mine',
  requireAnyAuth,
  wrap(async (req, res) => {
    const who = req.mobileUser ?? req.webUser;
    if (!who) throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
    res.json({ success: true, data: await getMyVisits(who.userId, who.tenantId, { from: q(req, 'from'), to: q(req, 'to') }) });
  })
);

router.get(
  '/',
  requirePermission('visits:view'),
  wrap(async (req, res) => {
    const data = await getPlanner(req.webUser!, {
      from: q(req, 'from'),
      to: q(req, 'to'),
      regionId: q(req, 'regionId'),
      projectId: q(req, 'projectId'),
      officerId: q(req, 'officerId'),
      visitKind: q(req, 'visitKind'),
    });
    res.json({ success: true, data });
  })
);

export const visitPlannerRoutes = router;
