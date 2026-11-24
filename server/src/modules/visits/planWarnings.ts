import { addDays, deriveSprintStatus, resolveProjectTypeConfig, sprintCoveringDate, VISIT_KIND_META, VisitKind, VisitWarning } from '@insite/shared';
import { Db, monitoringConfigOf, projectToday, visitLabel } from './visitCore';

/**
 * Redesign R4a (D-R4.18): planning warnings. They are shown on the planner and the project's visits
 * page and never block anything.
 */


/** Warnings about one project's plan: sprints without a visit, no recent visit, visits outside their sprint, no officer. */
export async function projectPlanWarnings(db: Db, projectId: string, now: Date = new Date()): Promise<VisitWarning[]> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, codePrefix: true, status: true, timezone: true, constructionPhase: true, projectTypeSnapshotJson: true },
  });
  if (!project || project.status !== 'ACTIVE') return [];
  const today = projectToday(project, now);
  const config = monitoringConfigOf(project.projectTypeSnapshotJson);
  const [sprints, visits] = await Promise.all([
    db.projectSprint.findMany({ where: { projectId }, select: { id: true, number: true, name: true, startDate: true, endDate: true } }),
    db.visit.findMany({
      where: { projectId, status: { not: 'CANCELLED' } },
      select: { id: true, visitKind: true, status: true, plannedDate: true, sprintId: true, assignees: { select: { id: true } } },
    }),
  ]);
  const warnings: VisitWarning[] = [];
  const base = { projectId, userId: null };
  const live = visits.filter((v) => v.status !== 'PROPOSED');

  if (project.constructionPhase === 'ACTIVE_CONSTRUCTION') {
    for (const s of sprints) {
      const status = deriveSprintStatus(s, today);
      if (status === 'ENDED') continue;
      if (!visits.some((v) => v.plannedDate >= s.startDate && v.plannedDate <= s.endDate)) {
        warnings.push({
          ...base,
          code: 'SPRINT_WITHOUT_VISIT',
          message: `${project.codePrefix}: ${s.name} (${s.startDate} to ${s.endDate}) has no visit planned.`,
          visitId: null,
          date: s.startDate,
        });
      }
    }
    const weeks = config.noVisitWarningWeeks;
    const from = addDays(today, -7 * weeks);
    const to = addDays(today, 7 * weeks);
    if (!live.some((v) => v.plannedDate >= from && v.plannedDate <= to)) {
      warnings.push({ ...base, code: 'NO_RECENT_VISIT', message: `${project.codePrefix} has no visit within ${weeks} weeks of today.`, visitId: null, date: today });
    }
  }

  for (const v of visits) {
    if (v.status !== 'PLANNED' && v.status !== 'PROPOSED') continue;
    if (v.status === 'PLANNED' && v.assignees.length === 0) {
      warnings.push({ ...base, code: 'VISIT_WITHOUT_OFFICER', message: `${visitLabel(v.visitKind)} on ${v.plannedDate} has no officer.`, visitId: v.id, date: v.plannedDate });
    }
    if (v.status === 'PLANNED' && sprints.length > 0 && VISIT_KIND_META[v.visitKind as VisitKind].facilityRule === 'SPRINT' && v.sprintId) {
      const own = sprints.find((s) => s.id === v.sprintId);
      const covering = sprintCoveringDate(sprints, v.plannedDate);
      if (own && covering && covering.id !== own.id) {
        warnings.push({
          ...base,
          code: 'VISIT_OUTSIDE_SPRINT',
          message: `${visitLabel(v.visitKind)} on ${v.plannedDate} was planned for ${own.name} but now falls in ${covering.name}. Rebuild its form or move it.`,
          visitId: v.id,
          date: v.plannedDate,
        });
      }
    }
  }
  return warnings;
}

/**
 * Warnings about officers (D-R4.18): over the type's site limit (projects with a planned visit in the
 * next 30 days), or visits in two regions on one day.
 */
export async function officerWarnings(db: Db, userIds: string[], now: Date = new Date()): Promise<VisitWarning[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const today = now.toISOString().slice(0, 10);
  const horizon = addDays(today, 30);
  const rows = await db.visitAssignee.findMany({
    where: { userId: { in: ids }, visit: { status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] }, plannedDate: { gte: addDays(today, -1), lte: horizon } } },
    select: {
      userId: true,
      user: { select: { fullName: true } },
      visit: { select: { id: true, plannedDate: true, projectId: true, project: { select: { codePrefix: true, regionId: true, projectTypeSnapshotJson: true } } } },
    },
  });
  const warnings: VisitWarning[] = [];
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  for (const [userId, list] of byUser) {
    const name = list[0].user.fullName;
    const projects = new Map(list.map((r) => [r.visit.projectId, r.visit.project]));
    const limits = [...projects.values()]
      .map((p) => resolveProjectTypeConfig(p.projectTypeSnapshotJson)?.supervision.maxSitesPerSupervisor ?? null)
      .filter((n): n is number => n !== null);
    const limit = limits.length ? Math.min(...limits) : null;
    if (limit !== null && projects.size > limit) {
      warnings.push({
        code: 'OFFICER_OVER_LIMIT',
        message: `${name} has visits on ${projects.size} sites in the next 30 days; the limit is ${limit}.`,
        projectId: null,
        visitId: null,
        userId,
        date: null,
      });
    }
    const byDay = new Map<string, Set<string>>();
    for (const r of list) {
      if (!r.visit.project.regionId) continue;
      byDay.set(r.visit.plannedDate, (byDay.get(r.visit.plannedDate) ?? new Set()).add(r.visit.project.regionId));
    }
    for (const [date, regions] of byDay) {
      if (regions.size > 1) {
        warnings.push({
          code: 'OFFICER_TWO_REGIONS_SAME_DAY',
          message: `${name} has visits in ${regions.size} regions on ${date}.`,
          projectId: null,
          visitId: null,
          userId,
          date,
        });
      }
    }
  }
  return warnings;
}
