import {
  deriveSprintStatus,
  OPEN_DEFECT_STATUSES,
  unitsActiveInSprint,
  VISIT_KIND_META,
  zonedCalendarDate,
  type OverviewDeadline,
  type OverviewNextVisit,
  type OverviewSprint,
  type ProjectOverviewDto,
  type VisitKind,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { OPEN_MILESTONE_STATUSES } from '../contracts/milestones.service';
import { monitoringConfigOf } from '../visits/visitCore';
import { loadProjectStages } from './projectStage.service';

/**
 * Redesign R6c (D-R6.18): GET /projects/:projectId/overview. One read for the Overview page: the
 * stage bar, the current sprint, the next visit, the next deadline and the open counts. Facts are
 * loaded in one pass (a fixed set of queries, skipped when the caller may not see the section);
 * a section the caller may not see is null, never zero.
 */

/** Who sees contract milestones (mirrors the web `MILESTONE_VIEW_PERMISSIONS`). */
export const OVERVIEW_MILESTONE_PERMISSIONS = [
  'milestones:manage',
  'milestones:waive',
  'kickoff:manage',
  'documents:view',
  'contracts:raise_default',
  'contracts:decide_default',
];
/** Who reads visits (R4 `GET /projects/:id/visits`). */
export const OVERVIEW_VISIT_PERMISSIONS = ['visits:view'];
/** Who reads findings (R4 `GET /projects/:id/findings`). */
export const OVERVIEW_FINDING_PERMISSIONS = ['visits:view', 'findings:manage'];
/** Who reads defects (staff-only since R1c/R1d). */
export const OVERVIEW_DEFECT_PERMISSIONS = ['defects:manage'];
/** Who reads sprints and scope. */
export const OVERVIEW_SCOPE_PERMISSIONS = ['scope:view'];

/** Visits still to be carried out or corrected. */
const NEXT_VISIT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'RETURNED'] as const;
const OPEN_FINDING_STATUS = 'OPEN' as const;

function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

function visitKindLabel(kind: VisitKind): string {
  return VISIT_KIND_META[kind]?.label ?? kind;
}

