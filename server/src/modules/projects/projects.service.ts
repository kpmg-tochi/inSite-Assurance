import { Prisma } from '@prisma/client';
import {
  CreateProjectRequest,
  GeoCoordinate,
  INDEPENDENCE_TIER_META,
  IndependenceTier,
  ProjectGeofenceSchema,
  UpdateProjectBaseline,
  verifyPointAgainstGeofence,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

const TIERS: IndependenceTier[] = [
  'MONITOR_INSPECTOR',
  'INDEPENDENT_RESIDENT',
  'CONTRACTOR_ENGINEER',
];

export async function listProjectsForUser(webUser: WebJwtPayload) {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      monitorOrganization: true,
      lenderOrganization: true,
      contractorOrganization: true,
      joinCodes: true,
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
          independenceTier: true,
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
            log.independenceTier !== 'CONTRACTOR_ENGINEER'
        )
        .map((log) => log.boqItemId as string)
    );
    const unfulfilledHoldPointCount =
      holdPointIds.size - evidencedHoldPointIds.size;

    // Segregate Join Codes for CONTRACTOR role (only show CONTRACTOR_ENGINEER join code)
    const visibleJoinCodes =
      webUser.role === 'CONTRACTOR'
        ? project.joinCodes.filter(
            (jc) => jc.independenceTier === 'CONTRACTOR_ENGINEER'
          )
        : project.joinCodes;

    return {
      id: project.id,
      name: project.name,
      codePrefix: project.codePrefix,
      stateLocation: project.stateLocation,
      lgaLocation: project.lgaLocation,
      description: project.description,
      totalBudgetNgn: Number(project.totalBudgetNgn),
      disbursedToDateNgn: Number(project.disbursedToDateNgn),
      certifiedProgressPct: Number(project.certifiedProgressPct),
      reportingCadence: project.reportingCadence,
      geofenceMode: project.geofenceMode,
      geofence: project.geofenceGeoJson,
      portfolioHealth: project.portfolioHealth,
      monitorOrganizationName: project.monitorOrganization.name,
      lenderOrganizationName: project.lenderOrganization.name,
      contractorOrganizationName: project.contractorOrganization.name,
      openConflictCount,
      unfulfilledHoldPointCount,
      totalBoqItems: project.boqItems.length,
      opaqueLumpSumCount: project.boqItems.filter((b) => b.isOpaqueLumpSum).length,
      lastFieldCaptureAt:
        project.evidenceLogs[0]?.capturedAtDevice.toISOString() ?? null,
      joinCodes: visibleJoinCodes,
      tranches: project.tranches.map((t) => ({
        ...t,
        allocatedAmountNgn: Number(t.allocatedAmountNgn),
        releasedAmountNgn: Number(t.releasedAmountNgn),
        targetCompletionPct: Number(t.targetCompletionPct),
      })),
    };
  });
}

export async function createProjectBaseline(
  webUser: WebJwtPayload,
  input: CreateProjectRequest
) {
  const existing = await prisma.project.findUnique({
    where: { codePrefix: input.codePrefix },
  });

  if (existing) {
    throw new AppError(
      `A project with code prefix "${input.codePrefix}" already exists`,
      409,
      'DUPLICATE_PROJECT_PREFIX'
    );
  }

  return prisma.$transaction(async (tx) => {
    // Find or create Lender Organization
    let lenderOrg = await tx.organization.findFirst({
      where: {
        name: { equals: input.lenderOrganizationName, mode: 'insensitive' },
        roleType: 'LENDER',
      },
    });
    if (!lenderOrg) {
      lenderOrg = await tx.organization.create({
        data: { name: input.lenderOrganizationName, roleType: 'LENDER' },
      });
    }

    // Find or create Contractor Organization
    let contractorOrg = await tx.organization.findFirst({
      where: {
        name: { equals: input.contractorOrganizationName, mode: 'insensitive' },
        roleType: 'CONTRACTOR',
      },
    });
    if (!contractorOrg) {
      contractorOrg = await tx.organization.create({
        data: { name: input.contractorOrganizationName, roleType: 'CONTRACTOR' },
      });
    }

    const project = await tx.project.create({
      data: {
        name: input.name,
        codePrefix: input.codePrefix,
        stateLocation: input.stateLocation,
        lgaLocation: input.lgaLocation ?? null,
        description: input.description ?? null,
        totalBudgetNgn: input.totalBudgetNgn,
        reportingCadence: input.reportingCadence,
        geofenceMode: input.geofence.mode,
        geofenceGeoJson: input.geofence as unknown as Prisma.InputJsonValue,
        monitorOrganizationId: webUser.organizationId,
        lenderOrganizationId: lenderOrg.id,
        contractorOrganizationId: contractorOrg.id,
      },
    });

    // Generate the 3 role-specific Join Codes (e.g. LKK-402-INS, LKK-402-COW, LKK-402-CON)
    const joinCodesData = TIERS.map((tier) => ({
      projectId: project.id,
      code: `${input.codePrefix}-${INDEPENDENCE_TIER_META[tier].codeSuffix}`,
      independenceTier: tier,
      isActive: true,
    }));

    await tx.projectJoinCode.createMany({ data: joinCodesData });

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
      actorDisplayName: `${webUser.fullName} (${webUser.role})`,
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

    return tx.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        joinCodes: true,
        tranches: {
          orderBy: { trancheNumber: 'asc' },
          include: { conditionsPrecedent: true },
        },
      },
    });
  });
}

