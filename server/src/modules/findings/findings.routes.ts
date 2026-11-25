import { NextFunction, Request, Response, Router } from 'express';
import { DismissInspectionFindingRequestSchema, ResolveInspectionFindingRequestSchema } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { dismissInspectionFinding, listInspectionFindings, resolveInspectionFinding } from './findings.service';
import { refreshUnstartedVisitForms } from '../visits/visitForms';

/**
 * Findings (redesign R4d): `/projects/:id/findings`, web only (R5f removed the old app's
 * `/inspection-findings` alias and its field resolve). Mounted at /api/v1/projects (project guard applies).
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** A finding closed by staff changes the re-check items of every unstarted visit. */
const refreshForms = (projectId: string) => async (tx: Parameters<typeof refreshUnstartedVisitForms>[0]) => {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  await refreshUnstartedVisitForms(tx, projectId, { timezone: project.timezone });
};

router.get(
  '/:projectId/findings',
  requirePermission('visits:view', 'findings:manage'),
  wrap(async (req, res) => {
    const data = await listInspectionFindings({
      projectId: String(req.params.projectId),
      principal: { webUser: req.webUser, fieldAgent: req.fieldAgent },
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      visitId: typeof req.query.visitId === 'string' ? req.query.visitId : undefined,
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/findings/:findingId/resolve',
  requirePermission('findings:manage'),
  validateBody(ResolveInspectionFindingRequestSchema),
  wrap(async (req, res) => {
    const projectId = String(req.params.projectId);
    const data = await resolveInspectionFinding({
      projectId,
      findingId: String(req.params.findingId),
      principal: { webUser: req.webUser! },
      input: req.body,
      afterChange: refreshForms(projectId),
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/findings/:findingId/dismiss',
  requirePermission('findings:manage'),
  validateBody(DismissInspectionFindingRequestSchema),
  wrap(async (req, res) => {
    const projectId = String(req.params.projectId);
    const data = await dismissInspectionFinding({ projectId, findingId: String(req.params.findingId), webUser: req.webUser!, input: req.body, afterChange: refreshForms(projectId) });
    res.json({ success: true, data });
  })
);

export const findingsRoutes = router;
