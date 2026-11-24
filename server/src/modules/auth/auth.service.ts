import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import {
  ChangePasswordRequest,
  DEVICE_SIGNATURE_ALGORITHM,
  MobileAccountProfile,
  MobileBaselinePack,
  MobileLoginRequest,
  MobileLoginResponse,
  MobileTenantBranding,
  resolveTerminology,
  WebLoginRequest,
  WebRegisterRequest,
  WebUserProfile,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  invalidateUserAuthCache,
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
import { parseTenantBranding } from '../rbac/rbac.service';
import { parseDevicePublicKey } from '../../utils/deviceSignature';
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
    mustChangePassword: user.mustChangePassword,
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
  constructionPhase?: string;
  tenant: { defaultGeofenceToleranceMeters: number };
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
};

/** The offline baseline for one project, as the baseline endpoint serves it. */
export function buildBaselinePack(project: BaselineProject): MobileBaselinePack {
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
export async function getProjectBaselinePack(projectId: string): Promise<MobileBaselinePack> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      boqItems: { orderBy: { wbsCode: 'asc' } },
      tenant: { select: { defaultGeofenceToleranceMeters: true } },
    },
  });
  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }
  return buildBaselinePack(project);
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

