import { Prisma, ProjectStatus } from '@prisma/client';
import {
  ContractorExecutionMode,
  countReconciliationIssues,
  FieldPersonaType,
  GeoCoordinate,
  GeofenceMode,
  ProjectGeofenceSchema,
  verifyPointAgainstGeofence,
  calendarDaysUntil,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  FieldAgentJwtPayload,
  hasWebPermission,
  invalidateSessionAuthCache,
  WebJwtPayload,
} from '../../middleware/auth.middleware';
import {
  assertCallerProjectAccess,
  buildProjectVisibilityWhere,
} from '../../utils/accessControl';
import { recordAuditEvent } from '../audit/audit.service';
import { serializeBoqItem, serializeTranche } from '../../utils/serializers';
import { contractorHeadline } from './contractors.service';
import { serializeScheduleBadge } from '../schedule/schedule.service';
import { effectiveToleranceMeters } from '../../utils/geofenceEvaluation';
import { isProjectObjectKey, storageService } from '../../integrations/storage.service';
import { createMobileNotification } from '../notifications/notifications.service';
import { releaseStagedReportsForSession } from '../workday-reports/workdayReports.service';
import { scheduleAiOmissionCheck } from '../workday-reports/aiOmissionCheck';
import { sendPushToFieldSession } from '../../integrations/push.service';
import { syncParticipantForSession } from '../mobilization/participants.service';

type JoinCodeWithRole = {
  id: string;
  projectId: string;
  code: string;
  isActive: boolean;
  expiresAt: Date | null;
  maxUses?: number | null;
  useCount?: number;
  projectContractorId?: string | null;
  projectContractor?: { tradeCode: string; organization: { name: string } } | null;
  role: {
    id: string;
    code: string;
    name: string;
    fieldPersonaType: string;
    assuranceWeight: number;
    requiresIdentityAssurance: boolean;
  };
};

/**
 * Join-code visibility (Phase 2 Step 7): only holders of `mobilization:manage_roster` see codes.
 * Of those, users who cannot edit the baseline (e.g. the main contractor) only see codes for
 * contractor-executor roles, so they cannot hand out independent-verifier codes.
 */
export function visibleJoinCodesFor(joinCodes: JoinCodeWithRole[], webUser?: WebJwtPayload) {
  if (!webUser || !hasWebPermission(webUser, 'mobilization:manage_roster')) {
    return [];
  }
  const seeAll = hasWebPermission(webUser, 'projects:edit_baseline');
  return joinCodes
    .filter((jc) => seeAll || jc.role.fieldPersonaType === 'CONTRACTOR_EXECUTOR')
    .map((jc) => ({
      id: jc.id,
      projectId: jc.projectId,
      code: jc.code,
      roleId: jc.role.id,
      roleCode: jc.role.code,
      roleName: jc.role.name,
      fieldPersonaType: jc.role.fieldPersonaType as FieldPersonaType,
      assuranceWeight: jc.role.assuranceWeight,
      requiresIdentityAssurance: jc.role.requiresIdentityAssurance,
      projectContractorId: jc.projectContractorId ?? null,
      contractorName: jc.projectContractor?.organization.name ?? null,
      tradeCode: jc.projectContractor?.tradeCode ?? null,
      isActive: jc.isActive,
      expiresAt: jc.expiresAt ? jc.expiresAt.toISOString() : null,
      maxUses: jc.maxUses ?? null,
      useCount: jc.useCount ?? 0,
    }));
}

const JOIN_CODE_LIST_INCLUDE = {
  role: {
    select: {
      id: true,
      code: true,
      name: true,
      fieldPersonaType: true,
      assuranceWeight: true,
      requiresIdentityAssurance: true,
    },
  },
  projectContractor: { select: { tradeCode: true, organization: { select: { name: true } } } },
} as const;

const PROJECT_CONTRACTORS_INCLUDE = {
  orderBy: [{ isMainContractor: 'desc' as const }, { createdAt: 'asc' as const }],
  include: { organization: { select: { id: true, name: true } } },
};

