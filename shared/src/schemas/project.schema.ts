import { PortfolioRetentionItemSchema } from './retention.schema';
import { TranchePaymentInputSchema } from './milestonePayment.schema';
import { z } from 'zod';
import {
  ConditionPrecedentStatusEnum,
  ConstructionPhaseEnum,
  ProjectStatusEnum,
  FieldPersonaTypeEnum,
  PortfolioHealthEnum,
  RoleOnboardingModeEnum,
} from '../enums';
import { ProjectGeofenceSchema } from './geofence.schema';
import { ScheduleVarianceBadgeSchema } from './schedule.schema';
import { ProjectBeneficiaryDtoSchema, ProjectTypeSummarySchema, RegionSummarySchema } from './deliveryModel.schema';

/**
 * Phase 11: the delivery-model fields every project list row carries (directory, portfolio map,
 * executive matrix), for the type chip and the type / region / owner filters.
 */
export const ProjectDeliveryModelFieldsSchema = z.object({
  projectType: ProjectTypeSummarySchema.nullable(),
  region: RegionSummarySchema.nullable(),
  owningOrganization: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** The primary beneficiary (pre-fills the handover link recipient). */
  primaryBeneficiary: ProjectBeneficiaryDtoSchema.nullable().optional(),
});
export type ProjectDeliveryModelFields = z.infer<typeof ProjectDeliveryModelFieldsSchema>;

/**
 * Facility Tranche & Condition Precedent (CP) Schemas (Section 4.A Role 1)
 */
export const ConditionPrecedentInputSchema = z.object({
  id: z.string().uuid().optional(),
  referenceCode: z.string().min(1).max(32), // e.g., "CP-01"
  description: z.string().min(4).max(500),  // e.g., "Approved Environmental Impact Assessment & Geotechnical Soil Report"
  isMandatoryForRelease: z.boolean().default(true),
  status: ConditionPrecedentStatusEnum.default('PENDING'),
  evidenceDocumentUrl: z.string().url().nullable().optional(),
});
export type ConditionPrecedentInput = z.infer<typeof ConditionPrecedentInputSchema>;

export const FacilityTrancheInputSchema = z.object({
  id: z.string().uuid().optional(),
  trancheNumber: z.number().int().min(1),
  name: z.string().min(2).max(120), // e.g., "Tranche 2 — Substructure & Drainage Culverts"
  allocatedAmountNgn: z.number().positive(),
  targetCompletionPct: z.number().min(0).max(100),
  conditionsPrecedent: z.array(ConditionPrecedentInputSchema).default([]),
}).merge(TranchePaymentInputSchema); // Phase 12: payment basis and completion rule
export type FacilityTrancheInput = z.infer<typeof FacilityTrancheInputSchema>;

// Project creation is staged (Phase 6): see projectSetup.schema.ts for the draft and step schemas.

/**
 * Project Join Code DTO (Dynamic Mobile Role Binding)
 */
export const ProjectJoinCodeDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(), // e.g., "LKK-402-CON-7K2QXM"
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  requiresIdentityAssurance: z.boolean(),
  /** Codes of a role switched to PROVISIONED_ACCOUNT are deactivated and cannot be reissued. */
  roleOnboardingMode: RoleOnboardingModeEnum.optional(),
  /** Contractor package the code binds sessions to (Phase 6), or null for project-wide codes. */
  projectContractorId: z.string().uuid().nullable().optional(),
  contractorName: z.string().nullable().optional(),
  tradeCode: z.string().nullable().optional(),
  isActive: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  maxUses: z.number().int().positive().nullable().optional(),
  useCount: z.number().int().nonnegative().optional(),
});
export type ProjectJoinCodeDto = z.infer<typeof ProjectJoinCodeDtoSchema>;

export const IssueJoinCodeRequestSchema = z.object({
  roleId: z.string().uuid(),
  /** Required for contractor-executor roles on projects with more than one contractor. */
  projectContractorId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().positive().max(10000).nullable().optional(),
});
export type IssueJoinCodeRequest = z.infer<typeof IssueJoinCodeRequestSchema>;

export const RotateJoinCodeRequestSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().positive().max(10000).nullable().optional(),
});
export type RotateJoinCodeRequest = z.infer<typeof RotateJoinCodeRequestSchema>;

/**
 * Portfolio Map Summary Item (Used by Lender National Geospatial Portfolio Map)
 */
