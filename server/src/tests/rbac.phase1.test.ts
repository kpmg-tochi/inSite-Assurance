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
    permissions: ['projects:view_assigned', 'reports:view_all', 'reports:approve_completion'],
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
    assert.equal(hasWebPermission(meLead, 'reports:approve_completion'), true);
    assert.equal(
      hasWebPermission(meLead, 'tranche:approve_disbursement', 'reports:view_all'),
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
    assert.deepEqual(assignedWhere.userAssignments, {
      some: { userId: 'contractor-99' },
    });

    const tenantWideUser = makeWebUser({
      tenantId: 'tenant-xyz',
      permissions: ['projects:view_all_tenant'],
    });
    const tenantWhere = buildProjectVisibilityWhere(tenantWideUser);
    assert.equal(tenantWhere.tenantId, 'tenant-xyz');
    assert.equal(tenantWhere.userAssignments, undefined);

    const platformAdmin = makeWebUser({ isPlatformSuperAdmin: true });
    assert.deepEqual(buildProjectVisibilityWhere(platformAdmin), {});
    assert.deepEqual(buildProjectVisibilityWhere(platformAdmin, 'tenant-2'), {
      tenantId: 'tenant-2',
    });
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
      professionalLicenseType: 'QSRBN',
      professionalLicenseNumber: '3842',
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
