import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateOrganizationRequestSchema,
  ListOrganizationsQuerySchema,
  UpdateOrganizationRequestSchema,
} from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { createOrganization, listOrganizations, updateOrganization } from './organizations.service';

const router = Router();

/**
 * GET /api/v1/organizations?tag=&search=&includeArchived=
 * Any signed-in web user of the tenant: the directory feeds organisation inputs.
 */
router.get('/', requireWebAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ListOrganizationsQuerySchema.parse(req.query);
    res.json({ success: true, data: await listOrganizations(req.webUser!.tenantId, query) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/organizations */
router.post(
  '/',
  requirePermission('organizations:manage'),
  validateBody(CreateOrganizationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json({ success: true, data: await createOrganization(req.webUser!, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /api/v1/organizations/:organizationId (edit, tag, archive or restore) */
router.patch(
  '/:organizationId',
  requirePermission('organizations:manage'),
  validateBody(UpdateOrganizationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateOrganization(req.webUser!, String(req.params.organizationId), req.body);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/v1/organizations/:organizationId/archive */
router.post(
  '/:organizationId/archive',
  requirePermission('organizations:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateOrganization(req.webUser!, String(req.params.organizationId), {
        isArchived: true,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

export const organizationsRoutes = router;
