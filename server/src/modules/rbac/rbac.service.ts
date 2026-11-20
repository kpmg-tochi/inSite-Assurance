import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import {
  AssignUserProjectsRequest,
  CreateRoleRequest,
  CreateTenantRequest,
  CreateTenantUserRequest,
  DEFAULT_TENANT_ROLES,
  MobileDeviceDto,
  RoleOnboardingImpactDto,
  RoleOnboardingMode,
  parseEvidenceRatingLabels,
  resolveRatingLabels,
  UpdateEvidenceRatingLabelsRequest,
  SEGREGATED_DISBURSEMENT_PERMISSIONS,
  FieldPersonaType,
  OrganizationCategory,
  PermissionCategory,
  RoleSurface,
  TenantBrandingConfig,
  TenantBrandingConfigSchema,
  UpdateRoleRequest,
  UpdateTenantBrandingRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  clearAuthCache,
  invalidateUserAuthCache,
  WebJwtPayload,
} from '../../middleware/auth.middleware';
import { primaryCategory, resolveOrganization } from '../organizations/organizations.service';
import { recordAuditEvent } from '../audit/audit.service';
import { seedStarterTemplates } from '../process/workflowTemplates.service';
import { provisionDefaultRegistrationBodies } from '../credentials/registrationBodies.service';
import { normaliseProfileRegistration } from '../credentials/credentialPolicy.service';
import { issueJoinCodesForRoleOnAllProjects } from '../projects/joinCodes.service';
import { sendPushToMobileUser } from '../../integrations/push.service';

type Tx = Prisma.TransactionClient;

/** Neutral InSite default for tenants without their own branding (no client marks). */
export const DEFAULT_BRANDING_CONFIG: TenantBrandingConfig = {
  logoUrl: null,
  primaryColorHex: '#00338D',
  navyColorHex: '#0C233C',
  tagline: 'Field Evidence Assurance',
  pdfHeaderTitle: 'InSite Assurance — Disbursement Evidence & Valuation Report',
  pdfFooterDisclaimer:
    'Independent Project Monitoring Certification | Powered by InSite Assurance',
};

/** The permission that makes someone a tenant administrator for lock-out protection. */
const ROLE_ADMIN_PERMISSION = 'roles:create_edit';

export function parseTenantBranding(raw: unknown): TenantBrandingConfig {
  const parsed = TenantBrandingConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_BRANDING_CONFIG;
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

const ROLE_DETAIL_INCLUDE = {
  rolePermissions: {
    include: { permission: true },
    orderBy: { permission: { key: 'asc' } },
  },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

type RoleWithDetail = Prisma.RoleGetPayload<{ include: typeof ROLE_DETAIL_INCLUDE }>;

function serializeRole(r: RoleWithDetail) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    code: r.code,
    codeSuffix: r.codeSuffix,
    description: r.description,
    surface: r.surface as RoleSurface,
    fieldPersonaType: r.fieldPersonaType as FieldPersonaType,
    assuranceWeight: r.assuranceWeight,
    requiresIdentityAssurance: r.requiresIdentityAssurance,
    onboardingMode: r.onboardingMode as RoleOnboardingMode,
    isSystemDefault: r.isSystemDefault,
    permissions: r.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      key: rp.permission.key,
      name: rp.permission.name,
      description: rp.permission.description,
      category: rp.permission.category as PermissionCategory,
      surface: rp.permission.surface as RoleSurface,
    })),
    userCount: r._count.users,
  };
}

function serializeTenant(t: Prisma.TenantGetPayload<object>) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    defaultCurrency: t.defaultCurrency,
    timezone: t.timezone,
    brandingConfig: parseTenantBranding(t.brandingConfig),
    createdAt: t.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Guard rails (Phase 2 Step 6). Platform super admins are exempt from all of these.
// ---------------------------------------------------------------------------

async function permissionKeysForIds(db: Tx | typeof prisma, ids: string[]) {
  const rows = await db.permission.findMany({
    where: { id: { in: ids } },
    select: { id: true, key: true },
  });
  if (rows.length !== new Set(ids).size) {
    throw new AppError('One or more permission IDs are invalid', 400, 'INVALID_PERMISSIONS');
  }
  return rows.map((r) => r.key);
}

async function permissionKeysForRole(db: Tx | typeof prisma, roleId: string) {
  const rows = await db.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key);
}

/**
 * Throws if `keys` contains a permission the caller does not hold.
 *
 * D-3.1: the segregated disbursement permissions (certify, approve) are deliberately not held by
 * tenant administrators, who must still be able to assign the Monitor and Lender roles. They are
 * exempt here unless the change would give them to the caller (`affectsSelf`): the caller's own
 * role or the caller's own account. The platform super admin is subject to the same self rule.
 */
