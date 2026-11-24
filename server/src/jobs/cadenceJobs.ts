import { Prisma } from '@prisma/client';
import { cadenceHasPeriods, formatDueLabel, getReportingPeriod, periodNoun, ReportingCadence, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { sendPushToFieldSession } from '../integrations/push.service';
import { recordAuditEvent } from '../modules/audit/audit.service';
import {
  applyDuePendingCadence,
  CADENCE_PROJECT_SELECT,
  CadenceProjectRow,
  cadenceSettingsForDate,
  periodKeyForDate,
  sessionsForScope,
} from '../modules/cadence/cadence.service';
import {
  applyDuePendingStreamCadence,
  createInspectionObligation,
  loadActiveStreams,
  STREAM_SELECT,
  StreamRow,
  streamCadenceRow,
  streamPersonas,
} from '../modules/cadence/streams.service';
import { dispatchObligationsForProject, reportingPersonasForProject } from '../modules/cadence/obligationDispatch';
import { createMobileNotification, createWebNotification } from '../modules/notifications/notifications.service';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * Scheduled jobs only ever touch live projects of tenants that are not suspended. Phase 10: once a
 * project is in its defects liability period (or closed), construction jobs (reporting obligations,
 * schedule variance) stop for it.
 */
export const LIVE_PROJECT_WHERE: Prisma.ProjectWhereInput = {
  status: 'ACTIVE',
  constructionPhase: { in: ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'] },
  tenant: { status: { not: 'SUSPENDED' } },
};

/**
 * reporting-obligations (was brief-dispatch; briefs were removed in redesign R1e): when a project's
 * period opens (first workday of the period, at workdayStartTime in the project zone) create the
 * period's reporting obligations per persona. One JobRun per (project, period, persona), so a persona
 * that appears mid-period is still owed reports.
 */
export async function runObligationDispatch({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: LIVE_PROJECT_WHERE, select: CADENCE_PROJECT_SELECT });
  for (const project of projects) {
    try {
      const today = zonedCalendarDate(now, project.timezone);
      await applyDuePendingCadence(project, today);
      // Phase 14: a project with reporting streams dispatches per stream.
      const streams = await loadActiveStreams(prisma, project.id);
      if (streams.length > 0) {
        await dispatchStreams(project, streams, today, now);
        continue;
      }
      const settings = cadenceSettingsForDate(project, today);
      if (!cadenceHasPeriods(settings.reportingCadence)) continue;
      const period = getReportingPeriod(settings, now);
      if (!period?.opensAt || now.getTime() < new Date(period.opensAt).getTime()) continue;
      for (const persona of await reportingPersonasForProject(project.id)) {
        await runUnit('reporting-obligations', `${project.id}:${period.periodStart}:${persona}`, async () => {
          const created = await dispatchObligationsForProject(project.id, today, [persona]);
          return `${created} obligation(s)`;
        });
      }
    } catch (error) {
      console.warn(`[jobs] reporting-obligations failed for project ${project.id}:`, error);
    }
  }
}

/**
 * Phase 14: per stream, at its period start. ITEM_REPORTS streams create item obligations for the
 * personas of their roles; INSPECTION streams create their one obligation.
 */
async function dispatchStreams(project: CadenceProjectRow, streams: StreamRow[], today: string, now: Date): Promise<void> {
  const personas = await reportingPersonasForProject(project.id);
  for (const stream of streams) {
    if (await applyDuePendingStreamCadence(stream, today)) {
      const fresh = await prisma.projectReportingStream.findUnique({ where: { id: stream.id }, select: STREAM_SELECT });
      if (fresh) Object.assign(stream, fresh);
    }
    const settings = cadenceSettingsForDate(streamCadenceRow(project, stream), today);
    if (!cadenceHasPeriods(settings.reportingCadence)) continue;
    const period = getReportingPeriod(settings, now);
    if (!period?.opensAt || now.getTime() < new Date(period.opensAt).getTime()) continue;
    if (stream.kind === 'INSPECTION') {
      await runUnit('reporting-obligations', `${project.id}:${stream.id}:${period.periodStart}:inspection`, async () => {
        const created = await createInspectionObligation(stream, periodKeyForDate(settings, today));
        return `${created} inspection obligation(s)`;
      });
      continue;
    }
    const owed = (await streamPersonas(prisma, stream)).filter((p) => personas.includes(p));
    for (const persona of owed) {
      await runUnit('reporting-obligations', `${project.id}:${stream.id}:${period.periodStart}:${persona}`, async () => {
        const created = await dispatchObligationsForProject(project.id, today, [persona], stream);
        return `${created} obligation(s)`;
      });
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
      stream: { select: { label: true, kind: true, reportingCadence: true, roleIds: true } },
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
          summaryText: o.boqItem
            ? `No ${o.reporterScope === 'verifier' ? 'verifier' : 'contractor'} report on WBS ${o.boqItem.wbsCode} for ${o.periodStart} to ${o.periodEnd} by its due time.`
            : `No ${o.stream?.label ?? 'site inspection'} for ${o.periodStart} to ${o.periodEnd} by its upload deadline.`,
          payload: { obligationId: o.id, reporterScope: o.reporterScope, streamId: o.streamId, periodStart: o.periodStart, dueAt: o.dueAt.toISOString() },
        });
        missed.push(o);
      });
    });
    if (outcome === 'failed') continue;
  }

  const groups = new Map<string, typeof due>();
  for (const o of missed) {
    // Phase 14: inspection obligations are notified one by one.
    if (!o.boqItemId) {
      await notifyMissedInspection(o).catch((error) => console.warn('[jobs] overdue-reports inspection notification failed:', error));
      continue;
    }
    const key = `${o.projectId}|${o.streamId ?? ''}|${o.periodStart}|${o.reporterScope}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  for (const items of groups.values()) {
    const first = items[0];
    const codes = items.map((i) => i.boqItem?.wbsCode ?? '').sort();
    const codeList = codes.length > 4 ? `${codes.slice(0, 4).join(', ')} and ${codes.length - 4} more` : codes.join(', ');
    const noun = periodNoun((first.stream?.reportingCadence ?? first.project.reportingCadence) as ReportingCadence).report.toLowerCase();
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
            metadata: { wbsItemId: first.boqItemId ?? undefined, wbsCode: first.boqItem?.wbsCode, periodStart: first.periodStart },
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

type MissedObligation = {
  id: string;
  projectId: string;
  streamId: string | null;
  periodStart: string;
  periodEnd: string;
  lateAfter: Date;
  project: { timezone: string };
  stream: { label: string; roleIds: string[] } | null;
};

/** A missed site inspection: the stream's field sessions and users who can view inspections. */
async function notifyMissedInspection(o: MissedObligation): Promise<void> {
  const label = o.stream?.label ?? 'Site inspection';
  const sessions = o.stream
    ? await prisma.fieldAgentSession.findMany({ where: { projectId: o.projectId, isActive: true, roleId: { in: o.stream.roleIds } }, select: { id: true } })
    : [];
  const deadline = formatDueLabel(o.lateAfter, o.project.timezone);
  await prisma.$transaction(async (tx) => {
    for (const s of sessions) {
      await createMobileNotification(tx, {
        projectId: o.projectId,
        fieldSessionId: s.id,
        type: 'REPORT_OVERDUE',
        actionType: 'NONE',
        title: `${label} overdue`,
        message: `The ${label.toLowerCase()} for ${o.periodStart} to ${o.periodEnd} was due by ${deadline}. Submit it as soon as you can; it will be marked late.`,
        metadata: { periodStart: o.periodStart },
      });
    }
    await createWebNotification(tx, {
      projectId: o.projectId,
      targetPermissionKey: 'inspections:view',
      category: 'INSPECTION_MISSED',
      title: `Missed inspection · ${label}`,
      description: `No ${label.toLowerCase()} for ${o.periodStart} to ${o.periodEnd} (upload deadline ${deadline}).`,
      actionUrl: `/app/projects/${o.projectId}/inspections`,
      metadata: { periodStart: o.periodStart, streamId: o.streamId, obligationId: o.id },
      hideFromProjectContractors: true,
    });
  });
}

export function registerCadenceJobs(): void {
  registerJob({ name: 'reporting-obligations', intervalMs: 5 * 60 * 1000, run: runObligationDispatch });
  registerJob({ name: 'overdue-reports', intervalMs: 5 * 60 * 1000, run: runOverdueReports });
}
