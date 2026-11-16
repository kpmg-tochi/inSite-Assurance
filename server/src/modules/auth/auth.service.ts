import bcrypt from 'bcryptjs';
import {
  DemoSkipVerificationRequest,
  JoinProjectMobileRequest,
  WebLoginRequest,
  WebRegisterRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  signFieldAgentToken,
  signWebUserToken,
} from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

export async function registerWebUser(input: WebRegisterRequest) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (existing) {
    throw new AppError('A user with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    let organization = await tx.organization.findFirst({
      where: {
        name: { equals: input.organizationName, mode: 'insensitive' },
        roleType: input.role,
      },
    });

    if (!organization) {
      organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          roleType: input.role,
        },
      });
    }

    return tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        organizationId: organization.id,
        professionalLicenseType: input.professionalLicenseType ?? null,
        professionalLicenseNumber: input.professionalLicenseNumber ?? null,
      },
      include: {
        organization: true,
      },
    });
  });

  const accessToken = signWebUserToken({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  });

  return {
    accessToken,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      professionalLicenseType: user.professionalLicenseType,
      professionalLicenseNumber: user.professionalLicenseNumber,
    },
  };
}

export async function loginWebUser(input: WebLoginRequest) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { organization: true },
  });

  if (!user || !user.isActive) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const accessToken = signWebUserToken({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  });

  return {
    accessToken,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      professionalLicenseType: user.professionalLicenseType,
      professionalLicenseNumber: user.professionalLicenseNumber,
    },
  };
}

function buildMobileSessionResponse(
  project: {
    id: string;
    name: string;
    codePrefix: string;
    stateLocation: string;
    reportingCadence: string;
    geofenceMode: string;
    geofenceGeoJson: unknown;
    boqItems: Array<{
      id: string;
      wbsCode: string;
      section: string;
      description: string;
      unit: string;
      totalQuantity: unknown;
      budgetedCostNgn: unknown;
      isHoldPoint: boolean;
      holdPointInstruction: string | null;
      cumulativeCertifiedPct: unknown;
    }>;
  },
  session: {
    id: string;
    projectId: string;
    independenceTier: any;
    agentFullName: string;
    agentPhoneNumber: string;
    deviceId: string;
    assuranceStatus: string;
    corenLicenseNumber: string | null;
    livenessPassed: boolean;
  },
  normalizedCode: string
) {
  const accessToken = signFieldAgentToken({
    sessionId: session.id,
    projectId: session.projectId,
    independenceTier: session.independenceTier,
    agentFullName: session.agentFullName,
    deviceId: session.deviceId,
  });

  const boqItems = project.boqItems.map((item) => ({
    id: item.id,
    wbsCode: item.wbsCode,
    section: item.section,
    description: item.description,
    unit: item.unit,
    totalQuantity: Number(item.totalQuantity),
    budgetedCostNgn: Number(item.budgetedCostNgn),
    isHoldPoint: item.isHoldPoint,
    holdPointInstruction: item.holdPointInstruction,
    cumulativeCertifiedPct: Number(item.cumulativeCertifiedPct),
  }));

  return {
    accessToken,
    sessionProfile: {
      sessionId: session.id,
      projectId: project.id,
      projectName: project.name,
      projectCodePrefix: project.codePrefix,
      joinCodeUsed: normalizedCode,
      independenceTier: session.independenceTier,
      agentFullName: session.agentFullName,
      agentPhoneNumber: session.agentPhoneNumber,
      deviceId: session.deviceId,
      assuranceStatus: session.assuranceStatus,
      corenLicenseNumber: session.corenLicenseNumber ?? undefined,
      livenessPassed: session.livenessPassed,
    },
    baselinePack: {
      projectId: project.id,
      name: project.name,
      codePrefix: project.codePrefix,
      stateLocation: project.stateLocation,
      reportingCadence: project.reportingCadence,
      geofenceMode: project.geofenceMode,
      geofence: project.geofenceGeoJson,
      boqItems,
      holdPoints: boqItems.filter((b) => b.isHoldPoint),
    },
  };
}

