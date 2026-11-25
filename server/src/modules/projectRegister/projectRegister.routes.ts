import { NextFunction, Request, Response, Router } from 'express';
import { ProjectRegisterImportConfirmRequestSchema, ProjectRegisterImportPreviewRequestSchema, XLSX_CONTENT_TYPE } from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { buildRegisterTemplate, confirmRegisterImport, previewRegisterImport } from './registerImport.service';

/**
 * UBEC IRL: bulk import of the project register (mounted at /api/v1/project-register). Permission
 * `projects:create`; projects are created in the caller's workspace.
 */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** The import template (.xlsx) with the workspace's lists. */
router.get(
  '/template',
  requirePermission('projects:create'),
  wrap(async (req, res) => {
    const { buffer, fileName } = await buildRegisterTemplate(req.webUser!.tenantId);
    res.attachment(fileName);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  })
);

/** Parses and validates a filled template; nothing is written. */
router.post(
  '/import/preview',
  requirePermission('projects:create'),
  validateBody(ProjectRegisterImportPreviewRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await previewRegisterImport(req.webUser!, req.body) });
  })
);

/** Re-parses the previewed file (same sha256) and creates every project, or none. */
router.post(
  '/import/confirm',
  requirePermission('projects:create'),
  validateBody(ProjectRegisterImportConfirmRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await confirmRegisterImport(req.webUser!, req.body) });
  })
);

export const projectRegisterRoutes = router;
