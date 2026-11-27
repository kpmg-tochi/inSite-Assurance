import { NextFunction, Request, Response, Router } from 'express';
import { NeedsSubmissionKindEnum } from '@insite/shared';
import { requirePermission } from '../../../middleware/auth.middleware';
import { loadVisibleCycle } from '../needsAccess';
import { getSubmission, listCycleSubmissions } from './submissions.service';

/**
 * Needs pipeline wave 4 (main thread): reading cycle submissions. Mounted at /api/v1/needs before
 * `needsRoutes`. Each kind's writes live in its track's route file (portfolio and out-of-cycle:
 * `needsApproval.routes.ts`; BEAP and funding: `needsFunding.routes.ts`).
 */
export const needsSubmissionsRoutes = Router();

const param = (req: Request, name: string): string => String(req.params[name] ?? '');
const send =
  (fn: (req: Request) => Promise<unknown>, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const VIEW = requirePermission('needs:view');

needsSubmissionsRoutes.get(
  '/cycles/:cycleId/submissions',
  VIEW,
  send(async (req) => {
    await loadVisibleCycle(req.webUser!, param(req, 'cycleId'));
    const kind = NeedsSubmissionKindEnum.safeParse(req.query.kind);
    return listCycleSubmissions(req.webUser!, param(req, 'cycleId'), kind.success ? kind.data : null);
  })
);
needsSubmissionsRoutes.get('/submissions/:submissionId', VIEW, send((req) => getSubmission(req.webUser!, param(req, 'submissionId'))));