export async function joinProjectMobile(input: JoinProjectMobileRequest) {
  const normalizedCode = input.joinCode.trim().toUpperCase();

  const joinCodeRecord = await prisma.projectJoinCode.findUnique({
    where: { code: normalizedCode },
    include: {
      project: {
        include: {
          boqItems: {
            orderBy: { wbsCode: 'asc' },
          },
          tranches: {
            orderBy: { trancheNumber: 'asc' },
          },
        },
      },
    },
  });

  if (!joinCodeRecord || !joinCodeRecord.isActive) {
    throw new AppError(
      `Project Join Code "${normalizedCode}" is invalid or has been deactivated by the Independent Monitor.`,
      404,
      'INVALID_JOIN_CODE'
    );
  }

  if (
    joinCodeRecord.expiresAt &&
    joinCodeRecord.expiresAt.getTime() < Date.now()
  ) {
    throw new AppError(
      `Project Join Code "${normalizedCode}" has expired.`,
      403,
      'EXPIRED_JOIN_CODE'
    );
  }

  const pinHash = input.agentPin
    ? await bcrypt.hash(input.agentPin, 8)
    : null;

  const isContractorTier =
    joinCodeRecord.independenceTier === 'CONTRACTOR_ENGINEER';
  const initialAssuranceStatus = isContractorTier
    ? 'PENDING_APPROVAL'
    : 'APPROVED';

  const session = await prisma.$transaction(async (tx) => {
    const createdSession = await tx.fieldAgentSession.create({
      data: {
        projectId: joinCodeRecord.projectId,
        joinCodeId: joinCodeRecord.id,
        independenceTier: joinCodeRecord.independenceTier,
        agentFullName: input.agentFullName,
        agentPhoneNumber: input.agentPhoneNumber,
        agentPinHash: pinHash,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel ?? null,
        deviceOs: input.deviceOs ?? null,
        deviceSecretHash: input.devicePublicKeyOrSecretHash ?? null,
        lastSyncAt: new Date(),
        assuranceStatus: initialAssuranceStatus,
        idDocumentType: input.idDocumentType ?? (isContractorTier ? 'National Identity (NIN)' : null),
        idDocumentUrl: input.idDocumentUrl ?? null,
        selfieImageUrl: input.selfieImageUrl ?? null,
        livenessPassed: input.livenessPassed ?? false,
        livenessScore: input.livenessPassed ? 0.985 : null,
        corenLicenseNumber: input.corenLicenseNumber ?? null,
        experienceSummary: input.experienceSummary ?? null,
      },
    });

    await recordAuditEvent(tx, {
      projectId: joinCodeRecord.projectId,
      actorType: 'FIELD_AGENT',
      actorId: createdSession.id,
      actorDisplayName: `${input.agentFullName} (${joinCodeRecord.independenceTier})`,
      action: isContractorTier
        ? 'CONTRACTOR_ASSURANCE_SUBMITTED'
        : 'FIELD_AGENT_JOINED',
      summaryText: isContractorTier
        ? `Contractor Site Engineer ${input.agentFullName} submitted identity & COREN (${input.corenLicenseNumber || 'License'}) credentials for project ${joinCodeRecord.project.codePrefix} — Awaiting Monitor verification.`
        : `Field reporter ${input.agentFullName} joined project ${joinCodeRecord.project.codePrefix} using code ${normalizedCode} under tier ${joinCodeRecord.independenceTier}.`,
      payload: {
        joinCode: normalizedCode,
        independenceTier: joinCodeRecord.independenceTier,
        agentPhoneNumber: input.agentPhoneNumber,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel ?? null,
        assuranceStatus: initialAssuranceStatus,
        corenLicenseNumber: input.corenLicenseNumber ?? null,
        livenessPassed: input.livenessPassed ?? false,
      },
    });

    return createdSession;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    session,
    normalizedCode
  );
}

/**
 * Demo-only onboarding bypass:
 * Links a mobile field user to the project matching the provided join code and
 * marks their session as APPROVED without requiring ID/liveness/credential review.
 */
export async function demoSkipVerificationMobile(
  input: DemoSkipVerificationRequest,
  authenticatedSessionId?: string
) {
  const normalizedCode = input.joinCode.trim().toUpperCase();

  const joinCodeRecord = await prisma.projectJoinCode.findUnique({
    where: { code: normalizedCode },
    include: {
      project: {
        include: {
          boqItems: {
            orderBy: { wbsCode: 'asc' },
          },
          tranches: {
            orderBy: { trancheNumber: 'asc' },
          },
        },
      },
    },
  });

  if (!joinCodeRecord || !joinCodeRecord.isActive) {
    throw new AppError(
      `Project Join Code "${normalizedCode}" is invalid or inactive.`,
      404,
      'INVALID_JOIN_CODE'
    );
  }

  const targetSessionId = input.sessionId || authenticatedSessionId;

  const session = await prisma.$transaction(async (tx) => {
    let existingSession = null;
    if (targetSessionId) {
      existingSession = await tx.fieldAgentSession.findFirst({
        where: {
          id: targetSessionId,
          projectId: joinCodeRecord.projectId,
        },
      });
    }

    const updatedOrCreated = existingSession
      ? await tx.fieldAgentSession.update({
          where: { id: existingSession.id },
          data: {
            assuranceStatus: 'APPROVED',
            livenessPassed: true,
            livenessScore: existingSession.livenessScore ?? 1.0,
            corenLicenseNumber:
              existingSession.corenLicenseNumber ?? 'DEMO-BYPASS',
            experienceSummary:
              existingSession.experienceSummary ??
              'Demo-only verification bypass session.',
            reviewedAt: new Date(),
            lastSyncAt: new Date(),
          },
        })
      : await tx.fieldAgentSession.create({
          data: {
            projectId: joinCodeRecord.projectId,
            joinCodeId: joinCodeRecord.id,
            independenceTier: joinCodeRecord.independenceTier,
            agentFullName: input.agentFullName || 'Demo Field Engineer',
            agentPhoneNumber: input.agentPhoneNumber || '+2348000000000',
            deviceId: input.deviceId || `DEMO-${Date.now()}`,
            deviceModel: input.deviceModel ?? null,
            deviceOs: input.deviceOs ?? null,
            assuranceStatus: 'APPROVED',
            livenessPassed: true,
            livenessScore: 1.0,
            corenLicenseNumber: 'DEMO-BYPASS',
            experienceSummary: 'Demo-only verification bypass session.',
            reviewedAt: new Date(),
            lastSyncAt: new Date(),
          },
        });

    await recordAuditEvent(tx, {
      projectId: joinCodeRecord.projectId,
      actorType: 'FIELD_AGENT',
      actorId: updatedOrCreated.id,
      actorDisplayName: `${updatedOrCreated.agentFullName} (${joinCodeRecord.independenceTier})`,
      action: 'CONTRACTOR_ASSURANCE_APPROVED',
      summaryText: `[DEMO ONLY] Verification skipped — linked ${updatedOrCreated.agentFullName} directly to project ${joinCodeRecord.project.codePrefix} (${normalizedCode}).`,
      payload: {
        demoBypass: true,
        joinCode: normalizedCode,
        sessionId: updatedOrCreated.id,
        independenceTier: joinCodeRecord.independenceTier,
      },
    });

    return updatedOrCreated;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    session,
    normalizedCode
  );
}

