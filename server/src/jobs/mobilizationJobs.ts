import {
  cadenceExpectsDailyPresence,
  daysBetween,
  isWorkday,
  zonedCalendarDate,
  zonedDateTimeToInstant,
} from '@insite/shared';
import { prisma } from '../config/prisma';
import { dispatchQueuedMessages, sendMessage } from '../integrations/messaging';
import { recordAuditEvent } from '../modules/audit/audit.service';
import { CADENCE_PROJECT_SELECT, cadenceSettingsForDate } from '../modules/cadence/cadence.service';
import { firstCheckIn, raiseAttendanceAlert } from '../modules/mobilization/attendance.service';
import {
  effectiveCheckInTime,
  effectiveReminderOffsets,
  PARTICIPANT_INCLUDE,
  participantSessionIds,
} from '../modules/mobilization/participants.service';
import { LIVE_PROJECT_WHERE } from './cadenceJobs';
import { JobContext, registerJob, runUnit } from './runner';

const NOT_READY = ['INVITED', 'REGISTERED_PENDING_ASSURANCE'] as const;

/** The active join code for a participant's role (and contractor package when it has one). */
async function joinCodeFor(projectId: string, roleId: string, projectContractorId: string | null): Promise<string | null> {
  const active = { projectId, roleId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
  const exact = await prisma.projectJoinCode.findFirst({ where: { ...active, projectContractorId }, select: { code: true } });
  if (exact || !projectContractorId) return exact?.code ?? null;
  const projectWide = await prisma.projectJoinCode.findFirst({ where: { ...active, projectContractorId: null }, select: { code: true } });
  return projectWide?.code ?? null;
}

/**
 * mobilization-reminders: on each configured offset (days before the planned date) send one
 * reminder to participants who are not yet ready. The JobRun key includes the planned date, so
 * moving the date re-arms the schedule. A join code is only ever emailed to the address the admin
 * entered, never pushed.
 */
export async function runMobilizationReminders({ now }: JobContext): Promise<void> {
  const participants = await prisma.expectedProjectParticipant.findMany({
    where: { mobilizationStatus: { in: [...NOT_READY] }, project: LIVE_PROJECT_WHERE },
    include: {
      ...PARTICIPANT_INCLUDE,
      user: { select: { email: true } },
      project: {
        select: { tenantId: true, name: true, codePrefix: true, timezone: true, workdayStartTime: true, mobilizationReminderOffsetsDays: true },
      },
    },
  });
  for (const p of participants) {
    const today = zonedCalendarDate(now, p.project.timezone);
    const daysBefore = daysBetween(today, p.plannedMobilizationDate);
    if (daysBefore < 0 || !effectiveReminderOffsets(p).includes(daysBefore)) continue;
    await runUnit('mobilization-reminders', `${p.id}:${p.plannedMobilizationDate}:${daysBefore}`, async () => {
      const provisioned = p.role.onboardingMode === 'PROVISIONED_ACCOUNT';
      const data = {
        fullName: p.fullName,
        projectName: p.project.name,
        projectCode: p.project.codePrefix,
        roleName: p.role.name,
        plannedMobilizationDate: p.plannedMobilizationDate,
        daysBefore,
        signInWithAccount: provisioned,
        pendingAssurance: p.mobilizationStatus === 'REGISTERED_PENDING_ASSURANCE',
      };
      const sent: string[] = [];
      const email = p.email ?? (provisioned ? p.user?.email ?? null : null);
      if (email) {
        // The join code goes only to the email the admin typed for this participant.
        const joinCode = !provisioned && p.email ? await joinCodeFor(p.projectId, p.roleId, p.projectContractorId) : null;
        const r = await sendMessage({
          tenantId: p.project.tenantId,
          projectId: p.projectId,
          channel: 'EMAIL',
          to: email,
          templateKey: 'MOBILIZATION_REMINDER',
          data: { ...data, joinCode },
        });
        sent.push(`email:${r.status}`);
      }
      const pushTo = p.userId ? `user:${p.userId}` : p.linkedFieldSessionId ? `session:${p.linkedFieldSessionId}` : null;
      if (pushTo) {
        const r = await sendMessage({
          tenantId: p.project.tenantId,
          projectId: p.projectId,
          channel: 'PUSH',
          to: pushTo,
          templateKey: 'MOBILIZATION_REMINDER',
          data: { ...data, joinCode: null },
        });
        sent.push(`push:${r.status}`);
      }
      if (!email && !pushTo && p.phoneNumber) {
        const r = await sendMessage({
          tenantId: p.project.tenantId,
          projectId: p.projectId,
          channel: 'SMS',
          to: p.phoneNumber,
          templateKey: 'MOBILIZATION_REMINDER',
          data: { ...data, joinCode: null },
        });
        sent.push(`sms:${r.status}`);
      }
      await prisma.$transaction(async (tx) => {
        await tx.expectedProjectParticipant.update({ where: { id: p.id }, data: { lastReminderSentAt: now } });
        await recordAuditEvent(tx, {
          projectId: p.projectId,
          actorType: 'SYSTEM',
          actorId: 'job:mobilization-reminders',
          actorDisplayName: 'Mobilization reminders',
          action: 'PARTICIPANT_REMINDER_SENT',
          summaryText: `Reminded ${p.fullName} (${daysBefore} day(s) before ${p.plannedMobilizationDate}) via ${sent.join(', ') || 'no channel'}.`,
          payload: { participantId: p.id, daysBefore, channels: sent },
        });
      });
      return sent.join(',');
    });
  }
}

/**
 * attendance-check: after a participant's expected check-in time plus grace, raise
 * - MOBILIZATION_NO_SHOW on the mobilization date with no in-geofence check-in,
 * - UNVERIFIED_AT_MOBILIZATION on that date when registration or assurance is unfinished,
 * - WORKDAY_MISSED_CHECKIN on later workdays (cadences that expect daily presence).
 */
export async function runAttendanceCheck({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: LIVE_PROJECT_WHERE, select: CADENCE_PROJECT_SELECT });
  for (const project of projects) {
    try {
      const today = zonedCalendarDate(now, project.timezone);
      const settings = cadenceSettingsForDate(project, today);
      const participants = await prisma.expectedProjectParticipant.findMany({
        where: { projectId: project.id, mobilizationStatus: { not: 'WITHDRAWN' }, plannedMobilizationDate: { lte: today } },
        include: PARTICIPANT_INCLUDE,
      });
      for (const p of participants) {
        const expectedAt = zonedDateTimeToInstant(today, effectiveCheckInTime(p), project.timezone);
        const deadline = new Date(expectedAt.getTime() + p.checkInGraceMinutes * 60_000);
        if (now < deadline) continue;
        const isMobilizationDay = p.plannedMobilizationDate === today;
        if (!isMobilizationDay && !(cadenceExpectsDailyPresence(settings.reportingCadence) && isWorkday(settings, today))) continue;

        const sessionIds = await participantSessionIds(prisma, p);
        if (isMobilizationDay) {
          const sessions = sessionIds.length
            ? await prisma.fieldAgentSession.findMany({ where: { id: { in: sessionIds }, isActive: true }, select: { assuranceStatus: true } })
            : [];
          if (!sessions.some((s) => s.assuranceStatus === 'APPROVED')) {
            await runUnit('attendance-check', `${p.id}:${today}:UNVERIFIED_AT_MOBILIZATION`, async () => {
              await raiseAttendanceAlert({ projectId: project.id, participant: p, fieldSessionId: p.linkedFieldSessionId, workdayDate: today, alertType: 'UNVERIFIED_AT_MOBILIZATION' });
            });
          }
        }
        const checkIn = await firstCheckIn(prisma, { projectId: project.id, sessionIds, date: today, timeZone: project.timezone, until: deadline });
        if (checkIn) continue;
        const alertType = isMobilizationDay ? 'MOBILIZATION_NO_SHOW' : 'WORKDAY_MISSED_CHECKIN';
        await runUnit('attendance-check', `${p.id}:${today}:${alertType}`, async () => {
          await raiseAttendanceAlert({ projectId: project.id, participant: p, fieldSessionId: p.linkedFieldSessionId, workdayDate: today, alertType });
        });
      }
    } catch (error) {
      console.warn(`[jobs] attendance-check failed for project ${project.id}:`, error);
    }
  }
}

export async function runMessageDispatch({ now }: JobContext): Promise<void> {
  await dispatchQueuedMessages(now);
}

export function registerMobilizationJobs(): void {
  registerJob({ name: 'mobilization-reminders', intervalMs: 15 * 60 * 1000, run: runMobilizationReminders });
  registerJob({ name: 'attendance-check', intervalMs: 10 * 60 * 1000, run: runAttendanceCheck });
  registerJob({ name: 'message-dispatch', intervalMs: 60 * 1000, run: runMessageDispatch });
}
