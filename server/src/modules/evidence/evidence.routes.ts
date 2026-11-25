import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { z } from 'zod';
import { MediaTypeEnum } from '@insite/shared';
import { hasWebPermission, requireAnyAuth, requirePermission } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { presignRateLimit } from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { assertProjectObjectKey, isHandoverObjectKey, storageService } from '../../integrations/storage.service';
import { prisma } from '../../config/prisma';
import { listProjectCaptures } from './evidence.service';
import { assertDocumentObjectReadable } from '../documents/documents.service';

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
 * Every registered capture with its server-computed integrity results, newest first.
 */
router.get(
  '/:projectId/evidence',
  requirePermission('visits:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const captures = await listProjectCaptures(projectId);
      res.json({ success: true, data: captures });
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
      const tenantId = await projectTenantId(projectId);
      let attachmentName: string | undefined;
      // Phase 13: a register document's file follows the document rules (permission, contractor side).
      if (await assertDocumentObjectReadable(projectId, key, req.webUser)) attachmentName = key.split('/').pop() ?? 'download';
      if (isHandoverObjectKey(key, tenantId, projectId)) {
        // Phase 10: stakeholder uploads are for handover reviewers only, and anything that is not an
        // image, audio or video is served as a download.
        if (!req.webUser || !hasWebPermission(req.webUser, 'handover:review_feedback')) {
          throw new AppError('File reference must be an object key issued for this project', 400, 'INVALID_OBJECT_KEY');
        }
        const info = await storageService.headObject(key);
        const type = (info?.contentType ?? '').toLowerCase();
        if (!/^(image|audio|video)\//.test(type)) attachmentName = key.split('/').pop() ?? 'download';
      }
      const url = await storageService.getPresignedReadUrl(key, 300, { attachmentName });
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

export const evidenceRoutes = router;

