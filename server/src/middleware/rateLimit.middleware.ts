import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from './error.middleware';

/**
 * In-memory rate limiters. Each API instance counts separately; move to a shared store
 * (Redis) before running more than one instance.
 */
function limiter(options: { windowMs: number; limit: number; code: string; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test' && !process.env.RATE_LIMIT_IN_TESTS,
    handler: (_req, _res, next) => {
      next(new AppError(options.message, 429, options.code));
    },
  });
}

/** Per IP: 20 sign-in attempts per 15 minutes. Per-account lockout is enforced separately. */
export const loginRateLimit = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  code: 'RATE_LIMITED_LOGIN',
  message: 'Too many sign-in attempts from this network. Try again later.',
});

/** Per IP: demo endpoints (reset, seed). */
export const demoRateLimit = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  code: 'RATE_LIMITED_DEMO',
  message: 'Too many demo requests. Try again later.',
});

/** Per IP: upload URL issuance. */
export const presignRateLimit = limiter({
  windowMs: 60 * 1000,
  limit: 60,
  code: 'RATE_LIMITED_PRESIGN',
  message: 'Too many upload requests. Slow down and try again.',
});
