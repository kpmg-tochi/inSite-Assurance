import { z } from 'zod';
import {
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  OrgInputModeEnum,
} from '../enums';
import { GeofenceToleranceMetersSchema, GeofenceRadiusMetersSchema } from './geofence.schema';
import { isValidTimeZone } from '../utils/time';

/**
 * Organisation directory (Phase 6, decision E). An organisation carries a set of tags rather than
 * one fixed type, so the same firm can be a contractor on one project and a client on another.
 */
export const OrganizationDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  categories: z.array(OrganizationCategoryEnum),
  registrationNumber: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  isArchived: z.boolean(),
  /** Phase 11: the organisation above this one (flagship → subsidiary), or null for a root. */
  parentOrganizationId: z.string().uuid().nullable(),
  /** Phase 11: the parent is archived (allowed, but flagged in the directory). */
  parentIsArchived: z.boolean().optional(),
  userCount: z.number().int().optional(),
  projectCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganizationDto = z.infer<typeof OrganizationDtoSchema>;

const OrgName = z.string().trim().min(2, 'Enter at least 2 characters').max(160);

export const CreateOrganizationRequestSchema = z.object({
  name: OrgName,
  categories: z.array(OrganizationCategoryEnum).min(1, 'Choose at least one tag'),
  registrationNumber: z.string().trim().max(64).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  contactPhone: z.string().trim().max(32).nullable().optional(),
  /** Phase 11: parent organisation; null or omitted for a root. Cycles and depth > 5 are refused. */
  parentOrganizationId: z.string().uuid().nullable().optional(),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>;

export const UpdateOrganizationRequestSchema = CreateOrganizationRequestSchema.partial().extend({
  isArchived: z.boolean().optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequestSchema>;

export const ListOrganizationsQuerySchema = z.object({
  tag: OrganizationCategoryEnum.optional(),
  search: z.string().trim().max(160).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
export type ListOrganizationsQuery = z.infer<typeof ListOrganizationsQuerySchema>;

/**
 * A reference to an organisation from a form: an existing directory entry (`id`) or a typed name.
 * Which of the two the server accepts depends on the tenant's `organizationInputMode`.
 */
export const OrganizationRefSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: OrgName.optional(),
  })
  .refine((v) => Boolean(v.id || v.name), { message: 'Choose or enter an organisation' });
export type OrganizationRef = z.infer<typeof OrganizationRefSchema>;

/** Tenant-wide settings that are not branding (Phase 6). */
export const TenantSettingsDtoSchema = z.object({
  organizationInputMode: OrgInputModeEnum,
  enabledGeofenceModes: z.array(GeofenceModeEnum),
  defaultGeofenceToleranceMeters: z.number().int(),
  /** Pre-fills new radial site boundaries (each project sets its own radius). */
  defaultGeofenceRadiusMeters: z.number().int(),
  defaultCurrency: z.string(),
  timezone: z.string(),
});
export type TenantSettingsDto = z.infer<typeof TenantSettingsDtoSchema>;

export const UpdateTenantSettingsRequestSchema = z.object({
  organizationInputMode: OrgInputModeEnum.optional(),
  enabledGeofenceModes: z.array(GeofenceModeEnum).min(1, 'Enable at least one geofence mode').optional(),
  defaultGeofenceToleranceMeters: GeofenceToleranceMetersSchema.optional(),
  defaultGeofenceRadiusMeters: GeofenceRadiusMetersSchema.optional(),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code, e.g. NGN')
    .optional(),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, 'Choose a valid IANA time zone, e.g. Africa/Lagos')
    .optional(),
});
export type UpdateTenantSettingsRequest = z.infer<typeof UpdateTenantSettingsRequestSchema>;