export async function getProjectOverview(projectId: string, webUser: WebJwtPayload, now: Date = new Date()): Promise<ProjectOverviewDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true, timezone: true, projectTypeSnapshotJson: true },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  if (project.status === 'DRAFT') {
    throw new AppError('This project is a draft. Finish setup and set it active first.', 409, 'PROJECT_IS_DRAFT');
  }

  const today = zonedCalendarDate(now, project.timezone);
  const can = {
    scope: hasWebPermission(webUser, ...OVERVIEW_SCOPE_PERMISSIONS),
    milestones: hasWebPermission(webUser, ...OVERVIEW_MILESTONE_PERMISSIONS),
    visits: hasWebPermission(webUser, ...OVERVIEW_VISIT_PERMISSIONS),
    findings: hasWebPermission(webUser, ...OVERVIEW_FINDING_PERMISSIONS),
    defects: hasWebPermission(webUser, ...OVERVIEW_DEFECT_PERMISSIONS),
  };

  const [stages, sprints, units, milestones, nextVisitRow, visitDeadlineRow, openFindingCount, openDefectCount] = await Promise.all([
    loadProjectStages([projectId]),
    can.scope
      ? prisma.projectSprint.findMany({
          where: { projectId },
          orderBy: { number: 'asc' },
          select: { id: true, number: true, name: true, startDate: true, endDate: true, deliverables: true, verificationOutcome: true },
        })
      : Promise.resolve(null),
    can.scope
      ? prisma.facilityUnit.findMany({ where: { projectId }, select: { id: true, startSprintId: true, endSprintId: true } })
      : Promise.resolve(null),
    can.milestones
      ? prisma.projectContractMilestone.findMany({
          where: { projectId, status: { in: OPEN_MILESTONE_STATUSES }, dueDate: { not: null } },
          select: { id: true, label: true, dueDate: true, sortOrder: true },
          orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
        })
      : Promise.resolve(null),
    can.visits
      ? prisma.visit.findFirst({
          where: { projectId, status: { in: [...NEXT_VISIT_STATUSES] }, plannedDate: { gte: today } },
          orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            visitKind: true,
            plannedDate: true,
            status: true,
            confirmation: true,
            assignees: { select: { isLead: true, user: { select: { fullName: true } } }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
          },
        })
      : Promise.resolve(null),
    can.visits
      ? prisma.visit.findFirst({
          where: { projectId, status: { in: [...NEXT_VISIT_STATUSES] }, submissionDeadline: { not: null } },
          orderBy: [{ submissionDeadline: 'asc' }, { plannedDate: 'asc' }],
          select: { id: true, visitKind: true, plannedDate: true, submissionDeadline: true },
        })
      : Promise.resolve(null),
    can.findings ? prisma.finding.count({ where: { projectId, status: OPEN_FINDING_STATUS } }) : Promise.resolve(null),
    can.defects
      ? prisma.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } })
      : Promise.resolve(null),
  ]);

  const stage = stages.get(projectId);
  if (!stage) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');

  // Current sprint: the one today falls in, else the next upcoming, else the last ended.
  let currentSprint: OverviewSprint | null = null;
  if (sprints && units && sprints.length > 0) {
    const verificationDays = monitoringConfigOf(project.projectTypeSnapshotJson).sprintVerificationDays;
    const active = sprints.find((s) => s.startDate <= today && today <= s.endDate);
    const next = sprints.find((s) => s.startDate > today);
    const pick = active ?? next ?? sprints[sprints.length - 1];
    const relation: OverviewSprint['relation'] = active ? 'ACTIVE' : next ? 'NEXT' : 'LAST';
    const numberById = new Map(sprints.map((s) => [s.id, s.number]));
    const unitSpans = units.map((u) => ({
      startSprintNumber: u.startSprintId ? numberById.get(u.startSprintId) ?? null : null,
      endSprintNumber: u.endSprintId ? numberById.get(u.endSprintId) ?? null : null,
    }));
    currentSprint = {
      id: pick.id,
      number: pick.number,
      name: pick.name || null,
      startDate: pick.startDate,
      endDate: pick.endDate,
      deliverables: firstLine(pick.deliverables),
      status: deriveSprintStatus(pick, today, verificationDays),
      verificationOutcome: pick.verificationOutcome ?? null,
      totalSprints: sprints.length,
      activeUnitCount: unitsActiveInSprint(unitSpans, pick.number).length,
      relation,
    };
  }

  const nextVisit: OverviewNextVisit | null = nextVisitRow
    ? {
        id: nextVisitRow.id,
        visitKind: nextVisitRow.visitKind,
        plannedDate: nextVisitRow.plannedDate,
        status: nextVisitRow.status,
        confirmation: nextVisitRow.confirmation,
        officerNames: nextVisitRow.assignees.map((a) => a.user.fullName),
      }
    : null;

  // Next deadline: the earliest open milestone or visit submission deadline the caller may see.
  const candidates: OverviewDeadline[] = [];
  const firstMilestone = milestones?.[0];
  if (firstMilestone?.dueDate) {
    candidates.push({
      kind: 'MILESTONE',
      label: firstMilestone.label,
      dueDate: firstMilestone.dueDate,
      overdue: firstMilestone.dueDate < today,
      milestoneId: firstMilestone.id,
      visitId: null,
    });
  }
  if (visitDeadlineRow?.submissionDeadline) {
    candidates.push({
      kind: 'VISIT_SUBMISSION',
      label: `${visitKindLabel(visitDeadlineRow.visitKind)} visit of ${visitDeadlineRow.plannedDate}: submit the report`,
      dueDate: visitDeadlineRow.submissionDeadline,
      overdue: visitDeadlineRow.submissionDeadline < today,
      milestoneId: null,
      visitId: visitDeadlineRow.id,
    });
  }
  candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.kind === 'MILESTONE' ? -1 : 1));
  const nextDeadline = candidates[0] ?? null;

  return {
    projectId: project.id,
    today,
    stage,
    currentSprint,
    hasSprints: sprints ? sprints.length > 0 : null,
    nextVisit,
    nextDeadline,
    overdueMilestoneCount: milestones ? milestones.filter((m) => m.dueDate! < today).length : null,
    openDefectCount,
    openFindingCount,
  };
}
