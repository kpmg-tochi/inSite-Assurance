import { Prisma } from '@prisma/client';
import { addDays, KpiPeriod, resolveProjectTypeConfig, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../../config/prisma';
import type { KpiDurationSum, KpiProjectFacts, KpiVisitFact } from './kpiEngine';

/**
 * Loads the facts the KPI engine needs for a set of projects: one batched query per source, never
 * one query per project. Timestamp windows are widened by a day on each side in SQL and trimmed
 * exactly in code.
 *
 * Zones: `periodZone` is the tenant's time zone. Events that are only counted into a period
 * (approvals, release decisions, certificate issue) are dated in it, so "this month" means the
 * tenant's month. Project-local facts (deadlines, the kick-off day, completion dates and the
 * project's "today" for what is already due) stay in the project's own zone, as everywhere else.
 */

export const KPI_PROJECT_SELECT = {
  id: true,
  status: true,
  constructionPhase: true,
  timezone: true,
  projectTypeSnapshotJson: true,
  totalBudgetNgn: true,
  disbursedToDateNgn: true,
  scheduleStatus: true,
  plannedEndDate: true,
  originalPlannedEndDate: true,
  kickoffDate: true,
  processConfig: { select: { requireReportApproval: true } },
} satisfies Prisma.ProjectSelect;

export type KpiProjectRow = Prisma.ProjectGetPayload<{ select: typeof KPI_PROJECT_SELECT }>;

const DAY_MS = 24 * 3600 * 1000;
const daysBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / DAY_MS);

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const emptyDuration = (): KpiDurationSum => ({ totalDays: 0, count: 0 });

