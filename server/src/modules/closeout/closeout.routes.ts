import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  AssignDefectTicketRequestSchema,
  CertifyRetentionReleaseRequestSchema,
  ChangeProjectPhaseRequestSchema,
  ConvertSnagsRequestSchema,
  CreateDefectTicketRequestSchema,
  CreateHandoverLinkRequestSchema,
  LenderTrancheDecisionRequestSchema,
  RectifyDefectTicketRequestSchema,
  ReissueHandoverLinkRequestSchema,
  RejectDefectTicketRequestSchema,
  RequestRetentionReleaseRequestSchema,
  ReviewHandoverSubmissionRequestSchema,
  VerifyDefectTicketRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  requireAnyAuthWithWebPermission,
  requirePermission,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { recordLenderTrancheDecision } from '../reconciliation/reconciliation.service';
import { changeProjectPhase, getProjectPhase } from './projectPhase.service';
import {
  createHandoverLink,
  listHandoverLinks,
  listHandoverSubmissions,
  reissueHandoverLink,
  reviewHandoverSubmission,
  revokeHandoverLink,
} from './handover.service';
import {
  assignDefectTicket,
  createDefectTicket,
  createTicketsFromSnags,
  defectViewerFor,
  getDefectTicket,
  listDefectTickets,
  rectifyDefectTicket,
  rejectDefectTicket,
  verifyDefectTicket,
} from './defects.service';
import {
  cancelRetentionRelease,
  certifyRetentionRelease,
  getRetentionSummary,
  requestRetentionRelease,
  retentionValuationTranche,
} from './retention.service';

/**
 * Phase 10 project routes: construction phase, handover links and review, defect tickets and
 * retention. Every route is behind the project guard; module switches are enforced by the
 * services (404 when off).
 */
const router = guardProjectRoutes(Router());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const p = (req: Request, name: string) => String(req.params[name]);

// ---------------------------------------------------------------------------
// Construction phase
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/phase',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectPhase(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/phase',
  requirePermission('projects:edit_baseline'),
  validateBody(ChangeProjectPhaseRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await changeProjectPhase({ projectId: p(req, 'projectId'), webUser: req.webUser!, input: req.body }) });
  })
);

// ---------------------------------------------------------------------------
// Handover (authenticated side)
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/handover/links',
  requirePermission('handover:manage_links', 'handover:review_feedback'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listHandoverLinks(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/handover/links',
  requirePermission('handover:manage_links'),
  validateBody(CreateHandoverLinkRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createHandoverLink(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/handover/links/:linkId/revoke',
  requirePermission('handover:manage_links'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await revokeHandoverLink(p(req, 'projectId'), p(req, 'linkId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/handover/links/:linkId/reissue',
  requirePermission('handover:manage_links'),
  validateBody(ReissueHandoverLinkRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await reissueHandoverLink(p(req, 'projectId'), p(req, 'linkId'), req.webUser!, req.body) });
  })
);

router.get(
  '/:projectId/handover/submissions',
  requirePermission('handover:review_feedback'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listHandoverSubmissions(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/handover/submissions/:submissionId/review',
  requirePermission('handover:review_feedback'),
  validateBody(ReviewHandoverSubmissionRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await reviewHandoverSubmission(p(req, 'projectId'), p(req, 'submissionId'), req.webUser!, req.body),
    });
  })
);

/** Turns the submission's snags into defect tickets (also needs retention:manage_defects). */
router.post(
  '/:projectId/handover/submissions/:submissionId/defects',
  requirePermission('handover:review_feedback'),
  validateBody(ConvertSnagsRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await createTicketsFromSnags(p(req, 'projectId'), p(req, 'submissionId'), req.webUser!, req.body),
    });
  })
);

// ---------------------------------------------------------------------------
// Defect tickets (web and mobile)
// ---------------------------------------------------------------------------

/** Field sessions need retention:manage_defects on their role to see defects at all. */
function requireFieldDefectPermission(req: Request) {
  if (req.fieldAgent && !req.fieldAgent.permissions.includes('retention:manage_defects')) {
    throw new AppError('Access requires permission(s): retention:manage_defects', 403, 'FORBIDDEN_PERMISSION');
  }
}

const defectReaders = requireAnyAuthWithWebPermission('retention:manage_defects', 'retention:release_escrow', 'handover:review_feedback');
const defectWriters = requireAnyAuthWithWebPermission('retention:manage_defects');