function assertCallerHoldsAll(
  webUser: WebJwtPayload,
  keys: string[],
  context: string,
  opts: { affectsSelf?: boolean } = {}
) {
  const checked = keys.filter(
    (k) => opts.affectsSelf || !SEGREGATED_DISBURSEMENT_PERMISSIONS.includes(k)
  );
  const missing = webUser.isPlatformSuperAdmin
    ? opts.affectsSelf
      ? checked.filter(
          (k) => SEGREGATED_DISBURSEMENT_PERMISSIONS.includes(k) && !webUser.permissions.includes(k)
        )
      : []
    : checked.filter((k) => !webUser.permissions.includes(k));
  if (missing.length > 0) {
    throw new AppError(
      `${context}: you cannot grant permissions you do not hold (${missing.join(', ')})`,
      403,
      'PERMISSION_ESCALATION'
    );
  }
}

/**
 * Throws if, after the pending changes in `tx`, the tenant has no active user whose role holds
 * `roles:create_edit`. Call inside the mutating transaction so the change is rolled back.
 */
async function assertTenantKeepsRoleAdmin(tx: Tx, webUser: WebJwtPayload, tenantId: string) {
  if (webUser.isPlatformSuperAdmin) return;
  const remaining = await tx.user.count({
    where: {
      tenantId,
      isActive: true,
      role: { rolePermissions: { some: { permission: { key: ROLE_ADMIN_PERMISSION } } } },
    },
  });
  if (remaining === 0) {
    throw new AppError(
      'This change would leave the tenant with no active user who can manage roles.',
      409,
      'LAST_TENANT_ADMIN'
    );
  }
}

// ---------------------------------------------------------------------------
// Default roles (single definition in @insite/shared)
// ---------------------------------------------------------------------------

/**
 * Creates the default role set for a tenant from `DEFAULT_TENANT_ROLES` and returns them by code.
 * Used by tenant provisioning and by the database seed.
 */
export async function provisionDefaultRoles(db: Tx | typeof prisma, tenantId: string) {
  const allPermissions = await db.permission.findMany({ select: { id: true, key: true } });
  const permIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  const byCode = new Map<string, Prisma.RoleGetPayload<object>>();
  for (const def of DEFAULT_TENANT_ROLES) {
    const role = await db.role.create({
      data: {
        tenantId,
        name: def.name,
        code: def.code,
        codeSuffix: def.codeSuffix,
        description: def.description,
        surface: def.surface,
        fieldPersonaType: def.fieldPersonaType,
        assuranceWeight: def.assuranceWeight,
        requiresIdentityAssurance: def.requiresIdentityAssurance,
        isSystemDefault: true,
      },
    });
    const missing = def.permissionKeys.filter((k) => !permIdByKey.has(k));
    if (missing.length > 0) {
      throw new Error(`Default role ${def.code} references unknown permissions: ${missing.join(', ')}`);
    }
    await db.rolePermission.createMany({
      data: def.permissionKeys.map((k) => ({ roleId: role.id, permissionId: permIdByKey.get(k)! })),
    });
    byCode.set(def.code, role);
  }
  return byCode;
}

// ---------------------------------------------------------------------------
// Permissions and roles
// ---------------------------------------------------------------------------

export async function listAllPermissions() {
  const rows = await prisma.permission.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });

  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    category: p.category as PermissionCategory,
    surface: p.surface as RoleSurface,
  }));
}

export async function listRolesForTenant(tenantId: string) {
  const roles = await prisma.role.findMany({
    where: { tenantId },
    include: ROLE_DETAIL_INCLUDE,
    orderBy: [{ isSystemDefault: 'desc' }, { name: 'asc' }],
  });
  return roles.map(serializeRole);
}

async function assertCodeSuffixAvailable(
  tenantId: string,
  codeSuffix: string | null | undefined,
  excludeRoleId?: string
) {
  if (!codeSuffix) return;
  const clash = await prisma.role.findFirst({
    where: { tenantId, codeSuffix, ...(excludeRoleId ? { id: { not: excludeRoleId } } : {}) },
    select: { name: true },
  });
  if (clash) {
    throw new AppError(
      `Join-code suffix "${codeSuffix}" is already used by role "${clash.name}"`,
      409,
      'DUPLICATE_ROLE_SUFFIX'
    );
  }
}

export async function createRoleForTenant(webUser: WebJwtPayload, input: CreateRoleRequest) {
  const tenantId = webUser.tenantId;
  const code = input.code.trim().toUpperCase();
  const codeSuffix = input.codeSuffix ? input.codeSuffix.trim().toUpperCase() : null;

  const existing = await prisma.role.findUnique({
    where: { tenantId_code: { tenantId, code } },
  });
  if (existing) {
    throw new AppError(
      `A role with code "${code}" already exists in this tenant`,
      409,
      'DUPLICATE_ROLE_CODE'
    );
  }
  await assertCodeSuffixAvailable(tenantId, codeSuffix);

  const keys = await permissionKeysForIds(prisma, input.permissionIds);
  assertCallerHoldsAll(webUser, keys, 'Create role');

  const created = await prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        tenantId,
        name: input.name.trim(),
        code,
        codeSuffix,
        description: input.description ?? null,
        surface: input.surface,
        fieldPersonaType: input.fieldPersonaType,
        assuranceWeight: input.assuranceWeight,
        // Decision G: a pre-provisioned role never requires identity assurance.
        requiresIdentityAssurance:
          input.onboardingMode === 'PROVISIONED_ACCOUNT' ? false : input.requiresIdentityAssurance,
        onboardingMode: input.onboardingMode,
        isSystemDefault: false,
      },
    });

    await tx.rolePermission.createMany({
      data: [...new Set(input.permissionIds)].map((permissionId) => ({
        roleId: role.id,
        permissionId,
      })),
    });

    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'ROLE_CREATED',
      summaryText: `Created role "${role.name}" (${role.code}) with ${keys.length} permission(s).`,
      payload: { roleId: role.id, code: role.code, name: role.name, permissionKeys: keys.sort() },
    });

    return tx.role.findUniqueOrThrow({ where: { id: role.id }, include: ROLE_DETAIL_INCLUDE });
  });

  return serializeRole(created);
}

