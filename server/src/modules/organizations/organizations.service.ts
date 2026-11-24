import { Prisma } from '@prisma/client';
import {
  CreateOrganizationRequest,
  GeofenceMode,
  ListOrganizationsQuery,
  OrganizationCategory,
  OrganizationDto,
  OrganizationRef,
  OrgInputMode,
  TenantSettingsDto,
  UpdateOrganizationRequest,
  UpdateTenantSettingsRequest,
  validateOrganizationParent,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type OrganizationRow = Prisma.OrganizationGetPayload<object>;

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

export function serializeOrganization(
  org: OrganizationRow,
  counts?: { userCount?: number; projectCount?: number },
  parent?: { isArchived: boolean } | null
): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    categories: org.categories as OrganizationCategory[],
    registrationNumber: org.registrationNumber,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    isArchived: org.isArchived,
    parentOrganizationId: org.parentOrganizationId,
    ...(parent ? { parentIsArchived: parent.isArchived } : {}),
    ...(counts?.userCount !== undefined ? { userCount: counts.userCount } : {}),
    ...(counts?.projectCount !== undefined ? { projectCount: counts.projectCount } : {}),
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

/** First tag, for older contracts that expect a single category. */
export function primaryCategory(categories: string[] | null | undefined): OrganizationCategory {
  return ((categories ?? [])[0] as OrganizationCategory | undefined) ?? 'OTHER';
}

async function findByName(db: Db, tenantId: string, name: string) {
  return db.organization.findFirst({
    where: { tenantId, name: { equals: name.trim(), mode: 'insensitive' } },
  });
}

async function tenantInputMode(db: Db, tenantId: string): Promise<OrgInputMode> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { organizationInputMode: true },
  });
  return (tenant?.organizationInputMode as OrgInputMode | undefined) ?? 'BOTH';
}

/**
 * The one place an organisation is taken from user input (decision E). Used by project setup,
 * tenant user creation and self-registration.
 *
 * - `{ id }` picks a directory entry in the tenant; archived entries cannot be picked.
 * - `{ name }` matches an existing organisation by case-insensitive name; otherwise it creates
 *   one, unless the tenant's input mode is DIRECTORY, which refuses new names.
 * - `tag` is added to the organisation's tags if missing (an organisation can play several parts).
 *
 * `allowArchivedId` lets a project keep an organisation that was archived after it was chosen.
 */
export async function resolveOrganization(
  tx: Tx,
  tenantId: string,
  ref: OrganizationRef | { id?: string | null; name?: string | null },
  tag: OrganizationCategory,
  options: {
    allowArchivedId?: string | null;
    /** Who typed the name; recorded on the ORGANIZATION_CREATED entry. */
    actor?: { actorId: string; actorDisplayName: string };
    projectId?: string | null;
  } = {}
): Promise<{ organization: OrganizationRow; created: boolean }> {
  let org: OrganizationRow | null = null;
  let created = false;

  if (ref.id) {
    org = await tx.organization.findFirst({ where: { id: ref.id, tenantId } });
    if (!org) {
      throw new AppError('Organisation not found in this workspace', 404, 'ORGANIZATION_NOT_FOUND');
    }
    if (org.isArchived && org.id !== options.allowArchivedId) {
      throw new AppError(`"${org.name}" is archived and cannot be chosen`, 409, 'ORGANIZATION_ARCHIVED');
    }
  } else {
    const name = (ref.name ?? '').trim();
    if (name.length < 2) {
      throw new AppError('Choose or enter an organisation', 422, 'ORGANIZATION_REQUIRED');
    }
    const mode = await tenantInputMode(tx, tenantId);
    org = await findByName(tx, tenantId, name);
    if (org) {
      if (org.isArchived && org.id !== options.allowArchivedId) {
        throw new AppError(`"${org.name}" is archived and cannot be chosen`, 409, 'ORGANIZATION_ARCHIVED');
      }
    } else {
      if (mode === 'DIRECTORY') {
        throw new AppError(
          `"${name}" is not in the organisation directory. Pick an organisation from the list, or ask an administrator to add it.`,
          422,
          'ORGANIZATION_NOT_IN_DIRECTORY'
        );
      }
      org = await tx.organization.create({ data: { tenantId, name, categories: [tag] } });
      created = true;
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: options.actor?.actorId ?? 'self-registration',
        actorDisplayName: options.actor?.actorDisplayName ?? 'Self-registration',
        action: 'ORGANIZATION_CREATED',
        summaryText: `Added organisation "${name}" (${tag}) from a typed name.`,
        payload: { organizationId: org.id, name, categories: [tag], source: 'TYPED_NAME' },
      });
    }
  }

  if (!(org.categories as string[]).includes(tag)) {
    org = await tx.organization.update({
      where: { id: org.id },
      data: { categories: { push: tag } },
    });
  }
  return { organization: org, created };
}