router.get(
  '/:projectId/defects',
  defectReaders,
  wrap(async (req, res) => {
    requireFieldDefectPermission(req);
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await listDefectTickets(p(req, 'projectId'), viewer) });
  })
);

router.get(
  '/:projectId/defects/:ticketId',
  defectReaders,
  wrap(async (req, res) => {
    requireFieldDefectPermission(req);
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await getDefectTicket(p(req, 'projectId'), p(req, 'ticketId'), viewer) });
  })
);

router.post(
  '/:projectId/defects',
  requirePermission('retention:manage_defects'),
  validateBody(CreateDefectTicketRequestSchema),
  wrap(async (req, res) => {
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.status(201).json({ success: true, data: await createDefectTicket(p(req, 'projectId'), viewer, req.body) });
  })
);

router.post(
  '/:projectId/defects/:ticketId/assign',
  requirePermission('retention:manage_defects'),
  validateBody(AssignDefectTicketRequestSchema),
  wrap(async (req, res) => {
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await assignDefectTicket(p(req, 'projectId'), p(req, 'ticketId'), viewer, req.body) });
  })
);

router.post(
  '/:projectId/defects/:ticketId/rectify',
  defectWriters,
  validateBody(RectifyDefectTicketRequestSchema),
  wrap(async (req, res) => {
    requireFieldDefectPermission(req);
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await rectifyDefectTicket(p(req, 'projectId'), p(req, 'ticketId'), viewer, req.body) });
  })
);

router.post(
  '/:projectId/defects/:ticketId/verify',
  defectWriters,
  validateBody(VerifyDefectTicketRequestSchema),
  wrap(async (req, res) => {
    requireFieldDefectPermission(req);
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await verifyDefectTicket(p(req, 'projectId'), p(req, 'ticketId'), viewer, req.body) });
  })
);

router.post(
  '/:projectId/defects/:ticketId/reject',
  requirePermission('retention:manage_defects'),
  validateBody(RejectDefectTicketRequestSchema),
  wrap(async (req, res) => {
    const viewer = await defectViewerFor(p(req, 'projectId'), req);
    res.json({ success: true, data: await rejectDefectTicket(p(req, 'projectId'), p(req, 'ticketId'), viewer, req.body) });
  })
);

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

router.get(
  '/:projectId/retention',
  requirePermission('retention:manage_defects', 'retention:release_escrow', 'ipc:certify_valuation', 'tranche:approve_disbursement', 'audit:view_ledger'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getRetentionSummary(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/retention/release-request',
  requirePermission('retention:release_escrow'),
  validateBody(RequestRetentionReleaseRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await requestRetentionRelease({ projectId: p(req, 'projectId'), webUser: req.webUser!, input: req.body }) });
  })
);

router.post(
  '/:projectId/retention/release-requests/:requestId/cancel',
  requirePermission('retention:release_escrow'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await cancelRetentionRelease({ projectId: p(req, 'projectId'), requestId: p(req, 'requestId'), webUser: req.webUser! }),
    });
  })
);

/** The certification step; the certification permission is checked by the service (never by bypass). */
router.post(
  '/:projectId/retention/release-requests/:requestId/certify',
  requireWebAuth,
  validateBody(CertifyRetentionReleaseRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await certifyRetentionRelease({
        projectId: p(req, 'projectId'),
        requestId: p(req, 'requestId'),
        webUser: req.webUser!,
        input: req.body,
      }),
    });
  })
);

/** The release step of a RETENTION_RELEASE valuation (same rules as any lender decision). */
router.post(
  '/:projectId/retention/valuations/:valuationId/decision',
  requirePermission('tranche:approve_disbursement'),
  (req: Request, _res: Response, next: NextFunction) => {
    req.body = { ...(req.body ?? {}), valuationReportId: p(req, 'valuationId') };
    next();
  },
  validateBody(LenderTrancheDecisionRequestSchema),
  wrap(async (req, res) => {
    const projectId = p(req, 'projectId');
    const trancheId = await retentionValuationTranche(projectId, p(req, 'valuationId'));
    res.json({ success: true, data: await recordLenderTrancheDecision({ projectId, trancheId, webUser: req.webUser!, input: req.body }) });
  })
);

export const closeoutRoutes = router;
