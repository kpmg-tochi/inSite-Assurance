import { Router, Request, Response, NextFunction } from 'express';
import { SaveRegionRequestSchema } from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { createRegion, listRegions, updateRegion } from './regions.service';

/** Tenant regions (Phase 11). Readable by every web user (forms and filters); managed with regions:manage. */
const router = Router();

/** GET /api/v1/regions?includeArchived=true */
router.get('/', requireWebAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listRegions(req.webUser!.tenantId, req.query.includeArchived === 'true') });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/regions */
router.post('/', requirePermission('regions:manage'), validateBody(SaveRegionRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await createRegion(req.webUser!, req.body) });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/v1/regions/:regionId (rename, move, archive or restore) */
router.put('/:regionId', requirePermission('regions:manage'), validateBody(SaveRegionRequestSchema), async (req, res, next) => {
  try {
    res.json({ success: true, data: await updateRegion(req.webUser!, String(req.params.regionId), req.body) });
  } catch (error) {
    next(error);
  }
});

export const regionsRoutes = router;
