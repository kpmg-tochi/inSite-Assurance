import { Prisma } from '@prisma/client';
import {
  deriveSiteStatus,
  lgaByCode,
  ProjectGeofenceSchema,
  SaveProjectSitesRequest,
  SaveProjectSitesRequestSchema,
  SchoolLevel,
  SchoolLevelEnum,
  stateByCode,
  weightedProgressPct,
  zonedCalendarDate,
  type ProjectGeofence,
  type ProjectSiteDto,
  type ProjectSitesDto,
  type ProjectSiteSummaryDto,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Client demo updates C2 (wave 2, light version): the sites (schools) of a multi-site project.
 * - All sites are in the project's state; site numbers follow the saved list order.
 * - A located site (latitude and longitude) gets a radial boundary of the workspace default radius.
 * - Facility units name their site; a site a unit names cannot be removed (409 SITE_IN_USE).
 * - Each site's % complete is budget-weighted over its units' lines; its status follows
 *   `deriveSiteStatus` (handover is still per project in wave 2).
 */

export interface SiteRowInput {
  siteNumber: number;
  schoolName: string;
  schoolLevel: string;
  lgaCode: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

/** The stored boundary for a located site (null when not located). */
export function siteBoundary(site: { schoolName: string; latitude: number | null; longitude: number | null }, radiusMeters: number): ProjectGeofence | null {
  if (site.latitude === null || site.longitude === null) return null;
  return {
    mode: 'RADIAL',
    center: { latitude: site.latitude, longitude: site.longitude },
    radiusMeters,
    siteLabel: site.schoolName.slice(0, 120),
  };
}

function boundaryJson(boundary: ProjectGeofence | null) {
  return boundary ? (boundary as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}

/** 422 SITE_LGA_NOT_IN_STATE when an LGA is not in the project's state. */
function assertLgasInState(stateCode: string | null, sites: { schoolName: string; lgaCode: string }[]) {
  if (sites.length === 0) return;
  if (!stateCode) {
    throw new AppError('Choose the project state before adding sites: every site is in that state.', 422, 'STATE_REQUIRED_FOR_SITES');
  }
  const stateName = stateByCode(stateCode)?.name ?? stateCode;
  for (const s of sites) {
    const lga = lgaByCode(s.lgaCode);
    if (!lga || lga.stateCode !== stateCode) {
      throw new AppError(`The LGA of "${s.schoolName}" is not in ${stateName}.`, 422, 'SITE_LGA_NOT_IN_STATE', {
        schoolName: s.schoolName,
        lgaCode: s.lgaCode,
      });
    }
  }
}

async function projectForSites(db: Db, projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, tenantId: true, status: true, stateCode: true, tenant: { select: { defaultGeofenceRadiusMeters: true } } },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  return project;
}

/**
 * Moves every site of the project out of the way of the (projectId, siteNumber) unique index, so the
 * list can be renumbered in any order.
 */
async function parkSiteNumbers(tx: Tx, projectId: string) {
  await tx.$executeRaw`UPDATE "project_sites" SET "siteNumber" = -1000000 - "siteNumber" WHERE "projectId" = ${projectId}::uuid`;
}

/** Section `sites` save (full list) inside the setup transaction; returns what the saver reports. */
export async function saveProjectSites(
  tx: Tx,
  projectId: string,
  webUser: WebJwtPayload,
  input: unknown
): Promise<{ changedFields: string[]; payload?: Record<string, unknown> }> {
  const data: SaveProjectSitesRequest = SaveProjectSitesRequestSchema.parse(input);
  const project = await projectForSites(tx, projectId);
  assertLgasInState(project.stateCode, data.sites);
  const radius = project.tenant.defaultGeofenceRadiusMeters;

  const existing = await tx.projectSite.findMany({
    where: { projectId },
    orderBy: { siteNumber: 'asc' },
    include: { _count: { select: { units: true } } },
  });
  const byId = new Map(existing.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const s of data.sites) {
    if (!s.id) continue;
    if (!byId.has(s.id)) throw new AppError('Site not found on this project', 422, 'SITE_NOT_FOUND', { siteId: s.id });
    if (seen.has(s.id)) throw new AppError('A site appears twice in the list', 422, 'SITE_DUPLICATED', { siteId: s.id });
    seen.add(s.id);
  }
  const removed = existing.filter((s) => !seen.has(s.id));
  const inUse = removed.filter((s) => s._count.units > 0);
  if (inUse.length > 0) {
    const names = inUse.map((s) => `site ${s.siteNumber} (${s.schoolName})`).join(', ');
    throw new AppError(`Facility units are at ${names}: move or remove them before removing the site.`, 409, 'SITE_IN_USE', {
      siteIds: inUse.map((s) => s.id),
    });
  }

  const snapshot = (s: { siteNumber: number; schoolName: string; schoolLevel: string; lgaCode: string; address: string | null; latitude: number | null; longitude: number | null }) =>
    JSON.stringify([s.siteNumber, s.schoolName, s.schoolLevel, s.lgaCode, s.address, s.latitude, s.longitude]);
  const before = new Map(existing.map((s) => [s.id, snapshot(s)]));

  if (removed.length) await tx.projectSite.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
  await parkSiteNumbers(tx, projectId);

  let added = 0;
  let updated = 0;
  for (const [index, s] of data.sites.entries()) {
    const row = {
      siteNumber: index + 1,
      schoolName: s.schoolName,
      schoolLevel: s.schoolLevel,
      lgaCode: s.lgaCode,
      address: s.address ?? null,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
    };
    const boundary = boundaryJson(siteBoundary(row, radius));
    if (s.id) {
      if (before.get(s.id) !== snapshot(row)) updated += 1;
      await tx.projectSite.update({ where: { id: s.id }, data: { ...row, boundaryJson: boundary } });
    } else {
      added += 1;
      await tx.projectSite.create({ data: { projectId, ...row, boundaryJson: boundary } });
    }
  }

  const changed = added + updated + removed.length > 0;
  if (changed) {
    const unlocated = data.sites.filter((s) => s.latitude == null || s.longitude == null).length;
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'SITES_SAVED',
      summaryText: `Saved ${data.sites.length} site${data.sites.length === 1 ? '' : 's'} (${added} added, ${updated} changed, ${removed.length} removed).`,
      payload: {
        projectStatus: project.status,
        siteCount: data.sites.length,
        added,
        updated,
        removed: removed.length,
        unlocated,
        lgaCodes: [...new Set(data.sites.map((s) => s.lgaCode))],
      },
    });
  }
  return { changedFields: changed ? ['sites'] : [], payload: { siteCount: data.sites.length } };
}

