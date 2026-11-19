import { Prisma } from '@prisma/client';
import {
  addDays,
  AttendanceAlertActionRequest,
  AttendanceAlertStatus,
  AttendanceAlertType,
  CheckInStatusDto,
  isWorkday,
  SiteAttendanceAlertDto,
  zonedCalendarDate,
  zonedDateTimeToInstant,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { CADENCE_PROJECT_SELECT, cadenceSettingsForDate } from '../cadence/cadence.service';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Check-in and attendance alerts (Phase 8 Step 6). A check-in is the first in-geofence ping of
 * any kind on a day (manual check-in, presence, capture or report), excluding mock locations.
 */

const IN_GEOFENCE: Prisma.SiteTelemetryPingWhereInput = {
  isMocked: false,
  OR: [{ geofenceStatus: { in: ['INSIDE', 'WITHIN_TOLERANCE'] } }, { geofenceStatus: null, isWithinGeofence: true }],
};

export function dayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedDateTimeToInstant(date, '00:00', timeZone), end: zonedDateTimeToInstant(addDays(date, 1), '00:00', timeZone) };
}

/** First qualifying check-in of the given sessions on a project day, optionally before `until`. */
export async function firstCheckIn(
  db: Db,
  params: { projectId: string; sessionIds: string[]; date: string; timeZone: string; until?: Date }
): Promise<{ capturedAt: Date; source: string } | null> {
  if (params.sessionIds.length === 0) return null;
  const { start, end } = dayBounds(params.date, params.timeZone);
  const upper = params.until && params.until < end ? params.until : end;
  const ping = await db.siteTelemetryPing.findFirst({
    where: {
      projectId: params.projectId,
      fieldSessionId: { in: params.sessionIds },
      capturedAtDevice: { gte: start, lt: upper },
      ...IN_GEOFENCE,
    },
    orderBy: { capturedAtDevice: 'asc' },
    select: { capturedAtDevice: true, pingSource: true },
  });
  return ping ? { capturedAt: ping.capturedAtDevice, source: ping.pingSource } : null;
}

