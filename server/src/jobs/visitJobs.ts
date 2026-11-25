import { Prisma } from '@prisma/client';
import { addDays, daysBetween, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { recordAuditEvent } from '../modules/audit/audit.service';
import { createWebNotification } from '../modules/notifications/notifications.service';
import { flushVisitPushes, monitoringConfigOf, notifyOfficers, SYSTEM_VISIT_ACTOR, VisitPushQueue, visitLabel } from '../modules/visits/visitCore';
import { proposeVisitsFromType } from '../modules/visits/visitPlan.service';
import { refreshScheduleBadge } from '../modules/schedule/schedule.service';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * Redesign R4 visit jobs (D-R4.40: every ACTIVE project of a non-suspended tenant, in every phase):
 * - visit-reminders: unconfirmed visits `unconfirmedReminderDays` before their date (once per visit and date);
 * - visit-deadlines: visits whose submission deadline passed without a live submission become MISSED;
 *   one more mobilisation check while mobilisation stays open; sprints ended unverified (once per sprint);
 * - finding-escalations: findings open longer than `findingEscalationDays` (once per finding).
 */

export const VISIT_PROJECT_WHERE: Prisma.ProjectWhereInput = { status: 'ACTIVE', tenant: { status: { not: 'SUSPENDED' } } };

const PROJECT_SELECT = { id: true, codePrefix: true, timezone: true, projectTypeSnapshotJson: true } as const;

// ---------------------------------------------------------------------------
// visit-reminders
// ---------------------------------------------------------------------------

export async function runVisitReminders({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: { ...VISIT_PROJECT_WHERE, visits: { some: { status: 'PLANNED', confirmation: 'UNCONFIRMED' } } }, select: PROJECT_SELECT });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    const days = monitoringConfigOf(p.projectTypeSnapshotJson).unconfirmedReminderDays;
    const visits = await prisma.visit.findMany({
      where: { projectId: p.id, status: 'PLANNED', confirmation: 'UNCONFIRMED', plannedDate: { gte: today, lte: addDays(today, days) } },
      select: { id: true, visitKind: true, plannedDate: true, assignees: { select: { userId: true } } },
    });
    for (const v of visits) {
      await runUnit('visit-reminders', `${v.id}:${v.plannedDate}`, async () => {
        const pushes: VisitPushQueue = [];
        await prisma.$transaction((tx) =>
          notifyOfficers(tx, pushes, {
            projectId: p.id,
            visitId: v.id,
            userIds: v.assignees.map((a) => a.userId),
            type: 'VISIT_REMINDER',
            title: `Confirm the ${visitLabel(v.visitKind).toLowerCase()} on ${v.plannedDate}`,
            message: `${p.codePrefix}: the ${visitLabel(v.visitKind).toLowerCase()} on ${v.plannedDate} is not confirmed yet. Confirm it, move it or propose another date.`,
          })
        );
        await flushVisitPushes(pushes);
        return `${v.assignees.length} officer(s) reminded`;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// visit-deadlines
// ---------------------------------------------------------------------------

async function markMissed(p: { id: string; codePrefix: string }, today: string, now: Date): Promise<number> {
  const due = await prisma.visit.findMany({
    where: { projectId: p.id, status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] }, submissionDeadline: { lt: today } },
    select: { id: true, submissionDeadline: true },
  });
  let missed = 0;
  for (const { id, submissionDeadline } of due) {
    const outcome = await runUnit('visit-deadlines', `missed:${id}:${submissionDeadline}`, async () => {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "visits" WHERE id = ${id}::uuid FOR UPDATE`;
        const v = await tx.visit.findUniqueOrThrow({ where: { id } });
        if (!['PLANNED', 'IN_PROGRESS', 'RETURNED'].includes(v.status) || !v.submissionDeadline || v.submissionDeadline >= today) return 'not due';
        await tx.visit.update({ where: { id }, data: { status: 'MISSED', missedAt: now } });
        const label = visitLabel(v.visitKind);
        await createWebNotification(tx, {
          projectId: p.id,
          targetPermissionKey: 'visits:plan',
          category: 'VISIT_MISSED',
          title: `Missed: ${label} of ${v.plannedDate}`,
          description: `${p.codePrefix}: nothing was submitted for the ${label.toLowerCase()} of ${v.plannedDate} by ${v.submissionDeadline}.`,
          actionUrl: `/app/projects/${p.id}/visits?visitId=${id}`,
          metadata: { visitId: id },
        });
        await recordAuditEvent(tx, {
          projectId: p.id,
          actorType: 'SYSTEM',
          actorId: 'visit-deadlines',
          actorDisplayName: 'InSite (visits)',
          action: 'VISIT_MISSED',
          summaryText: `The ${label.toLowerCase()} of ${v.plannedDate} was missed: no submission by ${v.submissionDeadline}.`,
          payload: { visitId: id, submissionDeadline: v.submissionDeadline, previousStatus: v.status },
        });
        return 'missed';
      });
    });
    if (outcome === 'done') missed += 1;
  }
  return missed;
}

async function notifySprintsDue(p: { id: string; codePrefix: string; projectTypeSnapshotJson: Prisma.JsonValue }, today: string, now: Date): Promise<number> {
  const sprints = await prisma.projectSprint.findMany({
    where: { projectId: p.id, endDate: { lt: today }, verificationOutcome: null, verificationDueAlertedAt: null },
    select: { id: true, name: true, endDate: true },
  });
  const days = monitoringConfigOf(p.projectTypeSnapshotJson).sprintVerificationDays;
  let sent = 0;
  for (const s of sprints) {
    const outcome = await runUnit('visit-deadlines', `sprint:${s.id}`, () =>
      prisma.$transaction(async (tx) => {
        await createWebNotification(tx, {
          projectId: p.id,
          targetPermissionKey: 'sprints:verify',
          category: 'SPRINT_VERIFICATION_DUE',
          title: `Verify ${s.name}`,
          description: `${p.codePrefix}: ${s.name} ended on ${s.endDate}. Record whether it was met by ${addDays(s.endDate, days)}.`,
          actionUrl: `/app/projects/${p.id}/scope?sprintId=${s.id}`,
          metadata: { sprintId: s.id },
        });
        await tx.projectSprint.update({ where: { id: s.id }, data: { verificationDueAlertedAt: now } });
        return 'alerted';
      })
    );
    if (outcome === 'done') sent += 1;
  }
  return sent;
}

export async function runVisitDeadlines({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: { ...VISIT_PROJECT_WHERE }, select: PROJECT_SELECT });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    const missed = await markMissed(p, today, now);
    const sprints = await notifySprintsDue(p, today, now);
    if (sprints > 0) await refreshScheduleBadge(p.id, now).catch(() => undefined);
    const plan = monitoringConfigOf(p.projectTypeSnapshotJson).visitPlan;
    if (plan.some((r) => r.kind === 'EVERY_N_WEEKS_UNTIL_MOBILISED')) {
      await runUnit('visit-deadlines', `mobilisation:${p.id}:${today}`, async () => {
        const r = await prisma.$transaction((tx) => proposeVisitsFromType(tx, p.id, { trigger: 'MOBILISATION_EXTEND', actor: SYSTEM_VISIT_ACTOR, now }));
        return `${r.createdIds.length} mobilisation check(s) proposed`;
      });
    }
    void missed;
  }
}

// ---------------------------------------------------------------------------
// finding-escalations
// ---------------------------------------------------------------------------

export async function runFindingEscalations({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { ...VISIT_PROJECT_WHERE, findings: { some: { status: 'OPEN', escalatedAt: null } } },
    select: PROJECT_SELECT,
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    const days = monitoringConfigOf(p.projectTypeSnapshotJson).findingEscalationDays;
    const findings = await prisma.finding.findMany({
      where: { projectId: p.id, status: 'OPEN', escalatedAt: null },
      select: { id: true, createdAt: true, title: true, description: true, severity: true },
    });
    for (const f of findings) {
      const openDays = daysBetween(zonedCalendarDate(f.createdAt, p.timezone), today);
      if (openDays < days) continue;
      await runUnit('finding-escalations', f.id, () =>
        prisma.$transaction(async (tx) => {
          const claimed = await tx.finding.updateMany({ where: { id: f.id, status: 'OPEN', escalatedAt: null }, data: { escalatedAt: now } });
          if (claimed.count === 0) return 'closed';
          const what = f.title ?? f.description.slice(0, 120);
          await createWebNotification(tx, {
            projectId: p.id,
            targetPermissionKey: 'findings:receive_escalations',
            category: 'FINDING_ESCALATED',
            title: `Finding open for ${openDays} days`,
            description: `${p.codePrefix}: "${what}" (${f.severity.toLowerCase()}) has been open for ${openDays} days.`,
            actionUrl: `/app/projects/${p.id}/visits?tab=findings`,
            metadata: { findingId: f.id, openDays },
          });
          await recordAuditEvent(tx, {
            projectId: p.id,
            actorType: 'SYSTEM',
            actorId: 'finding-escalations',
            actorDisplayName: 'InSite (findings)',
            action: 'FINDING_ESCALATED',
            summaryText: `Escalated the finding "${what}": open for ${openDays} days (limit ${days}).`,
            payload: { findingId: f.id, openDays, escalationDays: days },
          });
          return 'escalated';
        })
      );
    }
  }
}

export function registerVisitJobs(): void {
  registerJob({ name: 'visit-reminders', intervalMs: 60 * 60 * 1000, run: runVisitReminders });
  registerJob({ name: 'visit-deadlines', intervalMs: 60 * 60 * 1000, run: runVisitDeadlines });
  registerJob({ name: 'finding-escalations', intervalMs: 60 * 60 * 1000, run: runFindingEscalations });
}