export async function updateRoleForTenant(
  webUser: WebJwtPayload,
  roleId: string,
  input: UpdateRoleRequest
) {
  const existing = await prisma.role.findFirst({
    where: {
      id: roleId,
      ...(webUser.isPlatformSuperAdmin ? {} : { tenantId: webUser.tenantId }),
    },
  });
  if (!existing) {
    throw new AppError('Role not found for this tenant', 404, 'ROLE_NOT_FOUND');
  }

  const beforeKeys = await permissionKeysForRole(prisma, roleId);
  // A caller may not edit a role that holds permissions they lack (prevents tampering with
  // more privileged roles).
  assertCallerHoldsAll(webUser, beforeKeys, 'Edit role');

  let afterKeys = beforeKeys;
  if (input.permissionIds) {
    afterKeys = await permissionKeysForIds(prisma, input.permissionIds);
    assertCallerHoldsAll(webUser, afterKeys, 'Edit role', {
      affectsSelf: roleId === webUser.roleId,
    });
  }

  const codeSuffix =
    input.codeSuffix === undefined
      ? undefined
      : input.codeSuffix
        ? input.codeSuffix.trim().toUpperCase()
        : null;
  await assertCodeSuffixAvailable(existing.tenantId, codeSuffix, roleId);

  // Onboarding mode applies to the merged role, not just the fields sent.
  const nextSurface = input.surface ?? existing.surface;
  const nextMode = (input.onboardingMode ?? existing.onboardingMode) as RoleOnboardingMode;
  const modeChanged = nextMode !== existing.onboardingMode;
  if (nextMode === 'PROVISIONED_ACCOUNT' && nextSurface === 'WEB') {
    throw new AppError('Only mobile roles can be pre-provisioned', 400, 'VALIDATION_ERROR');
  }
  if (nextMode === 'PROVISIONED_ACCOUNT' && input.requiresIdentityAssurance === true) {
    throw new AppError(
      'Pre-provisioned roles do not use identity assurance; the account is the identity',
      400,
      'VALIDATION_ERROR'
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id: roleId },
      data: {
        ...(modeChanged ? { onboardingMode: nextMode } : {}),
        ...(nextMode === 'PROVISIONED_ACCOUNT' ? { requiresIdentityAssurance: false } : {}),
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(codeSuffix !== undefined ? { codeSuffix } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.surface ? { surface: input.surface } : {}),
        ...(input.fieldPersonaType ? { fieldPersonaType: input.fieldPersonaType } : {}),
        ...(input.assuranceWeight !== undefined ? { assuranceWeight: input.assuranceWeight } : {}),
        ...(input.requiresIdentityAssurance !== undefined && nextMode !== 'PROVISIONED_ACCOUNT'
          ? { requiresIdentityAssurance: input.requiresIdentityAssurance }
          : {}),
      },
    });

    if (modeChanged) {
      await applyOnboardingModeChange(tx, webUser, { ...existing, onboardingMode: nextMode });
    }

    if (input.permissionIds) {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: [...new Set(input.permissionIds)].map((permissionId) => ({ roleId, permissionId })),
      });
      await assertTenantKeepsRoleAdmin(tx, webUser, existing.tenantId);
    }

    const added = afterKeys.filter((k) => !beforeKeys.includes(k)).sort();
    const removed = beforeKeys.filter((k) => !afterKeys.includes(k)).sort();
    await recordAuditEvent(tx, {
      tenantId: existing.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'ROLE_UPDATED',
      summaryText: `Updated role "${input.name?.trim() ?? existing.name}" (${existing.code}).${
        added.length || removed.length
          ? ` Permissions +${added.length} / -${removed.length}.`
          : ''
      }`,
      payload: {
        roleId,
        code: existing.code,
        changedFields: Object.keys(input).sort(),
        permissionsAdded: added,
        permissionsRemoved: removed,
      },
    });

    return tx.role.findUniqueOrThrow({ where: { id: roleId }, include: ROLE_DETAIL_INCLUDE });
  });

  clearAuthCache();
  return serializeRole(updated);
}