/** The caller's check-in for the project's current day (all devices of a provisioned account). */
export async function getCheckInStatus(projectId: string, fieldAgent: FieldAgentJwtPayload, now = new Date()): Promise<CheckInStatusDto> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: CADENCE_PROJECT_SELECT });
  const today = zonedCalendarDate(now, project.timezone);
  const sessionIds = fieldAgent.userId
    ? (await prisma.fieldAgentSession.findMany({ where: { projectId, userId: fieldAgent.userId }, select: { id: true } })).map((s) => s.id)
    : [fieldAgent.sessionId];
  const first = await firstCheckIn(prisma, { projectId, sessionIds, date: today, timeZone: project.timezone });
  const { start, end } = dayBounds(today, project.timezone);
  const manual = await prisma.siteTelemetryPing.findFirst({
    where: { projectId, fieldSessionId: { in: sessionIds }, pingSource: 'MANUAL_CHECKIN', capturedAtDevice: { gte: start, lt: end } },
    orderBy: { capturedAtDevice: 'desc' },
    select: { capturedAtDevice: true, isWithinGeofence: true, geofenceStatus: true },
  });
  return {
    workdayDate: today,
    isWorkday: isWorkday(cadenceSettingsForDate(project, today), today),
    checkedIn: Boolean(first),
    checkedInAt: first?.capturedAt.toISOString() ?? null,
    source: first?.source ?? null,
    lastManualCheckIn: manual
      ? { capturedAt: manual.capturedAtDevice.toISOString(), isWithinGeofence: manual.isWithinGeofence, geofenceStatus: manual.geofenceStatus }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const ALERT_INCLUDE = { participant: { select: { fullName: true } } } satisfies Prisma.SiteAttendanceAlertInclude;
type AlertRow = Prisma.SiteAttendanceAlertGetPayload<{ include: typeof ALERT_INCLUDE }>;

function serializeAlert(row: AlertRow, names: Map<string, string>): SiteAttendanceAlertDto {
  return {
    id: row.id,
    projectId: row.projectId,
    participantId: row.participantId,
    participantName: row.participant?.fullName ?? null,
    fieldSessionId: row.fieldSessionId,
    workdayDate: row.workdayDate,
    alertType: row.alertType,
    status: row.status,
    resolvedByUserId: row.resolvedByUserId,
    resolvedByName: row.resolvedByUserId ? names.get(row.resolvedByUserId) ?? null : null,
    resolutionNotes: row.resolutionNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export async function listAttendanceAlerts(params: {
  projectId: string;
  status?: AttendanceAlertStatus[];
  alertType?: AttendanceAlertType[];
  limit?: number;
}): Promise<SiteAttendanceAlertDto[]> {
  const where: Prisma.SiteAttendanceAlertWhereInput = { projectId: params.projectId };
  if (params.status?.length) where.status = { in: params.status };
  if (params.alertType?.length) where.alertType = { in: params.alertType };
  const rows = await prisma.siteAttendanceAlert.findMany({
    where,
    include: ALERT_INCLUDE,
    orderBy: [{ workdayDate: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(params.limit ?? 200, 500),
  });
  const names = await userNames(rows.map((r) => r.resolvedByUserId));
  return rows.map((r) => serializeAlert(r, names));
}

const ALERT_LABEL: Record<AttendanceAlertType, string> = {
  MOBILIZATION_NO_SHOW: 'did not check in on their mobilization day',
  WORKDAY_MISSED_CHECKIN: 'has not checked in today',
  UNVERIFIED_AT_MOBILIZATION: 'has not finished registration or identity checks on their mobilization day',
};

/**
 * Raises one alert per participant, day and type (unique key). Returns false when it existed.
 * Audits ATTENDANCE_ALERT_RAISED and notifies users with presence:manage_noshow_alerts.
 */
export async function raiseAttendanceAlert(params: {
  projectId: string;
  participant: { id: string; fullName: string };
  fieldSessionId: string | null;
  workdayDate: string;
  alertType: AttendanceAlertType;
}): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const alert = await tx.siteAttendanceAlert.create({
        data: {
          projectId: params.projectId,
          participantId: params.participant.id,
          fieldSessionId: params.fieldSessionId,
          workdayDate: params.workdayDate,
          alertType: params.alertType,
        },
      });
      if (params.alertType === 'MOBILIZATION_NO_SHOW') {
        await tx.expectedProjectParticipant.updateMany({
          where: { id: params.participant.id, mobilizationStatus: { notIn: ['WITHDRAWN', 'MOBILIZED_ON_SITE'] } },
          data: { mobilizationStatus: 'NO_SHOW_FLAGGED' },
        });
      }
      const summary = `${params.participant.fullName} ${ALERT_LABEL[params.alertType]} (${params.workdayDate}).`;
      await recordAuditEvent(tx, {
        projectId: params.projectId,
        actorType: 'SYSTEM',
        actorId: 'job:attendance-check',
        actorDisplayName: 'Attendance check',
        action: 'ATTENDANCE_ALERT_RAISED',
        summaryText: summary,
        payload: { alertId: alert.id, participantId: params.participant.id, alertType: params.alertType, workdayDate: params.workdayDate },
      });
      await createWebNotification(tx, {
        projectId: params.projectId,
        targetPermissionKey: 'presence:manage_noshow_alerts',
        category: 'ATTENDANCE_ALERT',
        title: params.alertType === 'WORKDAY_MISSED_CHECKIN' ? 'Missed check-in' : 'Mobilization alert',
        description: summary,
        actionUrl: `/app/projects/${params.projectId}/audit?tab=presence&view=alerts`,
        metadata: { alertId: alert.id, participantId: params.participant.id, alertType: params.alertType },
      });
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

const NEXT_STATUS: Record<AttendanceAlertActionRequest['action'], AttendanceAlertStatus> = {
  ACKNOWLEDGE: 'ACKNOWLEDGED',
  EXCUSE: 'EXCUSED',
  RESOLVE: 'RESOLVED',
};

export async function actOnAttendanceAlert(params: {
  projectId: string;
  alertId: string;
  webUser: WebJwtPayload;
  input: AttendanceAlertActionRequest;
}): Promise<SiteAttendanceAlertDto> {
  const { input, webUser } = params;
  const alert = await prisma.siteAttendanceAlert.findFirst({
    where: { id: params.alertId, projectId: params.projectId },
    include: ALERT_INCLUDE,
  });
  if (!alert) throw new AppError('Attendance alert not found', 404, 'ALERT_NOT_FOUND');
  const allowedFrom: AttendanceAlertStatus[] = input.action === 'ACKNOWLEDGE' ? ['OPEN'] : ['OPEN', 'ACKNOWLEDGED'];
  if (!allowedFrom.includes(alert.status)) {
    throw new AppError(`An alert that is ${alert.status.toLowerCase()} cannot be ${NEXT_STATUS[input.action].toLowerCase()}`, 409, 'ALERT_STATE_CONFLICT');
  }
  if (input.action === 'EXCUSE' && (input.notes ?? '').trim().length < 3) {
    throw new AppError('A note is required to excuse an alert', 400, 'NOTE_REQUIRED');
  }
  const next = NEXT_STATUS[input.action];
  await prisma.$transaction(async (tx) => {
    const updated = await tx.siteAttendanceAlert.updateMany({
      where: { id: alert.id, status: { in: allowedFrom } },
      data: {
        status: next,
        resolvedByUserId: webUser.userId,
        resolutionNotes: input.notes?.trim() || alert.resolutionNotes,
        resolvedAt: input.action === 'ACKNOWLEDGE' ? alert.resolvedAt : new Date(),
      },
    });
    if (updated.count === 0) throw new AppError('The alert changed; reload and try again', 409, 'ALERT_STATE_CONFLICT');
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'ATTENDANCE_ALERT_RESOLVED',
      summaryText: `${input.action === 'ACKNOWLEDGE' ? 'Acknowledged' : input.action === 'EXCUSE' ? 'Excused' : 'Resolved'} the ${alert.alertType.toLowerCase().replace(/_/g, ' ')} alert for ${alert.participant?.fullName ?? 'a participant'} (${alert.workdayDate})${input.notes ? `: ${input.notes.trim()}` : '.'}`,
      payload: { alertId: alert.id, action: input.action, previousStatus: alert.status, status: next, notes: input.notes ?? null },
    });
  });
  const fresh = await prisma.siteAttendanceAlert.findUniqueOrThrow({ where: { id: alert.id }, include: ALERT_INCLUDE });
  return serializeAlert(fresh, await userNames([fresh.resolvedByUserId]));
}
