import { z } from 'zod';
import { BeneficiaryTypeEnum } from '../enums';
import { NigeriaLgaCodeSchema, NigeriaZoneCodeEnum } from '../data/nigeriaAdminAreas';

/**
 * Delivery models (Phase 11): regions, beneficiaries and the project-type summary carried on
 * project DTOs. The project-type configuration itself is in projectType.schema.ts.
 */

// ---------------------------------------------------------------------------
// Regions (tenant list, two levels: region → area)
// ---------------------------------------------------------------------------

export const REGION_CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

export const RegionDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  /** Null for a region; set for an area inside a region. */
  parentRegionId: z.string().uuid().nullable(),
  parentRegionName: z.string().nullable(),
  isArchived: z.boolean(),
  projectCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RegionDto = z.infer<typeof RegionDtoSchema>;

export const SaveRegionRequestSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(REGION_CODE_REGEX, 'Code: up to 16 letters, digits or dashes, e.g. NW or NW-KANO'),
  /** Set to place an area inside a region. Only two levels: the parent must itself be a region. */
  parentRegionId: z.string().uuid().nullable().optional(),
  isArchived: z.boolean().optional(),
});
export type SaveRegionRequest = z.infer<typeof SaveRegionRequestSchema>;

export const RegionSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  /** "North West › Kano" for an area. */
  path: z.string(),
});
export type RegionSummary = z.infer<typeof RegionSummarySchema>;

// ---------------------------------------------------------------------------
// Beneficiaries (Parties step)
// ---------------------------------------------------------------------------

export const ProjectBeneficiaryInputSchema = z.object({
  /** Existing row; omit to add. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Enter the beneficiary name').max(200),
  beneficiaryType: BeneficiaryTypeEnum,
  contactName: z.string().trim().max(160).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  contactPhone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  isPrimary: z.boolean().default(false),
});
export type ProjectBeneficiaryInput = z.infer<typeof ProjectBeneficiaryInputSchema>;

/** The full beneficiary list. When there are any, exactly one is primary. */
export const ProjectBeneficiaryListSchema = z
  .array(ProjectBeneficiaryInputSchema)
  .max(50)
  .refine((list) => list.length === 0 || list.filter((b) => b.isPrimary).length === 1, {
    message: 'Mark exactly one beneficiary as primary',
  });

export const ProjectBeneficiaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  beneficiaryType: BeneficiaryTypeEnum,
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type ProjectBeneficiaryDto = z.infer<typeof ProjectBeneficiaryDtoSchema>;

// ---------------------------------------------------------------------------
// Project type summary (on project DTOs)
// ---------------------------------------------------------------------------

export const ProjectTypeSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  colour: z.string().nullable(),
  /** The type version the project's snapshot was taken from. */
  version: z.number().int(),
});
export type ProjectTypeSummary = z.infer<typeof ProjectTypeSummarySchema>;

/**
 * Directory, portfolio map and KPI filters (Phase 11). UBEC IRL: LGA (exact, case ignored), the
 * project's contractor organisation, intervention year and funding source (exact, case ignored).
 */
export const ProjectListFiltersSchema = z.object({
  projectTypeId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  owningOrganizationId: z.string().uuid().optional(),
  lga: z.string().trim().min(1).max(120).optional(),
  contractorOrganizationId: z.string().uuid().optional(),
  interventionYear: z.coerce.number().int().min(2000).max(2100).optional(),
  fundingSource: z.string().trim().min(1).max(120).optional(),
  /** Client demo updates C1/C4: zone (derived from the state), state and LGA codes, funding source code. */
  zone: NigeriaZoneCodeEnum.optional(),
  stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  lgaCode: NigeriaLgaCodeSchema.optional(),
  fundingSourceCode: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,40}$/).optional(),
});
export type ProjectListFilters = z.infer<typeof ProjectListFiltersSchema>;
