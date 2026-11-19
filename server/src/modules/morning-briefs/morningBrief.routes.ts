import { assertConstructionOngoing } from '../closeout/closeoutGate';
import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { BriefPersonaEnum, GenerateMorningBriefRequestSchema } from '@insite/shared';
import {
  hasWebPermission,
  requireAnyAuthWithWebPermission,
  requirePermission,
} from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  generateDispatchForProject,
  generateOrGetMorningBriefForBoqItem,
  listMorningBriefsForProject,
  resolveBriefPersona,
} from './morningBrief.service';

function requestedPersona(raw: unknown) {
  const parsed = BriefPersonaEnum.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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
      const projectId = String(req.params.projectId);
      await assertConstructionOngoing(projectId, 'briefs');
      const targetPersona = await resolveBriefPersona({
        projectId,
        fieldAgent: req.fieldAgent,
        webUser: req.webUser,
        requested: requestedPersona(req.body?.targetPersona ?? req.query.persona),
      });
      const brief = await generateOrGetMorningBriefForBoqItem({
        projectId,
        boqItemId: String(req.params.boqItemId),
        targetPersona,
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
 * Generates the current period's Plan A + fallback briefs (and the period's reporting obligations)
 * for a project. Spends AI tokens, so it is restricted to web users who can edit the baseline.
 */
router.post(
  '/:projectId/morning-briefs/dispatch',
  requirePermission('projects:edit_baseline'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const persona = requestedPersona(req.body?.targetPersona);
      await assertConstructionOngoing(String(req.params.projectId), 'briefs');
      const briefs = await generateDispatchForProject(
        String(req.params.projectId),
        req.body?.workdayDate ? String(req.body.workdayDate) : undefined,
        persona ? [persona] : undefined
      );
      res.status(201).json({ success: true, data: briefs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/morning-briefs
 * Returns the current period's briefs (or the period containing ?workdayDate) ordered Plan A -> Fallbacks, for the caller's persona
 * (field) or ?persona= (web; defaults to the contractor brief when contractors report).
 */
router.get(
  '/:projectId/morning-briefs',
  requireAnyAuthWithWebPermission('boq:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const targetPersona = await resolveBriefPersona({
        projectId,
        fieldAgent: req.fieldAgent,
        webUser: req.webUser,
        requested: requestedPersona(req.query.persona),
      });
      const briefs = await listMorningBriefsForProject({
        projectId,
        targetPersona,
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
