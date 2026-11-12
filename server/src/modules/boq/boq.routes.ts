import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  BoqItemInputSchema,
  UpdateBoqMappingsRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requireRole,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  confirmBoqTrancheMappings,
  listProjectBoqItems,
  uploadAndAnalyzeProjectBoq,
} from './boq.service';

const router = Router();

const UploadBoqBodySchema = z.object({
  items: z.array(BoqItemInputSchema).optional(),
  spreadsheetBase64: z.string().optional(),
});

/**
 * GET /api/v1/projects/:projectId/boq
 * Lists all BOQ items for a project.
 */
router.get(
  '/:projectId/boq',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await listProjectBoqItems(String(req.params.projectId));
      res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/boq/upload
 * Uploads BOQ items (or base64 .xlsx/.csv), runs AI Lump-Sum & Hold-Point analysis, and maps to Tranches.
 */
router.post(
  '/:projectId/boq/upload',
  requireRole('MONITOR'),
  validateBody(UploadBoqBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await uploadAndAnalyzeProjectBoq({
        projectId: String(req.params.projectId),
        webUser: req.webUser!,
        items: req.body.items,
        spreadsheetBase64: req.body.spreadsheetBase64,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/boq/mappings
 * Monitor confirms or edits BOQ-to-Tranche mappings and Hold Point flags.
 */
router.patch(
  '/:projectId/boq/mappings',
  requireRole('MONITOR'),
  validateBody(UpdateBoqMappingsRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await confirmBoqTrancheMappings({
        projectId: String(req.params.projectId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

export const boqRoutes = router;