const PROJECT_CORE_INCLUDE = {
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
    reportingCadence: project.reportingCadence,
    workdayStartTime: project.workdayStartTime,
    workdayEndTime: project.workdayEndTime,
    timezone: project.timezone,
    geofenceMode: project.geofenceMode as GeofenceMode | null,
    geofence: project.geofenceGeoJson,
    geofenceToleranceMeters: effectiveToleranceMeters(project, project.tenant),
    portfolioHealth: project.portfolioHealth,
    /** Phase 9: stored by the schedule-variance job; null until computed. */
    scheduleVariance: serializeScheduleBadge(project),
    monitorOrganizationName: project.monitorOrganization?.name ?? '',
    lenderOrganizationName: project.lenderOrganization?.name ?? '',
    /** Main contractor (or the only one). */
    contractorOrganizationName: headline.name,
    contractorCount: headline.total,
    contractorExecutionMode: project.contractorExecutionMode as ContractorExecutionMode | null,
    contractors: project.contractors.map((c) => ({
      id: c.id,
      organizationId: c.organization.id,
      organizationName: c.organization.name,
      tradeCategory: c.tradeCategory,
      tradeCode: c.tradeCode,
      isMainContractor: c.isMainContractor,
      allowFieldReporting: c.allowFieldReporting,
    })),
    activatedAt: project.activatedAt?.toISOString() ?? null,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/**
 * The IPC that project-level conflict and hold-point counts are taken from: the latest one that
 * has not been withdrawn. Counting itself is `countReconciliationIssues` in @insite/shared.
 */
const LATEST_RATED_IPC_QUERY = {
  where: { status: { not: 'REJECTED_WITHDRAWN' as const } },
  orderBy: { ipcNumber: 'desc' as const },
  take: 1,
  include: {
    lineItems: { select: { aiEvidenceRating: true, missingHoldPointFlag: true } },
  },
};

/**
 * The project directory: active and archived projects (drafts are listed separately, see
 * listDraftProjects in projectSetup.service).
 */
export async function listProjectsForUser(
  webUser: WebJwtPayload,
  statuses: ProjectStatus[] = ['ACTIVE', 'ARCHIVED']
) {
  const visibilityWhere = buildProjectVisibilityWhere(webUser, undefined, {
    statuses: statuses.filter((s) => s !== 'DRAFT'),
  });

  const projects = await prisma.project.findMany({
    where: visibilityWhere,
    orderBy: { createdAt: 'desc' },
    include: {
      ...PROJECT_CORE_INCLUDE,
      joinCodes: { include: JOIN_CODE_LIST_INCLUDE },
      tranches: {
        orderBy: { trancheNumber: 'asc' },
        include: { conditionsPrecedent: true },
      },
      boqItems: {
        select: {
          id: true,
          isHoldPoint: true,
          isOpaqueLumpSum: true,
        },
      },
      // Most recent registered capture of any kind.
      evidenceLogs: {
        orderBy: { capturedAtDevice: 'desc' },
        take: 1,
        select: { capturedAtDevice: true },
      },
      ipcClaims: LATEST_RATED_IPC_QUERY,
    },
  });

  return projects.map((project) => {
    const { openConflictCount, unfulfilledHoldPointCount } = countReconciliationIssues(
      project.ipcClaims[0]?.lineItems ?? []
    );

    return {
      ...serializeProjectCore(project),
      openConflictCount,
      unfulfilledHoldPointCount,
      totalBoqItems: project.boqItems.length,
      opaqueLumpSumCount: project.boqItems.filter((b) => b.isOpaqueLumpSum).length,
      lastFieldCaptureAt:
        project.evidenceLogs[0]?.capturedAtDevice.toISOString() ?? null,
      joinCodes: visibleJoinCodesFor(project.joinCodes, webUser),
      tranches: project.tranches.map(serializeTranche),
    };
  });
}

export async function getProjectBaselineDetails(
  projectId: string,
  webUser?: WebJwtPayload,
  fieldAgent?: FieldAgentJwtPayload
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      ...PROJECT_CORE_INCLUDE,
      joinCodes: { include: JOIN_CODE_LIST_INCLUDE },
      tranches: {
        orderBy: { trancheNumber: 'asc' },
        include: { conditionsPrecedent: true },
      },
      boqItems: {
        orderBy: { wbsCode: 'asc' },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  // Field agents get the baseline they need to report against; no join codes. In multi-prime a
  // contractor session only sees its own contractor's items.
  const contractorScope =
    fieldAgent && project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC'
      ? await prisma.fieldAgentSession.findUnique({
          where: { id: fieldAgent.sessionId },
          select: { projectContractorId: true },
        })
      : null;
  const boqItems = contractorScope?.projectContractorId
    ? project.boqItems.filter((b) => b.projectContractorId === contractorScope.projectContractorId)
    : project.boqItems;
  return {
    ...serializeProjectCore(project),
    joinCodes: fieldAgent ? [] : visibleJoinCodesFor(project.joinCodes, webUser),
    tranches: project.tranches.map(serializeTranche),
    boqItems: boqItems.map((b) => serializeBoqItem(b)),
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
      projectContractor: { select: { id: true, tradeCode: true, organization: { select: { name: true } } } },
      joinCode: {
        select: { code: true },
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
    origin: s.origin,
    joinCodeUsed: s.joinCode?.code ?? null,
    userId: s.user?.id ?? null,
    userEmail: s.user?.email ?? null,
    deviceId: s.deviceId,
    deviceModel: s.deviceModel,
    mobileDeviceId: s.mobileDeviceId,
    projectContractorId: s.projectContractorId,
    contractorName: s.projectContractor?.organization.name ?? null,
    tradeCode: s.projectContractor?.tradeCode ?? null,
    isActive: s.isActive,
    assuranceStatus: s.assuranceStatus,
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

/**
 * List all Assurance Verification Requests scoped to tenant & user project visibility.
 */
export async function listContractorVerifications(
  projectId: string | undefined,
  webUser: WebJwtPayload
) {
  const whereClause: Prisma.FieldAgentSessionWhereInput = {
    role: { requiresIdentityAssurance: true },
  };

  if (projectId && projectId !== 'all') {
    await assertCallerProjectAccess({ projectId, webUser });
    whereClause.projectId = projectId;
  } else {
    whereClause.project = buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] });
  }

  const sessions = await prisma.fieldAgentSession.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      role: {
        select: { id: true, name: true, fieldPersonaType: true },
      },
      project: {
        select: {
          id: true,
          tenantId: true,
          name: true,
          codePrefix: true,
          contractors: { ...PROJECT_CONTRACTORS_INCLUDE, include: { organization: { select: { name: true } } } },
        },
      },
      // The contractor this person works for (Phase 6), not "the" project contractor.
      projectContractor: { select: { tradeCode: true, organization: { select: { name: true } } } },
      joinCode: { select: { code: true } },
    },
  });

  const reviewerIds = sessions
    .map((s) => s.reviewedByUserId)
    .filter((id): id is string => Boolean(id));

  const reviewers =
    reviewerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, fullName: true },
        })
      : [];

  const reviewerMap = new Map(reviewers.map((r) => [r.id, r.fullName]));

  // Stored values are object keys; hand out 5-minute signed URLs, and nothing for legacy values
  // that are not keys in the session's project namespace.
  const signed = async (key: string | null, tenantId: string, projectId: string) =>
    isProjectObjectKey(key, tenantId, projectId)
      ? storageService.getPresignedReadUrl(key!, 300)
      : null;

  return Promise.all(sessions.map(async (s) => ({
    id: s.id,
    projectId: s.projectId,
    projectCodePrefix: s.project.codePrefix,
    projectName: s.project.name,
    organizationName:
      s.projectContractor?.organization.name ?? contractorHeadline(s.project.contractors).name,
    tradeCode: s.projectContractor?.tradeCode ?? null,
    roleId: s.roleId,
    roleName: s.role.name || s.roleNameSnapshot,
    fieldPersonaType: s.fieldPersonaType as FieldPersonaType,
    agentFullName: s.agentFullName,
    agentPhoneNumber: s.agentPhoneNumber,
    joinCodeUsed: s.joinCode?.code ?? '',
    corenLicenseNumber: s.corenLicenseNumber,
    idDocumentType: s.idDocumentType,
    idDocumentUrl: await signed(s.idDocumentUrl, s.project.tenantId, s.projectId),
    selfieImageUrl: await signed(s.selfieImageUrl, s.project.tenantId, s.projectId),
    selfieLeftUrl: await signed(s.selfieLeftUrl, s.project.tenantId, s.projectId),
    selfieRightUrl: await signed(s.selfieRightUrl, s.project.tenantId, s.projectId),
    livenessPassed: s.livenessPassed,
    experienceSummary: s.experienceSummary,
    assuranceStatus: s.assuranceStatus,
    deviceId: s.deviceId,
    deviceModel: s.deviceModel,
    createdAt: s.createdAt.toISOString(),
    submittedAt: s.createdAt.toISOString(),
    reviewedAt: s.reviewedAt?.toISOString() || null,
    reviewedByUserName: s.reviewedByUserId
      ? reviewerMap.get(s.reviewedByUserId) || 'Reviewer'
      : null,
    rejectionReason: s.rejectionReason,
  })));
}

