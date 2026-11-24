import { NextFunction, Request, Response, Router } from 'express';
import {
  AddVisitCommentRequestSchema,
  CancelVisitRequestSchema,
  CreateUnscheduledVisitRequestSchema,
  CreateVisitRequestSchema,
  DecideVisitProposalRequestSchema,
  GenerateVisitsRequestSchema,
  PublishVisitsRequestSchema,
  RaiseVisitFindingRequestSchema,
  RespondToVisitRequestSchema,
  ReviewVisitSubmissionRequestSchema,
  SaveVisitOfficersRequestSchema,
  SubmitVisitRequestSchema,
  UpdateVisitRequestSchema,
  VisitCheckInRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuth, requireAnyAuthWithWebPermission, requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import { loadVisitProject, type VisitPrincipal } from './visitCore';
import { prisma } from '../../config/prisma';
import {
  cancelVisit,
  createVisit,
  generateVisits,
  getVisitDetail,
  listProjectVisits,
  listVisitOfficers,
  publishVisits,
  rebuildVisitForm,
  saveDefaultVisitOfficers,
  updateVisit,
} from './visits.service';
import { previewVisitPlan } from './visitPlan.service';
import { decideVisitProposal, respondToVisit } from './visitResponses.service';
import {
  addVisitComment,
  checkInVisit,
  createUnscheduledVisit,
  getSubmissionDto,
  getVisitFieldPack,
  getVisitForm,
  listVisitSubmissions,
  submitVisit,
} from './visitSubmissions.service';
import { reviewVisitSubmission } from './visitAcceptance';
import { raiseVisitFinding } from '../findings/findings.service';
import { refreshUnstartedVisitForms } from './visitForms';

/**
 * Redesign R4: visits on a project, mounted at /api/v1/projects (section 7 of the R4 plan). Web staff
 * read with `visits:view` and plan with `visits:plan`; field principals (provisioned accounts) read
 * and act on the visits assigned to them (`visits:submit`).
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);
const q = (req: Request, key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined);

function principalOf(req: Request): VisitPrincipal {
  if (req.webUser) return { webUser: req.webUser };
  if (req.fieldAgent) return { fieldAgent: req.fieldAgent };
  throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
}

function fieldOnly(req: Request) {
  if (!req.fieldAgent) throw new AppError('Visits are answered from the field app', 403, 'VISIT_NEEDS_FIELD_APP');
  return req.fieldAgent;
}

// ---------------------------------------------------------------------------
// Plan (managers) and reads
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/visits',
  requireAnyAuthWithWebPermission('visits:view'),
  wrap(async (req, res) => {
    const data = await listProjectVisits(p(req, 'projectId'), principalOf(req), { from: q(req, 'from'), to: q(req, 'to'), status: q(req, 'status'), visitKind: q(req, 'visitKind') });
    res.json({ success: true, data });
  })
);

router.get(
  '/:projectId/visit-plan/preview',
  requirePermission('visits:plan'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await previewVisitPlan(p(req, 'projectId')) });
  })
);

router.get(
  '/:projectId/visit-officers',
  requirePermission('visits:plan', 'visits:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listVisitOfficers(p(req, 'projectId')) });
  })
);

router.put(
  '/:projectId/visit-officers',
  requirePermission('visits:plan'),
  validateBody(SaveVisitOfficersRequestSchema),
  wrap(async (req, res) => {
    await saveDefaultVisitOfficers(p(req, 'projectId'), req.webUser!, req.body.userIds);
    res.json({ success: true, data: await listVisitOfficers(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/visits/generate',
  requirePermission('visits:plan'),
  validateBody(GenerateVisitsRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await generateVisits(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/visits/publish',
  requirePermission('visits:plan'),
  validateBody(PublishVisitsRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await publishVisits(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

// Field: the offline Ad hoc pack and unscheduled visits (before /visits/:visitId).
router.get(
  '/:projectId/visits/field-pack',
  requireAnyAuthWithWebPermission('visits:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getVisitFieldPack(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/visits/unscheduled',
  requireAnyAuth,
  validateBody(CreateUnscheduledVisitRequestSchema),
  wrap(async (req, res) => {
    const { visit, created } = await createUnscheduledVisit(p(req, 'projectId'), fieldOnly(req), req.body);
    res.status(created ? 201 : 200).json({ success: true, data: visit });
  })
);

router.post(
  '/:projectId/visits',
  requirePermission('visits:plan'),
  validateBody(CreateVisitRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createVisit(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.get(
  '/:projectId/visits/:visitId',
  requireAnyAuthWithWebPermission('visits:view'),
  wrap(async (req, res) => {
    const viewer = req.webUser ?? null;
    const data = await getVisitDetail(p(req, 'projectId'), p(req, 'visitId'), principalOf(req), {
      submissions: (visitId) => listVisitSubmissions(visitId, viewer),
    });
    res.json({ success: true, data });
  })
);

router.patch(
  '/:projectId/visits/:visitId',
  requirePermission('visits:plan'),
  validateBody(UpdateVisitRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateVisit(p(req, 'projectId'), p(req, 'visitId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/visits/:visitId/cancel',
  requirePermission('visits:plan'),
  validateBody(CancelVisitRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await cancelVisit(p(req, 'projectId'), p(req, 'visitId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/visits/:visitId/rebuild-form',
  requirePermission('visits:plan'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await rebuildVisitForm(p(req, 'projectId'), p(req, 'visitId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/visits/:visitId/date-changes/:changeId/decide',
  requirePermission('visits:plan'),
  validateBody(DecideVisitProposalRequestSchema),
  wrap(async (req, res) => {
    const data = await decideVisitProposal({ projectId: p(req, 'projectId'), visitId: p(req, 'visitId'), changeId: p(req, 'changeId'), webUser: req.webUser!, input: req.body });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/visits/:visitId/comments',
  requireAnyAuthWithWebPermission('visits:view'),
  validateBody(AddVisitCommentRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await addVisitComment(p(req, 'projectId'), p(req, 'visitId'), principalOf(req), req.body.text) });
  })
);

router.post(
  '/:projectId/visits/:visitId/findings',
  requirePermission('inspections:manage_findings'),
  validateBody(RaiseVisitFindingRequestSchema),
  wrap(async (req, res) => {
    const projectId = p(req, 'projectId');
    const project = await loadVisitProject(prisma, projectId);
    const data = await raiseVisitFinding({
      projectId,
      visitId: p(req, 'visitId'),
      webUser: req.webUser!,
      input: req.body,
      afterRaise: (tx) => refreshUnstartedVisitForms(tx, projectId, { timezone: project.timezone }).then(() => undefined),
    });
    res.status(201).json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// Field (officers)
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/visits/:visitId/form',
  requireAnyAuthWithWebPermission('visits:view'),
  wrap(async (req, res) => {
    const data = await getVisitForm(p(req, 'projectId'), p(req, 'visitId'), principalOf(req));
    const etag = `"${data.formHash}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/visits/:visitId/respond',
  requireAnyAuth,
  validateBody(RespondToVisitRequestSchema),
  wrap(async (req, res) => {
    const data = await respondToVisit({ projectId: p(req, 'projectId'), visitId: p(req, 'visitId'), fieldAgent: fieldOnly(req), input: req.body });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/visits/:visitId/check-in',
  requireAnyAuth,
  validateBody(VisitCheckInRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await checkInVisit(p(req, 'projectId'), p(req, 'visitId'), fieldOnly(req), req.body) });
  })
);

router.post(
  '/:projectId/visits/:visitId/submissions',
  requireAnyAuth,
  validateBody(SubmitVisitRequestSchema),
  wrap(async (req, res) => {
    const { submission, created } = await submitVisit({ projectId: p(req, 'projectId'), visitId: p(req, 'visitId'), fieldAgent: fieldOnly(req), input: req.body });
    res.status(created ? 201 : 200).json({ success: true, data: submission });
  })
);

router.post(
  '/:projectId/visits/:visitId/submissions/:submissionId/review',
  requirePermission('visits:view', 'reports:approve_completion'),
  validateBody(ReviewVisitSubmissionRequestSchema),
  wrap(async (req, res) => {
    const data = await reviewVisitSubmission({
      projectId: p(req, 'projectId'),
      visitId: p(req, 'visitId'),
      submissionId: p(req, 'submissionId'),
      webUser: req.webUser!,
      input: req.body,
      load: (id, viewer) => getSubmissionDto(id, viewer),
    });
    res.json({ success: true, data });
  })
);

export const visitsRoutes = router;
