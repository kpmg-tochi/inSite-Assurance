import { z } from 'zod';
import {
  ConditionPrecedentStatusEnum,
  IndependenceTierEnum,
  PortfolioHealthEnum,
  ReportingCadenceEnum,
} from '../enums';
import { ProjectGeofenceSchema } from './geofence.schema';

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

/**
 * Project Creation & Baseline Setup Schema
 */
export const CreateProjectRequestSchema = z.object({
  name: z.string().min(3).max(200),
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}-[0-9]{3}$/, 'Format must be e.g. LKK-402 or ABJ-105'),
  stateLocation: z.string().min(2).max(80), // e.g., "Lagos State", "FCT Abuja", "Rivers State"
  lgaLocation: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  totalBudgetNgn: z.number().positive(),
  reportingCadence: ReportingCadenceEnum.default('WEEKLY'),
  geofence: ProjectGeofenceSchema,
  lenderOrganizationName: z.string().min(2).max(160),
  contractorOrganizationName: z.string().min(2).max(160),
  tranches: z.array(FacilityTrancheInputSchema).min(1),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectBaselineSchema = CreateProjectRequestSchema.partial();
export type UpdateProjectBaseline = z.infer<typeof UpdateProjectBaselineSchema>;

/**
 * Project Join Code DTO
 */
export const ProjectJoinCodeDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(), // e.g., "LKK-402-INS", "LKK-402-COW", "LKK-402-CON"
  independenceTier: IndependenceTierEnum,
  isActive: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});
export type ProjectJoinCodeDto = z.infer<typeof ProjectJoinCodeDtoSchema>;

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
  contractorName: z.string(),
  lenderName: z.string(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  activeTrancheNumber: z.number().nullable().optional(),
  portfolioHealth: PortfolioHealthEnum,
  openConflictCount: z.number(),
  unfulfilledHoldPointCount: z.number(),
  pendingContractorCount: z.number(),
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

