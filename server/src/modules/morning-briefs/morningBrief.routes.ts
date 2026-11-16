import { Router, Request, Response, NextFunction } from 'express';
import { GenerateMorningBriefRequestSchema } from '@insite/shared';
import { requireAnyAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  generateDailyDispatchForProject,
  generateOrGetMorningBriefForBoqItem,
  listMorningBriefsForProject,
} from './morningBrief.service';

const router = Router();

/**
 * POST /api/v1/projects/:projectId/boq/:boqItemId/morning-brief
 * Generates (or returns cached) Morning Deliverable Brief for a specific WBS item.
 */
router.post(
  '/:projectId/boq/:boqItemId/morning-brief',
  requireAnyAuth,
  validateBody(GenerateMorningBriefRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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
 * Triggers daily Plan A + Fallback Morning Deliverable Brief generation for a project.
 */
router.post(
  '/:projectId/morning-briefs/dispatch',
  requireAnyAuth,
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
  requireAnyAuth,
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

