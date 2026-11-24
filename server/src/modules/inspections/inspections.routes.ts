import { Router, Request, Response, NextFunction } from 'express';
import {
  InspectionVisitTypeEnum,
  RaiseInspectionFindingRequestSchema,
  resolveProjectTypeConfig,
  ReviewSiteInspectionRequestSchema,
  SubmitSiteInspectionRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import {
  hasWebPermission,
  requireAnyAuth,
  requireAnyAuthWithWebPermission,
  requireFieldSession,
  requirePermission,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import { prisma } from '../../config/prisma';
import {
  getSiteInspection,
  InspectionPrincipal,
  listSiteInspections,
  reviewSiteInspection,
  submitSiteInspection,
} from './inspections.service';
import { raiseInspectionFinding } from '../findings/findings.service';
import { getSupervisorWorkloads } from './supervision.service';
import { buildMobileInspectionPack } from './inspectionPack.service';
import { resolveTemplateForVisit } from './checklistTemplates.service';

/**
 * Phase 14 project routes (legacy until R5): site inspections and the
 * supervision workload of a project's team. Mounted at /api/v1/projects (project guard applies).
 */
const router = guardProjectRoutes(Router());

const principalOf = (req: Request): InspectionPrincipal =>
  req.webUser ? { webUser: req.webUser } : { fieldAgent: req.fieldAgent! };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---------------------------------------------------------------------------
// Site inspections
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/inspections',
  requireAnyAuthWithWebPermission('inspections:view'),
  wrap(async (req, res) => {
    const q = req.query;
    const data = await listSiteInspections({
      projectId: String(req.params.projectId),
      principal: principalOf(req),
      visitType: typeof q.visitType === 'string' ? q.visitType : undefined,
      streamId: typeof q.streamId === 'string' ? q.streamId : undefined,
      overallFinding: typeof q.overallFinding === 'string' ? q.overallFinding : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      lateOnly: q.late === 'true',
      withOpenFindings: q.openFindings === 'true',
    });
    res.json({ success: true, data });
  })
);


/** The checklist template this project uses for a visit type (web submission form). */
router.get(
  '/:projectId/inspections/template',
  requirePermission('inspections:submit', 'inspections:view'),
  wrap(async (req, res) => {
    const visitType = InspectionVisitTypeEnum.safeParse(req.query.visitType);
    if (!visitType.success) throw new AppError('visitType is required', 400, 'VALIDATION_ERROR');
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: String(req.params.projectId) },
      select: { tenantId: true, projectTypeSnapshotJson: true },
    });
    const t = await resolveTemplateForVisit(prisma, project.tenantId, resolveProjectTypeConfig(project.projectTypeSnapshotJson), visitType.data);
    res.json({ success: true, data: t });
  })
);

/** Streams and templates for the device (also part of the baseline pack). */
router.get(
  '/:projectId/inspections/field-pack',
  requireFieldSession,
  wrap(async (req, res) => {
    const projectId = projectIdForFieldWrite(req);
    const data = await buildMobileInspectionPack({ projectId, sessionId: req.fieldAgent!.sessionId, permissions: req.fieldAgent!.permissions });
    res.json({ success: true, data });
  })
);

/** 201 when created, 200 when replaying the same clientReportId. */
router.post(
  '/:projectId/inspections',
  requireAnyAuth,
  validateBody(SubmitSiteInspectionRequestSchema),
  wrap(async (req, res) => {
    if (req.webUser && !hasWebPermission(req.webUser, 'inspections:submit')) {
      throw new AppError('Access requires permission(s): inspections:submit', 403, 'FORBIDDEN_PERMISSION');
    }
    const projectId = req.fieldAgent ? projectIdForFieldWrite(req) : String(req.params.projectId);
    const result = await submitSiteInspection({ projectId, principal: principalOf(req), input: req.body });
    res.status(result.created ? 201 : 200).json({ success: true, data: result.inspection });
  })
);

router.get(
  '/:projectId/inspections/:inspectionId',
  requireAnyAuthWithWebPermission('inspections:view'),
  wrap(async (req, res) => {
    const principal = principalOf(req);
    const inspection = await getSiteInspection(String(req.params.projectId), String(req.params.inspectionId), principal);
    // A field session reads only its own inspections.
    const f = principal.fieldAgent;
    if (f) {
      const own = await prisma.siteInspectionReport.count({
        where: {
          id: inspection.id,
          OR: f.userId ? [{ reporterUserId: f.userId }, { reporterFieldSessionId: f.sessionId }] : [{ reporterFieldSessionId: f.sessionId }],
        },
      });
      if (!own) throw new AppError('Inspection not found', 404, 'INSPECTION_NOT_FOUND');
    }
    res.json({ success: true, data: inspection });
  })
);

router.post(
  '/:projectId/inspections/:inspectionId/review',
  requireWebAuth,
  validateBody(ReviewSiteInspectionRequestSchema),
  wrap(async (req, res) => {
    const data = await reviewSiteInspection({
      projectId: String(req.params.projectId),
      inspectionId: String(req.params.inspectionId),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/inspections/:inspectionId/findings',
  requirePermission('inspections:manage_findings'),
  validateBody(RaiseInspectionFindingRequestSchema),
  wrap(async (req, res) => {
    const data = await raiseInspectionFinding({
      projectId: String(req.params.projectId),
      inspectionId: String(req.params.inspectionId),
      webUser: req.webUser!,
      input: req.body,
    });
    res.status(201).json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

// Findings: moved to modules/findings/findings.routes.ts (redesign R4d; /inspection-findings is an alias).

// ---------------------------------------------------------------------------
// Supervision workload (team step)
// ---------------------------------------------------------------------------

/** GET /projects/:id/supervision/workload?userIds=a,b: workloads as if these users joined this project. */
router.get(
  '/:projectId/supervision/workload',
  requirePermission('projects:edit_baseline', 'inspections:view'),
  wrap(async (req, res) => {
    const raw = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 200);
    const data = await getSupervisorWorkloads({ tenantId: req.webUser!.tenantId, userIds, forProjectId: String(req.params.projectId) });
    res.json({ success: true, data });
  })
);

export const inspectionsRoutes = router;
