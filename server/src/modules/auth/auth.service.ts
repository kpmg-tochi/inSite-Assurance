import bcrypt from 'bcryptjs';
import {
  ChangePasswordRequest,
  DemoSkipVerificationRequest,
  FieldPersonaType,
  JoinProjectMobileRequest,
  OrganizationCategory,
  WebLoginRequest,
  WebRegisterRequest,
  WebUserProfile,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  invalidateUserAuthCache,
  signFieldAgentToken,
  signWebUserToken,
} from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { parseTenantBranding } from '../rbac/rbac.service';

export const WEB_USER_AUTH_INCLUDE = {
  organization: true,
  tenant: true,
  role: {
    include: {
      rolePermissions: {
        include: {
          permission: {
            select: { key: true },
          },
        },
      },
    },
  },
} as const;

/** Failed attempts before an account is locked, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Hash of a random string, compared against when the account does not exist so the
// response time does not reveal whether an email is registered.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('insite-timing-equaliser', 10);

type LoadedWebUser = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.user.findUnique<{
        where: { id: string };
        include: typeof WEB_USER_AUTH_INCLUDE;
      }>
    >
  >
>;

export function serializeWebUserProfile(user: LoadedWebUser): WebUserProfile {
  const permissions = user.role.rolePermissions.map((rp) => rp.permission.key);

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    isPlatformSuperAdmin: user.isPlatformSuperAdmin,
    tenantId: user.tenantId,
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      status: user.tenant.status,
      defaultCurrency: user.tenant.defaultCurrency,
      timezone: user.tenant.timezone,
      brandingConfig: parseTenantBranding(user.tenant.brandingConfig),
      createdAt: user.tenant.createdAt.toISOString(),
    },
    roleId: user.roleId,
    roleCode: user.role.code,
    roleName: user.role.name,
    permissions,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    organizationCategory: user.organization.category as OrganizationCategory,
    professionalLicenseType: user.professionalLicenseType,
    professionalLicenseNumber: user.professionalLicenseNumber,
    mustChangePassword: user.mustChangePassword,
  };
}

function issueWebToken(user: { id: string; tenantId: string; tokenVersion: number }) {
  return signWebUserToken({
    userId: user.id,
    tenantId: user.tenantId,
    tokenVersion: user.tokenVersion,
  });
}

export async function getWebUserProfileById(
  userId: string
): Promise<WebUserProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: WEB_USER_AUTH_INCLUDE,
  });

  if (!user || !user.isActive) return null;
  return serializeWebUserProfile(user);
}

/**
 * DEMO_MODE only (D-2.1). The route is not mounted otherwise.
 * Self-registration may not pick a role that holds any tenant-administration permission.
 */
export async function registerWebUser(input: WebRegisterRequest) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (existing) {
    throw new AppError('A user with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: input.tenantSlug.trim().toLowerCase() },
  });
  if (!tenant || tenant.status === 'SUSPENDED') {
    throw new AppError('Target tenant workspace not found', 404, 'TENANT_NOT_FOUND');
  }

  const targetRole = await prisma.role.findFirst({
    where: {
      tenantId: tenant.id,
      surface: { in: ['WEB', 'BOTH'] },
      ...(input.roleId
        ? { id: input.roleId }
        : { code: (input.roleCode || 'MONITOR').toUpperCase() }),
      rolePermissions: { none: { permission: { category: 'TENANT_ADMIN' } } },
    },
  });

  if (!targetRole) {
    throw new AppError(
      'Assigned role not found or not available for self-registration',
      404,
      'ROLE_NOT_FOUND'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const createdUserId = await prisma.$transaction(async (tx) => {
    let organization = await tx.organization.findFirst({
      where: {
        tenantId: tenant.id,
        name: { equals: input.organizationName, mode: 'insensitive' },
      },
    });

    if (!organization) {
      organization = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: input.organizationName,
          category: input.organizationCategory ?? 'OTHER',
        },
      });
    }

    const created = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email.toLowerCase(),
        passwordHash,
        fullName: input.fullName,
        roleId: targetRole.id,
        organizationId: organization.id,
        professionalLicenseType: input.professionalLicenseType ?? null,
        professionalLicenseNumber: input.professionalLicenseNumber ?? null,
      },
    });

    return created.id;
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: createdUserId },
    include: WEB_USER_AUTH_INCLUDE,
  });

  return {
    accessToken: issueWebToken(user),
    user: serializeWebUserProfile(user),
  };
}

