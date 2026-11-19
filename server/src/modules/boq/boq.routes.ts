import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { z } from 'zod';
import {
  BoqItemInputSchema,
  BoqPreviewRequestSchema,
  UpdateBoqMappingsRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuthWithWebPermission,
  requirePermission,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  confirmBoqTrancheMappings,
  listBoqRevisions,
  listProjectBoqItems,
  previewBoqSpreadsheet,
  suggestContractorPackages,
  uploadAndAnalyzeProjectBoq,
} from './boq.service';

const router = guardProjectRoutes(Router());

const UploadBoqBodySchema = z.object({
  items: z.array(BoqItemInputSchema).max(5000).optional(),
  spreadsheetBase64: z.string().optional(),
  /** Required once the project is active: the upload becomes a BOQ revision. */
  reason: z.string().trim().min(3).max(500).optional(),
  /** REPLACE (default) removes items not in the upload; MERGE only adds and updates. */
  mode: z.enum(['REPLACE', 'MERGE']).optional(),
});

/**
 * GET /api/v1/projects/:projectId/boq
 * Lists all BOQ items for a project.
 */
router.get(
  '/:projectId/boq',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const items = await listProjectBoqItems(projectId);
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
  requirePermission('boq:upload_edit'),
  validateBody(UploadBoqBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await uploadAndAnalyzeProjectBoq({
        projectId: String(req.params.projectId),
        webUser: req.webUser!,
        items: req.body.items,
        spreadsheetBase64: req.body.spreadsheetBase64,
        reason: req.body.reason,
        mode: req.body.mode,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/boq/mappings
 * Confirms or edits BOQ-to-Tranche mappings and Hold Point flags.
 */
router.patch(
  '/:projectId/boq/mappings',
  requirePermission('boq:upload_edit', 'boq:configure_hold_points'),
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

/**
 * POST /api/v1/projects/:projectId/boq/preview
 * Parses a base64 .xlsx or .csv on the server and returns every row with its warnings and errors.
 * Nothing is saved; the client commits the valid rows through /boq/upload.
 */
router.post(
  '/:projectId/boq/preview',
  requirePermission('boq:upload_edit'),
  validateBody(BoqPreviewRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await previewBoqSpreadsheet(req.body.spreadsheetBase64) });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/v1/projects/:projectId/boq/revisions */
router.get(
  '/:projectId/boq/revisions',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await listBoqRevisions(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/boq/suggest-contractors
 * Suggests contractor trade packages from the BOQ (Azure OpenAI when configured, else section and
 * keyword rules). Suggestion only: nothing is saved until the user confirms in the wizard.
 */
router.post(
  '/:projectId/boq/suggest-contractors',
  requirePermission('contractors:manage_packages'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await suggestContractorPackages(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

export const boqRoutes = router;