export async function deleteRoleForTenant(webUser: WebJwtPayload, roleId: string) {
  const existing = await prisma.role.findFirst({
    where: {
      id: roleId,
      ...(webUser.isPlatformSuperAdmin ? {} : { tenantId: webUser.tenantId }),
    },
    include: {
      _count: { select: { users: true, fieldSessions: true, joinCodes: true } },
    },
  });

  if (!existing) {
    throw new AppError('Role not found', 404, 'ROLE_NOT_FOUND');
  }
  if (existing.isSystemDefault) {
    throw new AppError(
      'System default roles cannot be deleted (you can rename or adjust their permissions instead).',
      400,
      'CANNOT_DELETE_DEFAULT_ROLE'
    );
  }
  if (
    existing._count.users > 0 ||
    existing._count.fieldSessions > 0 ||
    existing._count.joinCodes > 0
  ) {
    throw new AppError(
      'Role is currently assigned to active users or mobile sessions and cannot be deleted.',
      409,
      'ROLE_IN_USE'
    );
  }
  assertCallerHoldsAll(webUser, await permissionKeysForRole(prisma, roleId), 'Delete role');

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
    await recordAuditEvent(tx, {
      tenantId: existing.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'ROLE_DELETED',
      summaryText: `Deleted role "${existing.name}" (${existing.code}).`,
      payload: { roleId, code: existing.code, name: existing.name },
    });
  });
  clearAuthCache();
  return { deletedId: roleId };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsersForTenant(tenantId: string) {
  const users = await prisma.user.findMany({
    where: { tenantId },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
      mobileRole: { select: { id: true, name: true, surface: true, onboardingMode: true } },
      organization: true,
      projectAssignments: {
        include: {
          project: { select: { id: true, codePrefix: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return users.map((u) => {
    const permKeys = u.role.rolePermissions.map((rp) => rp.permission.key);
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      isActive: u.isActive,
      isPlatformSuperAdmin: u.isPlatformSuperAdmin,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      tenantId: u.tenantId,
      roleId: u.roleId,
      roleCode: u.role.code,
      roleName: u.role.name,
      organizationId: u.organizationId,
      organizationName: u.organization.name,
      organizationCategory: primaryCategory(u.organization.categories),
      organizationCategories: u.organization.categories as OrganizationCategory[],
      professionalRegistrationBodyCode: u.professionalRegistrationBodyCode,
      professionalRegistrationNumber: u.professionalRegistrationNumber,
      phoneNumber: u.phoneNumber,
      mobileRoleId: u.mobileRoleId,
      mobileRoleName: u.mobileRole?.name ?? null,
      hasMobileAccess: isProvisioned(u.mobileRole) || isProvisioned(u.role),
      hasAllTenantProjects:
        u.isPlatformSuperAdmin || permKeys.includes('projects:view_all_tenant'),
      projectAssignments: u.projectAssignments.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        projectCodePrefix: a.project.codePrefix,
        projectName: a.project.name,
      })),
      createdAt: u.createdAt.toISOString(),
    };
  });
}

/**
 * Creates a user inside the caller's tenant. The password supplied by the admin is temporary:
 * the user must change it at first sign-in.
 */
export async function createUserInTenant(webUser: WebJwtPayload, input: CreateTenantUserRequest) {
  const tenantId = webUser.tenantId;
  const emailLower = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: emailLower } });
  if (existing) {
    throw new AppError('A user with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const role = await prisma.role.findFirst({ where: { id: input.roleId, tenantId } });
  if (!role) {
    throw new AppError('Target role not found in tenant', 404, 'ROLE_NOT_FOUND');
  }
  assertCallerHoldsAll(webUser, await permissionKeysForRole(prisma, role.id), 'Assign role');
  const mobileRole = input.mobileRoleId
    ? await findAssignableMobileRole(webUser, tenantId, input.mobileRoleId, false)
    : null;

  // Only projects in the caller's tenant can be assigned.
  const validProjects =
    input.projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: input.projectIds }, tenantId },
          select: { id: true },
        })
      : [];
  if (validProjects.length !== new Set(input.projectIds).size) {
    throw new AppError('One or more projects were not found in this tenant', 404, 'PROJECT_NOT_FOUND');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const { organization: org } = await resolveOrganization(
      tx,
      tenantId,
      { id: input.organizationId ?? undefined, name: input.organizationName ?? undefined },
      input.organizationCategory,
      { actor: { actorId: webUser.userId, actorDisplayName: actorName(webUser) } }
    );

    const createdUser = await tx.user.create({
      data: {
        tenantId,
        email: emailLower,
        passwordHash,
        mustChangePassword: true,
        fullName: input.fullName,
        roleId: role.id,
        mobileRoleId: mobileRole?.id ?? null,
        phoneNumber: input.phoneNumber ?? null,
        organizationId: org.id,
        ...(await normaliseProfileRegistration(tx, tenantId, {
          code: input.professionalRegistrationBodyCode ?? null,
          number: input.professionalRegistrationNumber ?? null,
        })),
      },
    });

    if (validProjects.length > 0) {
      await tx.userProjectAssignment.createMany({
        data: validProjects.map((p) => ({ userId: createdUser.id, projectId: p.id })),
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'USER_CREATED',
      summaryText: `Created user ${createdUser.fullName} <${createdUser.email}> with role "${role.name}" and ${validProjects.length} project assignment(s).`,
      payload: {
        userId: createdUser.id,
        email: createdUser.email,
        roleId: role.id,
        roleCode: role.code,
        mobileRoleId: mobileRole?.id ?? null,
        projectIds: validProjects.map((p) => p.id),
      },
    });

    return createdUser;
  });

  const all = await listUsersForTenant(tenantId);
  return all.find((u) => u.id === user.id)!;
}