export async function listOrganizations(
  tenantId: string,
  query: ListOrganizationsQuery
): Promise<OrganizationDto[]> {
  const where: Prisma.OrganizationWhereInput = {
    tenantId,
    ...(query.includeArchived ? {} : { isArchived: false }),
    ...(query.tag ? { categories: { has: query.tag } } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const rows = await prisma.organization.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 500,
    include: {
      _count: {
        select: { users: true, monitoredProjects: true, lenderProjects: true, ownedProjects: true, projectContractors: true },
      },
      parentOrganization: { select: { isArchived: true } },
    },
  });
  return rows.map((r) =>
    serializeOrganization(
      r,
      {
        userCount: r._count.users,
        projectCount:
          r._count.monitoredProjects + r._count.lenderProjects + r._count.ownedProjects + r._count.projectContractors,
      },
      r.parentOrganization
    )
  );
}

function assertUniqueNameError(error: unknown, name: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(`An organisation named "${name}" already exists`, 409, 'ORGANIZATION_EXISTS');
  }
  throw error;
}

export async function createOrganization(webUser: WebJwtPayload, input: CreateOrganizationRequest) {
  const tenantId = webUser.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (await findByName(tx, tenantId, input.name)) {
        throw new AppError(`An organisation named "${input.name}" already exists`, 409, 'ORGANIZATION_EXISTS');
      }
      await assertValidParent(tx, tenantId, null, input.parentOrganizationId ?? null);
      const created = await tx.organization.create({
        data: {
          tenantId,
          name: input.name.trim(),
          categories: Array.from(new Set(input.categories)),
          registrationNumber: input.registrationNumber || null,
          contactEmail: input.contactEmail || null,
          contactPhone: input.contactPhone || null,
          parentOrganizationId: input.parentOrganizationId ?? null,
        },
      });
      if (created.parentOrganizationId) {
        await auditHierarchyChange(tx, webUser, created, null);
      }
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'ORGANIZATION_CREATED',
        summaryText: `Added organisation "${created.name}" (${created.categories.join(', ')}).`,
        payload: { organizationId: created.id, name: created.name, categories: created.categories },
      });
      return created;
    });
    return serializeOrganization(row);
  } catch (error) {
    assertUniqueNameError(error, input.name);
  }
}

export async function updateOrganization(
  webUser: WebJwtPayload,
  organizationId: string,
  input: UpdateOrganizationRequest
) {
  const tenantId = webUser.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findFirst({ where: { id: organizationId, tenantId } });
      if (!before) throw new AppError('Organisation not found', 404, 'ORGANIZATION_NOT_FOUND');
      if (input.name && input.name.trim().toLowerCase() !== before.name.toLowerCase()) {
        const clash = await findByName(tx, tenantId, input.name);
        if (clash && clash.id !== before.id) {
          throw new AppError(`An organisation named "${input.name}" already exists`, 409, 'ORGANIZATION_EXISTS');
        }
      }
      const parentChanging =
        input.parentOrganizationId !== undefined && (input.parentOrganizationId ?? null) !== before.parentOrganizationId;
      if (parentChanging) {
        // Serialise hierarchy edits in the tenant so two concurrent moves cannot form a loop.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'org-hierarchy:' + tenantId}))`;
        await assertValidParent(tx, tenantId, before.id, input.parentOrganizationId ?? null);
      }
      const data: Prisma.OrganizationUpdateInput = {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.categories !== undefined ? { categories: Array.from(new Set(input.categories)) } : {}),
        ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber || null } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail || null } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone || null } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(parentChanging
          ? input.parentOrganizationId
            ? { parentOrganization: { connect: { id: input.parentOrganizationId } } }
            : { parentOrganization: { disconnect: true } }
          : {}),
      };
      const updated = await tx.organization.update({ where: { id: before.id }, data });
      if (parentChanging) await auditHierarchyChange(tx, webUser, updated, before.parentOrganizationId);
      const changed = (Object.keys(data) as Array<keyof typeof data>).filter(
        (k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((updated as Record<string, unknown>)[k])
      );
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'ORGANIZATION_UPDATED',
        summaryText:
          input.isArchived === true && !before.isArchived
            ? `Archived organisation "${updated.name}".`
            : input.isArchived === false && before.isArchived
              ? `Restored organisation "${updated.name}".`
              : `Updated organisation "${updated.name}"${changed.length ? ` (${changed.join(', ')})` : ''}.`,
        payload: {
          organizationId: updated.id,
          changedFields: changed,
          previous: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
          next: Object.fromEntries(changed.map((k) => [k, (updated as Record<string, unknown>)[k]])),
        },
      });
      return updated;
    });
    return serializeOrganization(row);
  } catch (error) {
    assertUniqueNameError(error, input.name ?? '');
  }
}