function invalidCredentials() {
  return new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
}

export async function loginWebUser(input: WebLoginRequest) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: WEB_USER_AUTH_INCLUDE,
  });

  if (!user || !user.isActive) {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError(
      'Too many failed sign-in attempts. Try again later.',
      423,
      'ACCOUNT_LOCKED'
    );
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!isPasswordValid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: shouldLock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }
        : { failedLoginCount },
    });
    if (shouldLock) {
      await recordAuditEvent(prisma, {
        tenantId: user.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: user.id,
        actorDisplayName: user.fullName,
        action: 'LOGIN_FAILED_LOCKOUT',
        summaryText: `Account ${user.email} locked for ${LOCKOUT_DURATION_MS / 60000} minutes after ${MAX_FAILED_LOGINS} failed sign-in attempts.`,
        payload: { userId: user.id, lockedForMinutes: LOCKOUT_DURATION_MS / 60000 },
      });
    }
    throw invalidCredentials();
  }

  if (user.tenant.status === 'SUSPENDED' && !user.isPlatformSuperAdmin) {
    throw new AppError('This workspace has been suspended', 403, 'TENANT_SUSPENDED');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  return {
    accessToken: issueWebToken(user),
    user: serializeWebUserProfile(user),
  };
}

/**
 * Changes the caller's password, clears `mustChangePassword`, and bumps `tokenVersion` so every
 * other session for this user is revoked. Returns a fresh token for the current session.
 */
export async function changeWebUserPassword(userId: string, input: ChangePasswordRequest) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_INACTIVE');
  }

  const isCurrentValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_CURRENT_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
    include: WEB_USER_AUTH_INCLUDE,
  });
  invalidateUserAuthCache(userId);

  return {
    accessToken: issueWebToken(updated),
    user: serializeWebUserProfile(updated),
  };
}