export async function assignUserProjectsAndRole(
  webUser: WebJwtPayload,
  userId: string,
  input: AssignUserProjectsRequest
) {
  const targetUser = await prisma.user.findFirst({
    where: {
      id: userId,
      ...(webUser.isPlatformSuperAdmin ? {} : { tenantId: webUser.tenantId }),
    },
    include: {
      projectAssignments: { select: { projectId: true } },
      role: { select: { surface: true, onboardingMode: true } },
      mobileRole: { select: { surface: true, onboardingMode: true } },
    },
  });

  if (!targetUser) {
    throw new AppError('User not found in tenant', 404, 'USER_NOT_FOUND');
  }

  // Cannot manage a user who is more privileged than the caller.
  assertCallerHoldsAll(
    webUser,
    await permissionKeysForRole(prisma, targetUser.roleId),
    'Manage user'
  );
  if (targetUser.isPlatformSuperAdmin && !webUser.isPlatformSuperAdmin) {
    throw new AppError('Platform administrators cannot be managed from a tenant', 403, 'FORBIDDEN');
  }

  let newRole: { id: string; name: string; code: string } | null = null;
  if (input.roleId && input.roleId !== targetUser.roleId) {
    newRole = await prisma.role.findFirst({
      where: { id: input.roleId, tenantId: targetUser.tenantId },
      select: { id: true, name: true, code: true },
    });
    if (!newRole) {
      throw new AppError('Role not found in user tenant', 404, 'ROLE_NOT_FOUND');
    }
    assertCallerHoldsAll(webUser, await permissionKeysForRole(prisma, newRole.id), 'Assign role', {
      affectsSelf: targetUser.id === webUser.userId,
    });
  }

  const mobileRoleChanged =
    input.mobileRoleId !== undefined && input.mobileRoleId !== targetUser.mobileRoleId;
  const nextMobileRole =
    mobileRoleChanged && input.mobileRoleId
      ? await findAssignableMobileRole(webUser, targetUser.tenantId, input.mobileRoleId, targetUser.id === webUser.userId)
      : null;
  const phoneChanged =
    input.phoneNumber !== undefined && (input.phoneNumber ?? null) !== targetUser.phoneNumber;
  // Phase 12: registration body and number (omitted = unchanged).
  const registration = await normaliseProfileRegistration(
    prisma,
    targetUser.tenantId,
    { code: input.professionalRegistrationBodyCode, number: input.professionalRegistrationNumber },
    targetUser
  );
  const registrationChanged =
    (registration.professionalRegistrationBodyCode !== undefined &&
      registration.professionalRegistrationBodyCode !== targetUser.professionalRegistrationBodyCode) ||
    (registration.professionalRegistrationNumber !== undefined &&
      registration.professionalRegistrationNumber !== targetUser.professionalRegistrationNumber);

  const validProjects =
    input.projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: input.projectIds }, tenantId: targetUser.tenantId },
          select: { id: true, name: true, codePrefix: true },
        })
      : [];
  if (validProjects.length !== new Set(input.projectIds).size) {
    throw new AppError('One or more projects were not found in this tenant', 404, 'PROJECT_NOT_FOUND');
  }

  const deactivating = input.isActive === false && targetUser.isActive;
  const reactivating = input.isActive === true && !targetUser.isActive;
  const revokeSessions = Boolean(newRole) || deactivating;

  await prisma.$transaction(async (tx) => {
    if (newRole || input.isActive !== undefined || mobileRoleChanged || phoneChanged || registrationChanged) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(newRole ? { roleId: newRole.id } : {}),
          ...(mobileRoleChanged ? { mobileRoleId: nextMobileRole?.id ?? null } : {}),
          ...(phoneChanged ? { phoneNumber: input.phoneNumber ?? null } : {}),
          ...(registrationChanged ? registration : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(revokeSessions ? { tokenVersion: { increment: 1 } } : {}),
        },
      });
    }

    await tx.userProjectAssignment.deleteMany({ where: { userId } });
    if (validProjects.length > 0) {
      await tx.userProjectAssignment.createMany({
        data: validProjects.map((p) => ({ userId, projectId: p.id })),
      });
    }

    if (newRole || deactivating) {
      await assertTenantKeepsRoleAdmin(tx, webUser, targetUser.tenantId);
    }

    const before = targetUser.projectAssignments.map((a) => a.projectId).sort();
    const after = validProjects.map((p) => p.id).sort();
    const assignmentsChanged = before.join(',') !== after.join(',');

    if (deactivating) {
      await recordAuditEvent(tx, {
        tenantId: targetUser.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'USER_DEACTIVATED',
        summaryText: `Deactivated user ${targetUser.fullName} <${targetUser.email}>; active sessions revoked.`,
        payload: { userId },
      });
    }
    if (newRole || reactivating || mobileRoleChanged || phoneChanged || registrationChanged) {
      await recordAuditEvent(tx, {
        tenantId: targetUser.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'USER_UPDATED',
        summaryText: `Updated user ${targetUser.fullName}:${newRole ? ` role → "${newRole.name}"` : ''}${
          mobileRoleChanged
            ? nextMobileRole
              ? ` mobile access → "${nextMobileRole.name}"`
              : ' mobile role removed'
            : ''
        }${phoneChanged ? ' phone number changed' : ''}${registrationChanged ? ' professional registration changed' : ''}${
          reactivating ? ' reactivated' : ''
        }.`,
        payload: {
          userId,
          previousRoleId: targetUser.roleId,
          newRoleId: newRole?.id ?? targetUser.roleId,
          previousMobileRoleId: targetUser.mobileRoleId,
          newMobileRoleId: mobileRoleChanged ? nextMobileRole?.id ?? null : targetUser.mobileRoleId,
          phoneChanged,
          registrationChanged,
          reactivated: reactivating,
        },
      });
    }
    if (assignmentsChanged) {
      await recordAuditEvent(tx, {
        tenantId: targetUser.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'USER_PROJECT_ASSIGNED',
        summaryText: `Set project access for ${targetUser.fullName} to ${after.length} project(s).`,
        payload: {
          userId,
          addedProjectIds: after.filter((id) => !before.includes(id)),
          removedProjectIds: before.filter((id) => !after.includes(id)),
        },
      });
    }
  });

  invalidateUserAuthCache(userId);
  const all = await listUsersForTenant(targetUser.tenantId);
  const result = all.find((u) => u.id === userId)!;

  // Tell the person's devices about projects they can now open (fire and forget).
  const previousProjectIds = new Set(targetUser.projectAssignments.map((a) => a.projectId));
  const added = validProjects.filter((p) => !previousProjectIds.has(p.id));
  if (added.length > 0 && result.hasMobileAccess && result.isActive) {
    for (const project of added) {
      void sendPushToMobileUser(userId, {
        title: 'New project',
        body: `You've been added to ${project.name} (${project.codePrefix}).`,
        data: { actionType: 'OPEN_PROJECT', projectId: project.id },
      }).catch(() => undefined);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pre-provisioned mobile access (Phase 5)
// ---------------------------------------------------------------------------

function isProvisioned(role: { surface: string; onboardingMode: string } | null | undefined): boolean {
  return Boolean(role && role.surface !== 'WEB' && role.onboardingMode === 'PROVISIONED_ACCOUNT');
}

/** A role that can be given as a user's mobile role: same tenant, mobile surface, provisioned. */
async function findAssignableMobileRole(
  webUser: WebJwtPayload,
  tenantId: string,
  mobileRoleId: string,
  affectsSelf: boolean
) {
  const role = await prisma.role.findFirst({ where: { id: mobileRoleId, tenantId } });
  if (!role) {
    throw new AppError('Mobile role not found in this tenant', 404, 'ROLE_NOT_FOUND');
  }
  if (!isProvisioned(role)) {
    throw new AppError(
      `"${role.name}" is not a pre-provisioned mobile role. Set its onboarding to "Pre-provisioned account" first.`,
      400,
      'ROLE_NOT_PROVISIONED'
    );
  }
  assertCallerHoldsAll(webUser, await permissionKeysForRole(prisma, role.id), 'Assign mobile role', {
    affectsSelf,
  });
  return role;
}

/**
 * What switching this role's onboarding mode will touch, for the confirmation dialog: active join
 * codes (and their projects) that will be deactivated, and join-code sessions that keep working.
 */
export async function getRoleOnboardingImpact(
  webUser: WebJwtPayload,
  roleId: string
): Promise<RoleOnboardingImpactDto> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, ...(webUser.isPlatformSuperAdmin ? {} : { tenantId: webUser.tenantId }) },
    select: { id: true },
  });
  if (!role) {
    throw new AppError('Role not found for this tenant', 404, 'ROLE_NOT_FOUND');
  }
  const [codes, activeJoinCodeSessionCount] = await Promise.all([
    prisma.projectJoinCode.findMany({
      where: { roleId, isActive: true },
      select: { project: { select: { id: true, codePrefix: true, name: true } } },
    }),
    prisma.fieldAgentSession.count({ where: { roleId, origin: 'JOIN_CODE', isActive: true } }),
  ]);
  const projects = new Map<string, { id: string; codePrefix: string; name: string }>();
  for (const c of codes) projects.set(c.project.id, c.project);
  return {
    roleId,
    activeJoinCodeCount: codes.length,
    projects: [...projects.values()].sort((a, b) => a.codePrefix.localeCompare(b.codePrefix)),
    activeJoinCodeSessionCount,
  };
}