/**
 * Replaces a draft's sites from a list (needs-assessment import). Returns the new site ids by
 * site number, so units can be linked. No audit (the caller audits). Units lose their site first
 * (the caller replaces the units in the same transaction).
 */
export async function replaceProjectSitesInTx(tx: Tx, projectId: string, sites: SiteRowInput[]): Promise<Map<number, string>> {
  const project = await projectForSites(tx, projectId);
  assertLgasInState(project.stateCode, sites);
  const radius = project.tenant.defaultGeofenceRadiusMeters;
  await tx.facilityUnit.updateMany({ where: { projectId, siteId: { not: null } }, data: { siteId: null } });
  await tx.projectSite.deleteMany({ where: { projectId } });
  const ids = new Map<number, string>();
  for (const s of [...sites].sort((a, b) => a.siteNumber - b.siteNumber)) {
    const level: SchoolLevel = SchoolLevelEnum.safeParse(s.schoolLevel).success ? (s.schoolLevel as SchoolLevel) : 'PRIMARY';
    const created = await tx.projectSite.create({
      data: {
        projectId,
        siteNumber: s.siteNumber,
        schoolName: s.schoolName,
        schoolLevel: level,
        lgaCode: s.lgaCode,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        boundaryJson: boundaryJson(siteBoundary(s, radius)),
      },
      select: { id: true },
    });
    ids.set(s.siteNumber, created.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface SiteFacts {
  site: {
    id: string;
    projectId: string;
    siteNumber: number;
    schoolName: string;
    schoolLevel: string;
    lgaCode: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    boundaryJson: Prisma.JsonValue;
  };
  unitCount: number;
  lines: { amountNgn: number; progressPct: number }[];
  summary: ProjectSiteSummaryDto;
}

/** Sites with their units' lines and status, for many projects in a fixed number of queries. */
async function loadSiteFacts(projectIds: string[]): Promise<Map<string, SiteFacts[]>> {
  const result = new Map<string, SiteFacts[]>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return result;
  const sites = await prisma.projectSite.findMany({ where: { projectId: { in: ids } }, orderBy: [{ projectId: 'asc' }, { siteNumber: 'asc' }] });
  if (sites.length === 0) return result;
  const siteProjectIds = [...new Set(sites.map((s) => s.projectId))];
  const [projects, units, firstSprints, handovers] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: siteProjectIds } },
      select: { id: true, status: true, constructionPhase: true, timezone: true },
    }),
    prisma.facilityUnit.findMany({
      where: { projectId: { in: siteProjectIds }, siteId: { not: null } },
      select: {
        siteId: true,
        endSprint: { select: { endDate: true } },
        lines: { select: { budgetedCostNgn: true, cumulativeCertifiedPct: true } },
      },
    }),
    prisma.projectSprint.groupBy({ by: ['projectId'], where: { projectId: { in: siteProjectIds } }, _min: { startDate: true } }),
    prisma.handoverSubmission.findMany({
      where: { projectId: { in: siteProjectIds }, decision: { in: ['ACCEPTED', 'ACCEPTED_WITH_SNAGS'] }, reviewedAt: { not: null } },
      select: { projectId: true },
      distinct: ['projectId'],
    }),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const firstSprintStart = new Map(firstSprints.map((s) => [s.projectId, s._min.startDate]));
  const handedOverIds = new Set(handovers.map((h) => h.projectId));
  const unitsBySite = new Map<string, typeof units>();
  for (const u of units) unitsBySite.set(u.siteId!, [...(unitsBySite.get(u.siteId!) ?? []), u]);
  const now = new Date();

  for (const site of sites) {
    const project = projectById.get(site.projectId);
    if (!project) continue;
    const today = zonedCalendarDate(now, project.timezone);
    const own = unitsBySite.get(site.id) ?? [];
    const lines = own.flatMap((u) =>
      u.lines.map((l) => ({ amountNgn: Number(l.budgetedCostNgn), progressPct: Number(l.cumulativeCertifiedPct) }))
    );
    const progressPct = weightedProgressPct(lines);
    const hasUnitBehind = own.some(
      (u) => u.endSprint !== null && u.endSprint.endDate < today && u.lines.some((l) => Number(l.cumulativeCertifiedPct) < 100)
    );
    const firstStart = firstSprintStart.get(site.projectId) ?? null;
    const live = project.status !== 'DRAFT';
    const started = live && ((firstStart !== null && firstStart <= today) || (progressPct ?? 0) > 0);
    const handedOver =
      live &&
      (project.constructionPhase === 'RETENTION_PERIOD' || project.constructionPhase === 'COMPLETED_CLOSED' || handedOverIds.has(site.projectId));
    const summary: ProjectSiteSummaryDto = {
      id: site.id,
      siteNumber: site.siteNumber,
      schoolName: site.schoolName,
      schoolLevel: SchoolLevelEnum.safeParse(site.schoolLevel).success ? (site.schoolLevel as SchoolLevel) : 'PRIMARY',
      lgaCode: site.lgaCode,
      lgaName: lgaByCode(site.lgaCode)?.name ?? null,
      latitude: site.latitude,
      longitude: site.longitude,
      progressPct,
      status: deriveSiteStatus({ progressPct, hasUnitBehind, started, handedOver }),
    };
    result.set(site.projectId, [...(result.get(site.projectId) ?? []), { site, unitCount: own.length, lines, summary }]);
  }
  return result;
}

