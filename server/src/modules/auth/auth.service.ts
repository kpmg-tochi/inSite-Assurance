import bcrypt from 'bcryptjs';
import {
  ChangePasswordRequest,
  DEVICE_SIGNATURE_ALGORITHM,
  RegisterDeviceKeyRequest,
  DemoSkipVerificationRequest,
  FieldPersonaType,
  JoinProjectMobileRequest,
  MobileAccountProfile,
  MobileBaselinePack,
  MobileLoginRequest,
  MobileLoginResponse,
  MobileTenantBranding,
  SessionContractor,
  resolveRatingLabels,
  resolveTerminology,
  WebLoginRequest,
  WebRegisterRequest,
  WebUserProfile,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  invalidateUserAuthCache,
  signFieldAgentToken,
  signMobileUserToken,
  signWebUserToken,
} from '../../middleware/auth.middleware';
import {
  listMobileProjects,
  MOBILE_USER_INCLUDE,
  type MobileUserRow,
  requireEffectiveMobileRole,
  roleSummary,
} from './mobileAccess';
import { primaryCategory, resolveOrganization } from '../organizations/organizations.service';
import { recordAuditEvent } from '../audit/audit.service';
import { getProcessConfig } from '../process/processConfig.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { parseDevicePublicKey } from '../../utils/deviceSignature';
import { syncParticipantForSession } from '../mobilization/participants.service';
import { CadenceProjectRow, serializeCadenceSettings } from '../cadence/cadence.service';

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
    organizationCategory: primaryCategory(user.organization.categories),
    professionalLicenseType: user.professionalLicenseType,
    professionalLicenseNumber: user.professionalLicenseNumber,
    mustChangePassword: user.mustChangePassword,
    ratingLabels: resolveRatingLabels(user.tenant.evidenceRatingLabels),
    terminology: resolveTerminology(user.tenant.terminologyLabels),
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
    const { organization } = await resolveOrganization(
      tx,
      tenant.id,
      { name: input.organizationName },
      input.organizationCategory ?? 'OTHER'
    );

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

/**
 * Password check shared by web and mobile sign-in: the same lockout, timing equaliser and
 * tenant-status rules. Returns the user id on success.
 */
async function verifyPasswordLogin(email: string, password: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { tenant: { select: { status: true } } },
  });
  const input = { password };

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
  return user.id;
}

export async function loginWebUser(input: WebLoginRequest) {
  const userId = await verifyPasswordLogin(input.email, input.password);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: WEB_USER_AUTH_INCLUDE,
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
  await applyPasswordChange(userId, input);
  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: WEB_USER_AUTH_INCLUDE,
  });
  return {
    accessToken: issueWebToken(updated),
    user: serializeWebUserProfile(updated),
  };
}

/**
 * Sets a new password, clears `mustChangePassword` and bumps `tokenVersion`, which ends every web
 * and mobile token of the user. The caller issues a fresh token for the current device.
 */
async function applyPasswordChange(userId: string, input: ChangePasswordRequest): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_INACTIVE');
  }

  const isCurrentValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_CURRENT_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });
  invalidateUserAuthCache(userId);
}

// ---------------------------------------------------------------------------
// Provisioned mobile accounts (Phase 5)
// ---------------------------------------------------------------------------

function serializeMobileAccount(user: MobileUserRow, mobileDeviceId: string): MobileAccountProfile {
  const role = requireEffectiveMobileRole(user);
  return {
    userId: user.id,
    tenantId: user.tenantId,
    fullName: user.fullName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    organizationName: user.organization.name,
    mustChangePassword: user.mustChangePassword,
    mobileDeviceId,
    mobileRole: roleSummary(role),
    ratingLabels: resolveRatingLabels(user.tenant.evidenceRatingLabels),
    tenantBranding: mobileTenantBranding(user.tenant),
  };
}

/**
 * POST /auth/mobile/login. Same credential, lockout and tenant checks as the web. Refuses users
 * without a pre-provisioned mobile role (NO_MOBILE_ACCESS) and revoked devices (DEVICE_REVOKED).
 * Registers the device and its signing key; a new key on a known device (reinstall) replaces the
 * old one on the device and on its sessions, since a password sign-in proves the account.
 */
