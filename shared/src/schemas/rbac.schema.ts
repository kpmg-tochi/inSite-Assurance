import { z } from 'zod';
import {
  AssignableFieldPersonaTypeEnum,
  FieldPersonaTypeEnum,
  OrganizationCategoryEnum,
  PermissionCategoryEnum,
  RoleSurfaceEnum,
} from '../enums';

export const TenantBrandingConfigSchema = z.object({
  logoUrl: z.string().max(500).nullable().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hex color (e.g. #00338D)')
    .default('#00338D'),
  navyColorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hex color (e.g. #0C233C)')
    .default('#0C233C'),
  tagline: z.string().max(120).optional(),
  pdfHeaderTitle: z.string().max(160).optional(),
  pdfFooterDisclaimer: z.string().max(500).optional(),
});
export type TenantBrandingConfig = z.infer<typeof TenantBrandingConfigSchema>;

export const TenantDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']),
  defaultCurrency: z.string(),
  timezone: z.string(),
  brandingConfig: TenantBrandingConfigSchema,
  createdAt: z.string().optional(),
});
export type TenantDto = z.infer<typeof TenantDtoSchema>;

export const CreateTenantRequestSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Slug must contain lowercase letters, numbers, and hyphens only'),
  defaultCurrency: z.string().min(3).max(8).default('NGN'),
  timezone: z.string().min(2).max(64).default('Africa/Lagos'),
  brandingConfig: TenantBrandingConfigSchema.optional(),
  adminFullName: z.string().min(2).max(120).optional(),
  adminEmail: z.string().email().optional(),
  adminPassword: z.string().min(8).optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const UpdateTenantBrandingRequestSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  defaultCurrency: z.string().min(3).max(8).optional(),
  timezone: z.string().min(2).max(64).optional(),
  brandingConfig: TenantBrandingConfigSchema,
});
export type UpdateTenantBrandingRequest = z.infer<typeof UpdateTenantBrandingRequestSchema>;

export const PermissionDtoSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: PermissionCategoryEnum,
  surface: RoleSurfaceEnum,
});
export type PermissionDto = z.infer<typeof PermissionDtoSchema>;

export const RoleDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable().optional(),
  /** MOBILE or BOTH: people in the role sign in to the mobile app with their account (R1d: the only way in). */
  surface: RoleSurfaceEnum,
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number().min(0).max(1),
  isSystemDefault: z.boolean(),
  permissions: z.array(PermissionDtoSchema),
  userCount: z.number().int().optional(),
});
export type RoleDto = z.infer<typeof RoleDtoSchema>;

export const CreateRoleRequestSchema = z.object({
  name: z.string().min(2).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, numbers, or underscores')
    .min(2)
    .max(40),
  description: z.string().max(400).optional(),
  surface: RoleSurfaceEnum.default('WEB'),
  fieldPersonaType: AssignableFieldPersonaTypeEnum.default('NONE'),
  assuranceWeight: z.number().min(0.1).max(1.0).default(1.0),
  permissionIds: z.array(z.string().uuid()).min(1, 'Select at least one permission'),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(400).nullable().optional(),
  surface: RoleSurfaceEnum.optional(),
  fieldPersonaType: AssignableFieldPersonaTypeEnum.optional(),
  assuranceWeight: z.number().min(0.1).max(1.0).optional(),
  permissionIds: z.array(z.string().uuid()).min(1).optional(),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const UserProjectAssignmentDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectCodePrefix: z.string().optional(),
  projectName: z.string().optional(),
});
export type UserProjectAssignmentDto = z.infer<typeof UserProjectAssignmentDtoSchema>;

export const TenantUserDtoSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  isActive: z.boolean(),
  isPlatformSuperAdmin: z.boolean(),
  tenantId: z.string().uuid(),
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  organizationCategory: OrganizationCategoryEnum,
  /** All tags of the organisation (Phase 6). */
  organizationCategories: z.array(OrganizationCategoryEnum).optional(),
  phoneNumber: z.string().nullable().optional(),
  /** Pre-provisioned mobile role, when it differs from (or replaces) the main role on mobile. */
  mobileRoleId: z.string().uuid().nullable().optional(),
  mobileRoleName: z.string().nullable().optional(),
  /** True when the user can sign in to the mobile app (main or mobile role is pre-provisioned). */
  hasMobileAccess: z.boolean(),
  hasAllTenantProjects: z.boolean(),
  projectAssignments: z.array(UserProjectAssignmentDtoSchema),
  createdAt: z.string(),
});
export type TenantUserDto = z.infer<typeof TenantUserDtoSchema>;

const PhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number');

export const CreateTenantUserRequestSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  roleId: z.string().uuid(),
  /** A directory organisation, or a typed name (Phase 6: which is accepted depends on the tenant's input mode). */
  organizationId: z.string().uuid().nullable().optional(),
  organizationName: z.string().trim().min(2).max(160).optional(),
  /** Tag added to the organisation if it is created or lacks it. */
  organizationCategory: OrganizationCategoryEnum.default('OTHER'),
  phoneNumber: PhoneNumberSchema.nullable().optional(),
  mobileRoleId: z.string().uuid().nullable().optional(),
  projectIds: z.array(z.string().uuid()).default([]),
}).refine((v) => Boolean(v.organizationId || v.organizationName), {
  message: 'Choose or enter an organisation',
  path: ['organizationName'],
});
export type CreateTenantUserRequest = z.infer<typeof CreateTenantUserRequestSchema>;

export const AssignUserProjectsRequestSchema = z.object({
  roleId: z.string().uuid().optional(),
  /** null removes mobile access granted through a separate mobile role. */
  mobileRoleId: z.string().uuid().nullable().optional(),
  phoneNumber: PhoneNumberSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  projectIds: z.array(z.string().uuid()),
});
export type AssignUserProjectsRequest = z.infer<typeof AssignUserProjectsRequestSchema>;

export const FieldSessionRosterDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  /** The provisioned account the session belongs to. */
  userId: z.string().uuid(),
  userEmail: z.string().nullable(),
  deviceId: z.string(),
  deviceModel: z.string().nullable().optional(),
  /** MobileDevice row; revoking it blocks every project. */
  mobileDeviceId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  lastSyncAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type FieldSessionRosterDto = z.infer<typeof FieldSessionRosterDtoSchema>;

export const UpdateFieldSessionStatusRequestSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().max(400).optional(),
});
export type UpdateFieldSessionStatusRequest = z.infer<
  typeof UpdateFieldSessionStatusRequestSchema
>;

/** A device a provisioned user has signed in on. Revoking it blocks all of that user's projects. */
export const MobileDeviceDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string(),
  userEmail: z.string(),
  mobileRoleName: z.string().nullable(),
  deviceId: z.string(),
  deviceModel: z.string().nullable(),
  deviceOs: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  sessionCount: z.number().int(),
  createdAt: z.string(),
});
export type MobileDeviceDto = z.infer<typeof MobileDeviceDtoSchema>;

export const RevokeMobileDeviceRequestSchema = z.object({
  reason: z.string().max(400).optional(),
});
export type RevokeMobileDeviceRequest = z.infer<typeof RevokeMobileDeviceRequestSchema>;

