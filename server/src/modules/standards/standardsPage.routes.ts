import { NextFunction, Request, Response, Router } from 'express';
import { NeedsDocumentPresignRequestSchema, RegisterDesignStandardDocumentRequestSchema } from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { designStandardDocumentLink, presignDesignStandardDocument, registerDesignStandardDocument } from './designStandards.service';
import { getStandardsOverview } from './standardsPage.service';

/**
 * Needs pipeline wave 2 (N2): the Standards page at /api/v1/standards. Web users only.
 * - `GET /` (any web user): `StandardsOverviewDto` (costing, design, monitoring).
 * - `POST /design-documents/presign` and `POST /design-documents` (201): `standards:manage`.
 * - `GET /design-documents/:documentId/file` (any web user): 302 to a 5-minute signed link, or
 *   `?format=json` for `NeedsFileLinkDto`.
 */
export const standardsPageRoutes = Router();

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

standardsPageRoutes.get(
  '/',
  requireWebAuth,
  send((req) => getStandardsOverview(req.webUser!.tenantId))
);

standardsPageRoutes.post(
  '/design-documents/presign',
  MANAGE,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignDesignStandardDocument(req.webUser!, req.body))
);

standardsPageRoutes.post(
  '/design-documents',
  MANAGE,
  validateBody(RegisterDesignStandardDocumentRequestSchema),
  send((req) => registerDesignStandardDocument(req.webUser!, req.body), 201)
);

standardsPageRoutes.get('/design-documents/:documentId/file', requireWebAuth, (req: Request, res: Response, next: NextFunction) => {
  designStandardDocumentLink(req.webUser!.tenantId, String(req.params.documentId))
    .then((link) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.format === 'json') res.json({ success: true, data: link });
      else res.redirect(302, link.url);
    })
    .catch(next);
});