/**
 * Review (Approve or Reject) an Assurance Verification Request
 */
export async function reviewContractorVerification(
  projectId: string,
  sessionId: string,
  webUser: WebJwtPayload,
  decision: 'APPROVE' | 'REJECT',
  remarks?: string
) {
  const session = await prisma.fieldAgentSession.findFirst({
    where: { id: sessionId, projectId },
    include: { project: true, joinCode: true },
  });

  if (!session) {
    throw new AppError(
      'Contractor verification request not found',
      404,
      'VERIFICATION_NOT_FOUND'
    );
  }

  const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const rejectionMessage = remarks || 'Verification rejected by reviewer.';
  let releasedReportIds: string[] = [];

  // A rejected session stays signed in so the device can show the reason and route the person
  // back to the identity wizard. Its reports stay staged; revocation is a separate action.
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.fieldAgentSession.update({
      where: { id: sessionId },
      data: {
        assuranceStatus: nextStatus,
        reviewedByUserId: webUser.userId,
        reviewedAt: new Date(),
        rejectionReason: decision === 'REJECT' ? rejectionMessage : null,
      },
    });
    await syncParticipantForSession(tx, sessionId);

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action:
        decision === 'APPROVE'
          ? 'CONTRACTOR_ASSURANCE_APPROVED'
          : 'CONTRACTOR_ASSURANCE_REJECTED',
      summaryText:
        decision === 'APPROVE'
          ? `${webUser.fullName} (${webUser.roleName}) verified and approved credentials for ${session.agentFullName} (${session.corenLicenseNumber || 'License'}). Mobile field access activated.`
          : `${webUser.fullName} (${webUser.roleName}) rejected verification for ${session.agentFullName}. Reason: ${remarks || 'Incomplete credentials'}.`,
      payload: {
        sessionId,
        agentFullName: session.agentFullName,
        corenLicenseNumber: session.corenLicenseNumber,
        decision,
        remarks: remarks || null,
      },
    });

    await createMobileNotification(tx, {
      projectId,
      fieldSessionId: sessionId,
      type: decision === 'APPROVE' ? 'ASSURANCE_APPROVED' : 'ASSURANCE_REJECTED',
      actionType: decision === 'APPROVE' ? 'NONE' : 'OPEN_ASSURANCE_WIZARD',
      requiresAction: decision === 'REJECT',
      title:
        decision === 'APPROVE'
          ? 'Identity Assurance Approved'
          : 'Verification Resubmission Needed',
      message:
        decision === 'APPROVE'
          ? `${webUser.fullName} approved your identity and ${session.corenLicenseNumber || 'regulatory'} credentials.`
          : `Verification was returned: ${remarks || 'Please re-capture a clear ID photo and selfies.'}`,
    });

    if (decision === 'APPROVE') {
      // The server releases staged reports; the device never re-submits them.
      releasedReportIds = await releaseStagedReportsForSession(tx, { projectId, sessionId });
      if (releasedReportIds.length > 0) {
        await recordAuditEvent(tx, {
          projectId,
          actorType: 'WEB_USER',
          actorId: webUser.userId,
          actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
          action: 'WORKDAY_REPORTS_RELEASED',
          summaryText: `Released ${releasedReportIds.length} staged report(s) from ${session.agentFullName} after identity approval.`,
          payload: { sessionId, workdayReportIds: releasedReportIds },
        });
      }
    }

    return updated;
  });

  invalidateSessionAuthCache(sessionId);
  for (const reportId of releasedReportIds) scheduleAiOmissionCheck(reportId);
  void sendPushToFieldSession(sessionId, {
    title: decision === 'APPROVE' ? 'Identity approved' : 'Identity check returned',
    body:
      decision === 'APPROVE'
        ? releasedReportIds.length > 0
          ? `Your identity was approved. ${releasedReportIds.length} staged report(s) were submitted.`
          : 'Your identity was approved.'
        : `Your identity check was returned: ${rejectionMessage}`,
    data: {
      actionType: decision === 'APPROVE' ? 'NONE' : 'OPEN_ASSURANCE_WIZARD',
      assuranceStatus: nextStatus,
    },
  });
  return {
    releasedReportCount: releasedReportIds.length,
    id: updated.id,
    projectId: updated.projectId,
    agentFullName: updated.agentFullName,
    assuranceStatus: updated.assuranceStatus,
    isActive: updated.isActive,
    reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    rejectionReason: updated.rejectionReason,
  };
}

