import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  PERMISSION_CATEGORY_META,
  SYSTEM_PERMISSIONS_CATALOG,
} from '@insite/shared';
import {
  hasWebPermission,
  signWebUserToken,
  WebJwtPayload,
} from '../middleware/auth.middleware';
import { buildProjectVisibilityWhere } from '../utils/accessControl';
import { serializeWebUserProfile } from '../modules/auth/auth.service';
import {
  DEFAULT_BRANDING_CONFIG,
  parseTenantBranding,
} from '../modules/rbac/rbac.service';

function makeWebUser(overrides: Partial<WebJwtPayload> = {}): WebJwtPayload {
  return {
    tokenType: 'WEB_USER',
    userId: 'user-1111',
    email: 'me.lead@client.org',
    fullName: 'Amina Bello',
    tenantId: 'tenant-aaa',
    isPlatformSuperAdmin: false,
    roleId: 'role-me-lead',
    roleCode: 'ME_EVAL_LEAD',
    roleName: 'Monitoring & Evaluation Lead',
    permissions: ['projects:view_assigned', 'visits:view', 'visits:review'],
    organizationId: 'org-1111',
    mustChangePassword: false,
    ...overrides,
  };
}

describe('Phase 1 Multi-Tenant SaaS & Normalized RBAC', () => {
  it('defines unique canonical permission keys across all 8 governance categories', () => {
    const keys = SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length, 'Duplicate permission key detected');

    const categoriesInCatalog = new Set(SYSTEM_PERMISSIONS_CATALOG.map((p) => p.category));
    for (const category of Object.keys(PERMISSION_CATEGORY_META)) {
      assert.ok(
        categoriesInCatalog.has(category as keyof typeof PERMISSION_CATEGORY_META),
        `Category ${category} has no permissions in SYSTEM_PERMISSIONS_CATALOG`
      );
    }
  });

  it('evaluates hasWebPermission accurately for custom roles and Platform Super Admins', () => {
    assert.equal(hasWebPermission(undefined, 'projects:create'), false);

    const meLead = makeWebUser();
    assert.equal(hasWebPermission(meLead, 'visits:review'), true);
    assert.equal(
      hasWebPermission(meLead, 'tranche:approve_disbursement', 'visits:view'),
      true
    );
    assert.equal(hasWebPermission(meLead, 'roles:create_edit'), false);

    const platformAdmin = makeWebUser({
      isPlatformSuperAdmin: true,
      permissions: [],
    });
    assert.equal(hasWebPermission(platformAdmin, 'roles:create_edit'), true);
    assert.equal(hasWebPermission(platformAdmin, 'retention:release_escrow'), true);
  });

  it('signs web tokens that carry identity only (Phase 2 Step 1)', () => {
    const token = signWebUserToken({ userId: 'user-1111', tenantId: 'tenant-aaa', tokenVersion: 3 });
    const claims = jwt.decode(token) as Record<string, unknown>;
    assert.equal(claims.tokenType, 'WEB_USER');
    assert.equal(claims.userId, 'user-1111');
    assert.equal(claims.tenantId, 'tenant-aaa');
    assert.equal(claims.tokenVersion, 3);
    assert.equal(claims.permissions, undefined);
    assert.equal(claims.roleName, undefined);
  });

  it('scopes buildProjectVisibilityWhere by tenantId and UserProjectAssignment (TD-4)', () => {
    const assignedOnlyUser = makeWebUser({
      userId: 'contractor-99',
      tenantId: 'tenant-xyz',
      permissions: ['projects:view_assigned', 'ipc:submit_claim'],
    });
    const assignedWhere = buildProjectVisibilityWhere(assignedOnlyUser);
    assert.equal(assignedWhere.tenantId, 'tenant-xyz');
    // Phase 11: the access branch sits under AND (assignment, or the organisation tree).
    assert.deepEqual(assignedWhere.AND, [{ userAssignments: { some: { userId: 'contractor-99' } } }]);

    const treeUser = makeWebUser({
      userId: 'org-admin-1',
      tenantId: 'tenant-xyz',
      organizationId: 'org-1',
      permissions: ['projects:view_assigned', 'projects:view_organization_tree'],
    });
    const treeWhere = buildProjectVisibilityWhere(treeUser);
    const branch = (treeWhere.AND as Array<{ OR: unknown[] }>)[0];
    assert.equal(branch.OR.length, 2);
    assert.deepEqual(branch.OR[0], { userAssignments: { some: { userId: 'org-admin-1' } } });

    const tenantWideUser = makeWebUser({
      tenantId: 'tenant-xyz',
      permissions: ['projects:view_all_tenant'],
    });
    const tenantWhere = buildProjectVisibilityWhere(tenantWideUser);
    assert.equal(tenantWhere.tenantId, 'tenant-xyz');
    assert.equal(tenantWhere.AND, undefined);

    const activeOnly = { OR: [{ status: { in: ['ACTIVE'] } }] };
    const platformAdmin = makeWebUser({ isPlatformSuperAdmin: true });
    assert.deepEqual(buildProjectVisibilityWhere(platformAdmin), activeOnly);
    assert.deepEqual(buildProjectVisibilityWhere(platformAdmin, 'tenant-2'), {
      tenantId: 'tenant-2',
      ...activeOnly,
    });
  });

  it('excludes drafts by default and shows them only to their creator or to project creators (Phase 6)', () => {
    const viewer = makeWebUser({ userId: 'viewer-1', tenantId: 't', permissions: ['projects:view_all_tenant'] });
    assert.deepEqual(buildProjectVisibilityWhere(viewer).OR, [{ status: { in: ['ACTIVE'] } }]);
    assert.deepEqual(buildProjectVisibilityWhere(viewer, undefined, { statuses: ['DRAFT'] }).OR, [
      { status: 'DRAFT', createdByUserId: 'viewer-1' },
    ]);
    const creator = makeWebUser({ userId: 'c-1', tenantId: 't', permissions: ['projects:view_all_tenant', 'projects:create'] });
    assert.deepEqual(buildProjectVisibilityWhere(creator, undefined, { statuses: ['ACTIVE', 'DRAFT'] }).OR, [
      { status: { in: ['ACTIVE'] } },
      { status: 'DRAFT' },
    ]);
  });

  it('parses white-label TenantBrandingConfig and falls back safely on malformed input', () => {
    const parsed = parseTenantBranding({
      primaryColorHex: '#1B4332',
      navyColorHex: '#081C15',
      tagline: 'InfraCorp Capital Portal',
    });
    assert.equal(parsed.primaryColorHex, '#1B4332');
    assert.equal(parsed.navyColorHex, '#081C15');
    assert.equal(parsed.tagline, 'InfraCorp Capital Portal');

    const fallback = parseTenantBranding({ primaryColorHex: 'not-a-color' });
    assert.equal(fallback.primaryColorHex, DEFAULT_BRANDING_CONFIG.primaryColorHex);
    assert.equal(fallback.navyColorHex, DEFAULT_BRANDING_CONFIG.navyColorHex);
  });

  it('serializes relational Role & RolePermission records via shared serializeWebUserProfile (TD-7)', () => {
    const mockDbUser = {
      id: 'u-1',
      fullName: 'Adaeze Nwosu',
      email: 'admin@insite.ng',
      isPlatformSuperAdmin: true,
      tenantId: 't-1',
      roleId: 'r-1',
      organizationId: 'o-1',
      professionalRegistrationBodyCode: 'QSRBN',
      professionalRegistrationNumber: '3842',
      tenant: {
        id: 't-1',
        name: 'KPMG Advisory',
        slug: 'kpmg-nigeria',
        status: 'ACTIVE' as const,
        defaultCurrency: 'NGN',
        timezone: 'Africa/Lagos',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        brandingConfig: {
          primaryColorHex: '#00338D',
          navyColorHex: '#0C233C',
          tagline: 'Capital Advisory',
        },
      },
      role: {
        id: 'r-1',
        code: 'TENANT_SUPER_ADMIN',
        name: 'Client Platform Super Admin',
        rolePermissions: [
          { permission: { key: 'roles:create_edit' } },
          { permission: { key: 'tenant:manage_branding' } },
        ],
      },
      organization: {
        name: 'KPMG Advisory Services',
        category: 'ADVISORY_MONITOR',
      },
    } as unknown as Parameters<typeof serializeWebUserProfile>[0];

    const dto = serializeWebUserProfile(mockDbUser);
    assert.equal(dto.roleName, 'Client Platform Super Admin');
    assert.equal(dto.isPlatformSuperAdmin, true);
    assert.deepEqual(dto.permissions, ['roles:create_edit', 'tenant:manage_branding']);
    assert.equal(dto.tenant.brandingConfig.primaryColorHex, '#00338D');
  });
});
