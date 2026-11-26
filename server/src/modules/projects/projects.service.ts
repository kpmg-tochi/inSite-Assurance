import { overdueMilestoneCounts } from '../contracts/milestones.service';
import { loadProjectStageSummaries } from './projectStage.service';
import { alertKeysForViewer } from '../alerts/alertView';
import { loadSiteSummaries } from '../sites/sites.service';
import { Prisma, ProjectStatus } from '@prisma/client';
import {
  geofenceCentroid,
  PORTFOLIO_QUIET_SITE_DAYS,
  PortfolioOverviewDto,
  PortfolioOverviewKpis,
  PortfolioOverviewProject,
  FieldPersonaType,
  GeoCoordinate,
  GeofenceMode,
  ProjectDeliveryModelFields,
  ProjectGeofenceSchema,
  ProjectListFilters,
  ProjectRegisterFields,
  ProjectRegisterFilters,
  verifyPointAgainstGeofence,
  calendarDaysUntil,
  zonedCalendarDate,
  addDays,
  isOngoingProject,
  FundingSourceCodeEnum,
  zoneOfState,
  statesOfZone,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  FieldAgentJwtPayload,
  invalidateSessionAuthCache,
  WebJwtPayload,
} from '../../middleware/auth.middleware';
import {
  assertCallerProjectAccess,
  buildProjectVisibilityWhere,
} from '../../utils/accessControl';
import { recordAuditEvent } from '../audit/audit.service';
import { serializeBoqItem } from '../../utils/serializers';
import { contractorHeadline } from './contractors.service';
import { serializeScheduleBadge } from '../schedule/schedule.service';
import { effectiveToleranceMeters } from '../../utils/geofenceEvaluation';
import { PROJECT_TYPE_SUMMARY_SELECT, projectTypeSummary } from '../projectTypes/projectTypes.service';
import { REGION_SUMMARY_SELECT, regionSummary } from '../regions/regions.service';

