import { NextFunction, Request, Response, Router } from 'express';
import {
  CloseNeedsCycleRequestSchema,
  NeedsCarryForwardQuerySchema,
  NeedsCycleListQuerySchema,
  NeedsDocumentPresignRequestSchema,
  NeedsProposalListQuerySchema,
  NeedsUploadConfirmRequestSchema,
  NeedsUploadPreviewRequestSchema,
  OpenNeedsCycleRequestSchema,
  RegisterCycleDocumentRequestSchema,
  RegisterProposalDocumentRequestSchema,
  UpdateNeedsCycleRequestSchema,
  XLSX_CONTENT_TYPE,
  type NeedsFileLinkDto,
} from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  closeCycle,
  cycleDocumentFile,
  getCycle,
  getNeedsOptions,
  listCarryForwardCandidates,
  listCycleDocuments,
  listCycles,
  openCycle,
  presignNeedsDocument,
  registerCycleDocument,
  updateCycle,
} from './needsCycles.service';
import {
  cycleTemplate,
  getProposalDetail,
  listProposalDocuments,
  listProposals,
  proposalDocumentFile,
  proposalTemplate,
  registerProposalDocument,
  versionFile,
} from './needsProposals.service';
import { confirmUpload, previewUpload } from './needsUpload.service';

/**
 * Needs pipeline wave 2 (N3): /api/v1/needs. Web users only (`requirePermission` refuses mobile
 * principals); `needs:view` for every read. Writes also need the user's organisation to own the
 * cycle and the cycle to be open (needsAccess). Static paths are registered before parameterised ones.
 */
export const needsRoutes = Router();

/** Express 5 types a route parameter as string | string[]. */
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

/** 302 to a signed link, or the link as JSON with `?format=json`. */
const sendFile =
  (fn: (req: Request) => Promise<NeedsFileLinkDto>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req)
      .then((link) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.query.format === 'json') res.json({ success: true, data: link });
        else res.redirect(302, link.url);
      })
      .catch(next);
  };

const sendXlsx =
  (fn: (req: Request) => Promise<{ buffer: Buffer; fileName: string }>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req)
      .then(({ buffer, fileName }) => {
        res.attachment(fileName);
        res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
        res.setHeader('Cache-Control', 'no-store');
        res.send(buffer);
      })
      .catch(next);
  };

const VIEW = requirePermission('needs:view');
const MANAGE = requirePermission('needs:manage_cycle');
// Wave 3 (A4): the quantity surveyor uploads costed versions through the same routes.
const UPLOADERS = requirePermission('needs:submit', 'needs:cost');
const DOCUMENT_WRITERS = requirePermission('needs:manage_cycle', 'needs:submit', 'needs:validate', 'needs:cost');
const PROPOSAL_DOCUMENT_WRITERS = requirePermission('needs:submit', 'needs:validate', 'needs:cost');

needsRoutes.get('/options', VIEW, send((req) => getNeedsOptions(req.webUser!)));

// Cycles (static paths first).
needsRoutes.get('/cycles', VIEW, send((req) => listCycles(req.webUser!, NeedsCycleListQuerySchema.parse(req.query))));
needsRoutes.get('/cycles/carry-forward', MANAGE, send((req) => listCarryForwardCandidates(req.webUser!, NeedsCarryForwardQuerySchema.parse(req.query))));
needsRoutes.post('/cycles', MANAGE, validateBody(OpenNeedsCycleRequestSchema), send((req) => openCycle(req.webUser!, req.body), 201));
needsRoutes.get('/cycles/:cycleId', VIEW, send((req) => getCycle(req.webUser!, param(req, 'cycleId'))));
needsRoutes.patch('/cycles/:cycleId', MANAGE, validateBody(UpdateNeedsCycleRequestSchema), send((req) => updateCycle(req.webUser!, param(req, 'cycleId'), req.body)));
needsRoutes.post('/cycles/:cycleId/close', MANAGE, validateBody(CloseNeedsCycleRequestSchema), send((req) => closeCycle(req.webUser!, param(req, 'cycleId'), req.body)));
needsRoutes.get('/cycles/:cycleId/template', VIEW, sendXlsx((req) => cycleTemplate(req.webUser!, param(req, 'cycleId'))));

// Cycle documents.
needsRoutes.post(
  '/cycles/:cycleId/documents/presign',
  DOCUMENT_WRITERS,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignNeedsDocument(req.webUser!, param(req, 'cycleId'), req.body))
);
needsRoutes.get('/cycles/:cycleId/documents', VIEW, send((req) => listCycleDocuments(req.webUser!, param(req, 'cycleId'))));
needsRoutes.post(
  '/cycles/:cycleId/documents',
  MANAGE,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerCycleDocument(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
needsRoutes.get('/cycles/:cycleId/documents/:documentId/file', VIEW, sendFile((req) => cycleDocumentFile(req.webUser!, param(req, 'cycleId'), param(req, 'documentId'))));

// Upload.
needsRoutes.post('/cycles/:cycleId/uploads/preview', UPLOADERS, validateBody(NeedsUploadPreviewRequestSchema), send((req) => previewUpload(req.webUser!, param(req, 'cycleId'), req.body)));
needsRoutes.post('/cycles/:cycleId/uploads/confirm', UPLOADERS, validateBody(NeedsUploadConfirmRequestSchema), send((req) => confirmUpload(req.webUser!, param(req, 'cycleId'), req.body), 201));

// Proposals.
needsRoutes.get('/cycles/:cycleId/proposals', VIEW, send((req) => listProposals(req.webUser!, param(req, 'cycleId'), NeedsProposalListQuerySchema.parse(req.query))));
needsRoutes.get('/proposals/:proposalId', VIEW, send((req) => getProposalDetail(req.webUser!, param(req, 'proposalId'))));
needsRoutes.get('/proposals/:proposalId/template', VIEW, sendXlsx((req) => proposalTemplate(req.webUser!, param(req, 'proposalId'))));
needsRoutes.get('/proposals/:proposalId/versions/:number/file', VIEW, sendFile((req) => versionFile(req.webUser!, param(req, 'proposalId'), param(req, 'number'))));
needsRoutes.get('/proposals/:proposalId/documents', VIEW, send((req) => listProposalDocuments(req.webUser!, param(req, 'proposalId'))));
needsRoutes.post(
  '/proposals/:proposalId/documents',
  PROPOSAL_DOCUMENT_WRITERS,
  validateBody(RegisterProposalDocumentRequestSchema),
  send((req) => registerProposalDocument(req.webUser!, param(req, 'proposalId'), req.body), 201)
);
needsRoutes.get('/proposals/:proposalId/documents/:documentId/file', VIEW, sendFile((req) => proposalDocumentFile(req.webUser!, param(req, 'proposalId'), param(req, 'documentId'))));