export async function loginMobileUser(input: MobileLoginRequest): Promise<MobileLoginResponse> {
  const userId = await verifyPasswordLogin(input.email, input.password);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: MOBILE_USER_INCLUDE });
  const role = requireEffectiveMobileRole(user);
  const key = parseDevicePublicKey(input.devicePublicKey, input.devicePublicKeyAlg);

  const existing = await prisma.mobileDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId: input.deviceId } },
  });
  if (existing?.revokedAt) {
    throw new AppError(
      'This device has been revoked for your account. Contact your administrator.',
      403,
      'DEVICE_REVOKED'
    );
  }

  const device = await prisma.$transaction(async (tx) => {
    const row = await tx.mobileDevice.upsert({
      where: { userId_deviceId: { userId, deviceId: input.deviceId } },
      create: {
        userId,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel ?? null,
        deviceOs: input.deviceOs ?? null,
        publicKey: key.publicKey,
        publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        publicKeyId: key.keyId,
        lastSeenAt: new Date(),
      },
      update: {
        deviceModel: input.deviceModel ?? existing?.deviceModel ?? null,
        deviceOs: input.deviceOs ?? existing?.deviceOs ?? null,
        publicKey: key.publicKey,
        publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        publicKeyId: key.keyId,
        lastSeenAt: new Date(),
      },
    });
    const keyReplaced = Boolean(existing && existing.publicKeyId !== key.keyId);
    if (keyReplaced) {
      await tx.fieldAgentSession.updateMany({
        where: { userId, mobileDeviceId: row.id },
        data: {
          devicePublicKey: key.publicKey,
          devicePublicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
          devicePublicKeyId: key.keyId,
          devicePublicKeyAddedAt: new Date(),
        },
      });
    }
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: user.id,
      actorDisplayName: `${user.fullName} (${role.name})`,
      action: 'MOBILE_USER_SIGNED_IN',
      summaryText: `${user.fullName} signed in to the mobile app on ${input.deviceModel ?? input.deviceId}${
        existing ? '' : ' (new device)'
      }${keyReplaced ? '; device signing key replaced' : ''}.`,
      payload: {
        userId: user.id,
        mobileDeviceId: row.id,
        deviceId: input.deviceId,
        newDevice: !existing,
        keyReplaced,
        devicePublicKeyId: key.keyId,
      },
    });
    return row;
  });
  invalidateUserAuthCache(userId);

  return {
    accessToken: signMobileUserToken({
      userId: user.id,
      tenantId: user.tenantId,
      deviceRowId: device.id,
      tokenVersion: user.tokenVersion,
    }),
    account: serializeMobileAccount(user, device.id),
    projects: await listMobileProjects(user),
  };
}

async function loadMobileUser(userId: string): Promise<MobileUserRow> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: MOBILE_USER_INCLUDE });
  if (!user || !user.isActive) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_INACTIVE');
  }
  return user;
}

/** Account and visible projects for a signed-in mobile user (GET /auth/me, /auth/mobile/projects). */
export async function getMobileAccountAndProjects(userId: string, mobileDeviceId: string) {
  const user = await loadMobileUser(userId);
  return {
    account: serializeMobileAccount(user, mobileDeviceId),
    projects: await listMobileProjects(user),
  };
}

/** POST /auth/mobile/change-password: same rules as the web; returns a fresh mobile token. */
export async function changeMobileUserPassword(
  principal: { userId: string; deviceRowId: string },
  input: ChangePasswordRequest
) {
  await applyPasswordChange(principal.userId, input);
  const user = await loadMobileUser(principal.userId);
  return {
    accessToken: signMobileUserToken({
      userId: user.id,
      tenantId: user.tenantId,
      deviceRowId: principal.deviceRowId,
      tokenVersion: user.tokenVersion,
    }),
    account: serializeMobileAccount(user, principal.deviceRowId),
  };
}

/** POST /auth/mobile/logout: the device stops receiving this account's pushes. */
export async function logoutMobileUser(principal: { userId: string; deviceRowId: string }) {
  await prisma.pushToken.deleteMany({
    where: { userId: principal.userId, mobileDeviceId: principal.deviceRowId },
  });
}