/** Phase 11: relations for the type chip, region and owner on every project list row. */
const DELIVERY_MODEL_INCLUDE = {
  projectType: { select: PROJECT_TYPE_SUMMARY_SELECT },
  region: { select: REGION_SUMMARY_SELECT },
  owningOrganization: { select: { id: true, name: true } },
  beneficiaries: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.ProjectInclude;

function serializeDeliveryModel(project: Prisma.ProjectGetPayload<{ include: typeof DELIVERY_MODEL_INCLUDE }>): ProjectDeliveryModelFields {
  return {
    projectType: projectTypeSummary(project),
    region: regionSummary(project.region),
    owningOrganization: project.owningOrganization,
    primaryBeneficiary: project.beneficiaries[0]
      ? {
          id: project.beneficiaries[0].id,
          name: project.beneficiaries[0].name,
          beneficiaryType: project.beneficiaries[0].beneficiaryType,
          contactName: project.beneficiaries[0].contactName,
          contactEmail: project.beneficiaries[0].contactEmail,
          contactPhone: project.beneficiaries[0].contactPhone,
          address: project.beneficiaries[0].address,
          isPrimary: true,
        }
      : null,
  };
}

/**
 * Phase 11 list filters. A region filter includes the region's areas; an owner filter is the exact
 * owner. Applied on top of the visibility filter, never instead of it.
 */
export function deliveryModelFilterWhere(filters: ProjectListFilters = {}): Prisma.ProjectWhereInput[] {
  const out: Prisma.ProjectWhereInput[] = [];
  if (filters.projectTypeId) out.push({ projectTypeId: filters.projectTypeId });
  if (filters.regionId) out.push({ OR: [{ regionId: filters.regionId }, { region: { parentRegionId: filters.regionId } }] });
  if (filters.owningOrganizationId) out.push({ owningOrganizationId: filters.owningOrganizationId });
  // UBEC IRL register filters.
  if (filters.lga) out.push({ lgaLocation: { equals: filters.lga, mode: 'insensitive' } });
  if (filters.contractorOrganizationId) out.push({ contractors: { some: { organizationId: filters.contractorOrganizationId } } });
  if (filters.interventionYear) out.push({ interventionYear: filters.interventionYear });
  if (filters.fundingSource) out.push({ fundingSource: { equals: filters.fundingSource, mode: 'insensitive' } });
  // Client demo updates C1/C4: zone (the states of the zone), state and LGA codes, funding source code.
  if (filters.zone) out.push({ stateCode: { in: statesOfZone(filters.zone).map((s) => s.code) } });
  if (filters.stateCode) out.push({ stateCode: filters.stateCode });
  if (filters.lgaCode) out.push({ lgaCode: filters.lgaCode });
  if (filters.fundingSourceCode) out.push({ fundingSourceCode: filters.fundingSourceCode });
  return out;
}

/**
 * UBEC IRL: the register's search box and status buttons, server-side (the export applies them;
 * the web keeps them browser-side for the table so the button counts stay complete).
 */
export function registerFilterWhere(filters: ProjectRegisterFilters = {}): Prisma.ProjectWhereInput[] {
  const out = deliveryModelFilterWhere(filters);
  const q = filters.q?.trim();
  if (q) {
    const has = { contains: q, mode: 'insensitive' as const };
    out.push({
      OR: [
        { name: has },
        { codePrefix: has },
        // C3: "LOT 5 BATCH 7" as shown finds the stored 2026-LOT-5-BATCH-7.
        { codePrefix: { contains: q.replace(/\s+/g, '-'), mode: 'insensitive' as const } },
        { externalReference: has },
        { stateLocation: has },
        { lgaLocation: has },
        { region: { name: has } },
        { projectType: { name: has } },
        { contractors: { some: { organization: { name: has } } } },
        { beneficiaries: { some: { name: has } } },
      ],
    });
  }
  switch (filters.status) {
    case 'ongoing':
      out.push({ status: 'ACTIVE', constructionPhase: { in: ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'] } });
      break;
    case 'behind':
      out.push({ scheduleStatus: 'BEHIND' });
      break;
    case 'completed':
      out.push({ status: 'ACTIVE', constructionPhase: { in: ['RETENTION_PERIOD', 'COMPLETED_CLOSED'] } });
      break;
    case 'archived':
      out.push({ status: 'ARCHIVED' });
      break;
  }
  return out;
}

/** UBEC IRL: register fields and import markers on every project DTO. */
export function serializeRegisterFields(project: {
  interventionYear: number | null;
  fundingSource: string | null;
  externalReference: string | null;
  importedAt: Date | null;
  importedProgressPct: Prisma.Decimal | null;
  importedStatus: string | null;
  stateCode: string | null;
  lgaCode: string | null;
  fundingSourceCode: string | null;
  batchNumber: number | null;
  lot?: { number: number } | null;
  _count: { boqItems: number };
}): ProjectRegisterFields {
  const fundingCode = FundingSourceCodeEnum.safeParse(project.fundingSourceCode);
  return {
    interventionYear: project.interventionYear,
    fundingSource: project.fundingSource,
    externalReference: project.externalReference,
    importedAt: project.importedAt?.toISOString() ?? null,
    importedProgressPct: project.importedProgressPct === null ? null : Number(project.importedProgressPct),
    importedStatus: project.importedStatus,
    progressIsImported: project.importedAt !== null && project.importedProgressPct !== null && project._count.boqItems === 0,
    // Client demo updates (wave 1)
    stateCode: project.stateCode,
    lgaCode: project.lgaCode,
    zone: zoneOfState(project.stateCode),
    fundingSourceCode: fundingCode.success ? fundingCode.data : null,
    lotNumber: project.lot?.number ?? null,
    batchNumber: project.batchNumber,
  };
}

/** Prisma include for `serializeRegisterFields`. */
export const REGISTER_COUNT_INCLUDE = {
  _count: { select: { boqItems: true } },
  lot: { select: { number: true } },
} satisfies Prisma.ProjectInclude;

/**
 * UBEC IRL: when each project's site was last observed in an approved visit report (the officer's
 * confirmation time of the latest APPROVED submission). One grouped query.
 */
export async function lastApprovedUpdates(projectIds: string[]): Promise<Map<string, Date>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.visitSubmission.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds }, status: 'APPROVED' },
    _max: { confirmedAt: true },
  });
  return new Map(rows.filter((r) => r._max.confirmedAt).map((r) => [r.projectId, r._max.confirmedAt!]));
}