function buildMobileSessionResponse(
  project: {
    id: string;
    tenantId: string;
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
  role: {
    id: string;
    code: string;
    name: string;
    fieldPersonaType: string;
    assuranceWeight: number;
    requiresIdentityAssurance: boolean;
    rolePermissions: Array<{ permission: { key: string } }>;
  },
  session: {
    id: string;
    projectId: string;
    agentFullName: string;
    agentPhoneNumber: string;
    deviceId: string;
    assuranceStatus: string;
    corenLicenseNumber: string | null;
    livenessPassed: boolean;
  },
  normalizedCode: string
) {
  const permissions = role.rolePermissions.map((rp) => rp.permission.key);
  const fieldPersonaType = role.fieldPersonaType as FieldPersonaType;

  const accessToken = signFieldAgentToken({ sessionId: session.id });

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
      tenantId: project.tenantId,
      projectId: project.id,
      projectName: project.name,
      projectCodePrefix: project.codePrefix,
      joinCodeUsed: normalizedCode,
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name,
      fieldPersonaType,
      assuranceWeight: role.assuranceWeight,
      requiresIdentityAssurance: role.requiresIdentityAssurance,
      permissions,
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

function assertJoinCodeUsable(
  record: {
    isActive: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
    role: { surface: string };
    project: { tenant: { status: string } };
  } | null,
  normalizedCode: string
): asserts record is NonNullable<typeof record> {
  if (!record || !record.isActive || record.role.surface === 'WEB') {
    throw new AppError(
      `Project Join Code "${normalizedCode}" is invalid or has been deactivated.`,
      404,
      'INVALID_JOIN_CODE'
    );
  }
  if (record.project.tenant.status === 'SUSPENDED') {
    throw new AppError('This workspace has been suspended', 403, 'TENANT_SUSPENDED');
  }
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    throw new AppError(
      `Project Join Code "${normalizedCode}" has expired.`,
      403,
      'EXPIRED_JOIN_CODE'
    );
  }
  if (record.maxUses !== null && record.useCount >= record.maxUses) {
    throw new AppError(
      `Project Join Code "${normalizedCode}" is no longer available.`,
      403,
      'JOIN_CODE_EXHAUSTED'
    );
  }
}

export async function joinProjectMobile(input: JoinProjectMobileRequest) {
  const normalizedCode = input.joinCode.trim().toUpperCase();

  const joinCodeRecord = await prisma.projectJoinCode.findUnique({
    where: { code: normalizedCode },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
      project: {
        include: {
          tenant: { select: { status: true } },
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

  assertJoinCodeUsable(joinCodeRecord, normalizedCode);

  const pinHash = input.agentPin
    ? await bcrypt.hash(input.agentPin, 8)
    : null;

  const role = joinCodeRecord.role;
  const requiresAssurance = role.requiresIdentityAssurance;
  const initialAssuranceStatus = requiresAssurance
    ? 'PENDING_APPROVAL'
    : 'APPROVED';

  const session = await prisma.$transaction(async (tx) => {
    // Claim one use atomically so concurrent joins cannot exceed maxUses.
    const claimed = await tx.projectJoinCode.updateMany({
      where: {
        id: joinCodeRecord.id,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(joinCodeRecord.maxUses !== null
          ? { useCount: { lt: joinCodeRecord.maxUses } }
          : {}),
      },
      data: { useCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new AppError(
        `Project Join Code "${normalizedCode}" is no longer available.`,
        403,
        'JOIN_CODE_EXHAUSTED'
      );
    }

    const createdSession = await tx.fieldAgentSession.create({
      data: {
        projectId: joinCodeRecord.projectId,
        joinCodeId: joinCodeRecord.id,
        roleId: role.id,
        roleNameSnapshot: role.name,
        fieldPersonaType: role.fieldPersonaType,
        assuranceWeight: role.assuranceWeight,
        agentFullName: input.agentFullName,
        agentPhoneNumber: input.agentPhoneNumber,
        agentPinHash: pinHash,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel ?? null,
        deviceOs: input.deviceOs ?? null,
        deviceSecretHash: input.devicePublicKeyOrSecretHash ?? null,
        lastSyncAt: new Date(),
        assuranceStatus: initialAssuranceStatus,
        // Identity evidence and liveness are accepted only via /auth/assurance-verification.
        idDocumentType:
          input.idDocumentType ??
          (requiresAssurance ? 'National Identity (NIN)' : null),
        livenessPassed: false,
        corenLicenseNumber: input.corenLicenseNumber ?? null,
        experienceSummary: input.experienceSummary ?? null,
      },
    });

    await recordAuditEvent(tx, {
      projectId: joinCodeRecord.projectId,
      actorType: 'FIELD_AGENT',
      actorId: createdSession.id,
      actorDisplayName: `${input.agentFullName} (${role.name})`,
      action: requiresAssurance
        ? 'CONTRACTOR_ASSURANCE_SUBMITTED'
        : 'FIELD_AGENT_JOINED',
      summaryText: requiresAssurance
        ? `${role.name} ${input.agentFullName} submitted identity & license (${input.corenLicenseNumber || 'Credentials'}) for project ${joinCodeRecord.project.codePrefix} — Awaiting verification.`
        : `Field reporter ${input.agentFullName} joined project ${joinCodeRecord.project.codePrefix} using code ${normalizedCode} as ${role.name}.`,
      payload: {
        joinCode: normalizedCode,
        roleId: role.id,
        roleCode: role.code,
        roleName: role.name,
        fieldPersonaType: role.fieldPersonaType,
        agentPhoneNumber: input.agentPhoneNumber,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel ?? null,
        assuranceStatus: initialAssuranceStatus,
        corenLicenseNumber: input.corenLicenseNumber ?? null,
      },
    });

    return createdSession;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    role,
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
      role: {
        include: {
          rolePermissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
      project: {
        include: {
          tenant: { select: { status: true } },
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
  const role = joinCodeRecord.role;

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
            roleId: role.id,
            roleNameSnapshot: role.name,
            fieldPersonaType: role.fieldPersonaType,
            assuranceWeight: role.assuranceWeight,
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
            roleId: role.id,
            roleNameSnapshot: role.name,
            fieldPersonaType: role.fieldPersonaType,
            assuranceWeight: role.assuranceWeight,
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
      actorDisplayName: `${updatedOrCreated.agentFullName} (${role.name})`,
      action: 'CONTRACTOR_ASSURANCE_APPROVED',
      summaryText: `[DEMO ONLY] Verification skipped — linked ${updatedOrCreated.agentFullName} directly to project ${joinCodeRecord.project.codePrefix} (${normalizedCode}).`,
      payload: {
        demoBypass: true,
        joinCode: normalizedCode,
        sessionId: updatedOrCreated.id,
        roleId: role.id,
        roleName: role.name,
      },
    });

    return updatedOrCreated;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    role,
    session,
    normalizedCode
  );
}