type BaselineProject = CadenceProjectRow & {
  id: string;
  name: string;
  codePrefix: string;
  stateLocation: string | null;
  reportingCadence: string;
  timezone: string;
  geofenceMode: string | null;
  geofenceGeoJson: unknown;
  geofenceToleranceMeters: number | null;
  contractorExecutionMode: string | null;
  constructionPhase?: string;
  tenant: { defaultGeofenceToleranceMeters: number };
  boqItems: Array<{
    id: string;
    projectContractorId: string | null;
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
};

/**
 * The offline baseline for one project, as join returns it and the baseline endpoint serves it.
 * In a multi-prime project a session bound to a contractor gets only that contractor's items.
 */
export function buildBaselinePack(
  project: BaselineProject,
  scope: { projectContractorId?: string | null } = {}
): MobileBaselinePack {
  const scoped =
    project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC' && scope.projectContractorId
      ? project.boqItems.filter((item) => item.projectContractorId === scope.projectContractorId)
      : project.boqItems;
  const boqItems = scoped.map((item) => ({
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
    projectId: project.id,
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation ?? '',
    reportingCadence: project.reportingCadence as MobileBaselinePack['reportingCadence'],
    timezone: project.timezone,
    // Phase 8: the app computes the current period with the shared module from these settings.
    cadence: serializeCadenceSettings(project),
    geofenceMode: project.geofenceMode as MobileBaselinePack['geofenceMode'],
    geofence: project.geofenceGeoJson as MobileBaselinePack['geofence'],
    geofenceToleranceMeters: project.geofenceToleranceMeters ?? project.tenant.defaultGeofenceToleranceMeters,
    boqItems,
    holdPoints: boqItems.filter((b) => b.isHoldPoint),
    // Phase 10: lets the app offer defect work once construction has ended.
    constructionPhase: (project.constructionPhase ?? 'ACTIVE_CONSTRUCTION') as MobileBaselinePack['constructionPhase'],
  };
}

/** GET /auth/mobile/projects/:projectId/baseline. Access is checked by the field auth guard. */
export async function getProjectBaselinePack(projectId: string, sessionId?: string): Promise<MobileBaselinePack> {
  const [project, session] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        boqItems: { orderBy: { wbsCode: 'asc' } },
        tenant: { select: { defaultGeofenceToleranceMeters: true } },
      },
    }),
    sessionId
      ? prisma.fieldAgentSession.findUnique({ where: { id: sessionId }, select: { projectContractorId: true } })
      : null,
  ]);
  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }
  return buildBaselinePack(project, { projectContractorId: session?.projectContractorId ?? null });
}

type SessionContractorRow = {
  id: string;
  tradeCategory: string;
  tradeCode: string;
  isMainContractor: boolean;
  organization: { name: string };
} | null;

export function serializeSessionContractor(c: SessionContractorRow): SessionContractor | null {
  if (!c) return null;
  return {
    projectContractorId: c.id,
    organizationName: c.organization.name,
    tradeCategory: c.tradeCategory,
    tradeCode: c.tradeCode,
    isMainContractor: c.isMainContractor,
  };
}

/** Tenant branding for the mobile app (Phase 6). */
export function mobileTenantBranding(tenant: {
  name: string;
  brandingConfig: unknown;
  defaultCurrency: string;
  terminologyLabels: unknown;
}): MobileTenantBranding {
  const branding = parseTenantBranding(tenant.brandingConfig);
  return {
    tenantName: tenant.name,
    logoUrl: branding.logoUrl ?? null,
    primaryColorHex: branding.primaryColorHex,
    currency: tenant.defaultCurrency,
    // Phase 11: tenant wording for domain terms.
    terminology: resolveTerminology(tenant.terminologyLabels),
  };
}

const SESSION_CONTRACTOR_SELECT = {
  select: {
    id: true,
    tradeCategory: true,
    tradeCode: true,
    isMainContractor: true,
    allowFieldReporting: true,
    organization: { select: { name: true } },
  },
} as const;