const PROJECT_CONTRACTORS_INCLUDE = {
  orderBy: [{ createdAt: 'asc' as const }],
  include: { organization: { select: { id: true, name: true } } },
};

const PROJECT_CORE_INCLUDE = {
  ...DELIVERY_MODEL_INCLUDE,
  monitorOrganization: true,
  lenderOrganization: true,
  contractors: PROJECT_CONTRACTORS_INCLUDE,
  tenant: { select: { defaultGeofenceToleranceMeters: true } },
  ...REGISTER_COUNT_INCLUDE,
} satisfies Prisma.ProjectInclude;

type ProjectCoreRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_CORE_INCLUDE }>;

function serializeProjectCore(project: ProjectCoreRow) {
  const headline = contractorHeadline(project.contractors);
  return {
    id: project.id,
    tenantId: project.tenantId,
    status: project.status,
    /** Phase 10: where an active project is in its life. */
    constructionPhase: project.constructionPhase,
    practicalCompletionDate: project.practicalCompletionDate,
    retentionEndDate: project.retentionEndDate,
    retentionPercentage: project.retentionPercentage === null ? null : Number(project.retentionPercentage),
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation ?? '',
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: Number(project.totalBudgetNgn ?? 0),
    disbursedToDateNgn: Number(project.disbursedToDateNgn),
    certifiedProgressPct: Number(project.certifiedProgressPct),
    workdayStartTime: project.workdayStartTime,
    workdayEndTime: project.workdayEndTime,
    timezone: project.timezone,
    geofenceMode: project.geofenceMode as GeofenceMode | null,
    geofence: project.geofenceGeoJson,
    geofenceToleranceMeters: effectiveToleranceMeters(project, project.tenant),
    /** Phase 9: stored by the schedule-variance job; null until computed. */
    scheduleVariance: serializeScheduleBadge(project),
    monitorOrganizationName: project.monitorOrganization?.name ?? '',
    lenderOrganizationName: project.lenderOrganization?.name ?? '',
    /** The contractor (one per project since R1d). */
    contractorOrganizationName: headline.name,
    contractorCount: headline.total,
    /** Phase 11: type chip, region and owning organisation. */
    ...serializeDeliveryModel(project),
    contractors: project.contractors.map((c) => ({
      id: c.id,
      organizationId: c.organization.id,
      organizationName: c.organization.name,
      tradeCategory: c.tradeCategory,
      tradeCode: c.tradeCode,
    })),
    activatedAt: project.activatedAt?.toISOString() ?? null,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    ...serializeRegisterFields(project),
  };
}

/**
 * The project directory: active and archived projects (drafts are listed separately, see
 * listDraftProjects in projectSetup.service).
 */
export async function listProjectsForUser(
  webUser: WebJwtPayload,
  statuses: ProjectStatus[] = ['ACTIVE', 'ARCHIVED'],
  filters: ProjectRegisterFilters = {}
) {
  const visibilityWhere = buildProjectVisibilityWhere(webUser, undefined, {
    statuses: statuses.filter((s) => s !== 'DRAFT'),
  });

  const projects = await prisma.project.findMany({
    where: { AND: [visibilityWhere, ...registerFilterWhere(filters)] },
    orderBy: { createdAt: 'desc' },
    include: {
      ...PROJECT_CORE_INCLUDE,
      boqItems: {
        select: {
          id: true,
          isOpaqueLumpSum: true,
        },
      },
      // Most recent registered capture of any kind.
      evidenceLogs: {
        orderBy: { capturedAtDevice: 'desc' },
        take: 1,
        select: { capturedAtDevice: true },
      },
    },
  });

  // Phase 13: overdue contract milestones per project (directory badge).
  // Redesign R6c (D-R6.22): the stage chip, batched.
  // Client demo updates C2 (wave 2): each row's sites, batched.
  const [overdue, stages, lastApproved, sites] = await Promise.all([
    overdueMilestoneCounts(projects),
    loadProjectStageSummaries(projects.map((p) => p.id)),
    lastApprovedUpdates(projects.map((p) => p.id)),
    loadSiteSummaries(projects.map((p) => p.id)),
  ]);

  return projects.map((project) => {
    return {
      ...serializeProjectCore(project),
      totalBoqItems: project.boqItems.length,
      opaqueLumpSumCount: project.boqItems.filter((b) => b.isOpaqueLumpSum).length,
      lastFieldCaptureAt:
        project.evidenceLogs[0]?.capturedAtDevice.toISOString() ?? null,
      overdueMilestoneCount: overdue.get(project.id) ?? 0,
      stage: stages.get(project.id) ?? null,
      activeAlerts: alertKeysForViewer(project, webUser),
      lastApprovedUpdateAt: lastApproved.get(project.id)?.toISOString() ?? null,
      sites: sites.get(project.id) ?? [],
    };
  });
}