/**
 * Inside the role-update transaction. To provisioned: deactivate every active join code for the
 * role (existing join-code sessions keep working until revoked). Back to join codes: issue one code
 * per project. Writes ROLE_ONBOARDING_MODE_CHANGED on the tenant chain.
 */
async function applyOnboardingModeChange(
  tx: Tx,
  webUser: WebJwtPayload,
  role: { id: string; tenantId: string; name: string; code: string; codeSuffix: string | null; onboardingMode: string; fieldPersonaType: string }
) {
  let deactivated: Array<{ id: string; code: string; projectId: string }> = [];
  let issuedCodes: string[] = [];
  if (role.onboardingMode === 'PROVISIONED_ACCOUNT') {
    deactivated = await tx.projectJoinCode.findMany({
      where: { roleId: role.id, isActive: true },
      select: { id: true, code: true, projectId: true },
    });
    await tx.projectJoinCode.updateMany({
      where: { id: { in: deactivated.map((c) => c.id) } },
      data: { isActive: false },
    });
  } else {
    const issued = await issueJoinCodesForRoleOnAllProjects(tx, role);
    issuedCodes = issued.map((jc) => jc.code);
  }

  await recordAuditEvent(tx, {
    tenantId: role.tenantId,
    projectId: null,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'ROLE_ONBOARDING_MODE_CHANGED',
    summaryText:
      role.onboardingMode === 'PROVISIONED_ACCOUNT'
        ? `Role "${role.name}" is now pre-provisioned: people sign in with an account. ${deactivated.length} join code(s) deactivated.`
        : `Role "${role.name}" now uses join codes. ${issuedCodes.length} join code(s) issued.`,
    payload: {
      roleId: role.id,
      onboardingMode: role.onboardingMode,
      deactivatedJoinCodeIds: deactivated.map((c) => c.id),
      deactivatedProjectIds: [...new Set(deactivated.map((c) => c.projectId))],
      issuedJoinCodes: issuedCodes,
    },
  });
}