function buildMobileSessionResponse(
  project: CadenceProjectRow & {
    id: string;
    tenantId: string;
    tenant: {
      evidenceRatingLabels: unknown;
      terminologyLabels: unknown;
      name: string;
      brandingConfig: unknown;
      defaultCurrency: string;
      defaultGeofenceToleranceMeters: number;
    };
    name: string;
    codePrefix: string;
    stateLocation: string | null;
    reportingCadence: string;
    timezone: string;
    geofenceMode: string | null;
    geofenceGeoJson: unknown;
    geofenceToleranceMeters: number | null;
    contractorExecutionMode: string | null;
    boqItems: Array<{
      id: string;
      projectContractorId: string | null;
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
    projectContractorId: string | null;
  },
  normalizedCode: string,
  contractor: SessionContractorRow = null
) {
  const permissions = role.rolePermissions.map((rp) => rp.permission.key);
  const fieldPersonaType = role.fieldPersonaType as FieldPersonaType;

  const accessToken = signFieldAgentToken({ sessionId: session.id });

  return {
    accessToken,
    sessionProfile: {
      sessionId: session.id,
      tenantId: project.tenantId,
      projectId: project.id,
      projectName: project.name,
      projectCodePrefix: project.codePrefix,
      joinCodeUsed: normalizedCode,
      origin: 'JOIN_CODE' as const,
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
      ratingLabels: resolveRatingLabels(project.tenant.evidenceRatingLabels),
      contractor: serializeSessionContractor(contractor),
      tenantBranding: mobileTenantBranding(project.tenant),
    },
    baselinePack: buildBaselinePack(project, { projectContractorId: session.projectContractorId }),
  };
}

function assertJoinCodeUsable(
  record: {
    isActive: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
    role: { surface: string };
    project: { status: string; tenant: { status: string } };
    projectContractor?: { allowFieldReporting: boolean } | null;
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
  // Drafts have no codes; an archived project's codes are deactivated, but check anyway.
  if (record.project.status !== 'ACTIVE' || record.projectContractor?.allowFieldReporting === false) {
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
      projectContractor: SESSION_CONTRACTOR_SELECT,
      role: {
        include: {
          rolePermissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
      project: {
        include: {
          tenant: {
            select: {
              status: true,
              evidenceRatingLabels: true,
              terminologyLabels: true,
              name: true,
              brandingConfig: true,
              defaultCurrency: true,
              defaultGeofenceToleranceMeters: true,
            },
          },
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

  const deviceKey = input.devicePublicKey
    ? parseDevicePublicKey(input.devicePublicKey, input.devicePublicKeyAlg ?? DEVICE_SIGNATURE_ALGORITHM)
    : null;

  const role = joinCodeRecord.role;
  // Phase 7: the project may switch the identity check off whatever the role says.
  const requiresAssurance =
    role.requiresIdentityAssurance &&
    (await getProcessConfig(joinCodeRecord.projectId)).enableContractorIdentityAssurance;
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
        projectContractorId: joinCodeRecord.projectContractorId,
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
        ...(deviceKey
          ? {
              devicePublicKey: deviceKey.publicKey,
              devicePublicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
              devicePublicKeyId: deviceKey.keyId,
              devicePublicKeyAddedAt: new Date(),
            }
          : {}),
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
    // Phase 8: link to the expected participant with this phone number.
    await syncParticipantForSession(tx, createdSession.id);

    return createdSession;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    role,
    session,
    normalizedCode,
    joinCodeRecord.projectContractor
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
      projectContractor: SESSION_CONTRACTOR_SELECT,
      role: {
        include: {
          rolePermissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
      project: {
        include: {
          tenant: {
            select: {
              status: true,
              evidenceRatingLabels: true,
              terminologyLabels: true,
              name: true,
              brandingConfig: true,
              defaultCurrency: true,
              defaultGeofenceToleranceMeters: true,
            },
          },
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
            livenessPassed: false,
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
            livenessPassed: false,
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
    await syncParticipantForSession(tx, updatedOrCreated.id);

    return updatedOrCreated;
  });

  return buildMobileSessionResponse(
    joinCodeRecord.project,
    role,
    session,
    normalizedCode,
    joinCodeRecord.projectContractor
  );
}

/**
 * POST /auth/device-key
 * Registers the per-install signing key on a session that has none. A key is never replaced through
 * this endpoint: a stolen token must not be able to swap the device key.
 */
export async function registerDeviceKey(
  fieldAgent: { sessionId: string; projectId: string; agentFullName: string; roleName: string },
  input: RegisterDeviceKeyRequest
) {
  const key = parseDevicePublicKey(input.devicePublicKey, input.devicePublicKeyAlg);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.fieldAgentSession.updateMany({
      where: { id: fieldAgent.sessionId, devicePublicKey: null },
      data: {
        devicePublicKey: key.publicKey,
        devicePublicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        devicePublicKeyId: key.keyId,
        devicePublicKeyAddedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const current = await tx.fieldAgentSession.findUniqueOrThrow({
        where: { id: fieldAgent.sessionId },
        select: { devicePublicKeyId: true },
      });
      if (current.devicePublicKeyId === key.keyId) {
        return { devicePublicKeyId: key.keyId, alreadyRegistered: true };
      }
      throw new AppError('A different device key is already registered for this session', 409, 'DEVICE_KEY_ALREADY_REGISTERED');
    }
    await recordAuditEvent(tx, {
      projectId: fieldAgent.projectId,
      actorType: 'FIELD_AGENT',
      actorId: fieldAgent.sessionId,
      actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
      action: 'DEVICE_KEY_REGISTERED',
      summaryText: 'Registered device signing key.',
      payload: { devicePublicKeyId: key.keyId, alg: DEVICE_SIGNATURE_ALGORITHM },
    });
    return { devicePublicKeyId: key.keyId, alreadyRegistered: false };
  });
}