/** The project and its BOQ for web users and field sessions (access is checked by the project guard). */
export async function getProjectBaselineDetails(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      ...PROJECT_CORE_INCLUDE,
      boqItems: {
        orderBy: { wbsCode: 'asc' },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  return {
    ...serializeProjectCore(project),
    boqItems: project.boqItems.map((b) => serializeBoqItem(b)),
    // Client demo updates C2 (wave 2): the project's sites (empty for single-site projects).
    sites: (await loadSiteSummaries([projectId])).get(projectId) ?? [],
  };
}

export async function verifyCoordinateForProject(
  projectId: string,
  coord: GeoCoordinate,
  webUser?: WebJwtPayload,
  fieldAgent?: FieldAgentJwtPayload
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      codePrefix: true,
      geofenceGeoJson: true,
      geofenceToleranceMeters: true,
      tenant: { select: { defaultGeofenceToleranceMeters: true } },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }
  if (!project.geofenceGeoJson) {
    throw new AppError('This project has no geofence yet', 409, 'GEOFENCE_NOT_SET');
  }

  const parsedGeofence = ProjectGeofenceSchema.parse(project.geofenceGeoJson);
  return verifyPointAgainstGeofence(coord, parsedGeofence, effectiveToleranceMeters(project, project.tenant));
}

/**
 * List real mobile FieldAgentSession records for Settings -> Active Mobile Field Personnel.
 */