/**
 * Aggregated Portfolio Executive Summary scoped to tenant & user visibility.
 */
export async function getPortfolioExecutiveSummary(webUser: WebJwtPayload) {
  const projects = await prisma.project.findMany({
    where: buildProjectVisibilityWhere(webUser),
    orderBy: { createdAt: 'desc' },
    include: {
      contractors: { ...PROJECT_CONTRACTORS_INCLUDE, include: { organization: { select: { name: true } } } },
      lenderOrganization: { select: { name: true } },
      tranches: {
        orderBy: { trancheNumber: 'asc' },
        select: { trancheNumber: true, isReleased: true },
      },
      boqItems: {
        select: { id: true, isHoldPoint: true, cumulativeCertifiedPct: true },
      },
      ipcClaims: {
        ...LATEST_RATED_IPC_QUERY,
        include: {
          lineItems: {
            select: {
              aiEvidenceRating: true,
              missingHoldPointFlag: true,
              contractorClaimedNgn: true,
              monitorCertifiedNgn: true,
            },
          },
        },
      },
      fieldSessions: {
        where: {
          assuranceStatus: 'PENDING_APPROVAL',
        },
        select: { id: true },
      },
      // Phase 10: retention column (module switch and open defects).
      processConfig: { select: { enableRetentionModule: true } },
      defectTickets: {
        where: { status: { in: ['OPEN', 'ASSIGNED', 'RECTIFIED_PENDING_VERIFICATION'] } },
        select: { id: true },
      },
    },
  });

  let totalPortfolioCommitmentNgn = 0;
  let totalDisbursedToDateNgn = 0;
  let totalRecommendedHoldbackNgn = 0;
  let supportedCount = 0;
  let partialCount = 0;
  let conflictCount = 0;
  let pendingContractorVerificationsCount = 0;

  const projectItems = projects.map((p) => {
    const budget = Number(p.totalBudgetNgn ?? 0);
    const disbursed = Number(p.disbursedToDateNgn);
    totalPortfolioCommitmentNgn += budget;
    totalDisbursedToDateNgn += disbursed;

    const latestIpc = p.ipcClaims[0] || null;
    const { openConflictCount: openConflicts, unfulfilledHoldPointCount: unfulfilledHoldPoints } =
      countReconciliationIssues(latestIpc?.lineItems ?? []);
    let holdbackNgn = 0;

    if (latestIpc) {
      for (const li of latestIpc.lineItems) {
        const claimed = Number(li.contractorClaimedNgn);
        const certified =
          li.monitorCertifiedNgn !== null
            ? Number(li.monitorCertifiedNgn)
            : claimed;
        if (claimed > certified) {
          holdbackNgn += claimed - certified;
        }
      }
    }
    totalRecommendedHoldbackNgn += holdbackNgn;

    if (p.portfolioHealth === 'EVIDENCE_SUPPORTED') supportedCount += 1;
    else if (p.portfolioHealth === 'EVIDENCE_PARTIAL') partialCount += 1;
    else conflictCount += 1;

    const pendingContractors = p.fieldSessions.length;
    pendingContractorVerificationsCount += pendingContractors;

    const activeTranche =
      p.tranches.find((t) => !t.isReleased) || p.tranches[0] || null;

    return {
      projectId: p.id,
      codePrefix: p.codePrefix,
      name: p.name,
      stateLocation: p.stateLocation ?? '',
      contractorName: contractorHeadline(p.contractors).name,
      contractorCount: p.contractors.length,
      lenderName: p.lenderOrganization?.name ?? '',
      totalBudgetNgn: budget,
      disbursedToDateNgn: disbursed,
      certifiedProgressPct: Number(p.certifiedProgressPct),
      activeTrancheNumber: activeTranche?.trancheNumber || null,
      portfolioHealth: p.portfolioHealth,
      openConflictCount: openConflicts,
      unfulfilledHoldPointCount: unfulfilledHoldPoints,
      pendingContractorCount: pendingContractors,
      scheduleVariance: serializeScheduleBadge(p),
      retention: p.processConfig?.enableRetentionModule
        ? {
            phase: p.constructionPhase,
            heldNgn: Number(p.retentionHeldNgn),
            releasedNgn: Number(p.retentionReleasedNgn),
            retentionEndDate: p.retentionEndDate,
            daysRemaining: p.retentionEndDate
              ? calendarDaysUntil(zonedCalendarDate(new Date(), p.timezone), p.retentionEndDate)
              : null,
            openDefectCount: p.defectTickets.length,
          }
        : null,
    };
  });

  return {
    totalPortfolioCommitmentNgn,
    totalDisbursedToDateNgn,
    totalRecommendedHoldbackNgn,
    activeProjectsCount: projects.length,
    supportedCount,
    partialCount,
    conflictCount,
    pendingContractorVerificationsCount,
    projects: projectItems,
  };
}

