import { Router, Request, Response, NextFunction } from 'express';
import { SaveProjectTypeRequestSchema } from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  archiveProjectType,
  createProjectType,
  getProjectType,
  listProjectTypes,
  updateProjectType,
} from './projectTypes.service';

/**
 * Project types (Phase 11). Every web user of the tenant can read them (the wizard's type picker
 * and the list filters); `project_types:manage` creates, edits and archives.
 */
const router = Router();

/** GET /api/v1/project-types?includeInactive=true */
router.get('/', requireWebAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listProjectTypes(req.webUser!.tenantId, req.query.includeInactive === 'true') });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/project-types/:projectTypeId */
router.get('/:projectTypeId', requireWebAuth, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getProjectType(req.webUser!.tenantId, String(req.params.projectTypeId)) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/project-types */
router.post('/', requirePermission('project_types:manage'), validateBody(SaveProjectTypeRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await createProjectType(req.webUser!, req.body) });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/v1/project-types/:projectTypeId: writes a new version; projects keep their snapshot. */
router.put(
  '/:projectTypeId',
  requirePermission('project_types:manage'),
  validateBody(SaveProjectTypeRequestSchema),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await updateProjectType(req.webUser!, String(req.params.projectTypeId), req.body) });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/v1/project-types/:projectTypeId/archive */
router.post('/:projectTypeId/archive', requirePermission('project_types:manage'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await archiveProjectType(req.webUser!, String(req.params.projectTypeId)) });
  } catch (error) {
    next(error);
  }
});

export const projectTypesRoutes = router;