export async function getProjectBaselineDetails(
  projectId: string,
  webUser?: WebJwtPayload
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      monitorOrganization: true,
      lenderOrganization: true,
      contractorOrganization: true,
      joinCodes: true,
      tranches: {
        orderBy: { trancheNumber: 'asc' },
        include: { conditionsPrecedent: true },
      },
      boqItems: {
        orderBy: { wbsCode: 'asc' },
      },
      fieldSessions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const isContractor = webUser?.role === 'CONTRACTOR';

  return {
    ...project,
    totalBudgetNgn: Number(project.totalBudgetNgn),
    disbursedToDateNgn: Number(project.disbursedToDateNgn),
    certifiedProgressPct: Number(project.certifiedProgressPct),
    geofence: project.geofenceGeoJson,
    joinCodes: isContractor
      ? project.joinCodes.filter(
          (jc) => jc.independenceTier === 'CONTRACTOR_ENGINEER'
        )
      : project.joinCodes,
    tranches: project.tranches.map((t) => ({
      ...t,
      allocatedAmountNgn: Number(t.allocatedAmountNgn),
      releasedAmountNgn: Number(t.releasedAmountNgn),
      targetCompletionPct: Number(t.targetCompletionPct),
    })),
    boqItems: project.boqItems.map((b) => ({
      ...b,
      totalQuantity: Number(b.totalQuantity),
      rateNgn: Number(b.rateNgn),
      budgetedCostNgn: Number(b.budgetedCostNgn),
      cumulativeCertifiedPct: Number(b.cumulativeCertifiedPct),
    })),
  };
}

export async function updateProjectBaseline(
  projectId: string,
  webUser: WebJwtPayload,
  input: UpdateProjectBaseline
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!existing) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
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
      actorDisplayName: `${webUser.fullName} (${webUser.role})`,
      action: 'BASELINE_UPDATED',
      summaryText: `Updated baseline configuration for project ${updated.codePrefix}.`,
      payload: input as Record<string, unknown>,
    });

    return updated;
  });
}

export async function verifyCoordinateForProject(
  projectId: string,
  coord: GeoCoordinate
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
 * List all Contractor Assurance Verification Requests for a project
 */
export async function listContractorVerifications(projectId?: string) {
  const whereClause: any = {
    independenceTier: 'CONTRACTOR_ENGINEER',
  };
  if (projectId && projectId !== 'all') {
    whereClause.projectId = projectId;
  }

  const sessions = await prisma.fieldAgentSession.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          codePrefix: true,
          contractorOrganization: { select: { name: true } },
        },
      },
      joinCode: { select: { code: true } },
    },
  });

  // Get reviewer user names if reviewed
  const reviewerIds = sessions
    .map((s) => s.reviewedByUserId)
    .filter((id): id is string => Boolean(id));

  const reviewers = reviewerIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, fullName: true },
      })
    : [];

  const reviewerMap = new Map(reviewers.map((r) => [r.id, r.fullName]));

  return sessions.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    projectCodePrefix: s.project.codePrefix,
    projectName: s.project.name,
    organizationName: s.project.contractorOrganization.name,
    agentFullName: s.agentFullName,
    agentPhoneNumber: s.agentPhoneNumber,
    joinCodeUsed: s.joinCode.code,
    corenLicenseNumber: s.corenLicenseNumber,
    idDocumentType: s.idDocumentType,
    idDocumentUrl: s.idDocumentUrl,
    selfieImageUrl: s.selfieImageUrl,
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
      ? reviewerMap.get(s.reviewedByUserId) || 'Independent Monitor'
      : null,
    rejectionReason: s.rejectionReason,
  }));
}

/**
 * Review (Approve or Reject) a Contractor Assurance Verification Request
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

  return prisma.$transaction(async (tx) => {
    const updated = await tx.fieldAgentSession.update({
      where: { id: sessionId },
      data: {
        assuranceStatus: nextStatus,
        isActive,
        reviewedByUserId: webUser.userId,
        reviewedAt: new Date(),
        rejectionReason: decision === 'REJECT' ? remarks || 'Verification rejected by Independent Monitor.' : null,
      },
    });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.role})`,
      action: decision === 'APPROVE' ? 'CONTRACTOR_ASSURANCE_APPROVED' : 'CONTRACTOR_ASSURANCE_REJECTED',
      summaryText: decision === 'APPROVE'
        ? `Independent Monitor ${webUser.fullName} verified and approved on-site contractor credentials for ${session.agentFullName} (${session.corenLicenseNumber || 'COREN'}). Mobile field access activated.`
        : `Independent Monitor ${webUser.fullName} rejected contractor verification for ${session.agentFullName}. Reason: ${remarks || 'Incomplete credentials'}.`,
      payload: {
        sessionId,
        agentFullName: session.agentFullName,
        corenLicenseNumber: session.corenLicenseNumber,
        decision,
        remarks: remarks || null,
      },
    });

    return updated;
  });
}

/**
 * Aggregated Portfolio Executive Summary for Financiers & Lead Monitors
 */
export async function getPortfolioExecutiveSummary(webUser: WebJwtPayload) {
  const projects = await prisma.project.findMany({
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
          independenceTier: 'CONTRACTOR_ENGINEER',
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
        const certified = li.monitorCertifiedNgn !== null ? Number(li.monitorCertifiedNgn) : claimed;
        if (claimed > certified) {
          holdbackNgn += (claimed - certified);
        }
      }
    }
    totalRecommendedHoldbackNgn += holdbackNgn;

    if (p.portfolioHealth === 'EVIDENCE_SUPPORTED') supportedCount += 1;
    else if (p.portfolioHealth === 'EVIDENCE_PARTIAL') partialCount += 1;
    else conflictCount += 1;

    const pendingContractors = p.fieldSessions.length;
    pendingContractorVerificationsCount += pendingContractors;

    const activeTranche = p.tranches.find((t) => !t.isReleased) || p.tranches[0] || null;

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

