import { Router, Request, Response, NextFunction } from 'express';
import {
  AssignUserProjectsRequestSchema,
  CreateRoleRequestSchema,
  CreateTenantRequestSchema,
  CreateTenantUserRequestSchema,
  RevokeMobileDeviceRequestSchema,
  UpdateRoleRequestSchema,
  UpdateEvidenceRatingLabelsRequestSchema,
  UpdateTenantBrandingRequestSchema,
  UpdateTenantSettingsRequestSchema,
  UpdateTerminologyRequestSchema,
} from '@insite/shared';
import {
  requirePermission,
  requirePlatformSuperAdmin,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  assignUserProjectsAndRole,
  createRoleForTenant,
  createTenantWithDefaults,
  createUserInTenant,
  deleteRoleForTenant,
  getEvidenceRatingLabels,
  getRoleOnboardingImpact,
  getTenantDetails,
  listMobileDevicesForTenant,
  revokeMobileDevice,
  listAllPermissions,
  listAllTenants,
  listRolesForTenant,
  listUsersForTenant,
  updateEvidenceRatingLabels,
  updateRoleForTenant,
  updateTenantBranding,
} from './rbac.service';
import { getAndVerifyTenantAuditTrail } from '../audit/audit.service';
import { getTenantSettings, updateTenantSettings } from '../organizations/organizations.service';
import { getTerminologySettings, updateTerminologySettings } from '../organizations/terminology.service';

const router = Router();

/**
 * GET /api/v1/rbac/permissions
 * Lists all canonical system permissions grouped for the Role Builder UI.
 */
router.get(
  '/permissions',
  requirePermission('roles:create_edit'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await listAllPermissions();
      res.json({ success: true, data: permissions });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/roles
 * Lists all Web & Mobile roles configured for the active tenant.
 */
router.get(
  '/roles',
  requirePermission('roles:create_edit', 'users:invite_manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await listRolesForTenant(req.webUser!.tenantId);
      res.json({ success: true, data: roles });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rbac/roles
 * Creates a new custom role with relational RolePermission rows.
 */
router.post(
  '/roles',
  requirePermission('roles:create_edit'),
  validateBody(CreateRoleRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createRoleForTenant(req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rbac/roles/:roleId
 * Updates a role's display name, configuration, and RolePermission assignments.
 */
router.put(
  '/roles/:roleId',
  requirePermission('roles:create_edit'),
  validateBody(UpdateRoleRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateRoleForTenant(
        req.webUser!,
        String(req.params.roleId),
        req.body
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/rbac/roles/:roleId
 */
router.delete(
  '/roles/:roleId',
  requirePermission('roles:create_edit'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteRoleForTenant(
        req.webUser!,
        String(req.params.roleId)
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/users
 * Lists users in the active tenant along with their role and project assignments.
 */
router.get(
  '/users',
  requirePermission('users:invite_manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await listUsersForTenant(req.webUser!.tenantId);
      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/roles/:roleId/onboarding-impact
 * What switching the role's onboarding mode would change (shown in the confirmation dialog).
 */
router.get(
  '/roles/:roleId/onboarding-impact',
  requirePermission('roles:create_edit'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const impact = await getRoleOnboardingImpact(req.webUser!, String(req.params.roleId));
      res.json({ success: true, data: impact });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/mobile-devices
 * Devices that pre-provisioned users have signed in on, across the tenant.
 */
router.get(
  '/mobile-devices',
  requirePermission('sessions:revoke_device', 'users:invite_manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const devices = await listMobileDevicesForTenant(req.webUser!.tenantId);
      res.json({ success: true, data: devices });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rbac/mobile-devices/:deviceId/revoke
 * Blocks every project for that user on that device.
 */
router.post(
  '/mobile-devices/:deviceId/revoke',
  requirePermission('sessions:revoke_device'),
  validateBody(RevokeMobileDeviceRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const device = await revokeMobileDevice(req.webUser!, String(req.params.deviceId), req.body.reason);
      res.json({ success: true, data: device });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rbac/users
 * Creates a new user inside the active tenant with an assigned custom role and project scope.
 */
router.post(
  '/users',
  requirePermission('users:invite_manage'),
  validateBody(CreateTenantUserRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createUserInTenant(req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rbac/users/:userId/assignments
 * Updates a user's assigned Role, active status, and UserProjectAssignment visibility scope.
 */
router.put(
  '/users/:userId/assignments',
  requirePermission('users:invite_manage'),
  validateBody(AssignUserProjectsRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await assignUserProjectsAndRole(
        req.webUser!,
        String(req.params.userId),
        req.body
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/tenant
 * Returns current tenant configuration & white-label branding.
 */
router.get(
  '/tenant',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenant = await getTenantDetails(req.webUser!.tenantId);
      res.json({ success: true, data: tenant });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rbac/tenant/branding
 * Updates tenant name, currency, timezone, and white-label brandingConfig.
 */
router.put(
  '/tenant/branding',
  requirePermission('tenant:manage_branding'),
  validateBody(UpdateTenantBrandingRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateTenantBranding(req.webUser!, req.body);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/tenant/settings
 * Organisation input mode, geofence modes and tolerance, currency and time zone. Readable by any
 * web user of the tenant (forms need them); changed with `tenant:manage_settings`.
 */
router.get(
  '/tenant/settings',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getTenantSettings(req.webUser!.tenantId) });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /api/v1/rbac/tenant/settings */
router.put(
  '/tenant/settings',
  requirePermission('tenant:manage_settings'),
  validateBody(UpdateTenantSettingsRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await updateTenantSettings(req.webUser!, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/tenant/settings/rating-labels
 * Tenant overrides plus the resolved label, description and fixed colour per canonical rating.
 */
router.get(
  '/tenant/settings/rating-labels',
  requirePermission('tenant:manage_settings'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getEvidenceRatingLabels(req.webUser!.tenantId) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rbac/tenant/settings/rating-labels
 * Display label and description only; canonical values never change (decision B).
 */
router.put(
  '/tenant/settings/rating-labels',
  requirePermission('tenant:manage_settings'),
  validateBody(UpdateEvidenceRatingLabelsRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await updateEvidenceRatingLabels(req.webUser!, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/tenant/settings/terminology (Phase 11)
 * Tenant wording overrides plus the resolved terms. Every signed-in user already receives the
 * resolved terms on their profile; this is for the editor.
 */
router.get(
  '/tenant/settings/terminology',
  requirePermission('tenant:manage_settings'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getTerminologySettings(req.webUser!.tenantId) });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /api/v1/rbac/tenant/settings/terminology: display words only; API values never change. */
router.put(
  '/tenant/settings/terminology',
  requirePermission('tenant:manage_settings'),
  validateBody(UpdateTerminologyRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await updateTerminologySettings(req.webUser!, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/audit-trail
 * Tenant-scope hash chain: role, user, branding and sign-in lockout events.
 */
router.get(
  '/audit-trail',
  requirePermission('audit:view_ledger'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const trail = await getAndVerifyTenantAuditTrail(req.webUser!.tenantId);
      res.json({ success: true, data: trail });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rbac/tenants
 * Platform Super Admin endpoint: list all tenants across the SaaS platform.
 */
router.get(
  '/tenants',
  requirePlatformSuperAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tenants = await listAllTenants();
      res.json({ success: true, data: tenants });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rbac/tenants
 * Platform Super Admin endpoint: provision a new client tenant with default roles and optional admin.
 */
router.post(
  '/tenants',
  requirePlatformSuperAdmin,
  validateBody(CreateTenantRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createTenantWithDefaults(req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

export const rbacRoutes = router;
