import { windowOverlaps, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { getReportedProgressByItem } from '../evidence/evidenceProvider';
import {
  cadenceSettingsForDate,
  createObligationsForPeriod,
  loadCadenceProject,
  periodKeyForDate,
  ReportingPersona,
} from './cadence.service';
import { loadActiveStreams, projectHasStreams, StreamRow, streamCadenceRow, streamPersonas } from './streams.service';

/**
 * Reporting obligations at a period's start (Phase 8; briefs were removed in redesign R1e, so this is
 * all that is left of the period dispatch). The visit plan replaces it in R4.
 */

/**
 * The personas that owe reports on a project: the verifier, when someone could report (an active
 * session or a provisioned account assigned to the project). R1d: contractors have no login.
 */
export async function reportingPersonasForProject(projectId: string): Promise<ReportingPersona[]> {
  const persona = 'INDEPENDENT_VERIFIER' as const;
  const [sessions, accounts] = await Promise.all([
    prisma.fieldAgentSession.count({ where: { projectId, isActive: true, fieldPersonaType: persona } }),
    prisma.userProjectAssignment.count({
      where: { projectId, user: { isActive: true, mobileRole: { fieldPersonaType: persona } } },
    }),
  ]);
  return sessions + accounts > 0 ? [persona] : [];
}

/**
 * Items owed in a period (Phase 9): not done, and the planned window overlaps the period, or ended
 * before it (overdue work stays due until it is done), or planningTier PLAN_A (manual override).
 * "Done" means progress at 100%, or field reports already cover the whole quantity. Nothing is owed
 * once the project's contractor is terminated (one contractor per project; lines carry no package
 * since redesign R2d).
 */
export async function scheduledItemsForPeriod(projectId: string, key: { periodStart: string; periodEnd: string }) {
  const contractors = await prisma.projectContractor.findMany({ where: { projectId }, select: { contractStatus: true } });
  if (contractors.length > 0 && contractors.every((c) => c.contractStatus !== 'ACTIVE')) return [];
  const boqItems = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: { wbsCode: 'asc' },
    select: {
      id: true,
      planningTier: true,
      totalQuantity: true,
      cumulativeCertifiedPct: true,
      plannedStartDate: true,
      plannedEndDate: true,
    },
  });
  const reported = await getReportedProgressByItem(
    projectId,
    boqItems.map((b) => ({ id: b.id, totalQuantity: Number(b.totalQuantity) }))
  );
  return boqItems
    .filter((b) => Number(b.cumulativeCertifiedPct) < 100 && (reported.get(b.id) ?? 0) < 100)
    .filter(
      (b) =>
        b.planningTier === 'PLAN_A' ||
        windowOverlaps(b.plannedStartDate, b.plannedEndDate, key.periodStart, key.periodEnd) ||
        (b.plannedEndDate !== null && b.plannedEndDate < key.periodStart)
    )
    .map((b) => ({ id: b.id, isScheduled: true }));
}

/**
 * Creates the reporting obligations of the period containing `date` (default today in the project
 * zone) for the personas that report (or only `personas`). With reporting streams (Phase 14), per
 * ITEM_REPORTS stream, or only for `stream`. Idempotent. Returns the number of rows created.
 */
export async function dispatchObligationsForProject(
  projectId: string,
  date?: string,
  personas?: ReportingPersona[],
  stream?: StreamRow | null
): Promise<number> {
  if (!stream) {
    const streams = (await loadActiveStreams(prisma, projectId)).filter((s) => s.kind === 'ITEM_REPORTS');
    if (streams.length > 0 || (await projectHasStreams(prisma, projectId))) {
      const wanted = personas ?? (await reportingPersonasForProject(projectId));
      let created = 0;
      for (const s of streams) {
        const owed = (await streamPersonas(prisma, s)).filter((p) => wanted.includes(p));
        if (owed.length) created += await dispatchObligationsForProject(projectId, date, owed, s);
      }
      return created;
    }
  }
  const project = await loadCadenceProject(prisma, projectId);
  const day = date ?? zonedCalendarDate(new Date(), project.timezone);
  const settings = cadenceSettingsForDate(stream ? streamCadenceRow(project, stream) : project, day);
  const key = periodKeyForDate(settings, day);
  const items = await scheduledItemsForPeriod(projectId, key);
  const forPersonas = personas ?? (await reportingPersonasForProject(projectId));
  return createObligationsForPeriod({ projectId, key, personas: forPersonas, items, stream: stream ?? null });
}