/**
 * Demo-only catalog endpoint: lists seeded/active projects and their active join codes.
 */
export async function listDemoProjects() {
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      codePrefix: true,
      name: true,
      stateLocation: true,
      lgaLocation: true,
      geofenceMode: true,
      portfolioHealth: true,
      joinCodes: {
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: {
          code: true,
          role: {
            select: {
              id: true,
              code: true,
              name: true,
              fieldPersonaType: true,
              assuranceWeight: true,
              requiresIdentityAssurance: true,
            },
          },
        },
      },
    },
  });

  return projects.map((p) => ({
    id: p.id,
    codePrefix: p.codePrefix,
    name: p.name,
    stateLocation: p.stateLocation ?? '',
    lgaLocation: p.lgaLocation,
    geofenceMode: p.geofenceMode as GeofenceMode,
    portfolioHealth: p.portfolioHealth,
    joinCodes: p.joinCodes.map((jc) => ({
      code: jc.code,
      roleId: jc.role.id,
      roleCode: jc.role.code,
      roleName: jc.role.name,
      fieldPersonaType: jc.role.fieldPersonaType as FieldPersonaType,
      assuranceWeight: jc.role.assuranceWeight,
      requiresIdentityAssurance: jc.role.requiresIdentityAssurance,
    })),
  }));
}
