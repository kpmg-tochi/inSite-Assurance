import { NextFunction, Request, Response, Router } from 'express';
import { DismissInspectionFindingRequestSchema, ResolveInspectionFindingRequestSchema } from '@insite/shared';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import { requireAnyAuth, requireAnyAuthWithWebPermission, requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { dismissInspectionFinding, listInspectionFindings, resolveInspectionFinding } from './findings.service';
import { refreshUnstartedVisitForms } from '../visits/visitForms';

/**
 * Findings (redesign R4d): `/projects/:id/findings`, with `/inspection-findings` kept as an alias
 * until R5 removes the old app's calls. Mounted at /api/v1/projects (project guard applies).
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const paths = (suffix: string) => [`/:projectId/findings${suffix}`, `/:projectId/inspection-findings${suffix}`];

/** A finding closed by staff changes the re-check items of every unstarted visit. */
const refreshForms = (projectId: string) => async (tx: Parameters<typeof refreshUnstartedVisitForms>[0]) => {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  await refreshUnstartedVisitForms(tx, projectId, { timezone: project.timezone });
};

router.get(
  paths(''),
  requireAnyAuthWithWebPermission('inspections:view', 'inspections:manage_findings', 'visits:view'),
  wrap(async (req, res) => {
    const data = await listInspectionFindings({
      projectId: String(req.params.projectId),
      principal: { webUser: req.webUser, fieldAgent: req.fieldAgent },
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      inspectionId: typeof req.query.inspectionId === 'string' ? req.query.inspectionId : undefined,
      visitId: typeof req.query.visitId === 'string' ? req.query.visitId : undefined,
    });
    res.json({ success: true, data });
  })
);

router.post(
  paths('/:findingId/resolve'),
  requireAnyAuth,
  validateBody(ResolveInspectionFindingRequestSchema),
  wrap(async (req, res) => {
    const projectId = req.fieldAgent ? projectIdForFieldWrite(req) : String(req.params.projectId);
    const data = await resolveInspectionFinding({
      projectId,
      findingId: String(req.params.findingId),
      principal: { webUser: req.webUser, fieldAgent: req.fieldAgent },
      input: req.body,
      afterChange: refreshForms(projectId),
    });
    res.json({ success: true, data });
  })
);

router.post(
  paths('/:findingId/dismiss'),
  requirePermission('inspections:manage_findings'),
  validateBody(DismissInspectionFindingRequestSchema),
  wrap(async (req, res) => {
    const projectId = String(req.params.projectId);
    const data = await dismissInspectionFinding({ projectId, findingId: String(req.params.findingId), webUser: req.webUser!, input: req.body, afterChange: refreshForms(projectId) });
    res.json({ success: true, data });
  })
);

export const findingsRoutes = router;
