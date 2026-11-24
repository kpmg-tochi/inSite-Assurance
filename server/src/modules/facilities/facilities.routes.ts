import { Router, Request, Response, NextFunction } from 'express';
import { CreateFacilityRequestSchema, UpdateFacilityRequestSchema } from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { createFacility, listFacilities, updateFacility } from './facilities.service';

/** Redesign R2a: the tenant facility catalogue (mounted at /api/v1/facilities). */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Any web user of the tenant reads the catalogue (scope pickers); `includeRetired` for admins. */
router.get(
  '/',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listFacilities(req.webUser!.tenantId, req.query.includeRetired === 'true') });
  })
);

router.post(
  '/',
  requirePermission('facilities:manage'),
  validateBody(CreateFacilityRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createFacility(req.webUser!, req.body) });
  })
);

/** Rename, re-archetype, reorder, retire (`isRetired: true`) or restore. */
router.patch(
  '/:facilityId',
  requirePermission('facilities:manage'),
  validateBody(UpdateFacilityRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateFacility(req.webUser!, String(req.params.facilityId), req.body) });
  })
);

export const facilitiesRoutes = router;
