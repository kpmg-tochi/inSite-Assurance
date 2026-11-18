import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import {
  AssignUserProjectsRequest,
  CreateRoleRequest,
  CreateTenantRequest,
  CreateTenantUserRequest,
  DEFAULT_TENANT_ROLES,
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
import { recordAuditEvent } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

export const DEFAULT_BRANDING_CONFIG: TenantBrandingConfig = {
  logoUrl: '/KPMG-logo.svg',
  primaryColorHex: '#00338D',
  navyColorHex: '#0C233C',
  tagline: 'Capital Advisory',
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
        requiresIdentityAssurance: input.requiresIdentityAssurance,
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

  const updated = await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id: roleId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(codeSuffix !== undefined ? { codeSuffix } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.surface ? { surface: input.surface } : {}),
        ...(input.fieldPersonaType ? { fieldPersonaType: input.fieldPersonaType } : {}),
        ...(input.assuranceWeight !== undefined ? { assuranceWeight: input.assuranceWeight } : {}),
        ...(input.requiresIdentityAssurance !== undefined
          ? { requiresIdentityAssurance: input.requiresIdentityAssurance }
          : {}),
      },
    });

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
      organization: true,
      projectAssignments: {
        include: {
          project: { select: { id: true, codePrefix: true, name: true } },
          role: { select: { id: true, name: true } },
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
      organizationCategory: u.organization.category as OrganizationCategory,
      professionalLicenseType: u.professionalLicenseType,
      professionalLicenseNumber: u.professionalLicenseNumber,
      hasAllTenantProjects:
        u.isPlatformSuperAdmin || permKeys.includes('projects:view_all_tenant'),
      projectAssignments: u.projectAssignments.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        projectCodePrefix: a.project.codePrefix,
        projectName: a.project.name,
        roleId: a.roleId,
        roleName: a.role?.name ?? null,
      })),
      createdAt: u.createdAt.toISOString(),
    };
  });
}

async function findOrCreateOrganization(
  tx: Tx,
  tenantId: string,
  name: string,
  category: OrganizationCategory
) {
  const trimmed = name.trim();
  const existing = await tx.organization.findFirst({
    where: { tenantId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  return tx.organization.create({ data: { tenantId, name: trimmed, category } });
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
    const org = await findOrCreateOrganization(
      tx,
      tenantId,
      input.organizationName,
      input.organizationCategory
    );

    const createdUser = await tx.user.create({
      data: {
        tenantId,
        email: emailLower,
        passwordHash,
        mustChangePassword: true,
        fullName: input.fullName,
        roleId: role.id,
        organizationId: org.id,
        professionalLicenseType: input.professionalLicenseType ?? null,
        professionalLicenseNumber: input.professionalLicenseNumber ?? null,
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
    include: { projectAssignments: { select: { projectId: true } } },
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

  const validProjects =
    input.projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: input.projectIds }, tenantId: targetUser.tenantId },
          select: { id: true },
        })
      : [];
  if (validProjects.length !== new Set(input.projectIds).size) {
    throw new AppError('One or more projects were not found in this tenant', 404, 'PROJECT_NOT_FOUND');
  }

  const deactivating = input.isActive === false && targetUser.isActive;
  const reactivating = input.isActive === true && !targetUser.isActive;
  const revokeSessions = Boolean(newRole) || deactivating;

  await prisma.$transaction(async (tx) => {
    if (newRole || input.isActive !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(newRole ? { roleId: newRole.id } : {}),
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
    if (newRole || reactivating) {
      await recordAuditEvent(tx, {
        tenantId: targetUser.tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'USER_UPDATED',
        summaryText: `Updated user ${targetUser.fullName}:${newRole ? ` role → "${newRole.name}"` : ''}${
          reactivating ? ' reactivated' : ''
        }.`,
        payload: {
          userId,
          previousRoleId: targetUser.roleId,
          newRoleId: newRole?.id ?? targetUser.roleId,
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
  return all.find((u) => u.id === userId)!;
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

    let adminUserId: string | null = null;
    if (input.adminEmail && input.adminPassword && input.adminFullName) {
      const org = await findOrCreateOrganization(tx, tenant.id, input.name, 'CLIENT_OWNER');
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