/** The setup DTO's `sites` section and GET /projects/:id/sites (an empty list until sites are saved). */
export async function getProjectSites(projectId: string): Promise<ProjectSitesDto | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, stateCode: true, tenant: { select: { defaultGeofenceRadiusMeters: true } } },
  });
  if (!project) return null;
  const facts = (await loadSiteFacts([projectId])).get(projectId) ?? [];
  const sites: ProjectSiteDto[] = facts.map((f) => {
    const boundary = f.site.boundaryJson ? (ProjectGeofenceSchema.safeParse(f.site.boundaryJson).data ?? null) : null;
    return {
      ...f.summary,
      address: f.site.address,
      boundary,
      located: f.site.latitude !== null && f.site.longitude !== null,
      unitCount: f.unitCount,
      lineCount: f.lines.length,
      amountNgn: Math.round(f.lines.reduce((s, l) => s + l.amountNgn, 0) * 100) / 100,
    };
  });
  return {
    projectId: project.id,
    stateCode: project.stateCode,
    defaultRadiusMeters: project.tenant.defaultGeofenceRadiusMeters,
    sites,
  };
}

/** Batched site summaries (register sub-rows, map pins), with progress and status. Projects without sites are absent. */
export async function loadSiteSummaries(projectIds: string[]): Promise<Map<string, ProjectSiteSummaryDto[]>> {
  const facts = await loadSiteFacts(projectIds);
  return new Map([...facts].map(([projectId, list]) => [projectId, list.map((f) => f.summary)]));
}
