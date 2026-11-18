import { Prisma } from '@prisma/client';
import {
  CreateProjectRequest,
  FieldPersonaType,
  GeoCoordinate,
  ProjectGeofenceSchema,
  UpdateProjectBaseline,
  verifyPointAgainstGeofence,
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
import { createJoinCode } from './joinCodes.service';
import { isProjectObjectKey, storageService } from '../../integrations/storage.service';
import { createMobileNotification } from '../notifications/notifications.service';

type JoinCodeWithRole = {
  id: string;
  projectId: string;
  code: string;
  isActive: boolean;
  expiresAt: Date | null;
  maxUses?: number | null;
  useCount?: number;
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
      isActive: jc.isActive,
      expiresAt: jc.expiresAt ? jc.expiresAt.toISOString() : null,
      maxUses: jc.maxUses ?? null,
      useCount: jc.useCount ?? 0,
    }));
}

type ProjectCoreRow = Prisma.ProjectGetPayload<{
  include: {
    monitorOrganization: true;
    lenderOrganization: true;
    contractorOrganization: true;
  };
}>;

function serializeProjectCore(project: ProjectCoreRow) {
  return {
    id: project.id,
    tenantId: project.tenantId,
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation,
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: Number(project.totalBudgetNgn),
    disbursedToDateNgn: Number(project.disbursedToDateNgn),
    certifiedProgressPct: Number(project.certifiedProgressPct),
    reportingCadence: project.reportingCadence,
    workdayStartTime: project.workdayStartTime,
    workdayEndTime: project.workdayEndTime,
    geofenceMode: project.geofenceMode,
    geofence: project.geofenceGeoJson,
    portfolioHealth: project.portfolioHealth,
    monitorOrganizationName: project.monitorOrganization.name,
    lenderOrganizationName: project.lenderOrganization.name,
    contractorOrganizationName: project.contractorOrganization.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function listProjectsForUser(webUser: WebJwtPayload) {
  const visibilityWhere = buildProjectVisibilityWhere(webUser);

  const projects = await prisma.project.findMany({
    where: visibilityWhere,
    orderBy: { createdAt: 'desc' },
    include: {
      monitorOrganization: true,
      lenderOrganization: true,
      contractorOrganization: true,
      joinCodes: {
        include: {
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
      evidenceLogs: {
        where: { status: 'CONFIRMED' },
        orderBy: { capturedAtDevice: 'desc' },
        select: {
          id: true,
          capturedAtDevice: true,
          boqItemId: true,
          fieldPersonaType: true,
        },
      },
      ipcClaims: {
        orderBy: { ipcNumber: 'desc' },
        take: 1,
        include: {
          lineItems: {
            select: {
              aiEvidenceRating: true,
              missingHoldPointFlag: true,
            },
          },
        },
      },
    },
  });


  return projects.map((project) => {
    const latestIpc = project.ipcClaims[0];
    const openConflictCount = latestIpc
      ? latestIpc.lineItems.filter(
          (li) =>
            li.aiEvidenceRating === 'CONTRADICTED' ||
            li.aiEvidenceRating === 'UNSUPPORTED'
        ).length
      : 0;

    const holdPointIds = new Set(
      project.boqItems.filter((b) => b.isHoldPoint).map((b) => b.id)
    );
    const evidencedHoldPointIds = new Set(
      project.evidenceLogs
        .filter(
          (log) =>
            log.boqItemId &&
            holdPointIds.has(log.boqItemId) &&
            log.fieldPersonaType === 'INDEPENDENT_VERIFIER'
        )
        .map((log) => log.boqItemId as string)
    );
    const unfulfilledHoldPointCount =
      holdPointIds.size - evidencedHoldPointIds.size;

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

export async function createProjectBaseline(
  webUser: WebJwtPayload,
  input: CreateProjectRequest
) {
  const existing = await prisma.project.findUnique({
    where: {
      tenantId_codePrefix: { tenantId: webUser.tenantId, codePrefix: input.codePrefix },
    },
  });

  if (existing) {
    throw new AppError(
      `A project with code prefix "${input.codePrefix}" already exists`,
      409,
      'DUPLICATE_PROJECT_PREFIX'
    );
  }

  const createdProjectId = await prisma.$transaction(async (tx) => {
    // Find or create Lender Organization within tenant
    let lenderOrg = await tx.organization.findFirst({
      where: {
        tenantId: webUser.tenantId,
        name: { equals: input.lenderOrganizationName, mode: 'insensitive' },
      },
    });
    if (!lenderOrg) {
      lenderOrg = await tx.organization.create({
        data: {
          tenantId: webUser.tenantId,
          name: input.lenderOrganizationName,
          category: 'FINANCIER_LENDER',
        },
      });
    }

    // Find or create Contractor Organization within tenant
    let contractorOrg = await tx.organization.findFirst({
      where: {
        tenantId: webUser.tenantId,
        name: { equals: input.contractorOrganizationName, mode: 'insensitive' },
      },
    });
    if (!contractorOrg) {
      contractorOrg = await tx.organization.create({
        data: {
          tenantId: webUser.tenantId,
          name: input.contractorOrganizationName,
          category: 'CONTRACTOR',
        },
      });
    }

    const project = await tx.project.create({
      data: {
        tenantId: webUser.tenantId,
        name: input.name,
        codePrefix: input.codePrefix,
        stateLocation: input.stateLocation,
        lgaLocation: input.lgaLocation ?? null,
        description: input.description ?? null,
        totalBudgetNgn: input.totalBudgetNgn,
        reportingCadence: input.reportingCadence,
        workdayStartTime: input.workdayStartTime ?? '08:00',
        workdayEndTime: input.workdayEndTime ?? '17:00',
        geofenceMode: input.geofence.mode,
        geofenceGeoJson: input.geofence as unknown as Prisma.InputJsonValue,
        monitorOrganizationId: webUser.organizationId,
        lenderOrganizationId: lenderOrg.id,
        contractorOrganizationId: contractorOrg.id,
      },
    });

    // Assign creator to the project automatically so non-global creators still retain visibility
    await tx.userProjectAssignment.create({
      data: {
        userId: webUser.userId,
        projectId: project.id,
        roleId: webUser.roleId,
      },
    });

    // Generate Join Codes from tenant's active MOBILE / BOTH roles
    const mobileRoles = await tx.role.findMany({
      where: {
        tenantId: webUser.tenantId,
        surface: { in: ['MOBILE', 'BOTH'] },
      },
      orderBy: { assuranceWeight: 'desc' },
    });

    const joinCodesData = [];
    for (const role of mobileRoles) {
      joinCodesData.push(
        await createJoinCode(tx, { projectId: project.id, codePrefix: project.codePrefix, role })
      );
    }

    // Create Facility Tranches and Conditions Precedent
    for (const trancheInput of input.tranches) {
      await tx.facilityTranche.create({
        data: {
          projectId: project.id,
          trancheNumber: trancheInput.trancheNumber,
          name: trancheInput.name,
          allocatedAmountNgn: trancheInput.allocatedAmountNgn,
          targetCompletionPct: trancheInput.targetCompletionPct,
          conditionsPrecedent: {
            create: trancheInput.conditionsPrecedent.map((cp) => ({
              referenceCode: cp.referenceCode,
              description: cp.description,
              isMandatoryForRelease: cp.isMandatoryForRelease,
              status: cp.status,
              evidenceDocumentUrl: cp.evidenceDocumentUrl ?? null,
            })),
          },
        },
      });
    }

    await recordAuditEvent(tx, {
      projectId: project.id,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PROJECT_CREATED',
      summaryText: `Configured project baseline "${project.name}" (${project.codePrefix}) with ${input.geofence.mode} geofence and ${input.tranches.length} facility tranches.`,
      payload: {
        codePrefix: project.codePrefix,
        totalBudgetNgn: input.totalBudgetNgn,
        geofenceMode: input.geofence.mode,
        reportingCadence: input.reportingCadence,
        issuedJoinCodes: joinCodesData.map((jc) => jc.code),
      },
    });

    return project.id;
  });

  return getProjectBaselineDetails(createdProjectId, webUser);
}

export async function getProjectBaselineDetails(
  projectId: string,
  webUser?: WebJwtPayload,
  fieldAgent?: FieldAgentJwtPayload
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      monitorOrganization: true,
      lenderOrganization: true,
      contractorOrganization: true,
      joinCodes: {
        include: {
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

  // Field agents get the baseline they need to report against; no join codes.
  return {
    ...serializeProjectCore(project),
    joinCodes: fieldAgent ? [] : visibleJoinCodesFor(project.joinCodes, webUser),
    tranches: project.tranches.map(serializeTranche),
    boqItems: project.boqItems.map((b) => serializeBoqItem(b)),
  };
}

export async function updateProjectBaseline(
  projectId: string,
  webUser: WebJwtPayload,
  input: UpdateProjectBaseline
) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.stateLocation ? { stateLocation: input.stateLocation } : {}),
        ...(input.lgaLocation !== undefined
          ? { lgaLocation: input.lgaLocation }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.totalBudgetNgn
          ? { totalBudgetNgn: input.totalBudgetNgn }
          : {}),
        ...(input.reportingCadence
          ? { reportingCadence: input.reportingCadence }
          : {}),
        ...(input.geofence
          ? {
              geofenceMode: input.geofence.mode,
              geofenceGeoJson:
                input.geofence as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'BASELINE_UPDATED',
      summaryText: `Updated baseline configuration for project ${updated.codePrefix}.`,
      payload: input as Record<string, unknown>,
    });
  });

  return getProjectBaselineDetails(projectId, webUser);
}

export async function verifyCoordinateForProject(
  projectId: string,
  coord: GeoCoordinate,
  webUser?: WebJwtPayload,
  fieldAgent?: FieldAgentJwtPayload
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, codePrefix: true, geofenceGeoJson: true },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const parsedGeofence = ProjectGeofenceSchema.parse(project.geofenceGeoJson);
  return verifyPointAgainstGeofence(coord, parsedGeofence);
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
    projectFilter = { project: buildProjectVisibilityWhere(webUser) };
  }

  const sessions = await prisma.fieldAgentSession.findMany({
    where: projectFilter,
    orderBy: { createdAt: 'desc' },
    include: {
      role: {
        select: { id: true, code: true, name: true },
      },
      joinCode: {
        select: { code: true },
      },
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
    joinCodeUsed: s.joinCode.code,
    deviceId: s.deviceId,
    deviceModel: s.deviceModel,
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
    whereClause.project = buildProjectVisibilityWhere(webUser);
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
          contractorOrganization: { select: { name: true } },
        },
      },
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
    organizationName: s.project.contractorOrganization.name,
    roleId: s.roleId,
    roleName: s.role.name || s.roleNameSnapshot,
    fieldPersonaType: s.fieldPersonaType as FieldPersonaType,
    agentFullName: s.agentFullName,
    agentPhoneNumber: s.agentPhoneNumber,
    joinCodeUsed: s.joinCode.code,
    corenLicenseNumber: s.corenLicenseNumber,
    idDocumentType: s.idDocumentType,
    idDocumentUrl: await signed(s.idDocumentUrl, s.project.tenantId, s.projectId),
    selfieImageUrl: await signed(s.selfieImageUrl, s.project.tenantId, s.projectId),
    selfieLeftUrl: await signed(s.selfieLeftUrl, s.project.tenantId, s.projectId),
    selfieRightUrl: await signed(s.selfieRightUrl, s.project.tenantId, s.projectId),
    livenessPassed: s.livenessPassed,
    livenessScore: s.livenessScore,
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
  const isActive = decision === 'APPROVE';

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.fieldAgentSession.update({
      where: { id: sessionId },
      data: {
        assuranceStatus: nextStatus,
        isActive,
        reviewedByUserId: webUser.userId,
        reviewedAt: new Date(),
        rejectionReason:
          decision === 'REJECT'
            ? remarks || 'Verification rejected by reviewer.'
            : null,
      },
    });

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
          : `Verification was returned: ${remarks || 'Please re-capture clear ID and liveness selfies.'}`,
    });

    if (decision === 'APPROVE') {
      const stagedReports = await tx.workdayReport.findMany({
        where: {
          projectId,
          reporterSessionId: sessionId,
          status: 'STAGED_UNVERIFIED',
        },
        include: { boqItem: { select: { wbsCode: true, unit: true } } },
        take: 10,
      });

      for (const report of stagedReports) {
        await createMobileNotification(tx, {
          projectId,
          fieldSessionId: sessionId,
          type: 'BACKLOG_REVIEW_REQUIRED',
          actionType: 'OPEN_REPORT_SUMMARY',
          requiresAction: true,
          title: `Review Queued Report · WBS ${report.boqItem.wbsCode}`,
          message:
            'Your staged report is ready for AI summary confirmation before final submission.',
          metadata: {
            workdayReportId: report.id,
            wbsItemId: report.wbsItemId,
            wbsCode: report.boqItem.wbsCode,
            draftSummary: report.summaryText,
            draftQuantity: Number(report.reportedQuantity),
            unit: report.unitOfMeasure || report.boqItem.unit,
          },
        });
      }
    }

    return updated;
  });

  invalidateSessionAuthCache(sessionId);
  return {
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
      contractorOrganization: { select: { name: true } },
      lenderOrganization: { select: { name: true } },
      tranches: {
        orderBy: { trancheNumber: 'asc' },
        select: { trancheNumber: true, isReleased: true },
      },
      boqItems: {
        select: { id: true, isHoldPoint: true, cumulativeCertifiedPct: true },
      },
      ipcClaims: {
        orderBy: { ipcNumber: 'desc' },
        take: 1,
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
    const budget = Number(p.totalBudgetNgn);
    const disbursed = Number(p.disbursedToDateNgn);
    totalPortfolioCommitmentNgn += budget;
    totalDisbursedToDateNgn += disbursed;

    const latestIpc = p.ipcClaims[0] || null;
    let openConflicts = 0;
    let unfulfilledHoldPoints = 0;
    let holdbackNgn = 0;

    if (latestIpc) {
      for (const li of latestIpc.lineItems) {
        if (li.aiEvidenceRating === 'CONTRADICTED' || li.missingHoldPointFlag) {
          openConflicts += 1;
        }
        if (li.missingHoldPointFlag) {
          unfulfilledHoldPoints += 1;
        }
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
      stateLocation: p.stateLocation,
      contractorName: p.contractorOrganization.name,
      lenderName: p.lenderOrganization.name,
      totalBudgetNgn: budget,
      disbursedToDateNgn: disbursed,
      certifiedProgressPct: Number(p.certifiedProgressPct),
      activeTrancheNumber: activeTranche?.trancheNumber || null,
      portfolioHealth: p.portfolioHealth,
      openConflictCount: openConflicts,
      unfulfilledHoldPointCount: unfulfilledHoldPoints,
      pendingContractorCount: pendingContractors,
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
    stateLocation: p.stateLocation,
    lgaLocation: p.lgaLocation,
    geofenceMode: p.geofenceMode,
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