export const PortfolioProjectPinSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  stateLocation: z.string(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  portfolioHealth: PortfolioHealthEnum,
  geofence: ProjectGeofenceSchema,
  openConflictCount: z.number().int(),
  unfulfilledHoldPointCount: z.number().int(),
  lastFieldCaptureAt: z.string().datetime().nullable(),
});
export type PortfolioProjectPin = z.infer<typeof PortfolioProjectPinSchema>;

/**
 * Portfolio Executive Summary for Lenders & Senior Risk Monitors
 */
export const PortfolioProjectHealthItemSchema = z.object({
  projectId: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  stateLocation: z.string(),
  /** Main contractor (or the only one); "" when none is set. */
  contractorName: z.string(),
  /** Number of contractors on the project; the UI shows "+N" for the others. */
  contractorCount: z.number().int(),
  lenderName: z.string(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  activeTrancheNumber: z.number().nullable().optional(),
  portfolioHealth: PortfolioHealthEnum,
  openConflictCount: z.number(),
  unfulfilledHoldPointCount: z.number(),
  pendingContractorCount: z.number(),
  /** Phase 9: stored by the schedule-variance job; null without a baseline. */
  scheduleVariance: ScheduleVarianceBadgeSchema.nullable().optional(),
  /** Phase 10: set when the retention module is on for the project. */
  retention: PortfolioRetentionItemSchema.nullable().optional(),
  ...ProjectDeliveryModelFieldsSchema.shape,
});
export type PortfolioProjectHealthItem = z.infer<
  typeof PortfolioProjectHealthItemSchema
>;

export const PortfolioExecutiveSummaryDtoSchema = z.object({
  totalPortfolioCommitmentNgn: z.number(),
  totalDisbursedToDateNgn: z.number(),
  totalRecommendedHoldbackNgn: z.number(),
  activeProjectsCount: z.number(),
  supportedCount: z.number(),
  partialCount: z.number(),
  conflictCount: z.number(),
  pendingContractorVerificationsCount: z.number(),
  projects: z.array(PortfolioProjectHealthItemSchema),
});
export type PortfolioExecutiveSummaryDto = z.infer<
  typeof PortfolioExecutiveSummaryDtoSchema
>;


// ---------------------------------------------------------------------------
// Portfolio dashboard (map + KPI cards), permission projects:view_portfolio
// ---------------------------------------------------------------------------

/** One project on the portfolio map. "point" is the geofence centroid (server-computed). */
export const PortfolioOverviewProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  status: ProjectStatusEnum,
  constructionPhase: ConstructionPhaseEnum,
  stateLocation: z.string(),
  lgaLocation: z.string().nullable(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  portfolioHealth: PortfolioHealthEnum,
  openConflictCount: z.number().int(),
  unfulfilledHoldPointCount: z.number().int(),
  lastFieldCaptureAt: z.string().nullable(),
  scheduleVariance: ScheduleVarianceBadgeSchema.nullable(),
  geofence: ProjectGeofenceSchema.nullable(),
  point: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  ...ProjectDeliveryModelFieldsSchema.shape,
});
export type PortfolioOverviewProject = z.infer<typeof PortfolioOverviewProjectSchema>;

/** Days without a field capture after which a live site counts as quiet. */
export const PORTFOLIO_QUIET_SITE_DAYS = 7;

export const PortfolioOverviewKpisSchema = z.object({
  projectCount: z.number().int(),
  totalCommitmentNgn: z.number(),
  totalDisbursedNgn: z.number(),
  /** Disbursed / commitment, 0–100. */
  disbursedPct: z.number(),
  /** Budget-weighted certified progress, 0–100. */
  weightedProgressPct: z.number(),
  healthCounts: z.object({ supported: z.number().int(), partial: z.number().int(), conflict: z.number().int() }),
  behindScheduleCount: z.number().int(),
  openConflictLineCount: z.number().int(),
  unfulfilledHoldPointCount: z.number().int(),
  /** Live projects in active construction with no capture for PORTFOLIO_QUIET_SITE_DAYS. */
  quietSiteCount: z.number().int(),
  /** Projects in handover or their defects liability period. */
  closeoutCount: z.number().int(),
  retentionHeldNgn: z.number(),
});
export type PortfolioOverviewKpis = z.infer<typeof PortfolioOverviewKpisSchema>;

export const PortfolioOverviewDtoSchema = z.object({
  kpis: PortfolioOverviewKpisSchema,
  projects: z.array(PortfolioOverviewProjectSchema),
});
export type PortfolioOverviewDto = z.infer<typeof PortfolioOverviewDtoSchema>;
