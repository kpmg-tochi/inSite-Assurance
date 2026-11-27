import { NextFunction, Request, Response, Router } from 'express';
import {
  CostingStandardImportConfirmRequestSchema,
  CostingStandardImportPreviewRequestSchema,
  SaveCostingStandardRequestSchema,
  XLSX_CONTENT_TYPE,
} from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  buildCostingStandardTemplate,
  confirmCostingStandardImport,
  editCostingStandardVersion,
  getCostingStandardVersion,
  getCurrentCostingStandard,
  listCostingStandardVersions,
  previewCostingStandardImport,
  saveCostingStandardFromEditor,
} from './costingStandards.service';

/**
 * Needs pipeline wave 2 (N2): costing standards at /api/v1/costing-standards. Any web user reads;
 * `standards:manage` writes. Static paths are registered before `/:versionId`.
 * - `GET /` versions (newest first), `GET /current` the latest (or null), `GET /template` (.xlsx of the
 *   latest version, blank structure when none), `GET /:versionId`.
 * - `POST /import/preview` (nothing written), `POST /import/confirm` (201; 409 COSTING_STANDARD_FILE_CHANGED,
 *   422 COSTING_STANDARD_IMPORT_INVALID), `POST /` JSON save (201), `PUT /:versionId` in-place edit of the
 *   latest unlocked version (409 COSTING_STANDARD_LOCKED).
 */
export const costingStandardsRoutes = Router();

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const MANAGE = requirePermission('standards:manage');

costingStandardsRoutes.get(
  '/',
  requireWebAuth,
  send((req) => listCostingStandardVersions(req.webUser!.tenantId))
);

costingStandardsRoutes.get(
  '/current',
  requireWebAuth,
  send((req) => getCurrentCostingStandard(req.webUser!.tenantId))
);

costingStandardsRoutes.get('/template', requireWebAuth, (req: Request, res: Response, next: NextFunction) => {
  buildCostingStandardTemplate(req.webUser!.tenantId)
    .then(({ buffer, fileName }) => {
      res.attachment(fileName);
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    })
    .catch(next);
});

costingStandardsRoutes.post(
  '/import/preview',
  MANAGE,
  validateBody(CostingStandardImportPreviewRequestSchema),
  send((req) => previewCostingStandardImport(req.webUser!, req.body))
);

costingStandardsRoutes.post(
  '/import/confirm',
  MANAGE,
  validateBody(CostingStandardImportConfirmRequestSchema),
  send((req) => confirmCostingStandardImport(req.webUser!, req.body), 201)
);

costingStandardsRoutes.post(
  '/',
  MANAGE,
  validateBody(SaveCostingStandardRequestSchema),
  send((req) => saveCostingStandardFromEditor(req.webUser!, req.body), 201)
);

costingStandardsRoutes.put(
  '/:versionId',
  MANAGE,
  validateBody(SaveCostingStandardRequestSchema),
  send((req) => editCostingStandardVersion(req.webUser!, String(req.params.versionId), req.body))
);

costingStandardsRoutes.get(
  '/:versionId',
  requireWebAuth,
  send((req) => getCostingStandardVersion(req.webUser!.tenantId, String(req.params.versionId)))
);
