import { NextFunction, Request, Response, Router } from 'express';
import {
  OutOfCycleFileConfirmRequestSchema,
  OutOfCycleFileRequestSchema,
  WithdrawOutOfCycleRequestSchema,
  NeedsApprovalActionRequestSchema,
  NeedsDocumentPresignRequestSchema,
  NeedsPipelineQuerySchema,
  OutOfCycleListQuerySchema,
  OutOfCycleRequestSchema,
  RegisterCycleDocumentRequestSchema,
  RegisterProposalDocumentRequestSchema,
  SubmitPortfolioRequestSchema,
  UpdateOutOfCycleRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../../middleware/auth.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import { listPipeline } from '../integration/needsIntegration.service';
import { actOnPortfolio, presignPortfolioMemo, registerPortfolioMemo, submitPortfolio } from './portfolio.service';
import {
  actOnOutOfCycle,
  confirmOutOfCycleNeedsAssessment,
  createOutOfCycle,
  getOutOfCycle,
  listOutOfCycle,
  presignOutOfCycleDocument,
  previewOutOfCycleNeedsAssessment,
  registerOutOfCycleDocument,
  submitOutOfCycle,
  updateOutOfCycle,
  withdrawOutOfCycle,
} from './outOfCycle.service';

/**
 * Needs pipeline wave 4, Track A (N6): portfolio submission and approval, out-of-cycle requests, the
 * pipeline list. Mounted at /api/v1/needs (app.ts) before `needsRoutes`. Routes: parent plan 17.10.
 * Web users only (`requirePermission`); acting on a chain step is decided by the submission base's
 * gate (step permission, separation of duties, organisation scope), not by a route permission.
 */
export const needsApprovalRoutes = Router();

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
const SUBMIT_PORTFOLIO = requirePermission('needs:submit_portfolio');
const REQUESTER = requirePermission('needs:submit');

// Pipeline (Portfolio → Pipeline).
needsApprovalRoutes.get('/pipeline', VIEW, send((req) => listPipeline(req.webUser!, NeedsPipelineQuerySchema.parse(req.query))));

// Portfolio (A1, A2).
needsApprovalRoutes.post(
  '/cycles/:cycleId/portfolio',
  SUBMIT_PORTFOLIO,
  validateBody(SubmitPortfolioRequestSchema),
  send((req) => submitPortfolio(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
needsApprovalRoutes.post(
  '/cycles/:cycleId/portfolio/actions',
  VIEW,
  validateBody(NeedsApprovalActionRequestSchema),
  send((req) => actOnPortfolio(req.webUser!, param(req, 'cycleId'), req.body))
);
needsApprovalRoutes.post(
  '/cycles/:cycleId/portfolio/memo/presign',
  VIEW,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignPortfolioMemo(req.webUser!, param(req, 'cycleId'), req.body))
);
needsApprovalRoutes.post(
  '/cycles/:cycleId/portfolio/memo',
  VIEW,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerPortfolioMemo(req.webUser!, param(req, 'cycleId'), req.body), 201)
);

// Out-of-cycle requests (A3, D-N.14).
needsApprovalRoutes.get('/out-of-cycle', VIEW, send((req) => listOutOfCycle(req.webUser!, OutOfCycleListQuerySchema.parse(req.query))));
needsApprovalRoutes.post('/out-of-cycle', REQUESTER, validateBody(OutOfCycleRequestSchema), send((req) => createOutOfCycle(req.webUser!, req.body), 201));
needsApprovalRoutes.get('/out-of-cycle/:proposalId', VIEW, send((req) => getOutOfCycle(req.webUser!, param(req, 'proposalId'))));
needsApprovalRoutes.patch(
  '/out-of-cycle/:proposalId',
  REQUESTER,
  validateBody(UpdateOutOfCycleRequestSchema),
  send((req) => updateOutOfCycle(req.webUser!, param(req, 'proposalId'), req.body))
);
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/documents/presign',
  REQUESTER,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignOutOfCycleDocument(req.webUser!, param(req, 'proposalId'), req.body))
);
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/documents',
  REQUESTER,
  validateBody(RegisterProposalDocumentRequestSchema),
  send((req) => registerOutOfCycleDocument(req.webUser!, param(req, 'proposalId'), req.body), 201)
);
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/needs-assessment/preview',
  REQUESTER,
  validateBody(OutOfCycleFileRequestSchema),
  send((req) => previewOutOfCycleNeedsAssessment(req.webUser!, param(req, 'proposalId'), req.body))
);
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/needs-assessment/confirm',
  REQUESTER,
  validateBody(OutOfCycleFileConfirmRequestSchema),
  send((req) => confirmOutOfCycleNeedsAssessment(req.webUser!, param(req, 'proposalId'), req.body), 201)
);
needsApprovalRoutes.post('/out-of-cycle/:proposalId/submit', REQUESTER, send((req) => submitOutOfCycle(req.webUser!, param(req, 'proposalId'))));
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/actions',
  VIEW,
  validateBody(NeedsApprovalActionRequestSchema),
  send((req) => actOnOutOfCycle(req.webUser!, param(req, 'proposalId'), req.body))
);
needsApprovalRoutes.post(
  '/out-of-cycle/:proposalId/withdraw',
  REQUESTER,
  validateBody(WithdrawOutOfCycleRequestSchema),
  send((req) => withdrawOutOfCycle(req.webUser!, param(req, 'proposalId'), req.body.reason))
);
