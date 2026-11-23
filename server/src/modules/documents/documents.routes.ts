import { Router, Request, Response, NextFunction } from 'express';
import {
  AddDocumentVersionRequestSchema,
  ArchiveProjectDocumentRequestSchema,
  RegisterProjectDocumentRequestSchema,
  SaveDocumentTypeRequestSchema,
  SignProjectDocumentRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  addDocumentVersion,
  archiveProjectDocument,
  getDocumentDownload,
  getProjectDocument,
  listProjectDocuments,
  registerProjectDocument,
  signProjectDocument,
} from './documents.service';
import { createDocumentType, listDocumentTypes, updateDocumentType } from './documentTypes.service';

/** Phase 13: the project document register (mounted at /api/v1/projects; project guard applies). */
const router = guardProjectRoutes(Router());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);

router.get(
  '/:projectId/documents',
  requirePermission('documents:view'),
  wrap(async (req, res) => {
    const q = req.query;
    const data = await listProjectDocuments({
      projectId: p(req, 'projectId'),
      webUser: req.webUser!,
      typeCode: typeof q.typeCode === 'string' ? q.typeCode : undefined,
      contractorId: typeof q.contractorId === 'string' ? q.contractorId : undefined,
      includeArchived: q.includeArchived === 'true',
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:projectId/documents',
  requirePermission('documents:upload'),
  validateBody(RegisterProjectDocumentRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await registerProjectDocument(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.get(
  '/:projectId/documents/:documentId',
  requirePermission('documents:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectDocument(p(req, 'projectId'), p(req, 'documentId'), req.webUser!) });
  })
);

router.get(
  '/:projectId/documents/:documentId/download',
  requirePermission('documents:view'),
  wrap(async (req, res) => {
    const version = req.query.version ? Number(req.query.version) : undefined;
    res.json({
      success: true,
      data: await getDocumentDownload(p(req, 'projectId'), p(req, 'documentId'), req.webUser!, Number.isInteger(version) ? version : undefined),
    });
  })
);

router.post(
  '/:projectId/documents/:documentId/versions',
  requirePermission('documents:upload'),
  validateBody(AddDocumentVersionRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await addDocumentVersion(p(req, 'projectId'), p(req, 'documentId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/documents/:documentId/sign-off',
  requirePermission('documents:view'),
  validateBody(SignProjectDocumentRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await signProjectDocument(p(req, 'projectId'), p(req, 'documentId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/documents/:documentId/archive',
  requirePermission('documents:upload'),
  validateBody(ArchiveProjectDocumentRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await archiveProjectDocument(p(req, 'projectId'), p(req, 'documentId'), req.webUser!, req.body.reason) });
  })
);

export const documentsRoutes = router;

/** Tenant document types (mounted at /api/v1/document-types). */
const types = Router();

types.get(
  '/',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listDocumentTypes(req.webUser!.tenantId, req.query.includeArchived === 'true') });
  })
);

types.post(
  '/',
  requirePermission('documents:manage_types'),
  validateBody(SaveDocumentTypeRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createDocumentType(req.webUser!, req.body) });
  })
);

types.put(
  '/:typeId',
  requirePermission('documents:manage_types'),
  validateBody(SaveDocumentTypeRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateDocumentType(req.webUser!, p(req, 'typeId'), req.body) });
  })
);

export const documentTypesRoutes = types;
