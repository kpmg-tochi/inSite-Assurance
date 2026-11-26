import { z } from 'zod';

/**
 * Client demo updates F.1–F.3 (wave 2): the contractor register. Contractors stay `Organization`
 * rows tagged CONTRACTOR (no login, decision P2) with register fields: status, TIN, address, state.
 * A contractor created in the register is INACTIVE until a signed contract for one of its projects
 * is on file (uploaded or signed off, `CONTRACT` document type); SUSPENDED comes from a decision
 * (wave 3). Existing contractors default to ACTIVE. The rating (0–5 stars) is computed from
 * accepted monitoring reports, work phase verification, findings and closure ratings
 * (`contractorReliability`, utils/contractorRating.ts) and stored nightly as a snapshot.
 */

export const ContractorStatusEnum = z.enum(['INACTIVE', 'ACTIVE', 'SUSPENDED']);
export type ContractorStatus = z.infer<typeof ContractorStatusEnum>;

export const CONTRACTOR_STATUS_LABELS: Record<ContractorStatus, string> = {
  INACTIVE: 'Inactive: contract not yet on file',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
};

/** CAC registration: RC (company), BN (business name) or IT (incorporated trustees) and digits. */
export const RC_NUMBER_REGEX = /^(RC|BN|IT)\s?-?\d{3,9}$/i;

export function normaliseRcNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(RC|BN|IT)\s?-?(\d{3,9})$/i.exec(value.trim());
  return m ? `${m[1].toUpperCase()} ${m[2]}` : value.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Settings (tenant: Tenant.contractorPerformanceJson; every key defaulted)
// ---------------------------------------------------------------------------

export const ContractorRatingWeightsSchema = z
  .object({
    workmanship: z.number().min(0).max(1).default(0.4),
    schedule: z.number().min(0).max(1).default(0.2),
    findings: z.number().min(0).max(1).default(0.2),
    closure: z.number().min(0).max(1).default(0.2),
  })
  .default({});

/** Wave 3 (F.4): flag a contractor on a project when N accepted reports within D days rate workmanship ≤ T. */
export const ContractorFlagRuleSchema = z
  .object({
    enabled: z.boolean().default(true),
    reportCount: z.number().int().min(1).max(20).default(3),
    workmanshipAtOrBelow: z.number().min(1).max(5).default(3),
    withinDays: z.number().int().min(7).max(365).default(60),
  })
  .default({});

export const ContractorPerformanceSettingsSchema = z
  .object({
    weights: ContractorRatingWeightsSchema,
    /** Reports older than this are not counted. */
    windowMonths: z.number().int().min(3).max(60).default(24),
    /** A report's weight halves every N months. */
    halfLifeMonths: z.number().int().min(1).max(36).default(6),
    /** Shown as "Not yet rated" below this many accepted reports. */
    minReports: z.number().int().min(1).max(50).default(5),
    flagRule: ContractorFlagRuleSchema,
  })
  .default({});
export type ContractorPerformanceSettings = z.infer<typeof ContractorPerformanceSettingsSchema>;

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export const ContractorRatingComponentKeyEnum = z.enum(['WORKMANSHIP', 'SCHEDULE', 'FINDINGS', 'CLOSURE']);
export type ContractorRatingComponentKey = z.infer<typeof ContractorRatingComponentKeyEnum>;

export const CONTRACTOR_RATING_COMPONENT_LABELS: Record<ContractorRatingComponentKey, string> = {
  WORKMANSHIP: 'Workmanship on monitoring reports',
  SCHEDULE: 'Work phases met on time and mobilisation',
  FINDINGS: 'Major and critical findings, and how fast they were rectified',
  CLOSURE: 'Closure ratings on completed projects',
};

export const ContractorRatingComponentSchema = z.object({
  key: ContractorRatingComponentKeyEnum,
  label: z.string(),
  /** 0–5; null when there is nothing to score yet (its weight is spread over the others). */
  score: z.number().nullable(),
  /** The weight applied (after spreading). */
  weight: z.number(),
  /** One line on what it is based on, e.g. "38 reports, average 3.8 of 5". */
  basis: z.string(),
});
export type ContractorRatingComponent = z.infer<typeof ContractorRatingComponentSchema>;