function serializeMobileDevice(
  d: Prisma.MobileDeviceGetPayload<{
    include: {
      user: { select: { fullName: true; email: true; mobileRole: { select: { name: true } }; role: { select: { name: true; surface: true; onboardingMode: true } } } };
      _count: { select: { fieldSessions: true } };
    };
  }>
): MobileDeviceDto {
  return {
    id: d.id,
    userId: d.userId,
    userFullName: d.user.fullName,
    userEmail: d.user.email,
    mobileRoleName: d.user.mobileRole?.name ?? (isProvisioned(d.user.role) ? d.user.role.name : null),
    deviceId: d.deviceId,
    deviceModel: d.deviceModel,
    deviceOs: d.deviceOs,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
    sessionCount: d._count.fieldSessions,
    createdAt: d.createdAt.toISOString(),
  };
}

const MOBILE_DEVICE_INCLUDE = {
  user: {
    select: {
      fullName: true,
      email: true,
      mobileRole: { select: { name: true } },
      role: { select: { name: true, surface: true, onboardingMode: true } },
    },
  },
  _count: { select: { fieldSessions: true } },
} as const;

/** Tenant-level list of provisioned users' devices, most recently seen first. */
export async function listMobileDevicesForTenant(tenantId: string): Promise<MobileDeviceDto[]> {
  const rows = await prisma.mobileDevice.findMany({
    where: { user: { tenantId } },
    include: MOBILE_DEVICE_INCLUDE,
    orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: { sort: 'desc', nulls: 'last' } }],
  });
  return rows.map(serializeMobileDevice);
}

/** Revoking a device blocks every project for that user on that device, through the auth loader. */
export async function revokeMobileDevice(
  webUser: WebJwtPayload,
  deviceRowId: string,
  reason?: string
): Promise<MobileDeviceDto> {
  const device = await prisma.mobileDevice.findFirst({
    where: { id: deviceRowId, ...(webUser.isPlatformSuperAdmin ? {} : { user: { tenantId: webUser.tenantId } }) },
    include: { user: { select: { id: true, tenantId: true, fullName: true, email: true } } },
  });
  if (!device) {
    throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }
  if (!device.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.mobileDevice.update({
        where: { id: device.id },
        data: { revokedAt: new Date(), revokedByUserId: webUser.userId, revokeReason: reason ?? null },
      });
      // Push tokens registered from this device must stop receiving the user's notifications.
      await tx.pushToken.deleteMany({ where: { userId: device.userId, devicePlatform: { not: 'WEB' }, mobileDeviceId: device.id } });
      await recordAuditEvent(tx, {
        tenantId: device.user.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'MOBILE_DEVICE_REVOKED',
        summaryText: `Revoked mobile device ${device.deviceModel ?? device.deviceId} for ${device.user.fullName} <${device.user.email}>.${
          reason ? ` Reason: ${reason}` : ''
        }`,
        payload: { mobileDeviceId: device.id, userId: device.userId, deviceId: device.deviceId, reason: reason ?? null },
      });
    });
    invalidateUserAuthCache(device.userId);
  }
  const row = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: device.id }, include: MOBILE_DEVICE_INCLUDE });
  return serializeMobileDevice(row);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export async function getTenantDetails(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  }
  return serializeTenant(tenant);
}

