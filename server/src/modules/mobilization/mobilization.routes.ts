import { Router, Request, Response, NextFunction } from 'express';
import {
  AttendanceAlertActionRequestSchema,
  AttendanceAlertStatusEnum,
  AttendanceAlertTypeEnum,
  CreateExpectedParticipantRequestSchema,
  ExcuseObligationRequestSchema,
  ProjectReminderSettingsSchema,
  ReportingObligationStatusEnum,
  UpdateExpectedParticipantRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  requireAnyAuthWithWebPermission,
  requireFieldSession,
  requirePermission,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { excuseObligation, getCadenceOverview, listObligations } from '../cadence/cadence.service';
import {
  createParticipant,
  deleteParticipant,
  listParticipants,
  saveReminderSettings,
  updateParticipant,
} from './participants.service';
import { actOnAttendanceAlert, getCheckInStatus, listAttendanceAlerts } from './attendance.service';

/** Phase 8: cadence, reporting obligations, expected participants and attendance alerts. */
const router = guardProjectRoutes(Router());

/** Comma-separated query values that belong to an enum; unknown values are ignored. */
function listParam<T extends string>(raw: unknown, schema: { safeParse: (v: unknown) => { success: boolean } }): T[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const values = raw.split(',').map((v) => v.trim()).filter((v) => schema.safeParse(v).success) as T[];
  return values.length ? values : undefined;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const pid = (req: Request) => String(req.params.projectId);

/** GET /projects/:projectId/cadence: settings, current period, its obligations and counts. */
router.get(
  '/:projectId/cadence',
  requireAnyAuthWithWebPermission('reports:view_all'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getCadenceOverview(pid(req)) });
  })
);

/** GET /projects/:projectId/reporting-obligations?periodStart=&status=&view=due */
router.get(
  '/:projectId/reporting-obligations',
  requirePermission('reports:view_all'),
  wrap(async (req, res) => {
    const data = await listObligations({
      projectId: pid(req),
      periodStart: typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined,
      status: listParam(req.query.status, ReportingObligationStatusEnum),
      dueAndOverdue: req.query.view === 'due',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  })
);

/** POST /projects/:projectId/reporting-obligations/:obligationId/excuse (note required, audited). */
router.post(
  '/:projectId/reporting-obligations/:obligationId/excuse',
  requirePermission('presence:manage_noshow_alerts'),
  validateBody(ExcuseObligationRequestSchema),
  wrap(async (req, res) => {
    const data = await excuseObligation({
      projectId: pid(req),
      obligationId: String(req.params.obligationId),
      notes: req.body.notes,
      webUser: req.webUser!,
    });
    res.json({ success: true, data });
  })
);

// --- Expected participants -------------------------------------------------

router.get(
  '/:projectId/participants',
  requirePermission('mobilization:manage_roster', 'presence:manage_noshow_alerts'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listParticipants(pid(req)) });
  })
);

router.post(
  '/:projectId/participants',
  requirePermission('mobilization:manage_roster'),
  validateBody(CreateExpectedParticipantRequestSchema),
  wrap(async (req, res) => {
    const data = await createParticipant({ projectId: pid(req), webUser: req.webUser!, input: req.body });
    res.status(201).json({ success: true, data });
  })
);

/** PUT /projects/:projectId/participants/reminder-settings: the project's reminder schedule. */
router.put(
  '/:projectId/participants/reminder-settings',
  requirePermission('mobilization:configure_reminders'),
  validateBody(ProjectReminderSettingsSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveReminderSettings({ projectId: pid(req), webUser: req.webUser!, input: req.body }) });
  })
);

router.patch(
  '/:projectId/participants/:participantId',
  requirePermission('mobilization:manage_roster'),
  validateBody(UpdateExpectedParticipantRequestSchema),
  wrap(async (req, res) => {
    const data = await updateParticipant({
      projectId: pid(req),
      participantId: String(req.params.participantId),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data });
  })
);

router.delete(
  '/:projectId/participants/:participantId',
  requirePermission('mobilization:manage_roster'),
  wrap(async (req, res) => {
    await deleteParticipant(pid(req), String(req.params.participantId));
    res.json({ success: true, data: { deleted: true } });
  })
);

// --- Attendance alerts --------------------------------------------------------

router.get(
  '/:projectId/attendance-alerts',
  requirePermission('presence:manage_noshow_alerts', 'presence:view_telemetry'),
  wrap(async (req, res) => {
    const data = await listAttendanceAlerts({
      projectId: pid(req),
      status: listParam(req.query.status, AttendanceAlertStatusEnum),
      alertType: listParam(req.query.type, AttendanceAlertTypeEnum),
    });
    res.json({ success: true, data });
  })
);

/** POST /projects/:projectId/attendance-alerts/:alertId/action { action, notes } */
router.post(
  '/:projectId/attendance-alerts/:alertId/action',
  requirePermission('presence:manage_noshow_alerts'),
  validateBody(AttendanceAlertActionRequestSchema),
  wrap(async (req, res) => {
    const data = await actOnAttendanceAlert({
      projectId: pid(req),
      alertId: String(req.params.alertId),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data });
  })
);

// --- Field check-in -----------------------------------------------------------

/** GET /projects/:projectId/check-in/today: the caller's check-in status for today (field). */
router.get(
  '/:projectId/check-in/today',
  requireFieldSession,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getCheckInStatus(pid(req), req.fieldAgent!) });
  })
);

export const mobilizationRoutes = router;
