import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateScheduleRevisionRequestSchema,
  DecideScheduleRevisionRequestSchema,
  PreviewScheduleRevisionRequestSchema,
  ProposeScheduleDatesRequestSchema,
  SaveScheduleBaselineRequestSchema,
  ScheduleRevisionStatusEnum,
} from '@insite/shared';
import { z } from 'zod';
import { guardProjectRoutes } from '../../utils/accessControl';
import { AppError } from '../../middleware/error.middleware';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { getProjectSchedule, proposeScheduleDates, saveScheduleBaseline } from './schedule.service';
import {
  approveScheduleRevision,
  createScheduleRevision,
  listScheduleRevisions,
  previewScheduleRevision,
  rejectScheduleRevision,
  withdrawScheduleRevision,
} from './scheduleRevision.service';

/** Phase 9: schedule baseline, variance and "Catch Project Up" revisions. */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const pid = (req: Request) => String(req.params.projectId);
const revisionIdOf = (req: Request) => {
  const parsed = z.string().uuid().safeParse(req.params.revisionId);
  if (!parsed.success) throw new AppError('Schedule revision not found', 404, 'SCHEDULE_REVISION_NOT_FOUND');
  return parsed.data;
};

/** GET /projects/:projectId/schedule: items, dates, both progress measures, variance, dependencies. */
router.get(
  '/:projectId/schedule',
  // The setup wizard's schedule step reads it too.
  requirePermission('schedule:view_variance', 'projects:edit_baseline'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectSchedule(pid(req), req.webUser!) });
  })
);

/** PUT /projects/:projectId/schedule/baseline: project dates, item dates and dependencies. */
router.put(
  '/:projectId/schedule/baseline',
  requirePermission('projects:edit_baseline'),
  validateBody(SaveScheduleBaselineRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveScheduleBaseline(pid(req), req.webUser!, req.body) });
  })
);

/** POST /projects/:projectId/schedule/propose-dates: suggested item dates; nothing is saved. */
router.post(
  '/:projectId/schedule/propose-dates',
  requirePermission('projects:edit_baseline'),
  validateBody(ProposeScheduleDatesRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await proposeScheduleDates(pid(req), req.body) });
  })
);

/** GET /projects/:projectId/schedule/revisions?status= */
router.get(
  '/:projectId/schedule/revisions',
  requirePermission('schedule:view_variance'),
  wrap(async (req, res) => {
    const parsed = ScheduleRevisionStatusEnum.safeParse(req.query.status);
    res.json({
      success: true,
      data: await listScheduleRevisions(pid(req), req.webUser!, parsed.success ? { status: parsed.data } : {}),
    });
  })
);

/** POST /projects/:projectId/schedule/revisions/preview: the propagated plan; nothing is saved. */
router.post(
  '/:projectId/schedule/revisions/preview',
  requirePermission('schedule:catch_up_refactor'),
  validateBody(PreviewScheduleRevisionRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await previewScheduleRevision(pid(req), req.body) });
  })
);

/** POST /projects/:projectId/schedule/revisions: pending approval, or applied at once. */
router.post(
  '/:projectId/schedule/revisions',
  requirePermission('schedule:catch_up_refactor'),
  validateBody(CreateScheduleRevisionRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createScheduleRevision(pid(req), req.webUser!, req.body) });
  })
);

/** POST /projects/:projectId/schedule/revisions/:revisionId/approve */
router.post(
  '/:projectId/schedule/revisions/:revisionId/approve',
  requirePermission('schedule:approve_refactor'),
  validateBody(DecideScheduleRevisionRequestSchema),
  wrap(async (req, res) => {
    const data = await approveScheduleRevision(pid(req), revisionIdOf(req), req.webUser!, req.body);
    res.json({ success: true, data });
  })
);

/** POST /projects/:projectId/schedule/revisions/:revisionId/reject */
router.post(
  '/:projectId/schedule/revisions/:revisionId/reject',
  requirePermission('schedule:approve_refactor'),
  validateBody(DecideScheduleRevisionRequestSchema),
  wrap(async (req, res) => {
    const data = await rejectScheduleRevision(pid(req), revisionIdOf(req), req.webUser!, req.body);
    res.json({ success: true, data });
  })
);

/** POST /projects/:projectId/schedule/revisions/:revisionId/withdraw (the proposer only, while pending) */
router.post(
  '/:projectId/schedule/revisions/:revisionId/withdraw',
  requirePermission('schedule:catch_up_refactor'),
  validateBody(DecideScheduleRevisionRequestSchema),
  wrap(async (req, res) => {
    const data = await withdrawScheduleRevision(pid(req), revisionIdOf(req), req.webUser!, req.body);
    res.json({ success: true, data });
  })
);

export const scheduleRoutes = router;
