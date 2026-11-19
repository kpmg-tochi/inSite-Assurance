import crypto from 'crypto';
import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  HandoverMultipartPartsRequestSchema,
  HandoverPresignRequestSchema,
  HandoverUploadTicketRequestSchema,
  SubmitHandoverRequestSchema,
  VerifyHandoverCodeRequestSchema,
} from '@insite/shared';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  completeHandoverMultipart,
  getPublicHandoverInfo,
  handoverMultipartStatus,
  presignHandoverParts,
  startHandoverMultipart,
  presignHandoverUpload,
  requestHandoverCode,
  requireHandoverSession,
  startHandoverSession,
  submitHandover,
  verifyHandoverCode,
} from './handoverPublic.service';

/**
 * Public stakeholder handover API (Phase 10 Step 3), mounted at /api/v1/public/handover on its own
 * router, before the app's JSON parser: small body limit, strict per-IP and per-token rate limits,
 * no cookies, no shared auth, and nothing else reachable from here.
 */

const router = Router();

function limiter(options: { windowMs: number; limit: number; code: string; perToken?: boolean }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test' && !process.env.RATE_LIMIT_IN_TESTS,
    // Per token: keyed on a hash of the token (never the token itself) so one link cannot be
    // hammered from many addresses.
    ...(options.perToken
      ? {
          keyGenerator: (req: Request) =>
            `t:${crypto.createHash('sha256').update(String(req.params.token ?? '')).digest('hex').slice(0, 32)}`,
        }
      : {}),
    handler: (_req, _res, next) => {
      next(new AppError('Too many requests. Wait a few minutes and try again.', 429, options.code));
    },
  });
}

const MINUTE = 60 * 1000;
/** Every public handover request, per IP. */
const perIp = limiter({ windowMs: 15 * MINUTE, limit: 120, code: 'RATE_LIMITED_HANDOVER' });
/** Per link. */
const viewPerToken = limiter({ windowMs: 15 * MINUTE, limit: 60, code: 'RATE_LIMITED_HANDOVER', perToken: true });
const codeRequestPerToken = limiter({ windowMs: 15 * MINUTE, limit: 3, code: 'RATE_LIMITED_HANDOVER_CODE', perToken: true });
const codeVerifyPerToken = limiter({ windowMs: 15 * MINUTE, limit: 10, code: 'RATE_LIMITED_HANDOVER_CODE', perToken: true });
const uploadPerToken = limiter({ windowMs: 15 * MINUTE, limit: 80, code: 'RATE_LIMITED_HANDOVER_UPLOAD', perToken: true });
/** Part signing and status checks while resuming (many small calls per large file). */
const partsPerToken = limiter({ windowMs: 15 * MINUTE, limit: 400, code: 'RATE_LIMITED_HANDOVER_UPLOAD', perToken: true });
const submitPerToken = limiter({ windowMs: 60 * MINUTE, limit: 10, code: 'RATE_LIMITED_HANDOVER_SUBMIT', perToken: true });

router.use(perIp);
router.use(express.json({ limit: '64kb' }));
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const token = (req: Request) => String(req.params.token ?? '');

router.get(
  '/:token',
  viewPerToken,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getPublicHandoverInfo(token(req)) });
  })
);

router.post(
  '/:token/otp/request',
  codeRequestPerToken,
  wrap(async (req, res) => {
    res.json({ success: true, data: await requestHandoverCode(token(req)) });
  })
);

router.post(
  '/:token/otp/verify',
  codeVerifyPerToken,
  validateBody(VerifyHandoverCodeRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await verifyHandoverCode(token(req), req.body.code) });
  })
);

router.post(
  '/:token/session',
  codeVerifyPerToken,
  wrap(async (req, res) => {
    res.json({ success: true, data: await startHandoverSession(token(req)) });
  })
);

router.post(
  '/:token/uploads/presign',
  uploadPerToken,
  validateBody(HandoverPresignRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    res.json({ success: true, data: await presignHandoverUpload(link, req.body) });
  })
);

// Resumable uploads (files above 5 MB): start, sign the parts still to send, check what arrived, complete.
router.post(
  '/:token/uploads/multipart/start',
  uploadPerToken,
  validateBody(HandoverPresignRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    res.json({ success: true, data: await startHandoverMultipart(link, req.body) });
  })
);

router.post(
  '/:token/uploads/multipart/parts',
  partsPerToken,
  validateBody(HandoverMultipartPartsRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    res.json({ success: true, data: await presignHandoverParts(link, req.body) });
  })
);

router.post(
  '/:token/uploads/multipart/status',
  partsPerToken,
  validateBody(HandoverUploadTicketRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    res.json({ success: true, data: await handoverMultipartStatus(link, req.body) });
  })
);

router.post(
  '/:token/uploads/multipart/complete',
  partsPerToken,
  validateBody(HandoverUploadTicketRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    res.json({ success: true, data: await completeHandoverMultipart(link, req.body) });
  })
);

router.post(
  '/:token/submit',
  submitPerToken,
  validateBody(SubmitHandoverRequestSchema),
  wrap(async (req, res) => {
    const link = await requireHandoverSession(token(req), req.headers.authorization);
    const data = await submitHandover(link, req.body, {
      clientIp: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    res.status(201).json({ success: true, data });
  })
);

router.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

export const handoverPublicRoutes = router;
