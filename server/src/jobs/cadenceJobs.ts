import { cadenceHasPeriods, formatDueLabel, getReportingPeriod, periodNoun, ReportingCadence, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { sendPushToFieldSession } from '../integrations/push.service';
import { recordAuditEvent } from '../modules/audit/audit.service';
import {
  applyDuePendingCadence,
  CADENCE_PROJECT_SELECT,
  cadenceSettingsForDate,
  sessionsForScope,
} from '../modules/cadence/cadence.service';
import { briefPersonasForProject, generateDispatchForProject } from '../modules/morning-briefs/morningBrief.service';
import { createMobileNotification, createWebNotification } from '../modules/notifications/notifications.service';
import { JobContext, registerJob, runUnit } from './runner';

/** Scheduled jobs only ever touch live projects of tenants that are not suspended. */
export const LIVE_PROJECT_WHERE = { status: 'ACTIVE', tenant: { status: { not: 'SUSPENDED' } } } as const;

/**
 * brief-dispatch: at a project's period start (first workday of the period, at workdayStartTime in
 * the project zone) generate the period's briefs per persona and its reporting obligations. One
 * JobRun per (project, period, persona), so a persona that appears mid-period still gets briefs.
 */
export async function runBriefDispatch({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: LIVE_PROJECT_WHERE, select: CADENCE_PROJECT_SELECT });
  for (const project of projects) {
    try {
      const today = zonedCalendarDate(now, project.timezone);
      await applyDuePendingCadence(project, today);
      const settings = cadenceSettingsForDate(project, today);
      if (!cadenceHasPeriods(settings.reportingCadence)) continue;
      const period = getReportingPeriod(settings, now);
      if (!period?.briefAt || now.getTime() < new Date(period.briefAt).getTime()) continue;
      for (const persona of await briefPersonasForProject(project.id)) {
        await runUnit('brief-dispatch', `${project.id}:${period.periodStart}:${persona}`, async () => {
          const briefs = await generateDispatchForProject(project.id, today, [persona]);
          return `${briefs.length} brief(s)`;
        });
      }
    } catch (error) {
      console.warn(`[jobs] brief-dispatch failed for project ${project.id}:`, error);
    }
  }
}

/**
 * overdue-reports: after dueAt + grace, PENDING obligations become MISSED (REPORT_MISSED once each),
 * then each (project, period, reporter scope) group notifies its reporters (in-app and push) and
 * users with reports:view_all (web notification).
 */
export async function runOverdueReports({ now }: JobContext): Promise<void> {
  const due = await prisma.reportingObligation.findMany({
    where: { status: 'PENDING', lateAfter: { lt: now }, project: LIVE_PROJECT_WHERE },
    include: {
      boqItem: { select: { wbsCode: true } },
      project: { select: { reportingCadence: true, timezone: true } },
    },
    orderBy: { lateAfter: 'asc' },
    take: 500,
  });

  const missed: typeof due = [];
  for (const o of due) {
    const outcome = await runUnit('overdue-reports', `obligation:${o.id}`, async () => {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.reportingObligation.updateMany({
          where: { id: o.id, status: 'PENDING' },
          data: { status: 'MISSED', alertedAt: now },
        });
        if (changed.count === 0) return;
        await recordAuditEvent(tx, {
          projectId: o.projectId,
          actorType: 'SYSTEM',
          actorId: 'job:overdue-reports',
          actorDisplayName: 'Reporting schedule',
          action: 'REPORT_MISSED',
          summaryText: `No ${o.reporterScope === 'verifier' ? 'verifier' : 'contractor'} report on WBS ${o.boqItem.wbsCode} for ${o.periodStart} to ${o.periodEnd} by its due time.`,
          payload: { obligationId: o.id, reporterScope: o.reporterScope, periodStart: o.periodStart, dueAt: o.dueAt.toISOString() },
        });
        missed.push(o);
      });
    });
    if (outcome === 'failed') continue;
  }

  const groups = new Map<string, typeof due>();
  for (const o of missed) {
    const key = `${o.projectId}|${o.periodStart}|${o.reporterScope}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  for (const items of groups.values()) {
    const first = items[0];
    const codes = items.map((i) => i.boqItem.wbsCode).sort();
    const codeList = codes.length > 4 ? `${codes.slice(0, 4).join(', ')} and ${codes.length - 4} more` : codes.join(', ');
    const noun = periodNoun(first.project.reportingCadence as ReportingCadence).report.toLowerCase();
    const due = formatDueLabel(first.dueAt, first.project.timezone);
    try {
      const sessions = await sessionsForScope(first.projectId, first.reporterScope);
      await prisma.$transaction(async (tx) => {
        for (const s of sessions) {
          await createMobileNotification(tx, {
            projectId: first.projectId,
            fieldSessionId: s.id,
            type: 'REPORT_OVERDUE',
            actionType: 'NONE',
            title: 'Report overdue',
            message: `Your ${noun} for WBS ${codeList} was due ${due}. Submit it as soon as you can; it will be marked late.`,
            metadata: { wbsItemId: first.boqItemId, wbsCode: first.boqItem.wbsCode, periodStart: first.periodStart },
          });
        }
        await createWebNotification(tx, {
          projectId: first.projectId,
          targetPermissionKey: 'reports:view_all',
          category: 'REPORT_MISSED',
          title: `Missed ${noun}${items.length > 1 ? 's' : ''} · ${first.reporterScope === 'verifier' ? 'verifier' : 'contractor'}`,
          description: `No report on WBS ${codeList} for ${first.periodStart} to ${first.periodEnd} (due ${due}).`,
          actionUrl: `/app/projects/${first.projectId}/audit?tab=presence&view=due`,
          metadata: { periodStart: first.periodStart, reporterScope: first.reporterScope, obligationIds: items.map((i) => i.id) },
        });
      });
      for (const s of sessions) {
        await sendPushToFieldSession(s.id, {
          title: 'Report overdue',
          body: `Your ${noun} for WBS ${codeList} was due ${due}.`,
          data: { actionType: 'NONE', type: 'REPORT_OVERDUE' },
        });
      }
    } catch (error) {
      console.warn('[jobs] overdue-reports notification failed:', error);
    }
  }
}

export function registerCadenceJobs(): void {
  registerJob({ name: 'brief-dispatch', intervalMs: 5 * 60 * 1000, run: runBriefDispatch });
  registerJob({ name: 'overdue-reports', intervalMs: 5 * 60 * 1000, run: runOverdueReports });
}
