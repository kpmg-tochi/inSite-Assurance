import { z } from 'zod';
import {
  ConstructionPhaseEnum,
  GeofenceModeEnum,
  ProjectStatusEnum,
} from '../enums';
import { ProjectGeofenceSchema } from './geofence.schema';
import { ScheduleVarianceBadgeSchema } from './schedule.schema';
import { ProjectBeneficiaryDtoSchema, ProjectTypeSummarySchema, RegionSummarySchema } from './deliveryModel.schema';
import { ProjectStageSummarySchema } from './projectOverview.schema';

/**
 * Phase 11: the delivery-model fields every project list row carries (directory and portfolio
 * map), for the type chip and the type / region / owner filters.
 */
export const ProjectDeliveryModelFieldsSchema = z.object({
  projectType: ProjectTypeSummarySchema.nullable(),
  region: RegionSummarySchema.nullable(),
  owningOrganization: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** The primary beneficiary (pre-fills the handover response). */
  primaryBeneficiary: ProjectBeneficiaryDtoSchema.nullable().optional(),
});
export type ProjectDeliveryModelFields = z.infer<typeof ProjectDeliveryModelFieldsSchema>;

// Project creation is staged (Phase 6): see projectSetup.schema.ts for the draft and step schemas.

/**
 * GET /projects/:id/baseline (without its BOQ) and the core of every GET /projects row. Drafts are
 * not in the directory (see /projects/drafts). Redesign R6c (D-R6.22): moved here from the web's
 * hand-written types.
 */
export const ProjectCoreDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: ProjectStatusEnum,
  /** Phase 10: where an active project is in its life. */
  constructionPhase: ConstructionPhaseEnum,
  practicalCompletionDate: z.string().nullable(),
  retentionEndDate: z.string().nullable(),
  /** Phase 10: percentage withheld from each payment (applies only with the retention module on). */
  retentionPercentage: z.number().nullable(),
  name: z.string(),
  codePrefix: z.string(),
  stateLocation: z.string(),
  lgaLocation: z.string().nullable(),
  description: z.string().nullable(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  workdayStartTime: z.string(),
  workdayEndTime: z.string(),
  /** IANA zone of the project (dates, deadlines and visit days). */
  timezone: z.string(),
  geofenceMode: GeofenceModeEnum.nullable(),
  geofence: ProjectGeofenceSchema.nullable(),
  /** Effective tolerance band outside the boundary, in metres. */
  geofenceToleranceMeters: z.number(),
  /** Phase 9: variance badge stored by the schedule-variance job; null until computed. */
  scheduleVariance: ScheduleVarianceBadgeSchema.nullable(),
  monitorOrganizationName: z.string(),
  lenderOrganizationName: z.string(),
  /** The project's contractor (one per project since R1d). */
  contractorOrganizationName: z.string(),
  contractorCount: z.number().int(),
  contractors: z.array(
    z.object({
      id: z.string().uuid(),
      organizationId: z.string().uuid(),
      organizationName: z.string(),
      tradeCategory: z.string(),
      tradeCode: z.string(),
    })
  ),
  activatedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ProjectDeliveryModelFieldsSchema.shape,
});
export type ProjectCoreDto = z.infer<typeof ProjectCoreDtoSchema>;

/**
 * One GET /projects row. The list-only fields are optional because the web also types the baseline
 * (`ProjectCoreDto` + BOQ) with this shape.
 */
export const ProjectSummaryDtoSchema = ProjectCoreDtoSchema.extend({
  /** Redesign R6c (D-R6.22): the stage chip, from the batched stage loader. */
  stage: ProjectStageSummarySchema.nullable().optional(),
  /** Phase 13: open contract milestones past their due date (today in the project zone). */
  overdueMilestoneCount: z.number().int().optional(),
  totalBoqItems: z.number().int().optional(),
  opaqueLumpSumCount: z.number().int().optional(),
  lastFieldCaptureAt: z.string().nullable().optional(),
});
export type ProjectSummaryDto = z.infer<typeof ProjectSummaryDtoSchema>;

/**
 * Portfolio map summary item
 */
export const PortfolioProjectPinSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  stateLocation: z.string(),
  totalBudgetNgn: z.number(),
  disbursedToDateNgn: z.number(),
  certifiedProgressPct: z.number(),
  geofence: ProjectGeofenceSchema,
  lastFieldCaptureAt: z.string().datetime().nullable(),
});
export type PortfolioProjectPin = z.infer<typeof PortfolioProjectPinSchema>;



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
  lastFieldCaptureAt: z.string().nullable(),
  scheduleVariance: ScheduleVarianceBadgeSchema.nullable(),
  geofence: ProjectGeofenceSchema.nullable(),
  point: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  /** Redesign R6c (D-R6.22): the stage chip. */
  stage: ProjectStageSummarySchema.nullable(),
  ...ProjectDeliveryModelFieldsSchema.shape,
});
export type PortfolioOverviewProject = z.infer<typeof PortfolioOverviewProjectSchema>;

/** Days without a field capture after which a live site counts as quiet. */
export const PORTFOLIO_QUIET_SITE_DAYS = 7;

export const PortfolioOverviewKpisSchema = z.object({
  projectCount: z.number().int(),
  totalCommitmentNgn: z.number(),
  totalDisbursedNgn: z.number(),
  /** Paid (net, from the payment record) / commitment, 0–100. */
  disbursedPct: z.number(),
  /** Budget-weighted certified progress, 0–100. */
  weightedProgressPct: z.number(),
  behindScheduleCount: z.number().int(),
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
