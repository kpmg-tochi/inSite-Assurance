import { Router, Request, Response, NextFunction } from 'express';
import { PreviewVisitFormRequestSchema, VisitFormPreviewDto } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { prisma } from '../../config/prisma';
import { buildVisitForm } from './visitForm.service';

/**
 * Redesign R3c (D-R3.23): preview a project's visit form without storing it. Mounted at
 * /api/v1/projects. R4 swaps `inspections:view` for its visit permission.
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.post(
  '/:projectId/visit-form/preview',
  requirePermission('forms:manage', 'inspections:view'),
  validateBody(PreviewVisitFormRequestSchema),
  wrap(async (req, res) => {
    const built = await buildVisitForm(prisma, String(req.params.projectId), req.body);
    const data: VisitFormPreviewDto = {
      snapshot: built.snapshot,
      warnings: built.warnings,
      fieldCount: built.fieldCount,
      contentSha256: built.contentSha256,
    };
    res.json({ success: true, data });
  })
);

export const visitFormRoutes = router;
