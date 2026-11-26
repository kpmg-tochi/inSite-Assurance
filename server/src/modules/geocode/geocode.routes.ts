import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { GeocodeSearchRequestSchema, type GeocodeStatusDto } from '@insite/shared';
import { env } from '../../config/env';
import { requireWebAuth } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { isGeocodingEnabled } from '../../integrations/geocoding';
import { searchAddress } from './geocode.service';

/**
 * Client demo updates D3: address lookup, mounted at /api/v1/geocode.
 * - GET /status → GeocodeStatusDto (any signed-in web user).
 * - POST /search (GeocodeSearchRequest) → GeocodeSearchDto; signed-in web users, 30 a minute per
 *   user; 404 GEOCODING_DISABLED without a key, 502 GEOCODING_FAILED when the provider fails.
 */
export const GEOCODE_SEARCH_LIMIT = { windowMs: 60 * 1000, limit: 30 } as const;

/**
 * Per user (the route runs after authentication), in memory like the other limiters in
 * `middleware/rateLimit.middleware.ts`; skipped in tests unless RATE_LIMIT_IN_TESTS is set.
 */
const geocodeSearchRateLimit = rateLimit({
  ...GEOCODE_SEARCH_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `geocode:${req.webUser?.userId ?? 'anonymous'}`,
  skip: () => env.NODE_ENV === 'test' && !process.env.RATE_LIMIT_IN_TESTS,
  handler: (_req, _res, next) => {
    next(new AppError('Too many address lookups. Wait a minute and try again.', 429, 'RATE_LIMITED_GEOCODE'));
  },
});

export const geocodeRoutes = Router();

geocodeRoutes.get('/status', requireWebAuth, (_req: Request, res: Response) => {
  const data: GeocodeStatusDto = { enabled: isGeocodingEnabled() };
  res.json({ success: true, data });
});

geocodeRoutes.post(
  '/search',
  requireWebAuth,
  geocodeSearchRateLimit,
  validateBody(GeocodeSearchRequestSchema),
  (req: Request, res: Response, next: NextFunction) => {
    searchAddress(req.body)
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  }
);
