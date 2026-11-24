import { overdueMilestoneCounts } from '../contracts/milestones.service';
import { loadProjectStageSummaries } from './projectStage.service';
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
  verifyPointAgainstGeofence,
  calendarDaysUntil,
  zonedCalendarDate,
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
  return out;
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
  };
}

/**
 * The project directory: active and archived projects (drafts are listed separately, see
 * listDraftProjects in projectSetup.service).
 */
export async function listProjectsForUser(
  webUser: WebJwtPayload,
  statuses: ProjectStatus[] = ['ACTIVE', 'ARCHIVED'],
  filters: ProjectListFilters = {}
) {
  const visibilityWhere = buildProjectVisibilityWhere(webUser, undefined, {
    statuses: statuses.filter((s) => s !== 'DRAFT'),
  });

  const projects = await prisma.project.findMany({
    where: { AND: [visibilityWhere, ...deliveryModelFilterWhere(filters)] },
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
  const [overdue, stages] = await Promise.all([
    overdueMilestoneCounts(projects),
    loadProjectStageSummaries(projects.map((p) => p.id)),
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
export async function getPortfolioOverview(webUser: WebJwtPayload, filters: ProjectListFilters = {}): Promise<PortfolioOverviewDto> {
  const projects = await prisma.project.findMany({
    where: { AND: [buildProjectVisibilityWhere(webUser), ...deliveryModelFilterWhere(filters)] },
    orderBy: { name: 'asc' },
    include: {
      ...DELIVERY_MODEL_INCLUDE,
      evidenceLogs: { orderBy: { capturedAtDevice: 'desc' }, take: 1, select: { capturedAtDevice: true } },
    },
  });

  const stages = await loadProjectStageSummaries(projects.map((p) => p.id));
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
  };
  let weightedProgress = 0;

  const items: PortfolioOverviewProject[] = projects.map((p) => {
    const budget = Number(p.totalBudgetNgn ?? 0);
    const disbursed = Number(p.disbursedToDateNgn);
    const progress = Number(p.certifiedProgressPct);
    const lastCapture = p.evidenceLogs[0]?.capturedAtDevice ?? null;
    const geofence = p.geofenceGeoJson ? ProjectGeofenceSchema.safeParse(p.geofenceGeoJson).data ?? null : null;
    const schedule = serializeScheduleBadge(p);

    kpis.totalCommitmentNgn += budget;
    kpis.totalDisbursedNgn += disbursed;
    weightedProgress += budget * progress;
    if (p.scheduleStatus === 'BEHIND') kpis.behindScheduleCount += 1;
    if (
      p.constructionPhase === 'ACTIVE_CONSTRUCTION' &&
      (!lastCapture || now - lastCapture.getTime() > PORTFOLIO_QUIET_SITE_DAYS * DAY_MS)
    ) {
      kpis.quietSiteCount += 1;
    }
    if (p.constructionPhase === 'HANDOVER_IN_PROGRESS' || p.constructionPhase === 'RETENTION_PERIOD') kpis.closeoutCount += 1;
    kpis.retentionHeldNgn += Number(p.retentionHeldNgn);

    return {
      id: p.id,
      name: p.name,
      codePrefix: p.codePrefix,
      status: p.status,
      constructionPhase: p.constructionPhase,
      stateLocation: p.stateLocation ?? '',
      lgaLocation: p.lgaLocation,
      totalBudgetNgn: budget,
      disbursedToDateNgn: disbursed,
      certifiedProgressPct: progress,
      lastFieldCaptureAt: lastCapture?.toISOString() ?? null,
      scheduleVariance: schedule,
      geofence,
      point: geofence ? geofenceCentroid(geofence) : null,
      stage: stages.get(p.id) ?? null,
      ...serializeDeliveryModel(p),
    };
  });

  kpis.disbursedPct = kpis.totalCommitmentNgn > 0 ? Math.round((kpis.totalDisbursedNgn / kpis.totalCommitmentNgn) * 1000) / 10 : 0;
  kpis.weightedProgressPct = kpis.totalCommitmentNgn > 0 ? Math.round((weightedProgress / kpis.totalCommitmentNgn) * 10) / 10 : 0;
  return { kpis, projects: items };
}
