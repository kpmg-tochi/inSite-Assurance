import { PortfolioRetentionItemSchema } from './retention.schema';
import { z } from 'zod';
import {
  ConditionPrecedentStatusEnum,
  FieldPersonaTypeEnum,
  PortfolioHealthEnum,
  RoleOnboardingModeEnum,
} from '../enums';
import { ProjectGeofenceSchema } from './geofence.schema';
import { ScheduleVarianceBadgeSchema } from './schedule.schema';

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
});
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

