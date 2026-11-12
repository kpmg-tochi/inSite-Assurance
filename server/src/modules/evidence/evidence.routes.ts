import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ConfirmEvidenceLogRequestSchema,
  MediaTypeEnum,
  SubmitEvidenceForExtractionRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requireFieldSession,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { storageService } from '../../integrations/storage.service';
import {
  confirmEvidenceLogByAgent,
  listProjectEvidenceTimeline,
  submitEvidenceForAiExtraction,
} from './evidence.service';

const router = Router();

const PresignRequestSchema = z.object({
  mediaType: MediaTypeEnum,
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(3).max(80),
});

/**
 * GET /api/v1/projects/:projectId/evidence
 * Returns chronological Field Evidence Timeline for Web Portal & Mobile App.
 */
router.get(
  '/:projectId/evidence',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logs = await listProjectEvidenceTimeline(
        String(req.params.projectId)
      );
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
  requireAnyAuth,
  validateBody(PresignRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const presigned = await storageService.createPresignedUpload({
        projectId: String(req.params.projectId),
        mediaType: req.body.mediaType,
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
      });
      res.json({ success: true, data: presigned });
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
        projectId: String(req.params.projectId),
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
        projectId: String(req.params.projectId),
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