export async function updateTenantBranding(
  webUser: WebJwtPayload,
  input: UpdateTenantBrandingRequest
) {
  const tenantId = webUser.tenantId;
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const row = await tx.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.defaultCurrency ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        brandingConfig: input.brandingConfig as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'TENANT_BRANDING_UPDATED',
      summaryText: `Updated tenant branding and settings for "${row.name}".`,
      payload: {
        previous: {
          name: before.name,
          defaultCurrency: before.defaultCurrency,
          timezone: before.timezone,
          brandingConfig: before.brandingConfig,
        },
        next: {
          name: row.name,
          defaultCurrency: row.defaultCurrency,
          timezone: row.timezone,
          brandingConfig: row.brandingConfig,
        },
      },
    });
    return row;
  });
  return serializeTenant(updated);
}

// ---------------------------------------------------------------------------
// Tenant settings: evidence rating labels (decision B)
// ---------------------------------------------------------------------------

export async function getEvidenceRatingLabels(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { evidenceRatingLabels: true },
  });
  if (!tenant) throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  return {
    labels: parseEvidenceRatingLabels(tenant.evidenceRatingLabels),
    resolved: resolveRatingLabels(tenant.evidenceRatingLabels),
  };
}

/** Replaces the tenant's overrides. Omitted ratings fall back to the defaults. */
export async function updateEvidenceRatingLabels(
  webUser: WebJwtPayload,
  input: UpdateEvidenceRatingLabelsRequest
) {
  const tenantId = webUser.tenantId;
  const next = parseEvidenceRatingLabels(input.labels);
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { evidenceRatingLabels: true },
    });
    await tx.tenant.update({
      where: { id: tenantId },
      data: { evidenceRatingLabels: next as unknown as Prisma.InputJsonValue },
    });
    const changed = Object.keys({ ...parseEvidenceRatingLabels(before.evidenceRatingLabels), ...next });
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'TENANT_SETTINGS_UPDATED',
      summaryText: `Updated evidence rating labels${changed.length ? ` (${changed.join(', ')})` : ''}.`,
      payload: {
        setting: 'evidenceRatingLabels',
        previous: parseEvidenceRatingLabels(before.evidenceRatingLabels),
        next,
      },
    });
  });
  return getEvidenceRatingLabels(tenantId);
}

export async function listAllTenants() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { projects: true, users: true, roles: true } },
    },
  });

  return tenants.map((t) => ({
    ...serializeTenant(t),
    projectCount: t._count.projects,
    userCount: t._count.users,
    roleCount: t._count.roles,
  }));
}

export async function createTenantWithDefaults(webUser: WebJwtPayload, input: CreateTenantRequest) {
  const slug = input.slug.trim().toLowerCase();
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    throw new AppError(`Tenant with slug "${slug}" already exists`, 409, 'DUPLICATE_TENANT_SLUG');
  }
  if (input.adminEmail) {
    const emailTaken = await prisma.user.findUnique({
      where: { email: input.adminEmail.trim().toLowerCase() },
    });
    if (emailTaken) {
      throw new AppError('A user with the admin email already exists', 409, 'EMAIL_EXISTS');
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.name.trim(),
        slug,
        status: 'ACTIVE',
        defaultCurrency: input.defaultCurrency,
        timezone: input.timezone,
        brandingConfig: (input.brandingConfig ??
          DEFAULT_BRANDING_CONFIG) as unknown as Prisma.InputJsonValue,
      },
    });

    const roles = await provisionDefaultRoles(tx, tenant.id);
    // Phase 7: the three starter workflow templates.
    await seedStarterTemplates(tx, tenant.id);
    // Phase 12: the default registration bodies.
    await provisionDefaultRegistrationBodies(tx, tenant.id);

    let adminUserId: string | null = null;
    if (input.adminEmail && input.adminPassword && input.adminFullName) {
      const { organization: org } = await resolveOrganization(tx, tenant.id, { name: input.name }, 'CLIENT_OWNER', {
        actor: { actorId: webUser.userId, actorDisplayName: actorName(webUser) },
      });
      const passwordHash = await bcrypt.hash(input.adminPassword, 10);
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.adminEmail.trim().toLowerCase(),
          passwordHash,
          mustChangePassword: true,
          fullName: input.adminFullName,
          roleId: roles.get('TENANT_SUPER_ADMIN')!.id,
          organizationId: org.id,
        },
      });
      adminUserId = admin.id;
    }

    await recordAuditEvent(tx, {
      tenantId: tenant.id,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'TENANT_CREATED',
      summaryText: `Provisioned tenant "${tenant.name}" (${tenant.slug}) with ${roles.size} default roles${
        adminUserId ? ' and an initial administrator' : ''
      }.`,
      payload: { tenantId: tenant.id, slug: tenant.slug, adminUserId },
    });

    return tenant;
  });

  return serializeTenant(created);
}
