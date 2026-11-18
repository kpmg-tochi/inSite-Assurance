import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { GenerateMorningBriefRequestSchema } from '@insite/shared';
import {
  hasWebPermission,
  requireAnyAuthWithWebPermission,
  requirePermission,
} from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  generateDailyDispatchForProject,
  generateOrGetMorningBriefForBoqItem,
  listMorningBriefsForProject,
} from './morningBrief.service';

const router = guardProjectRoutes(Router());

/**
 * POST /api/v1/projects/:projectId/boq/:boqItemId/morning-brief
 * Generates (or returns cached) Morning Deliverable Brief for a specific WBS item.
 * Field agents may generate for their own project. Overriding the expected deliverable rewrites
 * the brief, so it requires a web user with `projects:edit_baseline`.
 */
router.post(
  '/:projectId/boq/:boqItemId/morning-brief',
  requireAnyAuthWithWebPermission('projects:edit_baseline'),
  validateBody(GenerateMorningBriefRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (
        req.body?.expectedDeliverableOverride &&
        !(req.webUser && hasWebPermission(req.webUser, 'projects:edit_baseline'))
      ) {
        throw new AppError(
          'Overriding the expected deliverable requires projects:edit_baseline',
          403,
          'FORBIDDEN_PERMISSION'
        );
      }
      const brief = await generateOrGetMorningBriefForBoqItem({
        projectId: String(req.params.projectId),
        boqItemId: String(req.params.boqItemId),
        input: req.body,
      });
      res.status(201).json({ success: true, data: brief });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/morning-briefs/dispatch
 * Triggers daily Plan A + Fallback brief generation for a project. Spends AI tokens, so it is
 * restricted to web users who can edit the project baseline.
 */
router.post(
  '/:projectId/morning-briefs/dispatch',
  requirePermission('projects:edit_baseline'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const briefs = await generateDailyDispatchForProject(
        String(req.params.projectId),
        req.body?.workdayDate ? String(req.body.workdayDate) : undefined
      );
      res.status(201).json({ success: true, data: briefs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/morning-briefs
 * Returns today's Morning Deliverable Briefs ordered by Plan A -> Fallbacks.
 */
router.get(
  '/:projectId/morning-briefs',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const briefs = await listMorningBriefsForProject({
        projectId: String(req.params.projectId),
        workdayDate: req.query.workdayDate
          ? String(req.query.workdayDate)
          : undefined,
      });
      res.json({ success: true, data: briefs });
    } catch (error) {
      next(error);
    }
  }
);

export const morningBriefRoutes = router;