export const ContractorReliabilityDtoSchema = z.object({
  /** True from `minReports` accepted reports. */
  rated: z.boolean(),
  /** 0–5 with one decimal; null when not rated. */
  score: z.number().nullable(),
  /** Rounded to the half star; null when not rated. */
  stars: z.number().nullable(),
  reportCount: z.number().int(),
  projectCount: z.number().int(),
  components: z.array(ContractorRatingComponentSchema),
  /** "★★★½ 3.6 · 42 reports on 5 projects" or "Not yet rated: 2 reports". */
  summary: z.string(),
  computedAt: z.string().nullable(),
});
export type ContractorReliabilityDto = z.infer<typeof ContractorReliabilityDtoSchema>;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export const ContractorSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  registrationNumber: z.string().nullable(),
  status: ContractorStatusEnum,
  stateCode: z.string().nullable(),
  rating: ContractorReliabilityDtoSchema,
  activeProjectCount: z.number().int(),
  completedProjectCount: z.number().int(),
  /** State codes of its projects. */
  statesWorkedIn: z.array(z.string()),
  /** Wave 3 (F.4); 0 until flags exist. */
  openFlagCount: z.number().int(),
});
export type ContractorSummaryDto = z.infer<typeof ContractorSummaryDtoSchema>;

export const ContractorProjectDtoSchema = z.object({
  projectId: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  interventionYear: z.number().int().nullable(),
  stateCode: z.string().nullable(),
  /** CURRENT (active, not closed), COMPLETED (closed or archived), TERMINATED (engagement terminated), DRAFT. */
  standing: z.enum(['DRAFT', 'CURRENT', 'COMPLETED', 'TERMINATED']),
  contractSumNgn: z.number().nullable(),
  progressPct: z.number(),
  /** Accepted monitoring reports with a workmanship rating on this project. */
  reportCount: z.number().int(),
  /** Average workmanship (1–5) on this project; null without reports. */
  averageWorkmanship: z.number().nullable(),
});
export type ContractorProjectDto = z.infer<typeof ContractorProjectDtoSchema>;

export const ContractorDetailDtoSchema = ContractorSummaryDtoSchema.extend({
  tin: z.string().nullable(),
  address: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  projects: z.array(ContractorProjectDtoSchema),
  canManage: z.boolean(),
});
export type ContractorDetailDto = z.infer<typeof ContractorDetailDtoSchema>;

/** GET /api/v1/contractors */
export const ContractorListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: ContractorStatusEnum.optional(),
  stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  /** "true": only contractors with an open flag (wave 3). */
  flagged: z.enum(['true', 'false']).optional(),
});
export type ContractorListQuery = z.infer<typeof ContractorListQuerySchema>;

const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** POST /api/v1/contractors (creates it INACTIVE). Duplicates: 409 CONTRACTOR_DUPLICATE with `candidates`. */
export const CreateContractorRequestSchema = z.object({
  name: z.string().trim().min(3, 'Enter the registered name').max(200),
  registrationNumber: z
    .string()
    .trim()
    .regex(RC_NUMBER_REGEX, 'Use the CAC number, e.g. RC 1234567')
    .nullable()
    .optional(),
  tin: OptionalText(30),
  address: OptionalText(300),
  stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  contactEmail: z.string().trim().email('Enter a valid email').max(200).nullable().optional(),
  contactPhone: OptionalText(40),
  /** Create even though close name matches exist (exact RC matches are always refused). */
  confirmNotDuplicate: z.boolean().optional(),
});
export type CreateContractorRequest = z.infer<typeof CreateContractorRequestSchema>;

/** PUT /api/v1/contractors/:id (profile fields; omitted keeps). */
export const UpdateContractorRequestSchema = CreateContractorRequestSchema.omit({ confirmNotDuplicate: true }).partial();
export type UpdateContractorRequest = z.infer<typeof UpdateContractorRequestSchema>;

/** POST /api/v1/contractors/:id/status (audited; reason required). */
export const ChangeContractorStatusRequestSchema = z.object({
  status: ContractorStatusEnum,
  reason: z.string().trim().min(5, 'Say why').max(500),
});
export type ChangeContractorStatusRequest = z.infer<typeof ChangeContractorStatusRequestSchema>;

/** The body of 409 CONTRACTOR_DUPLICATE (in `error.details`) and of GET /contractors/duplicates?name=&rc=. */
export const ContractorDuplicateCandidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  registrationNumber: z.string().nullable(),
  status: ContractorStatusEnum,
  /** EXACT_RC (always refused) or SIMILAR_NAME (allowed with confirmNotDuplicate). */
  match: z.enum(['EXACT_RC', 'SIMILAR_NAME']),
});
export type ContractorDuplicateCandidate = z.infer<typeof ContractorDuplicateCandidateSchema>;
