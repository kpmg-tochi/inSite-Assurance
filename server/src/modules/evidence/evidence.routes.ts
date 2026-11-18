import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import { z } from 'zod';
import {
  ConfirmEvidenceLogRequestSchema,
  MediaTypeEnum,
  SubmitEvidenceForExtractionRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requireFieldSession,
  requirePermission,
} from '../../middleware/auth.middleware';
import { presignRateLimit } from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { assertProjectObjectKey, storageService } from '../../integrations/storage.service';
import { prisma } from '../../config/prisma';
import {
  confirmEvidenceLogByAgent,
  listProjectEvidenceTimeline,
  submitEvidenceForAiExtraction,
} from './evidence.service';

const router = guardProjectRoutes(Router());

const PresignRequestSchema = z.object({
  mediaType: MediaTypeEnum,
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(3).max(80),
  byteSize: z.number().int().positive(),
});

async function projectTenantId(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { tenantId: true },
  });
  return project.tenantId;
}

/**
 * GET /api/v1/projects/:projectId/evidence
 * Returns chronological Field Evidence Timeline for Web Portal & Mobile App.
 */
router.get(
  '/:projectId/evidence',
  requirePermission('reports:view_all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const logs = await listProjectEvidenceTimeline(projectId, req.webUser);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/evidence/presign
 * Generates S3/R2 presigned PUT URL for uploading photos, voice notes, or IPC certificates.
 */
router.post(
  '/:projectId/evidence/presign',
  presignRateLimit,
  requireAnyAuth,
  validateBody(PresignRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const presigned = await storageService.createPresignedUpload({
        tenantId: await projectTenantId(projectId),
        projectId,
        mediaType: req.body.mediaType,
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        byteSize: req.body.byteSize,
      });
      res.json({ success: true, data: presigned });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/media?key=...
 * Authenticated media access: checks project access (route guard) and that the key belongs to
 * this project, then redirects to a 5-minute signed URL. Pass `?format=json` to receive the URL
 * instead of a redirect (for <img> tags, which cannot send an Authorization header).
 */
router.get(
  '/:projectId/media',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const key = assertProjectObjectKey(
        String(req.query.key ?? ''),
        await projectTenantId(projectId),
        projectId
      );
      const url = await storageService.getPresignedReadUrl(key, 300);
      if (req.query.format === 'json') {
        res.json({ success: true, data: { url, expiresInSeconds: 300 } });
        return;
      }
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/evidence/extract
 * Verifies GPS/corridor chainage, screens pHash & SHA-256 integrity, runs standalone Whisper + Azure GPT-4o,
 * and returns the Mandatory Human Confirmation Bubble payload.
 */
router.post(
  '/:projectId/evidence/extract',
  requireFieldSession,
  validateBody(SubmitEvidenceForExtractionRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const draft = await submitEvidenceForAiExtraction({
        projectId: projectIdForFieldWrite(req),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.status(201).json({ success: true, data: draft });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/evidence/:logId/confirm
 * Field Agent taps [Confirm & Sign Log] or [Edit Quantities] to commit evidence.
 */
router.post(
  '/:projectId/evidence/:logId/confirm',
  requireFieldSession,
  validateBody(ConfirmEvidenceLogRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const confirmed = await confirmEvidenceLogByAgent({
        projectId: projectIdForFieldWrite(req),
        logId: String(req.params.logId),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.json({ success: true, data: confirmed });
    } catch (error) {
      next(error);
    }
  }
);

export const evidenceRoutes = router;