// ---------------------------------------------------------------------------
// Hierarchy (Phase 11)
// ---------------------------------------------------------------------------

/** Refuses self-parenting, cycles, a parent from another tenant and depth beyond five levels. */
async function assertValidParent(tx: Tx, tenantId: string, organizationId: string | null, parentId: string | null) {
  if (!parentId) return;
  const nodes = await tx.organization.findMany({ where: { tenantId }, select: { id: true, parentOrganizationId: true } });
  const issue = validateOrganizationParent(nodes, organizationId, parentId);
  if (issue) {
    throw new AppError(issue.message, issue.code === 'ORGANIZATION_PARENT_NOT_FOUND' ? 404 : 422, issue.code);
  }
}

async function auditHierarchyChange(tx: Tx, webUser: WebJwtPayload, org: OrganizationRow, previousParentId: string | null) {
  const ids = [previousParentId, org.parentOrganizationId].filter((v): v is string => Boolean(v));
  const names = new Map(
    (await tx.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((o) => [o.id, o.name])
  );
  const label = (id: string | null) => (id ? `"${names.get(id) ?? id}"` : 'no parent');
  await recordAuditEvent(tx, {
    tenantId: org.tenantId,
    projectId: null,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'ORGANIZATION_HIERARCHY_CHANGED',
    summaryText: `Moved organisation "${org.name}" from ${label(previousParentId)} to ${label(org.parentOrganizationId)}.`,
    payload: { organizationId: org.id, previousParentOrganizationId: previousParentId, parentOrganizationId: org.parentOrganizationId },
  });
}

// ---------------------------------------------------------------------------
// Tenant settings (Phase 6)
// ---------------------------------------------------------------------------

const ALL_GEOFENCE_MODES: GeofenceMode[] = ['RADIAL', 'PERIMETER'];

export async function getTenantSettings(tenantId: string): Promise<TenantSettingsDto> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  const enabled = (t.enabledGeofenceModes as GeofenceMode[] | null) ?? ALL_GEOFENCE_MODES;
  return {
    organizationInputMode: t.organizationInputMode as OrgInputMode,
    enabledGeofenceModes: enabled.length ? enabled : ALL_GEOFENCE_MODES,
    defaultGeofenceToleranceMeters: t.defaultGeofenceToleranceMeters,
    defaultGeofenceRadiusMeters: t.defaultGeofenceRadiusMeters,
    defaultCurrency: t.defaultCurrency,
    timezone: t.timezone,
  };
}

export async function updateTenantSettings(webUser: WebJwtPayload, input: UpdateTenantSettingsRequest) {
  const tenantId = webUser.tenantId;
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const data: Prisma.TenantUpdateInput = {
      ...(input.organizationInputMode ? { organizationInputMode: input.organizationInputMode } : {}),
      ...(input.enabledGeofenceModes ? { enabledGeofenceModes: Array.from(new Set(input.enabledGeofenceModes)) } : {}),
      ...(input.defaultGeofenceToleranceMeters !== undefined
        ? { defaultGeofenceToleranceMeters: input.defaultGeofenceToleranceMeters }
        : {}),
      ...(input.defaultGeofenceRadiusMeters !== undefined ? { defaultGeofenceRadiusMeters: input.defaultGeofenceRadiusMeters } : {}),
      ...(input.defaultCurrency ? { defaultCurrency: input.defaultCurrency } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    };
    const after = await tx.tenant.update({ where: { id: tenantId }, data });
    const keys = Object.keys(data) as Array<keyof typeof before>;
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'TENANT_SETTINGS_UPDATED',
      summaryText: `Updated tenant settings${changed.length ? ` (${changed.join(', ')})` : ''}.`,
      payload: {
        setting: 'general',
        changedFields: changed,
        previous: Object.fromEntries(changed.map((k) => [k, before[k]])),
        next: Object.fromEntries(changed.map((k) => [k, after[k]])),
      },
    });
  });
  return getTenantSettings(tenantId);
}
