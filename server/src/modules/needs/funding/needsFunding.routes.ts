import { NextFunction, Request, Response, Router } from 'express';
import {
  AppropriationImportConfirmRequestSchema,
  AppropriationImportPreviewRequestSchema,
  AssignLotsRequestSchema,
  BeapItemReviewRequestSchema,
  NeedsApprovalActionRequestSchema,
  NeedsDocumentPresignRequestSchema,
  RecordBudgetSubmissionRequestSchema,
  RecordCounterpartRequestSchema,
  RegisterCycleDocumentRequestSchema,
  SaveBeapRequestSchema,
  XLSX_CONTENT_TYPE,
} from '@insite/shared';
import { requirePermission } from '../../../middleware/auth.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import { actOnBeap, getBeap, presignBeapDocument, recordCounterpart, registerBeapDocument, reviewBeapItems, saveBeap, submitBeap } from '../submissions/beap.service';
import {
  buildAppropriationTemplate,
  confirmAppropriation,
  getFunding,
  presignFundingDocument,
  previewAppropriation,
  recordBudgetSubmission,
  registerFundingDocument,
} from './needsFunding.service';
import { assignLots, getProcurementPlan, presignPlanDocument, registerPlanDocument } from './procurementPlan.service';

/**
 * Needs pipeline wave 4, Track B (N7b–c): budget submission, appropriated schedule import,
 * procurement plan, BEAP. Mounted at /api/v1/needs (app.ts) before `needsRoutes`. Web users only;
 * `needs:view` to read. Writes need the route's permission and the cycle's owning organisation
 * (403 NEEDS_CYCLE_FORBIDDEN); most also an OPEN cycle (409 NEEDS_CYCLE_NOT_OPEN). DI-only routes on an
 * MG cycle and BEAP routes on a DI cycle: 409 NEEDS_FUNDING_GATE_MISMATCH.
 */
export const needsFundingRoutes = Router();

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
const FUNDING = requirePermission('needs:record_funding');
const LOTS = requirePermission('procurement:plan_lots');
const PREPARE_BEAP = requirePermission('needs:prepare_beap');
const BEAP_REVIEWERS = requirePermission('needs:review_beap', 'needs:approve_beap');

// B1, B2: Direct Intervention funding.
needsFundingRoutes.get('/cycles/:cycleId/funding', VIEW, send((req) => getFunding(req.webUser!, param(req, 'cycleId'))));
needsFundingRoutes.post(
  '/cycles/:cycleId/funding/budget-submission',
  FUNDING,
  validateBody(RecordBudgetSubmissionRequestSchema),
  send((req) => recordBudgetSubmission(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
needsFundingRoutes.post(
  '/cycles/:cycleId/funding/documents/presign',
  FUNDING,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignFundingDocument(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post(
  '/cycles/:cycleId/funding/documents',
  FUNDING,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerFundingDocument(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
needsFundingRoutes.get('/cycles/:cycleId/funding/appropriation/template', FUNDING, (req: Request, res: Response, next: NextFunction) => {
  buildAppropriationTemplate(req.webUser!, param(req, 'cycleId'))
    .then(({ buffer, fileName }) => {
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
      res.send(buffer);
    })
    .catch(next);
});
needsFundingRoutes.post(
  '/cycles/:cycleId/funding/appropriation/preview',
  FUNDING,
  validateBody(AppropriationImportPreviewRequestSchema),
  send((req) => previewAppropriation(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post(
  '/cycles/:cycleId/funding/appropriation/confirm',
  FUNDING,
  validateBody(AppropriationImportConfirmRequestSchema),
  send((req) => confirmAppropriation(req.webUser!, param(req, 'cycleId'), req.body), 201)
);

// B3: procurement plan (Direct Intervention).
needsFundingRoutes.get('/cycles/:cycleId/procurement-plan', VIEW, send((req) => getProcurementPlan(req.webUser!, param(req, 'cycleId'))));
needsFundingRoutes.post('/cycles/:cycleId/procurement-plan/lots', LOTS, validateBody(AssignLotsRequestSchema), send((req) => assignLots(req.webUser!, param(req, 'cycleId'), req.body)));
needsFundingRoutes.post(
  '/cycles/:cycleId/procurement-plan/documents/presign',
  LOTS,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignPlanDocument(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post(
  '/cycles/:cycleId/procurement-plan/documents',
  LOTS,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerPlanDocument(req.webUser!, param(req, 'cycleId'), req.body), 201)
);

// B4: BEAP (Matching Grants).
needsFundingRoutes.get('/cycles/:cycleId/beap', VIEW, send((req) => getBeap(req.webUser!, param(req, 'cycleId'))));
needsFundingRoutes.put('/cycles/:cycleId/beap', PREPARE_BEAP, validateBody(SaveBeapRequestSchema), send((req) => saveBeap(req.webUser!, param(req, 'cycleId'), req.body)));
needsFundingRoutes.post('/cycles/:cycleId/beap/submit', PREPARE_BEAP, send((req) => submitBeap(req.webUser!, param(req, 'cycleId'))));
needsFundingRoutes.post(
  '/cycles/:cycleId/beap/review-items',
  BEAP_REVIEWERS,
  validateBody(BeapItemReviewRequestSchema),
  send((req) => reviewBeapItems(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post('/cycles/:cycleId/beap/actions', VIEW, validateBody(NeedsApprovalActionRequestSchema), send((req) => actOnBeap(req.webUser!, param(req, 'cycleId'), req.body)));
needsFundingRoutes.put(
  '/cycles/:cycleId/beap/counterpart',
  PREPARE_BEAP,
  validateBody(RecordCounterpartRequestSchema),
  send((req) => recordCounterpart(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post(
  '/cycles/:cycleId/beap/documents/presign',
  PREPARE_BEAP,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignBeapDocument(req.webUser!, param(req, 'cycleId'), req.body))
);
needsFundingRoutes.post(
  '/cycles/:cycleId/beap/documents',
  PREPARE_BEAP,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerBeapDocument(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
