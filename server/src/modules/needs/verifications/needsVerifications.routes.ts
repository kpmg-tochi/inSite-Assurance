import { NextFunction, Request, Response, Router } from 'express';
import {
  AssignNeedsVerificationRequestSchema,
  CancelNeedsVerificationRequestSchema,
  NeedsVerificationPurposeEnum,
  PresignNeedsVerificationCaptureRequestSchema,
  RegisterNeedsVerificationCaptureRequestSchema,
  ReviewNeedsVerificationRequestSchema,
  SubmitNeedsVerificationRequestSchema,
} from '@insite/shared';
import { requireAnyAuth, requirePermission } from '../../../middleware/auth.middleware';
import { AppError } from '../../../middleware/error.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import {
  myVerifications,
  presignVerificationCapture,
  registerVerificationCapture,
  submitVerification,
  verificationForm,
  type FieldPrincipal,
} from './needsVerificationField.service';
import {
  assignVerification,
  cancelVerification,
  getVerification,
  listCycleVerifications,
  listProposalVerifications,
  listVerificationOfficers,
  reviewVerification,
} from './needsVerifications.service';

/**
 * Needs pipeline wave 5 (N8): field verification routes.
 *
 * Web (`needsVerificationWebRoutes`, mounted at /api/v1/needs before `needsRoutes`; web users, the
 * services check purpose, organisation and the open cycle):
 * - GET  /proposals/:proposalId/verifications            needs:view (capture links signed)
 * - GET  /proposals/:proposalId/verification-officers    needs:validate or needs:review_beap (?purpose=)
 * - POST /proposals/:proposalId/verifications            assign (needs:validate / needs:review_beap)
 * - GET  /cycles/:cycleId/verifications                  needs:view (no capture links)
 * - GET  /verifications/:verificationId                  needs:view
 * - POST /verifications/:verificationId/cancel           the purpose's permission
 * - POST /verifications/:verificationId/review           the purpose's permission
 *
 * Field (`needsVerificationFieldRoutes`, mounted at /api/v1/needs-verifications; any signed-in
 * principal, access by assignment):
 * - GET  /mine, GET /:verificationId/form (ETag = formHash, 304),
 *   POST /:verificationId/captures/presign, POST /:verificationId/captures (201 / 200 replay),
 *   POST /:verificationId/submissions (the submission's DTO; 201 / 200 replay).
 */

const param = (req: Request, name: string): string => String(req.params[name] ?? '');

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const VIEW = requirePermission('needs:view');
const ASSIGNERS = requirePermission('needs:validate', 'needs:review_beap');

export const needsVerificationWebRoutes = Router();

needsVerificationWebRoutes.get('/proposals/:proposalId/verifications', VIEW, send((req) => listProposalVerifications(req.webUser!, param(req, 'proposalId'))));
needsVerificationWebRoutes.get(
  '/proposals/:proposalId/verification-officers',
  ASSIGNERS,
  send((req) => listVerificationOfficers(req.webUser!, param(req, 'proposalId'), NeedsVerificationPurposeEnum.catch('VALIDATION').parse(req.query.purpose)))
);
needsVerificationWebRoutes.post(
  '/proposals/:proposalId/verifications',
  ASSIGNERS,
  validateBody(AssignNeedsVerificationRequestSchema),
  send((req) => assignVerification(req.webUser!, param(req, 'proposalId'), req.body), 201)
);
needsVerificationWebRoutes.get('/cycles/:cycleId/verifications', VIEW, send((req) => listCycleVerifications(req.webUser!, param(req, 'cycleId'))));
needsVerificationWebRoutes.get('/verifications/:verificationId', VIEW, send((req) => getVerification(req.webUser!, param(req, 'verificationId'))));
needsVerificationWebRoutes.post(
  '/verifications/:verificationId/cancel',
  ASSIGNERS,
  validateBody(CancelNeedsVerificationRequestSchema),
  send((req) => cancelVerification(req.webUser!, param(req, 'verificationId'), req.body))
);
needsVerificationWebRoutes.post(
  '/verifications/:verificationId/review',
  ASSIGNERS,
  validateBody(ReviewNeedsVerificationRequestSchema),
  send((req) => reviewVerification(req.webUser!, param(req, 'verificationId'), req.body))
);

export const needsVerificationFieldRoutes = Router();

const principalOf = (req: Request): FieldPrincipal => {
  const who = req.mobileUser ?? req.webUser;
  if (!who) throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return who;
};

/** If-None-Match names the hash, quoted or not (a list or a weak tag is accepted too). */
function etagMatches(header: string | undefined, hash: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '').replace(/^"|"$/g, '') === hash);
}

needsVerificationFieldRoutes.get('/mine', requireAnyAuth, send((req) => myVerifications(principalOf(req))));
needsVerificationFieldRoutes.get('/:verificationId/form', requireAnyAuth, (req, res, next) => {
  verificationForm(principalOf(req), param(req, 'verificationId'))
    .then((data) => {
      res.setHeader('ETag', `"${data.formHash}"`);
      if (etagMatches(req.headers['if-none-match'], data.formHash)) {
        res.status(304).end();
        return;
      }
      res.json({ success: true, data });
    })
    .catch(next);
});
needsVerificationFieldRoutes.post(
  '/:verificationId/captures/presign',
  requireAnyAuth,
  validateBody(PresignNeedsVerificationCaptureRequestSchema),
  send((req) => presignVerificationCapture(principalOf(req), param(req, 'verificationId'), req.body))
);
needsVerificationFieldRoutes.post('/:verificationId/captures', requireAnyAuth, validateBody(RegisterNeedsVerificationCaptureRequestSchema), (req, res, next) => {
  registerVerificationCapture(principalOf(req), param(req, 'verificationId'), req.body)
    .then(({ capture, created }) => res.status(created ? 201 : 200).json({ success: true, data: capture }))
    .catch(next);
});
needsVerificationFieldRoutes.post('/:verificationId/submissions', requireAnyAuth, validateBody(SubmitNeedsVerificationRequestSchema), (req, res, next) => {
  submitVerification(principalOf(req), param(req, 'verificationId'), req.body)
    .then(({ submission, created }) => res.status(created ? 201 : 200).json({ success: true, data: submission }))
    .catch(next);
});
