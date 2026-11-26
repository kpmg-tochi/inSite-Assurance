import { NextFunction, Request, Response, Router } from 'express';
import {
  ApprovedListImportConfirmRequestSchema,
  ApprovedListImportPreviewRequestSchema,
  ApprovedListsQuerySchema,
  LinkApprovedListRowRequestSchema,
  XLSX_CONTENT_TYPE,
} from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  getApprovedListDetail,
  getApprovedListsOverview,
  getApprovedListYearRows,
  getProjectApprovedListLink,
  linkProjectApprovedListRow,
} from './approvedLists.service';
import { buildApprovedListTemplate, confirmApprovedListImport, previewApprovedListImport } from './approvedListImport.service';

/**
 * Client demo updates E3 (wave 3, read-only lists; wave 4, upload):
 * - `approvedListsRoutes` at /api/v1/approved-lists: `GET /` (overview of one intervention year) and
 *   `GET /:listId` (rows, linked projects, match status); `approved_lists:view`. Wave 4:
 *   `GET /template` (.xlsx), `POST /import/preview` (nothing written), `POST /import/confirm` (201;
 *   409 APPROVED_LIST_FILE_CHANGED, 422 APPROVED_LIST_IMPORT_INVALID); `approved_lists:manage`.
 * - `projectApprovedListRoutes` at /api/v1/projects: `GET /:projectId/approved-list-row` (any web
 *   reader of the project) and `PUT` (the setup editors; drafts and live projects).
 */
export const approvedListsRoutes = Router();

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  };

approvedListsRoutes.get(
  '/',
  requirePermission('approved_lists:view'),
  send((req) => getApprovedListsOverview(req.webUser!, ApprovedListsQuerySchema.parse(req.query).interventionYear))
);

// Design refinement (2026-11-26, registered before GET /:listId): every row of a year in one request.
approvedListsRoutes.get(
  '/rows',
  requirePermission('approved_lists:view'),
  send((req) => getApprovedListYearRows(req.webUser!, ApprovedListsQuerySchema.parse(req.query).interventionYear))
);

// Wave 4 (registered before GET /:listId): upload from the template, `approved_lists:manage`.
approvedListsRoutes.get(
  '/template',
  requirePermission('approved_lists:manage'),
  (req: Request, res: Response, next: NextFunction) => {
    buildApprovedListTemplate(req.webUser!.tenantId)
      .then(({ buffer, fileName }) => {
        res.attachment(fileName);
        res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
        res.setHeader('Cache-Control', 'no-store');
        res.send(buffer);
      })
      .catch(next);
  }
);

/** Parses and checks a filled template against the workspace; nothing is written. */
approvedListsRoutes.post(
  '/import/preview',
  requirePermission('approved_lists:manage'),
  validateBody(ApprovedListImportPreviewRequestSchema),
  send((req) => previewApprovedListImport(req.webUser!, req.body))
);

/** Re-checks the same file (sha256) and saves the list, or nothing. */
approvedListsRoutes.post(
  '/import/confirm',
  requirePermission('approved_lists:manage'),
  validateBody(ApprovedListImportConfirmRequestSchema),
  (req: Request, res: Response, next: NextFunction) => {
    confirmApprovedListImport(req.webUser!, req.body)
      .then((data) => res.status(201).json({ success: true, data }))
      .catch(next);
  }
);

approvedListsRoutes.get(
  '/:listId',
  requirePermission('approved_lists:view'),
  send((req) => getApprovedListDetail(req.webUser!, String(req.params.listId)))
);

const projectRouter = guardProjectRoutes(Router());

function requireWebUser(req: Request) {
  if (!req.webUser) throw new AppError('Only web users can read the approved list link', 403, 'FORBIDDEN_PERMISSION');
}

projectRouter.get(
  '/:projectId/approved-list-row',
  send(async (req) => {
    requireWebUser(req);
    return getProjectApprovedListLink(String(req.params.projectId));
  })
);

projectRouter.put(
  '/:projectId/approved-list-row',
  requirePermission('projects:create', 'projects:edit_baseline'),
  validateBody(LinkApprovedListRowRequestSchema),
  send((req) => linkProjectApprovedListRow(String(req.params.projectId), req.webUser!, req.body.rowId))
);

export const projectApprovedListRoutes = projectRouter;