export async function loadKpiFacts(
  projects: KpiProjectRow[],
  period: KpiPeriod,
  periodZone: string,
  now: Date = new Date()
): Promise<KpiProjectFacts[]> {
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const inIds = { in: ids };
  // Timestamp window around the calendar period (trimmed in the tenant's zone below).
  const windowStart = new Date(new Date(`${period.from}T00:00:00.000Z`).getTime() - DAY_MS);
  const windowEnd = new Date(new Date(`${period.to}T23:59:59.999Z`).getTime() + DAY_MS);
  const dateIn = (d: Date | null) => {
    if (!d) return false;
    const day = zonedCalendarDate(d, periodZone);
    return day >= period.from && day <= period.to;
  };
  // Visits dated in the period or due in it (deadlines are at most 60 days after the visit).
  const visitFrom = addDays(period.from, -60);

  const [
    meetings,
    milestones,
    assignments,
    documents,
    visitRows,
    visitsEver,
    visitLeads,
    sprintRows,
    baselines,
    baselineVisits,
    finalEvaluations,
    finalEvaluationVisits,
    reportApprovals,
    inspectionApprovals,
    visitApprovals,
    certificates,
    closureRows,
    lessons,
  ] = await Promise.all([
    prisma.kickoffMeeting.findMany({
      where: { projectId: inIds },
      select: {
        projectId: true,
        scheduledAt: true,
        heldAt: true,
        agendaDocumentId: true,
        minutesDocument: { select: { currentVersion: true, isArchived: true, signOffs: { select: { version: true } } } },
        invitees: { select: { attended: true } },
      },
    }),
    prisma.projectContractMilestone.findMany({
      where: { projectId: inIds },
      select: { projectId: true, completionMode: true, anchor: true, requiredDocumentTypeCodes: true, dueDate: true, status: true, completedAt: true },
    }),
    prisma.userProjectAssignment.findMany({
      where: { projectId: inIds, user: { isActive: true } },
      select: { projectId: true, user: { select: { role: { select: { code: true } }, mobileRole: { select: { code: true } } } } },
    }),
    prisma.projectDocument.findMany({
      where: { projectId: inIds, isArchived: false },
      distinct: ['projectId', 'documentTypeId'],
      select: { projectId: true, documentType: { select: { code: true } } },
    }),
    prisma.visit.findMany({
      where: { projectId: inIds, status: { notIn: ['PROPOSED', 'CANCELLED'] }, plannedDate: { gte: visitFrom, lte: period.to } },
      select: {
        projectId: true,
        visitKind: true,
        status: true,
        origin: true,
        plannedDate: true,
        submissionDeadline: true,
        submissions: { select: { isLate: true } },
      },
    }),
    prisma.visit.groupBy({ by: ['projectId'], where: { projectId: inIds, status: { notIn: ['PROPOSED', 'CANCELLED'] } }, _count: { _all: true } }),
    prisma.visitAssignee.findMany({
      where: { isLead: true, visit: { projectId: inIds, status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] } } },
      select: { visit: { select: { projectId: true } } },
    }),
    prisma.projectSprint.findMany({ where: { projectId: inIds }, select: { projectId: true, endDate: true, firstVerifiedAt: true } }),
    prisma.siteInspectionReport.groupBy({
      by: ['projectId'],
      where: { projectId: inIds, visitType: 'BASELINE', status: 'APPROVED' },
      _count: { _all: true },
    }),
    prisma.visit.groupBy({ by: ['projectId'], where: { projectId: inIds, visitKind: 'BASELINE', status: 'APPROVED' }, _count: { _all: true } }),
    prisma.siteInspectionReport.findMany({
      where: { projectId: inIds, visitType: 'FINAL_EVALUATION', status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
      select: { projectId: true, overallFinding: true },
    }),
    prisma.visitSubmission.findMany({
      where: { projectId: inIds, status: 'APPROVED', visit: { visitKind: 'FINAL_EVALUATION' } },
      orderBy: { approvedAt: 'desc' },
      select: { projectId: true, overallFinding: true },
    }),
    prisma.workdayReport.findMany({
      where: {
        projectId: inIds,
        status: 'APPROVED_COMPLETED',
        approvedCompletedAt: { gte: windowStart, lte: windowEnd },
        humanConfirmedAt: { not: null },
      },
      select: { projectId: true, humanConfirmedAt: true, approvedCompletedAt: true },
    }),
    prisma.siteInspectionReport.findMany({
      where: { projectId: inIds, status: 'APPROVED', approvedAt: { gte: windowStart, lte: windowEnd } },
      select: { projectId: true, confirmedAt: true, approvedAt: true },
    }),
    prisma.visitSubmission.findMany({
      where: { projectId: inIds, status: 'APPROVED', approvalChainVersion: { not: null }, approvedAt: { gte: windowStart, lte: windowEnd } },
      select: { projectId: true, receivedAt: true, approvedAt: true },
    }),
    prisma.completionCertificate.findMany({
      where: { projectId: inIds, status: 'ISSUED' },
      select: { projectId: true, issuedAt: true, completionDate: true },
    }),
    prisma.closureChecklistItemState.findMany({ where: { projectId: inIds }, select: { projectId: true, itemKey: true, status: true } }),
    prisma.lessonLearned.groupBy({ by: ['projectId'], where: { projectId: inIds, status: 'PUBLISHED' }, _count: { _all: true } }),
  ]);

  const meetingOf = new Map(meetings.map((m) => [m.projectId, m]));
  const milestonesOf = groupBy(milestones, (m) => m.projectId);
  const assignmentsOf = groupBy(assignments, (a) => a.projectId);
  const documentsOf = groupBy(documents, (d) => d.projectId);
  const visitsOf = groupBy(visitRows, (v) => v.projectId);
  const visitsEverSet = new Set(visitsEver.map((v) => v.projectId));
  const leadSet = new Set(visitLeads.map((l) => l.visit.projectId));
  const sprintsOf = groupBy(sprintRows, (s) => s.projectId);
  const baselineSet = new Set([...baselines.map((b) => b.projectId), ...baselineVisits.map((b) => b.projectId)]);
  const finalFindingOf = new Map<string, string>();
  // Accepted final evaluation visits first, then legacy inspections (until R5).
  for (const e of finalEvaluationVisits) if (!finalFindingOf.has(e.projectId)) finalFindingOf.set(e.projectId, e.overallFinding);
  for (const e of finalEvaluations) if (!finalFindingOf.has(e.projectId)) finalFindingOf.set(e.projectId, e.overallFinding);
  const certificateOf = new Map(certificates.map((c) => [c.projectId, c]));
  const closureOf = groupBy(closureRows, (r) => r.projectId);
  const lessonsOf = new Map(lessons.map((l) => [l.projectId, l._count._all]));


  const approvalsOf = new Map<string, KpiDurationSum>();
  const addDuration = (map: Map<string, KpiDurationSum>, projectId: string, from: Date | null, to: Date | null) => {
    if (!from || !to || !dateIn(to)) return;
    const d = map.get(projectId) ?? emptyDuration();
    d.totalDays += daysBetween(from, to);
    d.count += 1;
    map.set(projectId, d);
  };
  for (const r of reportApprovals) addDuration(approvalsOf, r.projectId, r.humanConfirmedAt, r.approvedCompletedAt);
  for (const r of inspectionApprovals) addDuration(approvalsOf, r.projectId, r.confirmedAt, r.approvedAt);
  for (const r of visitApprovals) addDuration(approvalsOf, r.projectId, r.receivedAt, r.approvedAt);

  return projects.map((p) => {
    const zone = p.timezone;
    const today = zonedCalendarDate(now, zone);
    const typeConfig = resolveProjectTypeConfig(p.projectTypeSnapshotJson);
    const meeting = meetingOf.get(p.id);
    const kickoffDate = meeting ? zonedCalendarDate(meeting.scheduledAt, zone) : p.kickoffDate;
    const supervisorCodes = new Set(typeConfig?.supervision.supervisorRoleCodes ?? []);
    const minutes = meeting?.minutesDocument;
    const certificate = certificateOf.get(p.id);
    return {
      projectId: p.id,
      status: p.status,
      constructionPhase: p.constructionPhase,
      today,
      typeConfig,
      requireReportApproval: p.processConfig?.requireReportApproval ?? false,
      budgetNgn: Number(p.totalBudgetNgn ?? 0),
      disbursedNgn: Number(p.disbursedToDateNgn),
      scheduleStatus: p.scheduleStatus,
      plannedEndDate: p.originalPlannedEndDate ?? p.plannedEndDate,
      kickoff: kickoffDate
        ? {
            date: kickoffDate,
            hasMeeting: Boolean(meeting),
            hasAgenda: Boolean(meeting?.agendaDocumentId),
            heldDate: meeting?.heldAt ? zonedCalendarDate(meeting.heldAt, zone) : null,
            minutesSigned: Boolean(minutes && !minutes.isArchived && minutes.signOffs.some((s) => s.version === minutes.currentVersion)),
            invited: meeting?.invitees.length ?? 0,
            attended: meeting?.invitees.filter((i) => i.attended === true).length ?? 0,
          }
        : null,
      milestones: (milestonesOf.get(p.id) ?? []).map((m) => ({
        completionMode: m.completionMode,
        anchor: m.anchor,
        requiredDocumentTypeCodes: m.requiredDocumentTypeCodes,
        dueDate: m.dueDate,
        status: m.status,
        completedDate: m.completedAt ? zonedCalendarDate(m.completedAt, zone) : null,
      })),
      hasSupervisor: (assignmentsOf.get(p.id) ?? []).some(
        (a) => supervisorCodes.has(a.user.role.code) || (a.user.mobileRole ? supervisorCodes.has(a.user.mobileRole.code) : false)
      ),
      hasVisitLead: leadSet.has(p.id),
      documentTypeCodes: new Set((documentsOf.get(p.id) ?? []).map((d) => d.documentType.code)),
      hasApprovedBaseline: baselineSet.has(p.id),
      visits: (visitsOf.get(p.id) ?? []).map(
        (v): KpiVisitFact => ({
          visitKind: v.visitKind,
          status: v.status,
          origin: v.origin,
          plannedDate: v.plannedDate,
          submissionDeadline: v.submissionDeadline,
          submitted: v.submissions.length > 0,
          submittedOnTime: v.submissions.some((s) => !s.isLate),
        })
      ),
      hasVisits: visitsEverSet.has(p.id),
      sprints: (sprintsOf.get(p.id) ?? []).map((s) => ({ endDate: s.endDate, firstVerifiedDate: s.firstVerifiedAt ? zonedCalendarDate(s.firstVerifiedAt, zone) : null })),
      approvals: approvalsOf.get(p.id) ?? emptyDuration(),
      certificate: certificate?.issuedAt
        ? { issuedDate: zonedCalendarDate(certificate.issuedAt, periodZone), completionDate: certificate.completionDate }
        : null,
      finalEvaluationFinding: finalFindingOf.get(p.id) ?? null,
      closureItemStatus: new Map((closureOf.get(p.id) ?? []).map((r) => [r.itemKey, r.status])),
      publishedLessonCount: lessonsOf.get(p.id) ?? 0,
    };
  });
}

/** The months (first days) from `months - 1` months before `today`'s month up to it, oldest first. */
export function recentMonthStarts(today: string, months: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The last day of the month that starts on `monthStart`. */
export function monthEnd(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
}