export async function listProjectFieldSessions(
  projectId: string,
  webUser: WebJwtPayload
) {
  let projectFilter: Prisma.FieldAgentSessionWhereInput = {};
  if (projectId && projectId !== 'all') {
    await assertCallerProjectAccess({ projectId, webUser });
    projectFilter = { projectId };
  } else {
    projectFilter = { project: buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] }) };
  }

  const sessions = await prisma.fieldAgentSession.findMany({
    where: projectFilter,
    orderBy: { createdAt: 'desc' },
    include: {
      role: {
        select: { id: true, code: true, name: true },
      },
      user: { select: { id: true, email: true } },
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    roleId: s.roleId,
    roleCode: s.role.code,
    roleName: s.role.name || s.roleNameSnapshot,
    fieldPersonaType: s.fieldPersonaType as FieldPersonaType,
    assuranceWeight: s.assuranceWeight,
    agentFullName: s.agentFullName,
    agentPhoneNumber: s.agentPhoneNumber,
    userId: s.userId,
    userEmail: s.user.email,
    deviceId: s.deviceId,
    deviceModel: s.deviceModel,
    mobileDeviceId: s.mobileDeviceId,
    isActive: s.isActive,
    lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
}

/**
 * Revoke or restore a mobile field agent device session in PostgreSQL + AuditLog.
 */
export async function updateFieldSessionStatus(params: {
  projectId: string;
  sessionId: string;
  webUser: WebJwtPayload;
  isActive: boolean;
  reason?: string;
}) {
  const existing = await prisma.fieldAgentSession.findFirst({
    where: { id: params.sessionId, projectId: params.projectId },
    include: { role: { select: { name: true } } },
  });

  if (!existing) {
    throw new AppError('Field agent session not found', 404, 'SESSION_NOT_FOUND');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.fieldAgentSession.update({
      where: { id: existing.id },
      data: params.isActive
        ? { isActive: true, revokedAt: null, revokedByUserId: null, revokeReason: null }
        : {
            isActive: false,
            revokedAt: new Date(),
            revokedByUserId: params.webUser.userId,
            revokeReason: params.reason ?? null,
          },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'FIELD_SESSION_STATUS_UPDATED',
      summaryText: params.isActive
        ? `Restored mobile session access for ${existing.agentFullName} (${existing.role.name}).`
        : `Revoked mobile session access for ${existing.agentFullName} (${existing.role.name}).${params.reason ? ` Reason: ${params.reason}` : ''}`,
      payload: {
        sessionId: existing.id,
        isActive: params.isActive,
        reason: params.reason ?? null,
      },
    });

    return updated;
  });

  invalidateSessionAuthCache(existing.id);
  return {
    id: result.id,
    projectId: result.projectId,
    agentFullName: result.agentFullName,
    isActive: result.isActive,
    revokedAt: result.revokedAt?.toISOString() ?? null,
    revokeReason: result.revokeReason,
  };
}


// ---------------------------------------------------------------------------
// Portfolio dashboard (map + KPI cards)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;

/**
 * GET /projects/portfolio/overview: every live project the user can see (same visibility rule as
 * the directory), with a map point per project and portfolio KPIs computed over the filtered set.
 */
export async function getPortfolioOverview(webUser: WebJwtPayload, filters: ProjectRegisterFilters = {}): Promise<PortfolioOverviewDto> {
  const projects = await prisma.project.findMany({
    // The register lists live projects; its Archived button (and export) asks for archived ones.
    where: { AND: [buildProjectVisibilityWhere(webUser, undefined, filters.status === 'archived' ? { statuses: ['ARCHIVED'] } : {}), ...registerFilterWhere(filters)] },
    orderBy: { name: 'asc' },
    include: {
      ...DELIVERY_MODEL_INCLUDE,
      evidenceLogs: { orderBy: { capturedAtDevice: 'desc' }, take: 1, select: { capturedAtDevice: true } },
      // One contractor per project (decision T); the oldest row if a terminated one is kept.
      contractors: { orderBy: { createdAt: 'asc' }, take: 1, select: { organization: { select: { id: true, name: true } } } },
      ...REGISTER_COUNT_INCLUDE,
    },
  });

  const projectIds = projects.map((p) => p.id);
  const [stages, findingGroups, openVisits, lastApproved, sites] = await Promise.all([
    loadProjectStageSummaries(projectIds),
    projectIds.length
      ? prisma.finding.groupBy({
          by: ['projectId'],
          where: { projectId: { in: projectIds }, status: 'OPEN' },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    projectIds.length
      ? prisma.visit.findMany({
          where: { projectId: { in: projectIds }, status: { in: ['PLANNED', 'IN_PROGRESS', 'MISSED'] } },
          select: { projectId: true, status: true, plannedDate: true },
        })
      : Promise.resolve([]),
    lastApprovedUpdates(projectIds),
    // Client demo updates C2 (wave 2): one map pin and one register sub-row per site.
    loadSiteSummaries(projectIds),
  ]);
  const openFindingsByProject = new Map(findingGroups.map((g) => [g.projectId, g._count._all]));
  const nowDate = new Date();
  const todayByProject = new Map(projects.map((p) => [p.id, zonedCalendarDate(nowDate, p.timezone)]));
  let upcomingVisitCount = 0;
  let overdueVisitCount = 0;
  for (const v of openVisits) {
    if (v.status === 'MISSED') {
      overdueVisitCount += 1;
      continue;
    }
    const today = todayByProject.get(v.projectId)!;
    if (v.plannedDate < today) overdueVisitCount += 1;
    else if (v.plannedDate <= addDays(today, 7)) upcomingVisitCount += 1;
  }

  const now = Date.now();
  const kpis: PortfolioOverviewKpis = {
    projectCount: projects.length,
    totalCommitmentNgn: 0,
    totalDisbursedNgn: 0,
    disbursedPct: 0,
    weightedProgressPct: 0,
    behindScheduleCount: 0,
    quietSiteCount: 0,
    closeoutCount: 0,
    retentionHeldNgn: 0,
    ongoingCount: 0,
    openFindingsCount: 0,
    upcomingVisitCount,
    overdueVisitCount,
    projectsWithAlertsCount: 0,
  };
  let weightedProgress = 0;

  const items: PortfolioOverviewProject[] = projects.map((p) => {
    const budget = Number(p.totalBudgetNgn ?? 0);
    // Owner decision 3 (2026-11-26): the commitment is the contract sum where a project has one, else its budget.
    const commitment = p.contractSumNgn !== null && Number(p.contractSumNgn) > 0 ? Number(p.contractSumNgn) : budget;
    const disbursed = Number(p.disbursedToDateNgn);
    const progress = Number(p.certifiedProgressPct);
    const lastCapture = p.evidenceLogs[0]?.capturedAtDevice ?? null;
    const geofence = p.geofenceGeoJson ? ProjectGeofenceSchema.safeParse(p.geofenceGeoJson).data ?? null : null;
    const schedule = serializeScheduleBadge(p);

    kpis.totalCommitmentNgn += commitment;
    kpis.totalDisbursedNgn += disbursed;
    weightedProgress += commitment * progress;
    if (p.scheduleStatus === 'BEHIND') kpis.behindScheduleCount += 1;
    if (
      p.constructionPhase === 'ACTIVE_CONSTRUCTION' &&
      (!lastCapture || now - lastCapture.getTime() > PORTFOLIO_QUIET_SITE_DAYS * DAY_MS)
    ) {
      kpis.quietSiteCount += 1;
    }
    if (p.constructionPhase === 'HANDOVER_IN_PROGRESS' || p.constructionPhase === 'RETENTION_PERIOD') kpis.closeoutCount += 1;
    kpis.retentionHeldNgn += Number(p.retentionHeldNgn);
    if (isOngoingProject(p)) kpis.ongoingCount += 1;
    const openFindingsCount = openFindingsByProject.get(p.id) ?? 0;
    kpis.openFindingsCount += openFindingsCount;
    const activeAlerts = alertKeysForViewer(p, webUser);
    if (activeAlerts.length > 0) kpis.projectsWithAlertsCount += 1;

    return {
      id: p.id,
      name: p.name,
      codePrefix: p.codePrefix,
      status: p.status,
      constructionPhase: p.constructionPhase,
      stateLocation: p.stateLocation ?? '',
      lgaLocation: p.lgaLocation,
      totalBudgetNgn: budget,
      contractSumNgn: p.contractSumNgn === null ? null : Number(p.contractSumNgn),
      disbursedToDateNgn: disbursed,
      certifiedProgressPct: progress,
      lastFieldCaptureAt: lastCapture?.toISOString() ?? null,
      scheduleVariance: schedule,
      geofence,
      point: geofence ? geofenceCentroid(geofence) : null,
      stage: stages.get(p.id) ?? null,
      contractorName: p.contractors[0]?.organization.name ?? null,
      contractorOrganizationId: p.contractors[0]?.organization.id ?? null,
      lastApprovedUpdateAt: lastApproved.get(p.id)?.toISOString() ?? null,
      openFindingsCount,
      activeAlerts,
      sites: sites.get(p.id) ?? [],
      ...serializeDeliveryModel(p),
      ...serializeRegisterFields(p),
    };
  });

  kpis.disbursedPct = kpis.totalCommitmentNgn > 0 ? Math.round((kpis.totalDisbursedNgn / kpis.totalCommitmentNgn) * 1000) / 10 : 0;
  kpis.weightedProgressPct = kpis.totalCommitmentNgn > 0 ? Math.round((weightedProgress / kpis.totalCommitmentNgn) * 10) / 10 : 0;
  return { kpis, projects: items };
}
