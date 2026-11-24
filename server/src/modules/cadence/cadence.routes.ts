import { Router, Request, Response, NextFunction } from 'express';
import { ExcuseObligationRequestSchema, ReportingObligationStatusEnum } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission, requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { excuseObligation, getCadenceOverview, listObligations } from './cadence.service';

/**
 * Phase 8: cadence and reporting obligations. The participant roster, attendance alerts and the
 * field check-in status were removed in redesign R1e.
 */
const router = guardProjectRoutes(Router());

/** Comma-separated query values that belong to an enum; unknown values are ignored. */
function listParam<T extends string>(raw: unknown, schema: { safeParse: (v: unknown) => { success: boolean } }): T[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const values = raw.split(',').map((v) => v.trim()).filter((v) => schema.safeParse(v).success) as T[];
  return values.length ? values : undefined;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const pid = (req: Request) => String(req.params.projectId);

/** GET /projects/:projectId/cadence: settings, current period, its obligations and counts. */
router.get(
  '/:projectId/cadence',
  requireAnyAuthWithWebPermission('reports:view_all'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getCadenceOverview(pid(req)) });
  })
);

/** GET /projects/:projectId/reporting-obligations?periodStart=&status=&view=due */
router.get(
  '/:projectId/reporting-obligations',
  requirePermission('reports:view_all'),
  wrap(async (req, res) => {
    const data = await listObligations({
      projectId: pid(req),
      periodStart: typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined,
      status: listParam(req.query.status, ReportingObligationStatusEnum),
      dueAndOverdue: req.query.view === 'due',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  })
);

/**
 * POST /projects/:projectId/reporting-obligations/:obligationId/excuse (note required, audited).
 * R1e: was presence:manage_noshow_alerts; now the report approver's permission.
 */
router.post(
  '/:projectId/reporting-obligations/:obligationId/excuse',
  requirePermission('reports:approve_completion'),
  validateBody(ExcuseObligationRequestSchema),
  wrap(async (req, res) => {
    const data = await excuseObligation({
      projectId: pid(req),
      obligationId: String(req.params.obligationId),
      notes: req.body.notes,
      webUser: req.webUser!,
    });
    res.json({ success: true, data });
  })
);

export { router as cadenceRoutes };
