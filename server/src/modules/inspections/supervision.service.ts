import { Prisma } from '@prisma/client';
import {
  evaluateWorkload,
  geofenceCentroid,
  maxPairwiseDistanceKm,
  ProjectGeofenceSchema,
  ProjectTypeConfigSchema,
  resolveProjectTypeConfig,
  SupervisorWorkloadDto,
  WorkloadThresholds,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';

/**
 * Supervision workload (Phase 14). A supervisor is a user whose main or mobile role code is in a
 * project type's `supervision.supervisorRoleCodes`. Their workload is their assigned live projects
 * (status ACTIVE, not closed) and the furthest distance between those projects' geofence centres.
 * Thresholds come from the project type; the system warns and never blocks.
 *
 * Join-code sessions are not counted: they are not people the platform can follow across projects.
 */

const NO_LIMITS: WorkloadThresholds = { maxSitesPerSupervisor: null, maxSpreadKm: null };

function thresholdsOf(snapshot: unknown): WorkloadThresholds & { roleCodes: string[] } {
  const config = resolveProjectTypeConfig(snapshot);
  if (!config) return { ...NO_LIMITS, roleCodes: [] };
  return {
    maxSitesPerSupervisor: config.supervision.maxSitesPerSupervisor,
    maxSpreadKm: config.supervision.maxSpreadKm,
    roleCodes: config.supervision.supervisorRoleCodes,
  };
}

/** The strictest of several thresholds (smallest limit wins). */
function strictest(list: WorkloadThresholds[]): WorkloadThresholds {
  const min = (vals: Array<number | null>) => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? Math.min(...nums) : null;
  };
  return { maxSitesPerSupervisor: min(list.map((t) => t.maxSitesPerSupervisor)), maxSpreadKm: min(list.map((t) => t.maxSpreadKm)) };
}

/** Role codes that count as supervisors in a tenant: the union over its active project types. */
export async function supervisorRoleCodes(tenantId: string): Promise<string[]> {
  const types = await prisma.projectType.findMany({ where: { tenantId, isActive: true }, select: { configJson: true } });
  const codes = new Set<string>();
  for (const t of types) {
    const parsed = ProjectTypeConfigSchema.safeParse(t.configJson ?? {});
    if (parsed.success) parsed.data.supervision.supervisorRoleCodes.forEach((c) => codes.add(c));
  }
  return [...codes];
}

function pointOf(raw: unknown) {
  const parsed = ProjectGeofenceSchema.safeParse(raw);
  return parsed.success ? geofenceCentroid(parsed.data) : null;
}

const LIVE_PROJECT: Prisma.ProjectWhereInput = { status: 'ACTIVE', constructionPhase: { not: 'COMPLETED_CLOSED' } };

/**
 * Workloads of supervisors in a tenant. With `userIds`, only those users (whatever their role);
 * with `forProjectId`, the project is counted as if they were assigned to it (the team step's
 * "what if I add them" view) and its type's thresholds apply.
 */
export async function getSupervisorWorkloads(params: {
  tenantId: string;
  userIds?: string[];
  forProjectId?: string;
}): Promise<SupervisorWorkloadDto[]> {
  const forProject = params.forProjectId
    ? await prisma.project.findFirst({
        where: { id: params.forProjectId, tenantId: params.tenantId },
        select: { id: true, name: true, codePrefix: true, geofenceGeoJson: true, projectTypeSnapshotJson: true },
      })
    : null;
  if (params.forProjectId && !forProject) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');

  let userWhere: Prisma.UserWhereInput;
  if (params.userIds && forProject) {
    // Team step: only the listed users who hold one of this project type's supervisor roles.
    const codes = thresholdsOf(forProject.projectTypeSnapshotJson).roleCodes;
    if (codes.length === 0) return [];
    userWhere = {
      tenantId: params.tenantId,
      id: { in: params.userIds },
      OR: [{ role: { code: { in: codes } } }, { mobileRole: { code: { in: codes } } }],
    };
  } else if (params.userIds) {
    userWhere = { tenantId: params.tenantId, id: { in: params.userIds } };
  } else {
    const codes = await supervisorRoleCodes(params.tenantId);
    if (codes.length === 0) return [];
    userWhere = { tenantId: params.tenantId, isActive: true, OR: [{ role: { code: { in: codes } } }, { mobileRole: { code: { in: codes } } }] };
  }
  const users = await prisma.user.findMany({
    where: userWhere,
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      role: { select: { name: true, code: true } },
      mobileRole: { select: { name: true, code: true } },
      projectAssignments: {
        where: { project: LIVE_PROJECT },
        select: {
          project: { select: { id: true, name: true, codePrefix: true, geofenceGeoJson: true, projectTypeSnapshotJson: true } },
        },
      },
    },
  });

  const out: SupervisorWorkloadDto[] = [];
  for (const u of users) {
    const projects = u.projectAssignments.map((a) => a.project);
    if (forProject && !projects.some((p) => p.id === forProject.id)) projects.push(forProject);
    const lastInspections = await prisma.siteInspectionReport.groupBy({
      by: ['projectId'],
      where: { reporterUserId: u.id, projectId: { in: projects.map((p) => p.id) } },
      _max: { visitDate: true },
    });
    const lastBy = new Map(lastInspections.map((l) => [l.projectId, l._max.visitDate]));
    const rows = projects.map((p) => ({
      projectId: p.id,
      name: p.name,
      codePrefix: p.codePrefix,
      point: pointOf(p.geofenceGeoJson),
      lastInspectionDate: lastBy.get(p.id) ?? null,
    }));
    const spreadKm = maxPairwiseDistanceKm(rows.map((r) => r.point).filter((p): p is NonNullable<typeof p> => p !== null));
    const thresholds = forProject
      ? thresholdsOf(forProject.projectTypeSnapshotJson)
      : strictest(projects.map((p) => thresholdsOf(p.projectTypeSnapshotJson)));
    const verdict = evaluateWorkload(rows.length, spreadKm, thresholds);
    const role = u.mobileRole ?? u.role;
    out.push({
      userId: u.id,
      fullName: u.fullName,
      roleName: role.name,
      projects: rows,
      activeProjectCount: rows.length,
      spreadKm,
      maxSitesPerSupervisor: thresholds.maxSitesPerSupervisor,
      maxSpreadKm: thresholds.maxSpreadKm,
      ...verdict,
    });
  }
  return out;
}
