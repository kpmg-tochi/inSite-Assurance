import express, { Router, Request, Response, NextFunction } from 'express';
import {
  MAX_UPLOAD_BYTES,
  storageService,
  verifyLocalPartUrl,
  verifyLocalStorageUrl,
} from '../../integrations/storage.service';
import { AppError } from '../../middleware/error.middleware';

/**
 * Local development object storage (mounted only when S3 is not configured and not in production).
 *
 * The URLs are issued by `POST /projects/:projectId/evidence/presign` and `GET .../media`, which run
 * the normal project access checks; each URL carries an HMAC signature, expiry, and for uploads the
 * exact content type and size, so it behaves like an S3 presigned URL.
 */
const router = Router();

router.put(
  '/upload',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signed = verifyLocalStorageUrl('put', req.query as Record<string, unknown>);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== signed.contentType) {
        throw new AppError('Content-Type does not match the signed upload', 400, 'CONTENT_TYPE_MISMATCH');
      }
      if (body.length !== signed.byteSize) {
        throw new AppError('Body size does not match the signed upload', 400, 'CONTENT_LENGTH_MISMATCH');
      }
      await storageService.putLocalObject(signed.objectKey, body, contentType);
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  }
);

/** Phase 10: one part of a resumable upload (signed for this upload, part number and size cap). */
router.put(
  '/part',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signed = verifyLocalPartUrl(req.query as Record<string, unknown>);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0 || body.length > signed.maxBytes) {
        throw new AppError('Part size is not allowed', 400, 'CONTENT_LENGTH_MISMATCH');
      }
      await storageService.putLocalPart({ ...signed, body });
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  }
);

router.get('/file', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signed = verifyLocalStorageUrl('get', req.query as Record<string, unknown>);
    const object = await storageService.readLocalObject(signed.objectKey);
    if (!object) {
      throw new AppError('Object not found', 404, 'OBJECT_NOT_FOUND');
    }
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    // The web portal on another origin renders these in <img>/<audio>.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (signed.attachmentName) {
      res.setHeader('Content-Disposition', `attachment; filename="${signed.attachmentName}"`);
    }
    res.send(object.body);
  } catch (error) {
    next(error);
  }
});

export const localStorageRoutes = router;
