import { z } from 'zod';
import { ApprovalOrganizationScopeEnum } from '../enums';
import { NigeriaLgaCodeSchema, NigeriaStateCodeSchema } from '../data/nigeriaAdminAreas';
import { FACILITY_CODE_REGEX } from './facility.schema';
import { FACILITY_UNIT_CODE_REGEX, UnitOfMeasureEnum } from './scope.schema';
import { SchoolLevelEnum } from './site.schema';
import { LotChoiceSchema } from './lot.schema';
import { APPROVED_LIST_COLUMNS, type ApprovedListColumn } from './approvedList.schema';

/**
 * Needs pipeline (plan `saas_updates/needs_pipeline_implementation_plan.md`, wave 1 = N1 contracts).
 *
 * A proposed project (`NeedsProposal`) is not a `Project` (D-N.1): it moves through the stages of
 * its annual cycle and becomes a draft project only at the funding gate (Direct Intervention:
 * appropriation; Matching Grants: UBEC's approval of the State's BEAP).
 *
 * Stage and status are separate (D-N.2): the stage list is type config (`needsPipeline.stages`), the
 * statuses are fixed. Versions are never overwritten (D-N.3); validation, scoring and approval are
 * decision records, not new files.
 *
 * Names here are binding for waves 2–5 (parent plan section 17). Shapes marked "wave N settles" may
 * gain fields when that wave builds the service.
 */

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const Money = z.number().nonnegative();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** The stages a proposal can pass, in flow order. A type uses a subset (Matching Grants: no DESIGN). */
export const NeedsStageEnum = z.enum(['IDENTIFICATION', 'VALIDATION', 'DESIGN', 'COSTING', 'PRIORITISATION', 'APPROVAL', 'FUNDING']);
export type NeedsStage = z.infer<typeof NeedsStageEnum>;
export const NEEDS_STAGE_ORDER: readonly NeedsStage[] = NeedsStageEnum.options;

/** Default stage names (a type may rename them: Matching Grants calls VALIDATION "Field verification"). */
export const NEEDS_STAGE_LABELS: Record<NeedsStage, string> = {
  IDENTIFICATION: 'Identification',
  VALIDATION: 'Validation',
  DESIGN: 'Needs assessment completion',
  COSTING: 'Costing',
  PRIORITISATION: 'Prioritisation',
  APPROVAL: 'Approval',
  FUNDING: 'Funding',
};

/** D-N.2. Fixed; labels combine stage and status (`proposalStatusLabel`). */
export const NeedsProposalStatusEnum = z.enum([
  'DRAFT',
  'IN_PROGRESS',
  'RETURNED',
  'CONVERTED',
  'NOT_VALIDATED',
  'NOT_SELECTED',
  'WITHDRAWN',
  'MERGED',
]);
export type NeedsProposalStatus = z.infer<typeof NeedsProposalStatusEnum>;

/** Statuses a proposal can still move from. */
export const NEEDS_OPEN_PROPOSAL_STATUSES: readonly NeedsProposalStatus[] = ['DRAFT', 'IN_PROGRESS', 'RETURNED'];

export const NeedsCycleStatusEnum = z.enum(['DRAFT', 'OPEN', 'CLOSED']);
export type NeedsCycleStatus = z.infer<typeof NeedsCycleStatusEnum>;

/** Why a needs assessment version exists (D-N.3: only content changes make a version). */
export const NeedsVersionSourceEnum = z.enum(['UPLOAD', 'CORRECTION', 'COSTING', 'BEAP_REVISION', 'CARRY_FORWARD']);
export type NeedsVersionSource = z.infer<typeof NeedsVersionSourceEnum>;

export const NEEDS_VERSION_SOURCE_LABELS: Record<NeedsVersionSource, string> = {
  UPLOAD: 'Uploaded',
  CORRECTION: 'Correction',
  COSTING: 'Costed version',
  BEAP_REVISION: 'BEAP revision',
  CARRY_FORWARD: 'Carried forward',
};

export const NeedsProposalRouteEnum = z.enum(['ANNUAL', 'OUT_OF_CYCLE']);
export type NeedsProposalRoute = z.infer<typeof NeedsProposalRouteEnum>;

/** Plan 6.3: what is done to the facility. */
export const InterventionActionEnum = z.enum(['NEW_CONSTRUCTION', 'RENOVATION', 'EXPANSION', 'FURNISHING', 'EQUIPPING', 'REPLACEMENT']);
export type InterventionAction = z.infer<typeof InterventionActionEnum>;

export const INTERVENTION_ACTION_LABELS: Record<InterventionAction, string> = {
  NEW_CONSTRUCTION: 'New construction',
  RENOVATION: 'Renovation',
  EXPANSION: 'Expansion',
  FURNISHING: 'Furnishing',
  EQUIPPING: 'Equipping',
  REPLACEMENT: 'Replacement',
};

export const ExistingConditionEnum = z.enum(['FUNCTIONAL', 'PARTLY_FUNCTIONAL', 'DILAPIDATED', 'NON_FUNCTIONAL', 'ABSENT']);
export type ExistingCondition = z.infer<typeof ExistingConditionEnum>;

export const EXISTING_CONDITION_LABELS: Record<ExistingCondition, string> = {
  FUNCTIONAL: 'Functional',
  PARTLY_FUNCTIONAL: 'Partly functional',
  DILAPIDATED: 'Dilapidated',
  NON_FUNCTIONAL: 'Non-functional',
  ABSENT: 'Absent',
};

export const FacilityCriticalityEnum = z.enum(['ESSENTIAL', 'HIGH', 'MEDIUM', 'OPTIONAL']);
export type FacilityCriticality = z.infer<typeof FacilityCriticalityEnum>;

export const FACILITY_CRITICALITY_LABELS: Record<FacilityCriticality, string> = {
  ESSENTIAL: 'Essential',
  HIGH: 'High',
  MEDIUM: 'Medium',
  OPTIONAL: 'Optional',
};

export const ProposalFlagKindEnum = z.enum([
  'DUPLICATE',
  'ESSENTIAL_FACILITY_GAP',
  'RATE_VARIANCE',
  'CEILING_EXCEEDED',
  'MISSING_SUPERVISION_LINE',
  'SEPARATION_OVERRIDE',
]);
export type ProposalFlagKind = z.infer<typeof ProposalFlagKindEnum>;

export const PROPOSAL_FLAG_KIND_META: Record<ProposalFlagKind, { label: string; /** Stage whose gate needs it resolved; null = a record, never a block. */ blocksStage: NeedsStage | null }> = {
  DUPLICATE: { label: 'Possible duplicate', blocksStage: 'VALIDATION' },
  ESSENTIAL_FACILITY_GAP: { label: 'Essential facility missing', blocksStage: 'VALIDATION' },
  RATE_VARIANCE: { label: 'Rate differs from the costing standard', blocksStage: 'COSTING' },
  CEILING_EXCEEDED: { label: 'Cost ceiling exceeded', blocksStage: 'COSTING' },
  MISSING_SUPERVISION_LINE: { label: 'Supervision and monitoring line missing', blocksStage: 'COSTING' },
  SEPARATION_OVERRIDE: { label: 'Separation of duties override', blocksStage: null },
};

/**
 * How a flag was closed. Wave 3 settles which resolutions each kind accepts. `AUTHORISED` and
 * `REFUSED` close a `SEPARATION_OVERRIDE` request (a second person's decision, D-N.9).
 */
export const ProposalFlagResolutionEnum = z.enum(['NOT_A_DUPLICATE', 'MERGED', 'NOT_VALIDATED', 'JUSTIFIED', 'ACKNOWLEDGED', 'CORRECTED', 'AUTHORISED', 'REFUSED']);
export type ProposalFlagResolution = z.infer<typeof ProposalFlagResolutionEnum>;

/** D-N.4: the outcome one proposal gets in a batch decision. */
export const StageOutcomeEnum = z.enum(['ADVANCE', 'RETURN', 'NOT_VALIDATED', 'NOT_SELECTED']);
export type StageOutcome = z.infer<typeof StageOutcomeEnum>;

export const NeedsSubmissionKindEnum = z.enum(['PORTFOLIO', 'BEAP', 'OUT_OF_CYCLE']);
export type NeedsSubmissionKind = z.infer<typeof NeedsSubmissionKindEnum>;

/**
 * D-N.11 / D-N.23: the cycle approval chains. They live in their own tables (`NeedsApprovalStep`,
 * `NeedsApprovalAction`), so this is not part of `ApprovalChainTypeEnum` (project chains).
 */
export const NeedsChainTypeEnum = z.enum(['NEEDS_PORTFOLIO', 'BEAP', 'OUT_OF_CYCLE']);
export type NeedsChainType = z.infer<typeof NeedsChainTypeEnum>;

export const NEEDS_CHAIN_FOR_SUBMISSION: Record<NeedsSubmissionKind, NeedsChainType> = {
  PORTFOLIO: 'NEEDS_PORTFOLIO',
  BEAP: 'BEAP',
  OUT_OF_CYCLE: 'OUT_OF_CYCLE',
};

/** Transitions: `NeedsSubmissionDtoSchema` (wave 4). */
export const NeedsSubmissionStatusEnum = z.enum(['DRAFT', 'IN_REVIEW', 'RETURNED', 'APPROVED']);
export const NEEDS_SUBMISSION_STATUS_LABELS: Record<z.infer<typeof NeedsSubmissionStatusEnum>, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  RETURNED: 'Returned for revision',
  APPROVED: 'Approved',
};
export type NeedsSubmissionStatus = z.infer<typeof NeedsSubmissionStatusEnum>;

/** D-N.5: documents that live once on the cycle. */
export const CycleDocumentKindEnum = z.enum([
  'CIRCULAR',
  'PRELIMINARY_NEEDS_REPORT',
  'STAKEHOLDER_ENGAGEMENT_SUMMARY',
  'VALIDATED_PROJECT_LIST',
  'COST_ESTIMATE_REPORT',
  'PRIORITISED_PROJECT_PORTFOLIO',
  'COMMITTEE_MINUTES',
  'APPROVAL_MEMO',
  'BUDGET_SUBMISSION_ACKNOWLEDGEMENT',
  'APPROPRIATED_SCHEDULE',
  'BEAP',
  'PROCUREMENT_PLAN',
  'COUNTERPART_EVIDENCE',
  'OTHER',
]);
export type CycleDocumentKind = z.infer<typeof CycleDocumentKindEnum>;

export const CYCLE_DOCUMENT_KIND_META: Record<CycleDocumentKind, { label: string; /** Produced by the platform from the records (a signed copy can be uploaded beside it). */ generated: boolean }> = {
  CIRCULAR: { label: 'Circular', generated: false },
  PRELIMINARY_NEEDS_REPORT: { label: 'Preliminary needs report', generated: false },
  STAKEHOLDER_ENGAGEMENT_SUMMARY: { label: 'Stakeholder engagement summary', generated: false },
  VALIDATED_PROJECT_LIST: { label: 'Validated Project List', generated: true },
  COST_ESTIMATE_REPORT: { label: 'Cost Estimate Report', generated: true },
  PRIORITISED_PROJECT_PORTFOLIO: { label: 'Prioritised Project Portfolio', generated: true },
  COMMITTEE_MINUTES: { label: 'Committee minutes', generated: false },
  APPROVAL_MEMO: { label: 'Approval memo', generated: false },
  BUDGET_SUBMISSION_ACKNOWLEDGEMENT: { label: 'Budget submission acknowledgement', generated: false },
  APPROPRIATED_SCHEDULE: { label: 'Appropriated schedule', generated: false },
  BEAP: { label: 'Basic Education Action Plan (BEAP)', generated: false },
  PROCUREMENT_PLAN: { label: 'Procurement plan', generated: false },
  COUNTERPART_EVIDENCE: { label: 'Counterpart funding evidence', generated: false },
  OTHER: { label: 'Other', generated: false },
};

export const ProposalDocumentKindEnum = z.enum([
  'DRAWING',
  'SPECIFICATION',
  'PHOTO',
  'SITE_REPORT',
  'SITE_VERIFICATION_EVIDENCE',
  'AUTHORISING_DOCUMENT',
  'OTHER',
]);
export type ProposalDocumentKind = z.infer<typeof ProposalDocumentKindEnum>;

export const PROPOSAL_DOCUMENT_KIND_LABELS: Record<ProposalDocumentKind, string> = {
  DRAWING: 'Drawing',
  SPECIFICATION: 'Specification',
  PHOTO: 'Photo',
  SITE_REPORT: 'Site report',
  SITE_VERIFICATION_EVIDENCE: 'Site verification evidence',
  AUTHORISING_DOCUMENT: 'Authorising document',
  OTHER: 'Other',
};

/** D-N.14. */
export const OutOfCycleReasonEnum = z.enum(['EMERGENCY', 'PRESIDENTIAL_DIRECTIVE', 'SUPPLEMENTARY_BUDGET', 'OTHER_FUNDING_SOURCE', 'CARRY_OVER_APPROPRIATED']);
export type OutOfCycleReason = z.infer<typeof OutOfCycleReasonEnum>;

export const OUT_OF_CYCLE_REASON_LABELS: Record<OutOfCycleReason, string> = {
  EMERGENCY: 'Emergency',
  PRESIDENTIAL_DIRECTIVE: 'Presidential directive',
  SUPPLEMENTARY_BUDGET: 'Supplementary budget',
  OTHER_FUNDING_SOURCE: 'Other funding source',
  CARRY_OVER_APPROPRIATED: 'Carried over, already appropriated',
};

/**
 * D-N.13: where a project came from. `Project.origin` is null on a draft nobody has given an origin
 * (it cannot be activated once wave 4 adds the gate); every project that existed when the migration
 * ran is LEGACY.
 */
export const ProjectOriginEnum = z.enum(['NEEDS_PIPELINE', 'OUT_OF_CYCLE', 'REGISTER_IMPORT', 'LEGACY']);
export type ProjectOrigin = z.infer<typeof ProjectOriginEnum>;

export const PROJECT_ORIGIN_LABELS: Record<ProjectOrigin, string> = {
  NEEDS_PIPELINE: 'Annual needs assessment',
  OUT_OF_CYCLE: 'Outside annual cycle',
  REGISTER_IMPORT: 'Imported from the register',
  LEGACY: 'Before the needs pipeline',
};

export const CommitteeRoleEnum = z.enum(['CHAIR', 'MEMBER']);
export type CommitteeRole = z.infer<typeof CommitteeRoleEnum>;

export const ScoreDimensionEnum = z.enum(['IMPACT', 'EASE']);
export type ScoreDimension = z.infer<typeof ScoreDimensionEnum>;

/** A7: how the site was verified. FIELD_APP arrives with wave 5 (N8). */
export const SiteVerificationMethodEnum = z.enum(['WEB_EVIDENCE', 'FIELD_APP']);
export type SiteVerificationMethod = z.infer<typeof SiteVerificationMethodEnum>;

export const NeedsFundingGateEnum = z.enum(['APPROPRIATION', 'BEAP_APPROVAL']);
export type NeedsFundingGate = z.infer<typeof NeedsFundingGateEnum>;

export const NeedsReferencePrefixEnum = z.enum(['DI', 'MG']);
export type NeedsReferencePrefix = z.infer<typeof NeedsReferencePrefixEnum>;

export const NeedsCycleScopeEnum = z.enum(['NATIONAL', 'STATE']);
export type NeedsCycleScope = z.infer<typeof NeedsCycleScopeEnum>;

/**
 * What a needs assessment must contain at a stage (`needsPipeline.minimumFields`). DRAWINGS are
 * proposal documents; the others are read from the parsed template.
 */
export const NeedsTemplateFieldKeyEnum = z.enum(['NEED', 'JUSTIFICATION', 'SITES', 'BREAKDOWN', 'BOQ', 'DRAWINGS', 'PRELIMINARY_COST']);
export type NeedsTemplateFieldKey = z.infer<typeof NeedsTemplateFieldKeyEnum>;

export const NEEDS_TEMPLATE_FIELD_LABELS: Record<NeedsTemplateFieldKey, string> = {
  NEED: 'The need (project title)',
  JUSTIFICATION: 'Justification',
  SITES: 'Sites',
  BREAKDOWN: 'Intervention and facilities breakdown',
  BOQ: 'BoQ',
  DRAWINGS: 'Drawings',
  PRELIMINARY_COST: 'Preliminary cost',
};

/** Template v2 stamp (D-N.6). The in-project scope workbook keeps `SCOPE_WORKBOOK_VERSION` (v1). */
export const NEEDS_TEMPLATE_VERSION = 'INSITE-NEEDS-v2';

// ---------------------------------------------------------------------------
// Rows of a needs assessment (the parsed file and the current-version tables)
// ---------------------------------------------------------------------------

export const NEEDS_SITES_MAX = 50;
export const NEEDS_BREAKDOWN_ROWS_MAX = 500;
export const NEEDS_BOQ_LINES_MAX = 5000;

/** A site of a proposal (Sites sheet). Becomes a `ProjectSite` at conversion. */
export const ProposalSiteSchema = z
  .object({
    siteNumber: z.number().int().min(1).max(NEEDS_SITES_MAX),
    schoolName: z.string().trim().min(3).max(200),
    schoolLevel: SchoolLevelEnum,
    lgaCode: NigeriaLgaCodeSchema,
    address: z.string().trim().max(300).nullable().default(null),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    /** Pupils enrolled, as reported in the needs assessment. */
    enrolment: z.number().int().nonnegative().nullable().default(null),
  })
  .refine((s) => (s.latitude === null) === (s.longitude === null), { message: 'Enter both latitude and longitude', path: ['latitude'] });
export type ProposalSite = z.infer<typeof ProposalSiteSchema>;
export type ProposalSiteInput = z.input<typeof ProposalSiteSchema>;

const UnitIdSchema = z.string().trim().toUpperCase().regex(FACILITY_UNIT_CODE_REGEX, 'Unit ID: up to 20 letters, digits, dots, dashes or underscores, e.g. U01');
const FacilityCodeSchema = z.string().trim().toUpperCase().regex(FACILITY_CODE_REGEX, 'Unknown facility code');

/**
 * One facility at one site (plan 6.3, D-N.7). A row with a proposed quantity above zero becomes a
 * `FacilityUnit` (code = `unitId`) on its `ProjectSite` at conversion, and the BoQ lines tagged with
 * that unit ID become its lines.
 *
 * Wave 1 decision (recorded in the wave file): a row may have proposed quantity 0 to record a
 * facility that exists and needs no work, so the essential-facilities rule (D-N.17: "a proposed row
 * or an existing row in condition Functional") can be met. Such a row has an existing quantity above
 * zero, becomes no unit and carries no cost.
 */
export const FacilityBreakdownRowSchema = z
  .object({
    /** Ties the BoQ lines; unique per proposal; becomes the FacilityUnit code. */
    unitId: UnitIdSchema,
    siteNumber: z.number().int().min(1).max(NEEDS_SITES_MAX),
    /** Tenant facility catalogue code. */
    facilityCode: FacilityCodeSchema,
    interventionAction: InterventionActionEnum,
    existingQuantity: z.number().nonnegative(),
    existingCondition: ExistingConditionEnum,
    /** The assessed need. */
    requiredQuantity: z.number().nonnegative(),
    /** Under this project; may be below the required quantity (the shortfall is shown). */
    proposedQuantity: z.number().nonnegative(),
    unitOfMeasure: UnitOfMeasureEnum,
    /** Computed from the unit's BoQ lines when there are any, else as entered. */
    preliminaryCostNgn: Money.nullable().default(null),
    technicalJustification: z.string().trim().min(1, 'Enter the technical justification').max(2000),
    criticality: FacilityCriticalityEnum,
    /** Text references: photo, site report, drawing, BoQ reference. */
    supportingEvidence: z.string().trim().max(1000).nullable().default(null),
    /** Proposal documents linked as evidence. */
    evidenceDocumentIds: z.array(Uuid).max(50).default([]),
  })
  .superRefine((r, ctx) => {
    if (r.existingCondition === 'ABSENT' && r.existingQuantity !== 0) {
      ctx.addIssue({ code: 'custom', path: ['existingQuantity'], message: 'An absent facility has an existing quantity of 0' });
    }
    if (r.proposedQuantity === 0 && r.existingQuantity === 0) {
      ctx.addIssue({ code: 'custom', path: ['proposedQuantity'], message: 'Enter a proposed quantity above zero' });
    }
  });
export type FacilityBreakdownRow = z.infer<typeof FacilityBreakdownRowSchema>;
export type FacilityBreakdownRowInput = z.input<typeof FacilityBreakdownRowSchema>;

/** A BoQ line of a needs assessment. Field names follow `CreateScopeLineRequestSchema` (conversion). */
export const NeedsBoqLineSchema = z.object({
  /** Item no., unique per proposal. */
  wbsCode: z.string().trim().min(1).max(32),
  /** The breakdown row (unit ID) the line belongs to. */
  unitId: UnitIdSchema,
  /** Costing standard item code; null for an item the standard does not list. */
  itemCode: z.string().trim().toUpperCase().max(40).nullable().default(null),
  description: z.string().trim().min(3).max(600),
  unit: UnitOfMeasureEnum,
  totalQuantity: z.number().positive(),
  rateNgn: Money,
  /** quantity × rate, recomputed by the server (`lineAmount`). */
  amountNgn: Money,
});
export type NeedsBoqLine = z.infer<typeof NeedsBoqLineSchema>;
export type NeedsBoqLineInput = z.input<typeof NeedsBoqLineSchema>;

/** The Costing summary sheet (D-N.18: the supervision and monitoring line is required on a costed version). */
export const CostingSummarySchema = z.object({
  subtotalNgn: Money,
  supervisionMonitoringPct: z.number().min(0).max(100),
  supervisionMonitoringNgn: Money,
  contingencyPct: z.number().min(0).max(100),
  contingencyNgn: Money,
  totalNgn: Money,
});
export type CostingSummary = z.infer<typeof CostingSummarySchema>;

export const ParsedNeedsProjectSchema = z.object({
  title: z.string().trim().max(300).nullable().default(null),
  /** The programme named in the file (project type code or name), as written. */
  programme: z.string().trim().max(120).nullable().default(null),
  interventionYear: z.number().int().min(2000).max(2100).nullable().default(null),
  stateCode: NigeriaStateCodeSchema.nullable().default(null),
  justification: z.string().trim().max(8000).nullable().default(null),
  assumptions: z.string().trim().max(8000).nullable().default(null),
  beneficiaries: z.string().trim().max(2000).nullable().default(null),
  estimatedDurationMonths: z.number().int().min(1).max(120).nullable().default(null),
});
export type ParsedNeedsProject = z.infer<typeof ParsedNeedsProjectSchema>;

/**
 * A needs assessment file as read by the template parser: `NeedsAssessmentVersion.parsedJson`, and
 * the input of conversion (sites → `ProjectSite`, breakdown rows → `FacilityUnit`, BoQ lines →
 * `BoqItem`). A v1 file (in-project scope workbook) is read into the same shape with no breakdown.
 */
export const ParsedNeedsAssessmentSchema = z.object({
  templateVersion: z.string().trim().min(1).max(40),
  /** The costing standard version the template was built from; null on a file without rates. */
  costingStandardVersion: z.number().int().positive().nullable().default(null),
  project: ParsedNeedsProjectSchema,
  sites: z.array(ProposalSiteSchema).max(NEEDS_SITES_MAX).default([]),
  breakdownRows: z.array(FacilityBreakdownRowSchema).max(NEEDS_BREAKDOWN_ROWS_MAX).default([]),
  boqLines: z.array(NeedsBoqLineSchema).max(NEEDS_BOQ_LINES_MAX).default([]),
  costingSummary: CostingSummarySchema.nullable().default(null),
});
export type ParsedNeedsAssessment = z.infer<typeof ParsedNeedsAssessmentSchema>;
export type ParsedNeedsAssessmentInput = z.input<typeof ParsedNeedsAssessmentSchema>;

/** A problem in an uploaded file: where it is and why (shown per file, downloadable). */
export const NeedsFileIssueSchema = z.object({
  sheet: z.string(),
  /** Sheet row number; null for a problem with the sheet or the file as a whole. */
  row: z.number().int().nullable(),
  column: z.string().nullable(),
  reason: z.string(),
});
export type NeedsFileIssue = z.infer<typeof NeedsFileIssueSchema>;

// ---------------------------------------------------------------------------
// Type config: `ProjectTypeConfig.needsPipeline`
// ---------------------------------------------------------------------------

/** A date in the cycle calendar: month and day, placed in a year by `cycleDeadlines`. */
export const MonthDaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type MonthDay = z.infer<typeof MonthDaySchema>;

const PermissionKeySchema = z.string().trim().regex(/^[a-z_]+:[a-z_]+$/, 'Use a permission key, e.g. needs:validate');

export const NeedsStageConfigSchema = z.object({
  stage: NeedsStageEnum,
  label: z.string().trim().min(2).max(80),
  /** Who moves a proposal out of the stage; null where an approval chain does (APPROVAL, BEAP). */
  actorPermissionKey: PermissionKeySchema.nullable().default(null),
  /** Deadline of the stage ("by"); null when it has no fixed date (e.g. appropriation). */
  deadline: MonthDaySchema.nullable().default(null),
});
export type NeedsStageConfig = z.infer<typeof NeedsStageConfigSchema>;
export type NeedsStageConfigInput = z.input<typeof NeedsStageConfigSchema>;

/** A dated event of the calendar that is not the end of a stage (e.g. "BEAP submitted"). */
export const NeedsExtraDeadlineSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]{1,47}$/, 'Key: lower-case letters, digits and dashes'),
  label: z.string().trim().min(2).max(120),
  stage: NeedsStageEnum,
  deadline: MonthDaySchema,
});
export type NeedsExtraDeadline = z.infer<typeof NeedsExtraDeadlineSchema>;

export const RUBRIC_SCALE = 5;
export const RUBRIC_CRITERION_KEY_REGEX = /^[a-z][a-z0-9_]{1,47}$/;

export const RubricDimensionSchema = z.object({
  key: ScoreDimensionEnum,
  label: z.string().trim().min(2).max(80),
  /** Share of the total score (the two dimensions add up to 100). */
  weight: z.number().min(0).max(100),
});
export type RubricDimension = z.infer<typeof RubricDimensionSchema>;

export const RubricCriterionSchema = z.object({
  key: z.string().trim().regex(RUBRIC_CRITERION_KEY_REGEX, 'Key: lower-case letters, digits and underscores'),
  dimension: ScoreDimensionEnum,
  label: z.string().trim().min(2).max(120),
  /** What each score means, for 1 … 5 in order. */
  descriptors: z.array(z.string().trim().min(2).max(300)).length(RUBRIC_SCALE),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

/** A6 / D-N.10. Frozen on the cycle when it opens. */
export const NeedsRubricSchema = z.object({
  scale: z.literal(RUBRIC_SCALE).default(RUBRIC_SCALE),
  dimensions: z.array(RubricDimensionSchema).max(2).default([]),
  /** Sub-criteria; equal weight inside a dimension. */
  criteria: z.array(RubricCriterionSchema).max(40).default([]),
  /** Scores of one sub-criterion this far apart (or more) are flagged, never silently averaged. */
  divergenceThreshold: z.number().int().min(1).max(RUBRIC_SCALE - 1).default(2),
  /** Fewest score sheets the chair may close a proposal with. */
  quorum: z.number().int().min(1).max(50).default(3),
});
export type NeedsRubric = z.infer<typeof NeedsRubricSchema>;
export type NeedsRubricInput = z.input<typeof NeedsRubricSchema>;

/** D-N.17: each school site needs a proposed row, or an existing Functional one, in each group. */
export const EssentialFacilityGroupSchema = z.object({
  label: z.string().trim().min(2).max(80),
  facilityCodes: z.array(FacilityCodeSchema).min(1).max(20),
});
export type EssentialFacilityGroup = z.infer<typeof EssentialFacilityGroupSchema>;

/** A step of a cycle approval chain (copied to `NeedsApprovalStep` rows when the cycle opens). */
export const NeedsChainStepConfigSchema = z.object({
  label: z.string().trim().min(2).max(120),
  requiredPermissionKey: PermissionKeySchema,
  /** Relative to the cycle's owning organisation (PROJECT_OWNER = that organisation). */
  organizationScope: ApprovalOrganizationScopeEnum.default('ANY'),
  /** Calendar deadline of the step, when the process gives one. */
  deadline: MonthDaySchema.nullable().default(null),
});
export type NeedsChainStepConfig = z.infer<typeof NeedsChainStepConfigSchema>;
export type NeedsChainStepConfigInput = z.input<typeof NeedsChainStepConfigSchema>;

const ChainSchema = z.array(NeedsChainStepConfigSchema).max(8).default([]);

export const NeedsApprovalChainsConfigSchema = z.object({
  NEEDS_PORTFOLIO: ChainSchema,
  BEAP: ChainSchema,
  OUT_OF_CYCLE: ChainSchema,
});
export type NeedsApprovalChainsConfig = z.infer<typeof NeedsApprovalChainsConfigSchema>;

const MinimumFieldsSchema = z.record(NeedsStageEnum, z.array(NeedsTemplateFieldKeyEnum).max(20));

/** Stages every enabled pipeline has; DESIGN is optional (A8). */
export const NEEDS_REQUIRED_STAGES: readonly NeedsStage[] = ['IDENTIFICATION', 'VALIDATION', 'COSTING', 'PRIORITISATION', 'APPROVAL', 'FUNDING'];

/** Problems with an enabled pipeline config (shown in the type editor; refused on save). */
export function needsPipelineConfigIssues(c: {
  enabled: boolean;
  fundingGate: NeedsFundingGate;
  stages: ReadonlyArray<{ stage: NeedsStage }>;
  rubric: { dimensions: ReadonlyArray<{ key: ScoreDimension; weight: number }>; criteria: ReadonlyArray<{ key: string; dimension: ScoreDimension }> };
  approvalChains: { NEEDS_PORTFOLIO: readonly unknown[]; BEAP: readonly unknown[]; OUT_OF_CYCLE: readonly unknown[] };
}): Array<{ path: Array<string | number>; message: string }> {
  if (!c.enabled) return [];
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  const codes = c.stages.map((s) => s.stage);
  for (const required of NEEDS_REQUIRED_STAGES) {
    if (!codes.includes(required)) issues.push({ path: ['stages'], message: `Add the ${NEEDS_STAGE_LABELS[required]} stage.` });
  }
  codes.forEach((code, i) => {
    if (codes.indexOf(code) !== i) issues.push({ path: ['stages', i, 'stage'], message: 'A stage is listed twice.' });
    if (i > 0 && NEEDS_STAGE_ORDER.indexOf(code) < NEEDS_STAGE_ORDER.indexOf(codes[i - 1])) {
      issues.push({ path: ['stages', i, 'stage'], message: 'Stages must follow the process order.' });
    }
  });
  const dimensionKeys = c.rubric.dimensions.map((d) => d.key);
  for (const key of ScoreDimensionEnum.options) {
    if (dimensionKeys.filter((k) => k === key).length !== 1) issues.push({ path: ['rubric', 'dimensions'], message: `The rubric needs the ${key} dimension once.` });
    if (!c.rubric.criteria.some((cr) => cr.dimension === key)) issues.push({ path: ['rubric', 'criteria'], message: `Add at least one ${key} criterion.` });
  }
  const weight = c.rubric.dimensions.reduce((s, d) => s + d.weight, 0);
  if (Math.abs(weight - 100) > 0.001) issues.push({ path: ['rubric', 'dimensions'], message: 'The dimension weights must add up to 100.' });
  c.rubric.criteria.forEach((cr, i) => {
    if (c.rubric.criteria.findIndex((x) => x.key === cr.key) !== i) issues.push({ path: ['rubric', 'criteria', i, 'key'], message: `The criterion key "${cr.key}" is used twice.` });
  });
  if (c.approvalChains.NEEDS_PORTFOLIO.length === 0) issues.push({ path: ['approvalChains', 'NEEDS_PORTFOLIO'], message: 'The portfolio approval chain needs at least one step.' });
  if (c.approvalChains.OUT_OF_CYCLE.length === 0) issues.push({ path: ['approvalChains', 'OUT_OF_CYCLE'], message: 'The out-of-cycle approval chain needs at least one step.' });
  if (c.fundingGate === 'BEAP_APPROVAL' && c.approvalChains.BEAP.length === 0) {
    issues.push({ path: ['approvalChains', 'BEAP'], message: 'The BEAP approval chain needs at least one step.' });
  }
  return issues;
}

/**
 * The needs pipeline of a project type (wave file section 3.3). Every key is defaulted and the
 * default is disabled, so a type saved before the pipeline is unchanged. The cycle keeps a frozen
 * copy (`NeedsCycle.configSnapshotJson`) from the day it opens.
 */
export const NeedsPipelineConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** What turns a proposal into a draft project. */
    fundingGate: NeedsFundingGateEnum.default('APPROPRIATION'),
    /** `<year>-DI-<nnn>` or `<year>-MG-<state>-<nnn>`. */
    referencePrefix: NeedsReferencePrefixEnum.default('DI'),
    /** NATIONAL: one cycle a year (owner: the type's default owner). STATE: one per State (owner: its SUBEB). */
    cycleScope: NeedsCycleScopeEnum.default('NATIONAL'),
    /** The cycle for intervention year Y opens on this date in Y − 1. */
    cycleOpens: MonthDaySchema.default({ month: 3, day: 1 }),
    stages: z.array(NeedsStageConfigSchema).max(NEEDS_STAGE_ORDER.length).default([]),
    extraDeadlines: z.array(NeedsExtraDeadlineSchema).max(20).default([]),
    /** Template fields a version must have to leave a stage. */
    minimumFields: MinimumFieldsSchema.default({}),
    rubric: NeedsRubricSchema.default({}),
    essentialFacilityGroups: z.array(EssentialFacilityGroupSchema).max(20).default([]),
    /** A rate this far (%) from the costing standard's rate is flagged. */
    rateVarianceTolerancePct: z.number().min(0).max(100).default(15),
    /** D-N.16. */
    duplicateRadiusMeters: z.number().int().min(0).max(5000).default(100),
    duplicateLookbackYears: z.number().int().min(0).max(20).default(3),
    /** A7: validation needs a site verification for every proposal. */
    requireSiteVerification: z.boolean().default(true),
    /** A5: a converted project cannot be activated until its BEAP's counterpart evidence is recorded. */
    requireCounterpartEvidenceBeforeActivation: z.boolean().default(false),
    approvalChains: NeedsApprovalChainsConfigSchema.default({}),
  })
  .superRefine((c, ctx) => {
    for (const issue of needsPipelineConfigIssues(c)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  });
export type NeedsPipelineConfig = z.infer<typeof NeedsPipelineConfigSchema>;
export type NeedsPipelineConfigInput = z.input<typeof NeedsPipelineConfigSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** A dated entry of a cycle's calendar (`cycleDeadlines`). */
export const NeedsDeadlineSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Null for the cycle opening itself. */
  stage: NeedsStageEnum.nullable(),
  kind: z.enum(['CYCLE_OPENS', 'STAGE', 'CHAIN_STEP', 'EXTRA']),
  date: IsoDate,
});
export type NeedsDeadline = z.infer<typeof NeedsDeadlineSchema>;

export const NeedsDeadlineStateEnum = z.enum(['NOT_SET', 'UPCOMING', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE']);
export type NeedsDeadlineState = z.infer<typeof NeedsDeadlineStateEnum>;

export const NeedsCycleSummaryDtoSchema = z.object({
  id: Uuid,
  projectTypeId: Uuid,
  projectTypeName: z.string(),
  interventionYear: z.number().int(),
  /** Matching Grants: the State the cycle is for. */
  stateCode: z.string().nullable(),
  owningOrganizationId: Uuid,
  owningOrganizationName: z.string(),
  status: NeedsCycleStatusEnum,
  fundingGate: NeedsFundingGateEnum,
  proposalCount: z.number().int(),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type NeedsCycleSummaryDto = z.infer<typeof NeedsCycleSummaryDtoSchema>;

export const NeedsCycleDocumentDtoSchema = z.object({
  id: Uuid,
  kind: CycleDocumentKindEnum,
  title: z.string(),
  generated: z.boolean(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  supersedesId: Uuid.nullable(),
  /** Proposals the document covers (D-N.5). */
  proposalIds: z.array(Uuid),
  uploadedByName: z.string(),
  uploadedAt: z.string(),
});
export type NeedsCycleDocumentDto = z.infer<typeof NeedsCycleDocumentDtoSchema>;

export const NeedsCycleDtoSchema = NeedsCycleSummaryDtoSchema.extend({
  /** The pipeline rules frozen when the cycle opened (stages, rubric, chains). */
  config: NeedsPipelineConfigSchema,
  deadlines: z.array(NeedsDeadlineSchema),
  templateVersion: z.string(),
  costingStandardVersionId: Uuid.nullable(),
  costingStandardVersion: z.number().int().nullable(),
  indicativeCeilingNgn: z.number().nullable(),
  documents: z.array(NeedsCycleDocumentDtoSchema),
  /** Proposals per stage and status, for the stage strip. */
  counts: z.array(z.object({ stage: NeedsStageEnum, status: NeedsProposalStatusEnum, count: z.number().int() })),
  openedByName: z.string().nullable(),
  closedByName: z.string().nullable(),
});
export type NeedsCycleDto = z.infer<typeof NeedsCycleDtoSchema>;

export const ProposalFlagDtoSchema = z.object({
  id: Uuid,
  proposalId: Uuid,
  kind: ProposalFlagKindEnum,
  label: z.string(),
  /** Kind-specific facts (matched proposal or project, site, rate, ceiling …). Wave 2–3 settle the shapes. */
  details: z.record(z.unknown()),
  raisedOnVersion: z.number().int().nullable(),
  raisedAt: z.string(),
  resolved: z.boolean(),
  resolution: ProposalFlagResolutionEnum.nullable(),
  resolutionReason: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type ProposalFlagDto = z.infer<typeof ProposalFlagDtoSchema>;

export const NeedsAssessmentVersionDtoSchema = z.object({
  id: Uuid,
  proposalId: Uuid,
  number: z.number().int(),
  source: NeedsVersionSourceEnum,
  fileName: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  templateVersion: z.string(),
  costingStandardVersion: z.number().int().nullable(),
  siteCount: z.number().int(),
  breakdownRowCount: z.number().int(),
  boqLineCount: z.number().int(),
  preliminaryCostNgn: z.number().nullable(),
  costedTotalNgn: z.number().nullable(),
  uploadedByUserId: Uuid,
  uploadedByName: z.string(),
  uploadedAt: z.string(),
  /** True for the proposal's current version. */
  isCurrent: z.boolean(),
});
export type NeedsAssessmentVersionDto = z.infer<typeof NeedsAssessmentVersionDtoSchema>;

/** A row of the Proposed projects table. */
export const NeedsProposalSummaryDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  reference: z.string(),
  title: z.string(),
  route: NeedsProposalRouteEnum,
  stage: NeedsStageEnum,
  status: NeedsProposalStatusEnum,
  /** `proposalStatusLabel`. */
  statusLabel: z.string(),
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  siteCount: z.number().int(),
  /** e.g. "Classroom ×6, Toilet ×2". */
  facilitiesSummary: z.string(),
  preliminaryCostNgn: z.number().nullable(),
  costedAmountNgn: z.number().nullable(),
  approvedAmountNgn: z.number().nullable(),
  fundedAmountNgn: z.number().nullable(),
  currentVersionNumber: z.number().int().nullable(),
  scoreTotal: z.number().nullable(),
  rank: z.number().int().nullable(),
  /** Above the funding line once the ranking is finalised; null before. */
  aboveLine: z.boolean().nullable(),
  openFlagKinds: z.array(ProposalFlagKindEnum),
  /** Who acts next ("Validation: M&E Department"); null when nothing is waiting. */
  nextActor: z.string().nullable(),
  /** The viewer can act on it now ("Waiting for me"). */
  waitingForMe: z.boolean(),
  projectId: Uuid.nullable(),
  updatedAt: z.string(),
});
export type NeedsProposalSummaryDto = z.infer<typeof NeedsProposalSummaryDtoSchema>;

export const NeedsProposalActionEnum = z.enum([
  'UPLOAD_VERSION',
  'SUBMIT',
  'RESUBMIT',
  'WITHDRAW',
  'RECORD_VALIDATION',
  'UPLOAD_COSTED_VERSION',
  'SIGN_OFF_COSTING',
  'RETURN',
  'SCORE',
  'FINALISE_PRIORITISATION',
  'INCLUDE_IN_PORTFOLIO',
  'RECORD_FUNDING',
  'INCLUDE_IN_BEAP',
  'CARRY_FORWARD',
]);
export type NeedsProposalAction = z.infer<typeof NeedsProposalActionEnum>;

/**
 * Site verification inside a validation record. Wave 3 settles the fields. Wave 5 (N8): method
 * FIELD_APP names the ACCEPTED field verification of this proposal it comes from (`verificationId`,
 * required for FIELD_APP; 422 NEEDS_VERIFICATION_NOT_ACCEPTED otherwise); WEB_EVIDENCE leaves it null.
 */
export const SiteVerificationSchema = z
  .object({
    method: SiteVerificationMethodEnum,
    verifiedOn: IsoDate,
    officerName: z.string().trim().min(2).max(160),
    notes: z.string().trim().max(4000).nullable().default(null),
    evidenceDocumentIds: z.array(Uuid).max(50).default([]),
    verificationId: Uuid.nullable().default(null),
  })
  .refine((v) => v.method !== 'FIELD_APP' || v.verificationId !== null, {
    message: 'A field app verification names the accepted verification',
    path: ['verificationId'],
  });
export type SiteVerification = z.infer<typeof SiteVerificationSchema>;

export const NeedsValidationRecordDtoSchema = z.object({
  id: Uuid,
  proposalId: Uuid,
  versionNumber: z.number().int(),
  outcome: StageOutcomeEnum,
  deskNotes: z.string().nullable(),
  siteVerification: SiteVerificationSchema.nullable(),
  /** Flag id → how the duplicate was resolved. */
  duplicateResolutions: z.array(z.object({ flagId: Uuid, resolution: ProposalFlagResolutionEnum, reason: z.string().nullable() })),
  recordedByUserId: Uuid,
  recordedByName: z.string(),
  recordedAt: z.string(),
});
export type NeedsValidationRecordDto = z.infer<typeof NeedsValidationRecordDtoSchema>;

export const NeedsProposalDocumentDtoSchema = z.object({
  id: Uuid,
  kind: ProposalDocumentKindEnum,
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  supersedesId: Uuid.nullable(),
  uploadedByName: z.string(),
  uploadedAt: z.string(),
});
export type NeedsProposalDocumentDto = z.infer<typeof NeedsProposalDocumentDtoSchema>;

/** One entry of a proposal's history (tenant ledger entries that name it). */
export const NeedsProposalHistoryEntrySchema = z.object({
  at: z.string(),
  action: z.string(),
  actorName: z.string(),
  summary: z.string(),
});
export type NeedsProposalHistoryEntry = z.infer<typeof NeedsProposalHistoryEntrySchema>;

/** A task on the proposal page ("Resolve possible duplicate", "Upload drawings"). */
export const NeedsProposalTaskSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['TODO', 'DONE', 'BLOCKED', 'NOT_NEEDED']),
  /** The viewer may do it. */
  mine: z.boolean(),
});
export type NeedsProposalTask = z.infer<typeof NeedsProposalTaskSchema>;

export const NeedsProposalDetailDtoSchema = NeedsProposalSummaryDtoSchema.extend({
  outOfCycleReason: OutOfCycleReasonEnum.nullable(),
  authorisingDocumentId: Uuid.nullable(),
  /** The current version's project fields. */
  project: ParsedNeedsProjectSchema.nullable(),
  sites: z.array(ProposalSiteSchema),
  breakdownRows: z.array(FacilityBreakdownRowSchema),
  boqLines: z.array(NeedsBoqLineSchema),
  costingSummary: CostingSummarySchema.nullable(),
  versions: z.array(NeedsAssessmentVersionDtoSchema),
  flags: z.array(ProposalFlagDtoSchema),
  validation: NeedsValidationRecordDtoSchema.nullable(),
  documents: z.array(NeedsProposalDocumentDtoSchema),
  /** What the viewer may do now (`allowedProposalActions`, narrowed by the server's own rules). */
  allowedActions: z.array(NeedsProposalActionEnum),
  tasks: z.array(NeedsProposalTaskSchema),
  carriedFromId: Uuid.nullable(),
  carriedFromReference: z.string().nullable(),
  mergedIntoId: Uuid.nullable(),
  mergedIntoReference: z.string().nullable(),
  history: z.array(NeedsProposalHistoryEntrySchema),
  createdByName: z.string(),
  createdAt: z.string(),
});
export type NeedsProposalDetailDto = z.infer<typeof NeedsProposalDetailDtoSchema>;

/** A row of the task queue ("Waiting for me", nav badge count; D-N.24). */
export const NeedsTaskDtoSchema = z.object({
  /** Stable per task: `<kind>:<subject id>`. */
  id: z.string(),
  kind: z.enum(['PROPOSAL_ACTION', 'SCORE', 'CONFLICT_DECLARATION', 'APPROVAL_STEP', 'CYCLE']),
  cycleId: Uuid,
  proposalId: Uuid.nullable(),
  submissionId: Uuid.nullable(),
  reference: z.string().nullable(),
  title: z.string(),
  /** Active-verb label: "Validate", "Score", "Approve the portfolio". */
  actionLabel: z.string(),
  stage: NeedsStageEnum.nullable(),
  dueDate: IsoDate.nullable(),
  deadlineState: NeedsDeadlineStateEnum,
  /** Web route to open. */
  url: z.string(),
});
export type NeedsTaskDto = z.infer<typeof NeedsTaskDtoSchema>;

// ---------------------------------------------------------------------------
// Requests (later waves settle the ones marked)
// ---------------------------------------------------------------------------

/**
 * D-N.4: a batch decision on a selection, with one outcome and reason per proposal. One evidence
 * file can cover the batch. A reason is required for every outcome other than ADVANCE.
 */
export const StageDecisionRequestSchema = z
  .object({
    stage: NeedsStageEnum,
    /** For the whole batch (e.g. "Validated at the M&E review meeting of 28 July"). */
    reason: z.string().trim().max(2000).nullable().default(null),
    /** Cycle documents that evidence the decision. */
    evidenceDocumentIds: z.array(Uuid).max(20).default([]),
    items: z
      .array(
        z.object({
          proposalId: Uuid,
          outcome: StageOutcomeEnum,
          reason: z.string().trim().max(2000).nullable().default(null),
        })
      )
      .min(1, 'Select at least one proposed project')
      .max(500),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.proposalId)) ctx.addIssue({ code: 'custom', path: ['items', i, 'proposalId'], message: 'Listed twice' });
      seen.add(item.proposalId);
      if (item.outcome !== 'ADVANCE' && !item.reason && !v.reason) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'reason'], message: 'Give the reason' });
      }
    });
  });
export type StageDecisionRequest = z.infer<typeof StageDecisionRequestSchema>;
export type StageDecisionRequestInput = z.input<typeof StageDecisionRequestSchema>;

const ScoreValue = z.number().int().min(1).max(RUBRIC_SCALE);

/** One member's scores for one proposal: every rubric criterion, 1–5 (the server checks the keys against the cycle's rubric). */
export const ScoreSheetSchema = z.object({
  proposalId: Uuid,
  scores: z.record(z.string().regex(RUBRIC_CRITERION_KEY_REGEX), ScoreValue),
  comment: z.string().trim().max(2000).nullable().default(null),
});
export type ScoreSheet = z.infer<typeof ScoreSheetSchema>;
export type ScoreSheetInput = z.input<typeof ScoreSheetSchema>;

export const ScoreSheetDtoSchema = ScoreSheetSchema.extend({
  id: Uuid,
  memberUserId: Uuid,
  memberName: z.string(),
  submittedAt: z.string(),
});
export type ScoreSheetDto = z.infer<typeof ScoreSheetDtoSchema>;

export const RecusalReasonEnum = z.enum(['UPLOADED', 'VALIDATED', 'COSTED', 'DECLARED_CONFLICT']);
export type RecusalReason = z.infer<typeof RecusalReasonEnum>;

export const CommitteeMemberDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  userId: Uuid,
  fullName: z.string(),
  roleName: z.string(),
  role: CommitteeRoleEnum,
  /** Null until the member has declared (a "no conflict" declaration has an empty list). */
  conflictDeclaredAt: z.string().nullable(),
  conflictStatement: z.string().nullable(),
  conflictedProposalIds: z.array(Uuid),
  /** Proposals the member does not score, and why (`recusalsFor`). */
  recusals: z.array(z.object({ proposalId: Uuid, reason: RecusalReasonEnum })),
  scoredCount: z.number().int(),
  toScoreCount: z.number().int(),
});
export type CommitteeMemberDto = z.infer<typeof CommitteeMemberDtoSchema>;

/** A member's conflict-of-interest declaration; required before scoring (D-N.10). */
export const ConflictDeclarationRequestSchema = z
  .object({
    /** False: "I have no conflict of interest in any proposed project of this cycle". */
    hasConflict: z.boolean(),
    conflictedProposalIds: z.array(Uuid).max(500).default([]),
    statement: z.string().trim().max(2000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.hasConflict && v.conflictedProposalIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['conflictedProposalIds'], message: 'Choose the proposed projects you have a conflict with' });
    }
    if (!v.hasConflict && v.conflictedProposalIds.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['hasConflict'], message: 'A declaration without a conflict names no proposed project' });
    }
  });
export type ConflictDeclarationRequest = z.infer<typeof ConflictDeclarationRequestSchema>;
export type ConflictDeclarationRequestInput = z.input<typeof ConflictDeclarationRequestSchema>;

/**
 * Wave 4: how a BEAP item is to be procured (assumption: the common methods of public procurement in
 * Nigeria; the BEAP records the State's choice, the platform enforces nothing on it).
 */
export const ProcurementMethodEnum = z.enum(['OPEN_COMPETITIVE_BIDDING', 'SELECTIVE_TENDERING', 'REQUEST_FOR_QUOTATIONS', 'DIRECT_PROCUREMENT', 'COMMUNITY_PARTICIPATION']);
export type ProcurementMethod = z.infer<typeof ProcurementMethodEnum>;
export const PROCUREMENT_METHOD_LABELS: Record<ProcurementMethod, string> = {
  OPEN_COMPETITIVE_BIDDING: 'Open competitive bidding',
  SELECTIVE_TENDERING: 'Selective tendering',
  REQUEST_FOR_QUOTATIONS: 'Request for quotations',
  DIRECT_PROCUREMENT: 'Direct procurement',
  COMMUNITY_PARTICIPATION: 'Community participation',
};

/** Wave 4: UBEC's review of one BEAP item (plan section 9: accept, comment, request removal). */
export const BeapReviewOutcomeEnum = z.enum(['ACCEPTED', 'COMMENTED', 'REMOVAL_REQUESTED']);
export type BeapReviewOutcome = z.infer<typeof BeapReviewOutcomeEnum>;
export const BEAP_REVIEW_OUTCOME_LABELS: Record<BeapReviewOutcome, string> = {
  ACCEPTED: 'Accepted',
  COMMENTED: 'Comment',
  REMOVAL_REQUESTED: 'Removal requested',
};

/** One proposal on a submission (wave 4). Portfolio: included or excluded; BEAP: lot, method, timeline, review. */
export const NeedsSubmissionItemDtoSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  siteCount: z.number().int(),
  /** Portfolio: the costed amount; BEAP: the current version's costed total; out-of-cycle: the requested amount. */
  amountNgn: z.number().nullable(),
  rank: z.number().int().nullable(),
  aboveLine: z.boolean().nullable(),
  included: z.boolean(),
  /** Why it was excluded (required then). */
  exclusionReason: z.string().nullable(),
  /** BEAP: the lot the proposal is procured in (projects with the same title share a lot); numbers given at conversion. */
  lotTitle: z.string().nullable(),
  lotNumber: z.number().int().nullable(),
  batchNumber: z.number().int().nullable(),
  procurementMethod: ProcurementMethodEnum.nullable(),
  plannedStartDate: IsoDate.nullable(),
  plannedEndDate: IsoDate.nullable(),
  reviewOutcome: BeapReviewOutcomeEnum.nullable(),
  reviewComment: z.string().nullable(),
  /** The proposal's current needs assessment version (a BEAP revision adds one). */
  currentVersionNumber: z.number().int().nullable(),
  /** Set once the proposal is a project. */
  projectId: Uuid.nullable(),
  projectCode: z.string().nullable(),
});
export type NeedsSubmissionItemDto = z.infer<typeof NeedsSubmissionItemDtoSchema>;

export const NeedsApprovalStepDtoSchema = z.object({
  id: Uuid,
  chainType: NeedsChainTypeEnum,
  stepOrder: z.number().int(),
  label: z.string(),
  requiredPermissionKey: z.string(),
  organizationScope: ApprovalOrganizationScopeEnum,
  state: z.enum(['DONE', 'CURRENT', 'PENDING']),
});
export type NeedsApprovalStepDto = z.infer<typeof NeedsApprovalStepDtoSchema>;

/**
 * A list put to an approval chain: the portfolio, a BEAP, or one out-of-cycle request (wave 4).
 * Status: a portfolio is created IN_REVIEW (submitting is creating); a BEAP and an out-of-cycle
 * request start DRAFT; RETURNED after a return (the submitter edits and resubmits); APPROVED when
 * the last step approves (the gate's effect runs in the same transaction).
 */
export const NeedsSubmissionDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  kind: NeedsSubmissionKindEnum,
  chainType: NeedsChainTypeEnum,
  status: NeedsSubmissionStatusEnum,
  statusLabel: z.string(),
  submittedByUserId: Uuid.nullable(),
  submittedByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** The signed approval memo (a cycle document of kind APPROVAL_MEMO), required on the portfolio's last step. */
  memoDocumentId: Uuid.nullable(),
  /** BEAP: the narrative (a cycle document of kind BEAP). */
  narrativeDocumentId: Uuid.nullable(),
  /** BEAP only (A5). */
  counterpartDeclaredNgn: z.number().nullable(),
  counterpartEvidenceDocumentId: Uuid.nullable(),
  counterpartRecordedAt: z.string().nullable(),
  counterpartRecordedByName: z.string().nullable(),
  items: z.array(NeedsSubmissionItemDtoSchema),
  /** Included items only. */
  totalNgn: z.number(),
  includedCount: z.number().int(),
  steps: z.array(NeedsApprovalStepDtoSchema),
  /** Null when the chain is complete; 0 before submission or after a return. */
  currentStepOrder: z.number().int().nullable(),
  actions: z.array(
    z.object({
      stepOrder: z.number().int(),
      stepLabel: z.string(),
      decision: z.enum(['APPROVE', 'RETURN', 'REJECT']),
      actorUserId: Uuid,
      actorName: z.string(),
      notes: z.string().nullable(),
      createdAt: z.string(),
    })
  ),
  canAct: z.boolean(),
  cannotActReason: z.string().nullable(),
});
export type NeedsSubmissionDto = z.infer<typeof NeedsSubmissionDtoSchema>;

// ---------------------------------------------------------------------------
// Separation of duties override (D-N.9; owner decision 2026-11-26: a second person authorises)
// ---------------------------------------------------------------------------

/** The guarded actions (`separationViolation`). */
export const NeedsSeparationActionEnum = z.enum(['VALIDATE', 'COST', 'APPROVE_STEP', 'CONFIRM_FUNDING']);
export type NeedsSeparationAction = z.infer<typeof NeedsSeparationActionEnum>;

/**
 * The blocked person asks for an override (an open `SEPARATION_OVERRIDE` flag). Wave 3 settles the
 * route; the details of the flag hold `{ action, requestedByUserId, reason }`.
 */
export const SeparationOverrideRequestSchema = z.object({
  proposalId: Uuid,
  action: NeedsSeparationActionEnum,
  reason: z.string().trim().min(10, 'Give the reason for the override').max(1000),
});
export type SeparationOverrideRequest = z.infer<typeof SeparationOverrideRequestSchema>;

/** Another holder of `needs:override_separation` decides it (never the person who asked). */
export const SeparationOverrideDecisionRequestSchema = z.object({
  decision: z.enum(['AUTHORISED', 'REFUSED']),
  note: z.string().trim().max(1000).nullable().default(null),
});
export type SeparationOverrideDecisionRequest = z.infer<typeof SeparationOverrideDecisionRequestSchema>;

// ---------------------------------------------------------------------------
// Error codes reserved by wave 1 (the services of waves 2–4 throw them)
// ---------------------------------------------------------------------------

/** Separation of duties (plan section 7). All are HTTP 409. */
export const NeedsSeparationErrorCodeEnum = z.enum(['SAME_PERSON_VALIDATION', 'SAME_PERSON_COSTING', 'SAME_PERSON_APPROVAL', 'SAME_PERSON_FUNDING']);
export type NeedsSeparationErrorCode = z.infer<typeof NeedsSeparationErrorCodeEnum>;

export const NEEDS_SEPARATION_ERROR_MESSAGES: Record<NeedsSeparationErrorCode, string> = {
  SAME_PERSON_VALIDATION: 'You uploaded a version of this proposed project, so another person must validate it.',
  SAME_PERSON_COSTING: 'You validated this proposed project, so another person must cost it.',
  SAME_PERSON_APPROVAL: 'You submitted this list or already approved a step of it, so another person must act on this step.',
  SAME_PERSON_FUNDING: 'You approved this portfolio, so another person must confirm the funding.',
};

// ---------------------------------------------------------------------------
// Wave 2 (N3): cycles, documents, upload, proposal reads
// ---------------------------------------------------------------------------

/**
 * Wave 2 decisions (wave file section 5): a cycle is created OPEN (DRAFT is unused until a wave needs
 * it); it is seen by users whose organisation is the cycle's owner or above it (the platform's
 * organisation-tree rule: UBEC HQ sees the SUBEB cycles, a SUBEB sees only its own); writes need the
 * user's organisation to be the owning organisation itself.
 */

/** One deadline moved on a cycle, by `NeedsDeadline.key`. */
export const NeedsDeadlineOverrideSchema = z.object({
  key: z.string().trim().min(1).max(80),
  date: IsoDate,
});
export type NeedsDeadlineOverride = z.infer<typeof NeedsDeadlineOverrideSchema>;

/** POST /api/v1/needs/cycles. The owner is derived (DI: the type's default owner; MG: the State's SUBEB). */
export const OpenNeedsCycleRequestSchema = z.object({
  projectTypeId: Uuid,
  interventionYear: z.number().int().min(2000).max(2100),
  /** Required for a STATE-scope type (Matching Grants); must be null for a NATIONAL one. */
  stateCode: NigeriaStateCodeSchema.nullable().default(null),
  indicativeCeilingNgn: Money.nullable().default(null),
  /** Dates that differ from the type's calendar; the rest come from `cycleDeadlines`. */
  deadlines: z.array(NeedsDeadlineOverrideSchema).max(60).default([]),
  /** D-N.19: proposals of the previous cycle (status NOT_SELECTED) to carry into this one. */
  carryForwardProposalIds: z.array(Uuid).max(500).default([]),
});
export type OpenNeedsCycleRequest = z.infer<typeof OpenNeedsCycleRequestSchema>;
export type OpenNeedsCycleRequestInput = z.input<typeof OpenNeedsCycleRequestSchema>;

/** PATCH /api/v1/needs/cycles/:cycleId (open cycles only). Omitted keeps; `indicativeCeilingNgn: null` clears. */
export const UpdateNeedsCycleRequestSchema = z.object({
  indicativeCeilingNgn: Money.nullable().optional(),
  /** Replaces the dates of the named deadlines; keys not in the cycle's calendar are refused (422). */
  deadlines: z.array(NeedsDeadlineOverrideSchema).max(60).optional(),
});
export type UpdateNeedsCycleRequest = z.infer<typeof UpdateNeedsCycleRequestSchema>;

/** POST /api/v1/needs/cycles/:cycleId/close. No upload or decision after it. */
export const CloseNeedsCycleRequestSchema = z.object({
  reason: z.string().trim().max(2000).nullable().default(null),
});
export type CloseNeedsCycleRequest = z.infer<typeof CloseNeedsCycleRequestSchema>;

/** GET /api/v1/needs/cycles. */
export const NeedsCycleListQuerySchema = z.object({
  interventionYear: z.coerce.number().int().min(2000).max(2100).optional(),
  projectTypeId: Uuid.optional(),
  stateCode: NigeriaStateCodeSchema.optional(),
  status: NeedsCycleStatusEnum.optional(),
});
export type NeedsCycleListQuery = z.infer<typeof NeedsCycleListQuerySchema>;

/** A programme the user can run a cycle for (GET /api/v1/needs/options). */
export const NeedsProgrammeOptionSchema = z.object({
  projectTypeId: Uuid,
  projectTypeName: z.string(),
  fundingGate: NeedsFundingGateEnum,
  referencePrefix: NeedsReferencePrefixEnum,
  cycleScope: NeedsCycleScopeEnum,
  /** The calendar of `suggestedInterventionYear` with these rules (open-cycle dialog). */
  defaultDeadlines: z.array(NeedsDeadlineSchema),
  /** States the user may open a STATE-scope cycle for (their SUBEB's State); empty for NATIONAL. */
  openableStateCodes: z.array(z.string()),
  /** The user may open a cycle of this programme (needs:manage_cycle in the owning organisation). */
  canOpen: z.boolean(),
});
export type NeedsProgrammeOption = z.infer<typeof NeedsProgrammeOptionSchema>;

export const NeedsOptionsDtoSchema = z.object({
  programmes: z.array(NeedsProgrammeOptionSchema),
  /** Intervention years of the cycles the user can see, newest first. */
  years: z.array(z.number().int()),
  /** The intervention year a cycle opened today would be for (`cycleOpens` in Y − 1). */
  suggestedInterventionYear: z.number().int(),
});
export type NeedsOptionsDto = z.infer<typeof NeedsOptionsDtoSchema>;

/** D-N.19: GET /api/v1/needs/cycles/carry-forward (the cycle about to open). */
export const NeedsCarryForwardQuerySchema = z.object({
  projectTypeId: Uuid,
  interventionYear: z.coerce.number().int().min(2000).max(2100),
  stateCode: NigeriaStateCodeSchema.optional(),
});
export type NeedsCarryForwardQuery = z.infer<typeof NeedsCarryForwardQuerySchema>;

/** A NOT_SELECTED proposal of the previous cycle (same type and scope, year − 1). */
export const NeedsCarryForwardCandidateDtoSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  cycleId: Uuid,
  interventionYear: z.number().int(),
  statusLabel: z.string(),
  statusReason: z.string().nullable(),
  siteCount: z.number().int(),
  lgaCodes: z.array(z.string()),
  preliminaryCostNgn: z.number().nullable(),
  costedAmountNgn: z.number().nullable(),
});
export type NeedsCarryForwardCandidateDto = z.infer<typeof NeedsCarryForwardCandidateDtoSchema>;

/** Files accepted for cycle, proposal and design-standard documents (presign kind NEEDS_DOCUMENT). */
export const NEEDS_DOCUMENT_UPLOAD_POLICY: { mimeTypes: readonly string[]; maxBytes: number } = {
  mimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
  maxBytes: 25 * 1024 * 1024,
};

/** POST …/documents/presign (cycle and design-standard documents). */
export const NeedsDocumentPresignRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(3).max(120),
  byteSize: z.number().int().positive(),
});
export type NeedsDocumentPresignRequest = z.infer<typeof NeedsDocumentPresignRequestSchema>;

export const NeedsPresignedUploadDtoSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().int(),
  storageMode: z.enum(['S3_COMPATIBLE', 'LOCAL_DEV_SIMULATED']),
});
export type NeedsPresignedUploadDto = z.infer<typeof NeedsPresignedUploadDtoSchema>;

const ObjectKeySchema = z.string().trim().min(1).max(600);

/** POST /api/v1/needs/cycles/:cycleId/documents: registers an uploaded file; size, type and sha256 are read from storage. */
export const RegisterCycleDocumentRequestSchema = z.object({
  objectKey: ObjectKeySchema,
  kind: CycleDocumentKindEnum,
  title: z.string().trim().min(2).max(200),
  /** A new version of this document (same cycle and kind). */
  supersedesId: Uuid.nullable().default(null),
  /** Proposals of this cycle the document covers (D-N.5). */
  proposalIds: z.array(Uuid).max(500).default([]),
});
export type RegisterCycleDocumentRequest = z.infer<typeof RegisterCycleDocumentRequestSchema>;
export type RegisterCycleDocumentRequestInput = z.input<typeof RegisterCycleDocumentRequestSchema>;

/** POST /api/v1/needs/proposals/:proposalId/documents (presign through the proposal's cycle). */
export const RegisterProposalDocumentRequestSchema = z.object({
  objectKey: ObjectKeySchema,
  kind: ProposalDocumentKindEnum,
  title: z.string().trim().min(2).max(200),
  supersedesId: Uuid.nullable().default(null),
});
export type RegisterProposalDocumentRequest = z.infer<typeof RegisterProposalDocumentRequestSchema>;
export type RegisterProposalDocumentRequestInput = z.input<typeof RegisterProposalDocumentRequestSchema>;

/** A signed link to a stored file (`?format=json` on a file route). */
export const NeedsFileLinkDtoSchema = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int(),
  fileName: z.string(),
});
export type NeedsFileLinkDto = z.infer<typeof NeedsFileLinkDtoSchema>;

/** Upload limits: many files in one request (the API's JSON body limit is 15 MB in all). */
export const NEEDS_UPLOAD_MAX_FILES = 20;
export const NEEDS_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** All files of one request together (base64 adds a third: 10 MB stays inside the 15 MB body limit). */
export const NEEDS_UPLOAD_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const decodedBytes = (files: ReadonlyArray<{ fileBase64: string }>) => files.reduce((sum, f) => sum + Math.floor((f.fileBase64.length * 3) / 4), 0);
const TOTAL_TOO_LARGE = `The files together are larger than ${NEEDS_UPLOAD_MAX_TOTAL_BYTES / (1024 * 1024)} MB: upload them in smaller groups.`;

const NeedsUploadFileSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  /** base64 of the .xlsx (at most NEEDS_FILE_MAX_BYTES once decoded). */
  fileBase64: z.string().min(1).max(Math.ceil((NEEDS_FILE_MAX_BYTES * 4) / 3) + 8),
  /** A new version of this proposal of the URL cycle; null = a new proposed project. */
  proposalId: Uuid.nullable().default(null),
});

/** POST /api/v1/needs/cycles/:cycleId/uploads/preview: nothing is written. */
export const NeedsUploadPreviewRequestSchema = z.object({
  files: z
    .array(NeedsUploadFileSchema)
    .min(1)
    .max(NEEDS_UPLOAD_MAX_FILES)
    .refine((files) => decodedBytes(files) <= NEEDS_UPLOAD_MAX_TOTAL_BYTES, TOTAL_TOO_LARGE),
});
export type NeedsUploadPreviewRequest = z.infer<typeof NeedsUploadPreviewRequestSchema>;
export type NeedsUploadPreviewRequestInput = z.input<typeof NeedsUploadPreviewRequestSchema>;

/**
 * POST /api/v1/needs/cycles/:cycleId/uploads/confirm: the same files, each with the preview's sha256.
 * A sha256 that does not match its file: 409 NEEDS_FILE_CHANGED, nothing written. Otherwise every
 * valid file is written in its own transaction and invalid ones are listed (REFUSED); 201 when at
 * least one file was written, else 422 NEEDS_FILE_INVALID with the per-file results in `details`.
 */
export const NeedsUploadConfirmRequestSchema = z.object({
  files: z
    .array(NeedsUploadFileSchema.extend({ sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first') }))
    .min(1)
    .max(NEEDS_UPLOAD_MAX_FILES)
    .refine((files) => decodedBytes(files) <= NEEDS_UPLOAD_MAX_TOTAL_BYTES, TOTAL_TOO_LARGE),
});
export type NeedsUploadConfirmRequest = z.infer<typeof NeedsUploadConfirmRequestSchema>;
export type NeedsUploadConfirmRequestInput = z.input<typeof NeedsUploadConfirmRequestSchema>;

/** What a file says, in brief (preview and result). */
export const NeedsUploadSummarySchema = z.object({
  title: z.string().nullable(),
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  siteCount: z.number().int(),
  breakdownRowCount: z.number().int(),
  boqLineCount: z.number().int(),
  /** e.g. "Classroom ×6, Toilet ×2" (proposed quantities). */
  facilitiesSummary: z.string(),
  preliminaryCostNgn: z.number().nullable(),
  costedTotalNgn: z.number().nullable(),
});
export type NeedsUploadSummary = z.infer<typeof NeedsUploadSummarySchema>;

/** A flag the version would raise (preview), with a sentence for the user. */
export const NeedsExpectedFlagSchema = z.object({
  kind: ProposalFlagKindEnum,
  message: z.string(),
});
export type NeedsExpectedFlag = z.infer<typeof NeedsExpectedFlagSchema>;

export const NeedsUploadFilePreviewSchema = z.object({
  /** Position in the request (0-based). */
  index: z.number().int(),
  fileName: z.string(),
  sha256: z.string(),
  status: z.enum(['VALID', 'INVALID']),
  action: z.enum(['NEW_PROPOSAL', 'NEW_VERSION']),
  /** NEW_VERSION: the proposal named in the request. */
  proposalId: Uuid.nullable(),
  proposalReference: z.string().nullable(),
  /** `INSITE-NEEDS-v2`, the v1 scope workbook stamp, or null when the file has none. */
  templateVersion: z.string().nullable(),
  summary: NeedsUploadSummarySchema.nullable(),
  /** Blocking (sheet, row, column, reason); the file is refused while any is listed. */
  issues: z.array(NeedsFileIssueSchema),
  /** Non-blocking (old template, values filled in). */
  warnings: z.array(NeedsFileIssueSchema),
  expectedFlags: z.array(NeedsExpectedFlagSchema),
});
export type NeedsUploadFilePreview = z.infer<typeof NeedsUploadFilePreviewSchema>;

export const NeedsUploadPreviewDtoSchema = z.object({
  cycleId: Uuid,
  files: z.array(NeedsUploadFilePreviewSchema),
  validCount: z.number().int(),
  invalidCount: z.number().int(),
});
export type NeedsUploadPreviewDto = z.infer<typeof NeedsUploadPreviewDtoSchema>;

export const NeedsUploadFileResultSchema = NeedsUploadFilePreviewSchema.extend({
  outcome: z.enum(['CREATED', 'VERSION_ADDED', 'REFUSED']),
  /** The proposal written (CREATED / VERSION_ADDED). */
  reference: z.string().nullable(),
  versionNumber: z.number().int().nullable(),
  flags: z.array(ProposalFlagDtoSchema),
});
export type NeedsUploadFileResult = z.infer<typeof NeedsUploadFileResultSchema>;

export const NeedsUploadResultDtoSchema = z.object({
  cycleId: Uuid,
  files: z.array(NeedsUploadFileResultSchema),
  createdCount: z.number().int(),
  versionCount: z.number().int(),
  refusedCount: z.number().int(),
});
export type NeedsUploadResultDto = z.infer<typeof NeedsUploadResultDtoSchema>;

/** GET /api/v1/needs/cycles/:cycleId/proposals (filters on the server; the table pages in the browser). */
export const NeedsProposalListQuerySchema = z.object({
  stage: NeedsStageEnum.optional(),
  status: NeedsProposalStatusEnum.optional(),
  q: z.string().trim().max(120).optional(),
  waitingForMe: z.enum(['true', 'false']).optional(),
});
export type NeedsProposalListQuery = z.infer<typeof NeedsProposalListQuerySchema>;

// ---------------------------------------------------------------------------
// Wave 3 (N4 + N5): stage work, flag resolutions, separation overrides, task queue, reports,
// committee, scoring and ranking. Decisions: `needs_pipeline/wave3_validation_costing_scoring.md`
// section 5; routes: parent plan section 17.9.
// ---------------------------------------------------------------------------

const ReasonText = z.string().trim().min(5, 'Give the reason').max(2000);

const uniqueIds = (ids: readonly string[], ctx: z.RefinementCtx, path: (string | number)[]) => {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [...path, i], message: 'Listed twice' });
    seen.add(id);
  });
};

/**
 * The submitter's batch actions (D-N.4), `POST /cycles/:cycleId/proposal-actions`:
 * - SUBMIT: a DRAFT in the first stage, or IN_PROGRESS at Design (DI), moves to the next stage once
 *   its current version has the minimum fields of the stage it leaves (incl. DRAWINGS);
 * - RESUBMIT: a RETURNED proposal goes back to IN_PROGRESS in the stage that returned it;
 * - WITHDRAW (reason required): closed WITHDRAWN.
 * All or nothing: one item that may not move refuses the request, nothing is written.
 */
export const ProposalBatchActionEnum = z.enum(['SUBMIT', 'RESUBMIT', 'WITHDRAW']);
export type ProposalBatchAction = z.infer<typeof ProposalBatchActionEnum>;

export const ProposalBatchActionRequestSchema = z
  .object({
    action: ProposalBatchActionEnum,
    proposalIds: z.array(Uuid).min(1, 'Select at least one proposed project').max(500),
    reason: z.string().trim().max(2000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.proposalIds, ctx, ['proposalIds']);
    if (v.action === 'WITHDRAW' && (!v.reason || v.reason.length < 5)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give the reason for withdrawing' });
  });
export type ProposalBatchActionRequest = z.infer<typeof ProposalBatchActionRequestSchema>;
export type ProposalBatchActionRequestInput = z.input<typeof ProposalBatchActionRequestSchema>;

/**
 * The outcomes a stage decision (`StageDecisionRequestSchema`, `POST /cycles/:cycleId/decisions`)
 * may give in each stage. Identification and Design move by SUBMIT; Prioritisation moves by the
 * committee's finalisation (only RETURN is a stage decision there); Approval and Funding are wave 4.
 */
export const STAGE_DECISION_OUTCOMES: Partial<Record<NeedsStage, readonly StageOutcome[]>> = {
  VALIDATION: ['ADVANCE', 'RETURN', 'NOT_VALIDATED'],
  COSTING: ['ADVANCE', 'RETURN'],
  PRIORITISATION: ['RETURN'],
};

/** Which resolutions a person may give each flag kind (CORRECTED is the system's, on a new version). */
export const FLAG_RESOLUTIONS_BY_KIND: Record<ProposalFlagKind, readonly ProposalFlagResolution[]> = {
  DUPLICATE: ['NOT_A_DUPLICATE', 'MERGED', 'NOT_VALIDATED'],
  ESSENTIAL_FACILITY_GAP: ['JUSTIFIED'],
  RATE_VARIANCE: ['ACKNOWLEDGED'],
  CEILING_EXCEEDED: ['ACKNOWLEDGED'],
  // D-N.18: only a corrected costed version clears it.
  MISSING_SUPERVISION_LINE: [],
  // Decided through the override routes, never through a flag resolution.
  SEPARATION_OVERRIDE: [],
};

/** Who resolves a flag kind (the actor of the stage it blocks). */
export const FLAG_RESOLVER_PERMISSION: Record<ProposalFlagKind, string | null> = {
  DUPLICATE: 'needs:validate',
  ESSENTIAL_FACILITY_GAP: 'needs:validate',
  RATE_VARIANCE: 'needs:cost',
  CEILING_EXCEEDED: 'needs:cost',
  MISSING_SUPERVISION_LINE: null,
  SEPARATION_OVERRIDE: 'needs:override_separation',
};

export const PROPOSAL_FLAG_RESOLUTION_LABELS: Record<ProposalFlagResolution, string> = {
  NOT_A_DUPLICATE: 'Not a duplicate',
  MERGED: 'Merged into another proposed project',
  NOT_VALIDATED: 'Not validated',
  JUSTIFIED: 'Justified',
  ACKNOWLEDGED: 'Acknowledged',
  CORRECTED: 'Corrected in a later version',
  AUTHORISED: 'Override authorised',
  REFUSED: 'Override refused',
};

/** One flag resolved by a person (validation record or costing acknowledgement). */
export const FlagResolutionInputSchema = z
  .object({
    flagId: Uuid,
    resolution: ProposalFlagResolutionEnum,
    reason: ReasonText,
    /** MERGED: the proposal of the same cycle this one is merged into (it closes MERGED). */
    mergeIntoProposalId: Uuid.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.resolution === 'MERGED' && !v.mergeIntoProposalId) ctx.addIssue({ code: 'custom', path: ['mergeIntoProposalId'], message: 'Choose the proposed project it is merged into' });
    if (v.resolution !== 'MERGED' && v.mergeIntoProposalId) ctx.addIssue({ code: 'custom', path: ['mergeIntoProposalId'], message: 'Only a merge names another proposed project' });
  });
export type FlagResolutionInput = z.infer<typeof FlagResolutionInputSchema>;
export type FlagResolutionInputInput = z.input<typeof FlagResolutionInputSchema>;

/** `POST /proposals/:proposalId/flags/resolve`: e.g. the quantity surveyor acknowledges a rate variance. */
export const ResolveProposalFlagsRequestSchema = z
  .object({ resolutions: z.array(FlagResolutionInputSchema).min(1).max(50) })
  .superRefine((v, ctx) => uniqueIds(v.resolutions.map((r) => r.flagId), ctx, ['resolutions']));
export type ResolveProposalFlagsRequest = z.infer<typeof ResolveProposalFlagsRequestSchema>;
export type ResolveProposalFlagsRequestInput = z.input<typeof ResolveProposalFlagsRequestSchema>;

/**
 * `POST /proposals/:proposalId/validation`: the validator's record on the current version (A2): desk
 * review, site verification (required for an ADVANCE record when the cycle's `requireSiteVerification`
 * is on; evidence = SITE_VERIFICATION_EVIDENCE documents of this proposal), and resolutions of the
 * open DUPLICATE and ESSENTIAL_FACILITY_GAP flags. The outcome is the validator's finding; the stage
 * decision then moves the proposal (an ADVANCE decision needs an ADVANCE record on the current version).
 */
export const RecordValidationRequestSchema = z
  .object({
    outcome: z.enum(['ADVANCE', 'RETURN', 'NOT_VALIDATED']),
    deskNotes: z.string().trim().min(10, 'Write the desk review').max(4000),
    siteVerification: SiteVerificationSchema.nullable().default(null),
    flagResolutions: z.array(FlagResolutionInputSchema).max(50).default([]),
  })
  .superRefine((v, ctx) => uniqueIds(v.flagResolutions.map((r) => r.flagId), ctx, ['flagResolutions']));
export type RecordValidationRequest = z.infer<typeof RecordValidationRequestSchema>;
export type RecordValidationRequestInput = z.input<typeof RecordValidationRequestSchema>;

/** What a stage decision or batch action did, per proposal (all items succeed together). */
export const NeedsDecisionResultDtoSchema = z.object({
  /** The stage decision written; null for a batch action. */
  decisionId: Uuid.nullable(),
  items: z.array(
    z.object({
      proposalId: Uuid,
      reference: z.string(),
      outcome: z.string(),
      stage: NeedsStageEnum,
      status: NeedsProposalStatusEnum,
      statusLabel: z.string(),
    })
  ),
  /** Cycle reports produced by the decision (Validated Project List, Cost Estimate Report …). */
  generatedDocuments: z.array(NeedsCycleDocumentDtoSchema),
});
export type NeedsDecisionResultDto = z.infer<typeof NeedsDecisionResultDtoSchema>;

/** One refused item of a batch (`details.items` of the 409/422 error). */
export const NeedsBatchProblemSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  code: z.string(),
  message: z.string(),
});
export type NeedsBatchProblem = z.infer<typeof NeedsBatchProblemSchema>;

/**
 * Details of a SEPARATION_OVERRIDE flag (D-N.9, 16.2 O-1). The authorisation counts for the asker's
 * `action` on this proposal while it stays in `stage`; `usedAt` is set when the action went ahead.
 */
export const SeparationOverrideDetailsSchema = z.object({
  action: NeedsSeparationActionEnum,
  violation: NeedsSeparationErrorCodeEnum,
  requestedByUserId: Uuid,
  requestedByName: z.string(),
  reason: z.string(),
  stage: NeedsStageEnum,
  usedAt: z.string().nullable().default(null),
});
export type SeparationOverrideDetails = z.infer<typeof SeparationOverrideDetailsSchema>;

/** The generated cycle reports (D-N.5): xlsx and PDF, each regeneration supersedes the last. */
export const NeedsReportKindEnum = z.enum(['VALIDATED_PROJECT_LIST', 'COST_ESTIMATE_REPORT', 'PRIORITISED_PROJECT_PORTFOLIO']);
export type NeedsReportKind = z.infer<typeof NeedsReportKindEnum>;

/** `GET /api/v1/needs/tasks` (every visible open cycle, or one with `cycleId`). */
export const NeedsTaskListQuerySchema = z.object({ cycleId: Uuid.optional() });
export type NeedsTaskListQuery = z.infer<typeof NeedsTaskListQuerySchema>;

/** `GET /api/v1/needs/tasks/count` (nav badge). */
export const NeedsTaskCountDtoSchema = z.object({ count: z.number().int() });
export type NeedsTaskCountDto = z.infer<typeof NeedsTaskCountDtoSchema>;

// Committee (N5) ---------------------------------------------------------------

/**
 * `PUT /cycles/:cycleId/committee`: the full membership, set by the chair (a holder of
 * `needs:chair_committee` in the owning organisation, who is the CHAIR row). Members hold
 * `needs:score` and belong to the owning organisation. Not after the ranking is finalised.
 */
export const SetCommitteeRequestSchema = z
  .object({
    members: z.array(z.object({ userId: Uuid, role: CommitteeRoleEnum })).min(1).max(30),
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.members.map((m) => m.userId), ctx, ['members']);
    if (v.members.filter((m) => m.role === 'CHAIR').length !== 1) ctx.addIssue({ code: 'custom', path: ['members'], message: 'The committee has exactly one chair' });
  });
export type SetCommitteeRequest = z.infer<typeof SetCommitteeRequestSchema>;

/** `POST /cycles/:cycleId/committee/scoring`: the chair opens scoring (every member declared) or closes it. */
export const CommitteeScoringRequestSchema = z.object({ action: z.enum(['OPEN', 'CLOSE']) });
export type CommitteeScoringRequest = z.infer<typeof CommitteeScoringRequestSchema>;

export const NeedsCommitteeCandidateSchema = z.object({
  userId: Uuid,
  fullName: z.string(),
  roleName: z.string(),
  canScore: z.boolean(),
  canChair: z.boolean(),
});
export type NeedsCommitteeCandidate = z.infer<typeof NeedsCommitteeCandidateSchema>;

/** `GET /cycles/:cycleId/committee`. */
export const NeedsCommitteeDtoSchema = z.object({
  cycleId: Uuid,
  members: z.array(CommitteeMemberDtoSchema),
  /** People of the owning organisation who may be appointed (for the chair). */
  candidates: z.array(NeedsCommitteeCandidateSchema),
  quorum: z.number().int(),
  divergenceThreshold: z.number(),
  /** Proposals waiting at Prioritisation (in progress). */
  proposalCount: z.number().int(),
  scoringOpenedAt: z.string().nullable(),
  scoringOpenedByName: z.string().nullable(),
  scoringClosedAt: z.string().nullable(),
  rankingFinalisedAt: z.string().nullable(),
  rankingFinalisedByName: z.string().nullable(),
  /** The viewer's own membership. */
  me: z.object({ memberId: Uuid, role: CommitteeRoleEnum, declared: z.boolean() }).nullable(),
  /** The viewer may change the membership, open or close scoring and finalise. */
  canManage: z.boolean(),
});
export type NeedsCommitteeDto = z.infer<typeof NeedsCommitteeDtoSchema>;

export const ProposalScoreSchema = z.object({ impact: z.number(), ease: z.number(), total: z.number() });

export const DivergentCriterionSchema = z.object({
  criterionKey: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  spread: z.number(),
});
export type DivergentCriterionDto = z.infer<typeof DivergentCriterionSchema>;

/** `GET /cycles/:cycleId/score-sheets/mine`: what the member scores and their own sheets. */
export const NeedsMyScoringDtoSchema = z.object({
  cycleId: Uuid,
  canScore: z.boolean(),
  /** Why not ("Declare your conflicts of interest first", "Scoring is not open") when `canScore` is false. */
  cannotScoreReason: z.string().nullable(),
  items: z.array(
    z.object({
      proposalId: Uuid,
      reference: z.string(),
      title: z.string(),
      costedAmountNgn: z.number().nullable(),
      recusal: RecusalReasonEnum.nullable(),
      sheet: ScoreSheetDtoSchema.nullable(),
    })
  ),
});
export type NeedsMyScoringDto = z.infer<typeof NeedsMyScoringDtoSchema>;

/**
 * `GET /proposals/:proposalId/scores`. Scoring is independent (D-N.10): until the ranking is
 * finalised a member sees only their own sheet and the chair sees all (`sheetsHidden` says so).
 */
export const NeedsProposalScoresDtoSchema = z.object({
  proposalId: Uuid,
  score: ProposalScoreSchema.nullable(),
  rank: z.number().int().nullable(),
  aboveLine: z.boolean().nullable(),
  lineOverrideReason: z.string().nullable(),
  sheets: z.array(ScoreSheetDtoSchema),
  sheetsHidden: z.boolean(),
  sheetCount: z.number().int(),
  /** Members who score it (not recused). */
  eligibleCount: z.number().int(),
  divergent: z.array(DivergentCriterionSchema),
  recusals: z.array(z.object({ memberName: z.string(), reason: RecusalReasonEnum })),
});
export type NeedsProposalScoresDto = z.infer<typeof NeedsProposalScoresDtoSchema>;

export const RankingPlacementEnum = z.enum(['ABOVE', 'BELOW']);
export type RankingPlacement = z.infer<typeof RankingPlacementEnum>;

/** `POST /cycles/:cycleId/ranking/placements`: the chair puts a proposal above or below the line (null clears). */
export const RankingPlacementRequestSchema = z
  .object({ proposalId: Uuid, placement: RankingPlacementEnum.nullable(), reason: z.string().trim().max(2000).nullable().default(null) })
  .superRefine((v, ctx) => {
    if (v.placement && (!v.reason || v.reason.length < 5)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give the reason for the override' });
  });
export type RankingPlacementRequest = z.infer<typeof RankingPlacementRequestSchema>;

/** `PUT /cycles/:cycleId/ranking/line`: how many ranked proposals are above the line (null = at the ceiling). */
export const SetFundingLineRequestSchema = z
  .object({ linePosition: z.number().int().min(0).max(500).nullable(), reason: z.string().trim().max(2000).nullable().default(null) })
  .superRefine((v, ctx) => {
    if (v.linePosition !== null && (!v.reason || v.reason.length < 5)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give the reason for moving the line' });
  });
export type SetFundingLineRequest = z.infer<typeof SetFundingLineRequestSchema>;

/** `POST /cycles/:cycleId/ranking/finalise`. Minutes: a COMMITTEE_MINUTES cycle document (optional, also addable later). */
export const FinaliseRankingRequestSchema = z.object({
  minutesDocumentId: Uuid.nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
});
export type FinaliseRankingRequest = z.infer<typeof FinaliseRankingRequestSchema>;

export const NeedsRankingRowSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  costNgn: z.number().nullable(),
  score: ProposalScoreSchema.nullable(),
  sheetCount: z.number().int(),
  eligibleCount: z.number().int(),
  divergent: z.array(DivergentCriterionSchema),
  rank: z.number().int().nullable(),
  cumulativeNgn: z.number().nullable(),
  /** Above the line the ceiling (or the chair's line position) draws. */
  computedAboveLine: z.boolean(),
  /** After the chair's placement, if any. */
  aboveLine: z.boolean(),
  placement: RankingPlacementEnum.nullable(),
  placementReason: z.string().nullable(),
});
export type NeedsRankingRow = z.infer<typeof NeedsRankingRowSchema>;

/** `GET /cycles/:cycleId/ranking` (live until finalised, then the stored ranks). */
export const NeedsRankingDtoSchema = z.object({
  cycleId: Uuid,
  finalised: z.boolean(),
  finalisedAt: z.string().nullable(),
  finalisedByName: z.string().nullable(),
  ceilingNgn: z.number().nullable(),
  /** Where the ceiling draws the line. */
  computedLinePosition: z.number().int(),
  /** The line in force (the chair's, else the computed one). */
  linePosition: z.number().int(),
  lineReason: z.string().nullable(),
  totalAboveNgn: z.number(),
  quorum: z.number().int(),
  rows: z.array(NeedsRankingRowSchema),
  canManage: z.boolean(),
  canFinalise: z.boolean(),
  cannotFinaliseReason: z.string().nullable(),
});
export type NeedsRankingDto = z.infer<typeof NeedsRankingDtoSchema>;

/** Sheet names used in `NeedsFileIssue.sheet` (template v2). */
export const NEEDS_TEMPLATE_SHEETS = {
  FILE: 'File',
  INSTRUCTIONS: 'Instructions',
  PROJECT: 'Project',
  SITES: 'Sites',
  BREAKDOWN: 'Facilities breakdown',
  BOQ: 'BoQ',
  COSTING: 'Costing summary',
  RATES: 'Rates',
  LISTS: 'Lists',
} as const;

// ---------------------------------------------------------------------------
// Wave 4 (N6 + N7b–e): approval, out-of-cycle, funding, BEAP, procurement plan, project integration
// Decisions: needs_pipeline/wave4_approval_funding_conversion.md section 5. Names: plan section 17.10.
// ---------------------------------------------------------------------------

/** A decision on the current step of a cycle chain (no rejection in wave 4: a return sends it back). */
export const NeedsApprovalDecisionEnum = z.enum(['APPROVE', 'RETURN']);
export type NeedsApprovalDecision = z.infer<typeof NeedsApprovalDecisionEnum>;

const Reason = z.string().trim().min(5, 'Give the reason').max(1000);

/** One proposal of the portfolio: included, or excluded with a reason. */
export const PortfolioItemInputSchema = z
  .object({
    proposalId: Uuid,
    included: z.boolean(),
    exclusionReason: z.string().trim().max(1000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (!v.included && (!v.exclusionReason || v.exclusionReason.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['exclusionReason'], message: 'Give the reason for the exclusion' });
    }
  });
export type PortfolioItemInput = z.infer<typeof PortfolioItemInputSchema>;

/**
 * `POST /cycles/:cycleId/portfolio` (`needs:submit_portfolio`, owning organisation): submits the
 * finalised ranking's proposals at Approval to the NEEDS_PORTFOLIO chain (IN_REVIEW at once); after a
 * return the same body resubmits it. Every proposal at Approval must be listed; a proposal below the
 * funding line cannot be included (the committee's line, D-N.10).
 */
export const SubmitPortfolioRequestSchema = z.object({
  items: z.array(PortfolioItemInputSchema).min(1).max(500),
  note: z.string().trim().max(2000).nullable().default(null),
});
export type SubmitPortfolioRequest = z.infer<typeof SubmitPortfolioRequestSchema>;
export type SubmitPortfolioRequestInput = z.input<typeof SubmitPortfolioRequestSchema>;

/**
 * A decision on the current step of any cycle chain. Portfolio: a step may exclude more proposals
 * (each with a reason); the last step needs the signed memo (`memoDocumentId`, a cycle document of
 * kind APPROVAL_MEMO). A return needs notes.
 */
export const NeedsApprovalActionRequestSchema = z
  .object({
    decision: NeedsApprovalDecisionEnum,
    notes: z.string().trim().max(2000).nullable().default(null),
    exclusions: z.array(z.object({ proposalId: Uuid, reason: Reason })).max(500).default([]),
    memoDocumentId: Uuid.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'RETURN' && (!v.notes || v.notes.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Say what must change' });
    }
    if (v.decision === 'RETURN' && v.exclusions.length) {
      ctx.addIssue({ code: 'custom', path: ['exclusions'], message: 'Exclusions are made when approving' });
    }
  });
export type NeedsApprovalActionRequest = z.infer<typeof NeedsApprovalActionRequestSchema>;
export type NeedsApprovalActionRequestInput = z.input<typeof NeedsApprovalActionRequestSchema>;

/** Where approved items land, for the approval review (C1; `needsDistribution` in utils). */
export const NeedsDistributionLevelEnum = z.enum(['ZONE', 'STATE', 'LGA']);
export type NeedsDistributionLevel = z.infer<typeof NeedsDistributionLevelEnum>;

// --- Out-of-cycle (D-N.14) --------------------------------------------------

/**
 * `POST /api/v1/needs/out-of-cycle` (`needs:submit`, the owning organisation of the programme's cycle
 * for that year and scope). Creates the proposal (route OUT_OF_CYCLE, stage APPROVAL, status DRAFT)
 * and its DRAFT OUT_OF_CYCLE submission in that cycle; when the year has no cycle, a CLOSED container
 * cycle is created for it (wave 4 decision). The authorising document is required before submitting;
 * a needs assessment (template v2) is optional.
 */
export const OutOfCycleRequestSchema = z.object({
  projectTypeId: Uuid,
  interventionYear: z.number().int().min(2000).max(2100),
  stateCode: NigeriaStateCodeSchema.nullable().default(null),
  title: z.string().trim().min(3).max(200),
  reason: OutOfCycleReasonEnum,
  reasonDetails: z.string().trim().min(10, 'Explain why the project cannot wait for the annual cycle').max(4000),
  requestedAmountNgn: z.number().positive().max(1e13),
});
export type OutOfCycleRequest = z.infer<typeof OutOfCycleRequestSchema>;
export type OutOfCycleRequestInput = z.input<typeof OutOfCycleRequestSchema>;

/** `PATCH /out-of-cycle/:proposalId` while DRAFT or RETURNED. */
export const UpdateOutOfCycleRequestSchema = OutOfCycleRequestSchema.pick({ title: true, reason: true, reasonDetails: true, requestedAmountNgn: true }).partial();
export type UpdateOutOfCycleRequest = z.infer<typeof UpdateOutOfCycleRequestSchema>;

/** `GET /out-of-cycle` filters. */
export const OutOfCycleListQuerySchema = z.object({ cycleId: Uuid.optional() });
export type OutOfCycleListQuery = z.infer<typeof OutOfCycleListQuerySchema>;

export const NeedsOutOfCycleDtoSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  cycleId: Uuid,
  cycleStatus: NeedsCycleStatusEnum,
  interventionYear: z.number().int(),
  projectTypeId: Uuid,
  projectTypeName: z.string(),
  stateCode: z.string().nullable(),
  reason: OutOfCycleReasonEnum,
  reasonLabel: z.string(),
  reasonDetails: z.string(),
  requestedAmountNgn: z.number(),
  authorisingDocument: NeedsProposalDocumentDtoSchema.nullable(),
  documents: z.array(NeedsProposalDocumentDtoSchema),
  currentVersion: NeedsAssessmentVersionDtoSchema.nullable(),
  status: NeedsProposalStatusEnum,
  statusLabel: z.string(),
  submission: NeedsSubmissionDtoSchema,
  projectId: Uuid.nullable(),
  projectCode: z.string().nullable(),
  canEdit: z.boolean(),
  createdByName: z.string(),
  createdAt: z.string(),
});
export type NeedsOutOfCycleDto = z.infer<typeof NeedsOutOfCycleDtoSchema>;

// --- Funding, Direct Intervention (N7b) ---------------------------------------

export const NeedsFundingRecordKindEnum = z.enum(['BUDGET_SUBMISSION', 'APPROPRIATION']);
export type NeedsFundingRecordKind = z.infer<typeof NeedsFundingRecordKindEnum>;

/** `POST /cycles/:cycleId/funding/budget-submission` (`needs:record_funding`, owning organisation). */
export const RecordBudgetSubmissionRequestSchema = z.object({
  submittedOn: IsoDate,
  amountNgn: z.number().positive().max(1e13),
  /** A cycle document of kind BUDGET_SUBMISSION_ACKNOWLEDGEMENT. */
  acknowledgementDocumentId: Uuid.nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
});
export type RecordBudgetSubmissionRequest = z.infer<typeof RecordBudgetSubmissionRequestSchema>;

export const NeedsFundingRecordDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  kind: NeedsFundingRecordKindEnum,
  recordedOn: IsoDate,
  amountNgn: z.number().nullable(),
  documentId: Uuid.nullable(),
  approvedListId: Uuid.nullable(),
  fileName: z.string().nullable(),
  sha256: z.string().nullable(),
  note: z.string().nullable(),
  /** APPROPRIATION: counts and totals of the import. */
  summary: z.record(z.unknown()),
  recordedByName: z.string(),
  createdAt: z.string(),
});
export type NeedsFundingRecordDto = z.infer<typeof NeedsFundingRecordDtoSchema>;

/**
 * The appropriated schedule: the approved-list workbook with a required "Proposal reference" column
 * in place of "Project ID" (`GET /cycles/:cycleId/funding/appropriation/template`).
 */
export interface AppropriatedScheduleColumn extends Omit<ApprovedListColumn, 'key'> {
  key: ApprovedListColumn['key'] | 'proposalRef';
}
export const APPROPRIATED_SCHEDULE_COLUMNS: readonly AppropriatedScheduleColumn[] = [
  ...APPROVED_LIST_COLUMNS.filter((c) => c.key !== 'projectRef'),
  {
    key: 'proposalRef',
    header: 'Proposal reference',
    required: true,
    note: 'The proposed project the row funds, e.g. 2027-DI-014 (or an approved out-of-cycle request).',
  },
];

export const AppropriationImportPreviewRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  fileBase64: z.string().min(1),
});
export type AppropriationImportPreviewRequest = z.infer<typeof AppropriationImportPreviewRequestSchema>;

export const AppropriationImportConfirmRequestSchema = AppropriationImportPreviewRequestSchema.extend({
  /** The preview's sha256: another file is 409 NEEDS_FILE_CHANGED. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** When the appropriation act or schedule was passed. */
  appropriatedOn: IsoDate,
});
export type AppropriationImportConfirmRequest = z.infer<typeof AppropriationImportConfirmRequestSchema>;

/**
 * Per row: MATCHED (funded at the approved amount), PARTLY_FUNDED (below it), OUT_OF_CYCLE (an
 * approved out-of-cycle proposal: the row is linked to its project), REFUSED (unknown reference, not
 * at Funding, above the approved amount, listed twice …).
 */
export const AppropriationRowOutcomeEnum = z.enum(['MATCHED', 'PARTLY_FUNDED', 'OUT_OF_CYCLE', 'REFUSED']);
export type AppropriationRowOutcome = z.infer<typeof AppropriationRowOutcomeEnum>;

export const AppropriationIssueSchema = z.object({ row: z.number().int().nullable(), column: z.string().nullable(), code: z.string(), message: z.string() });
export type AppropriationIssue = z.infer<typeof AppropriationIssueSchema>;

export const AppropriationPreviewRowSchema = z.object({
  rowNumber: z.number().int(),
  rowRef: z.string(),
  proposalReference: z.string().nullable(),
  proposalId: Uuid.nullable(),
  title: z.string(),
  approvedAmountNgn: z.number().nullable(),
  fundedAmountNgn: z.number().nullable(),
  outcome: AppropriationRowOutcomeEnum,
  issues: z.array(AppropriationIssueSchema),
});
export type AppropriationPreviewRow = z.infer<typeof AppropriationPreviewRowSchema>;

export const AppropriationPreviewDtoSchema = z.object({
  cycleId: Uuid,
  fileName: z.string(),
  sha256: z.string(),
  rows: z.array(AppropriationPreviewRowSchema),
  /** Proposals at Funding the file does not fund: "Not funded, carried forward" on confirm. */
  notFunded: z.array(z.object({ proposalId: Uuid, reference: z.string(), title: z.string(), approvedAmountNgn: z.number().nullable() })),
  /** File-level problems (template, list header, year). */
  issues: z.array(AppropriationIssueSchema),
  totals: z.object({
    matched: z.number().int(),
    partlyFunded: z.number().int(),
    outOfCycle: z.number().int(),
    refused: z.number().int(),
    notFunded: z.number().int(),
    fundedNgn: z.number(),
  }),
  canConfirm: z.boolean(),
});
export type AppropriationPreviewDto = z.infer<typeof AppropriationPreviewDtoSchema>;

export const NeedsConvertedProposalSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  projectId: Uuid,
  projectCode: z.string(),
  fundedAmountNgn: z.number(),
});
export type NeedsConvertedProposal = z.infer<typeof NeedsConvertedProposalSchema>;

export const AppropriationResultDtoSchema = z.object({
  fundingRecord: NeedsFundingRecordDtoSchema,
  converted: z.array(NeedsConvertedProposalSchema),
  notSelected: z.array(z.object({ proposalId: Uuid, reference: z.string() })),
  approvedListId: Uuid,
});
export type AppropriationResultDto = z.infer<typeof AppropriationResultDtoSchema>;

/** `GET /cycles/:cycleId/funding` */
export const NeedsFundingDtoSchema = z.object({
  cycleId: Uuid,
  fundingGate: NeedsFundingGateEnum,
  records: z.array(NeedsFundingRecordDtoSchema),
  /** Proposals at Funding (waiting for appropriation or the BEAP). */
  awaiting: z.array(NeedsSubmissionItemDtoSchema),
  converted: z.array(NeedsConvertedProposalSchema),
  canRecord: z.boolean(),
  /** Why the current user cannot confirm an import (e.g. SAME_PERSON_FUNDING), null when they can. */
  cannotConfirmReason: z.string().nullable(),
});
export type NeedsFundingDto = z.infer<typeof NeedsFundingDtoSchema>;

// --- Procurement plan, Direct Intervention (B3) ------------------------------

export const NeedsProcurementPlanRowSchema = z.object({
  projectId: Uuid,
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  /** As shown (`formatProjectCode`): the reference until a lot is assigned. */
  projectCode: z.string(),
  projectStatus: z.string(),
  stateCode: z.string().nullable(),
  budgetNgn: z.number().nullable(),
  lotId: Uuid.nullable(),
  lotNumber: z.number().int().nullable(),
  lotTitle: z.string().nullable(),
  batchNumber: z.number().int().nullable(),
});
export type NeedsProcurementPlanRow = z.infer<typeof NeedsProcurementPlanRowSchema>;

export const NeedsProcurementPlanDtoSchema = z.object({
  cycleId: Uuid,
  interventionYear: z.number().int(),
  rows: z.array(NeedsProcurementPlanRowSchema),
  /** The tenant's lots of the cycle's year, for the picker. */
  lots: z.array(z.object({ id: Uuid, number: z.number().int(), title: z.string(), batchCount: z.number().int() })),
  planDocuments: z.array(NeedsCycleDocumentDtoSchema),
  canPlan: z.boolean(),
});
export type NeedsProcurementPlanDto = z.infer<typeof NeedsProcurementPlanDtoSchema>;

/** `POST /cycles/:cycleId/procurement-plan/lots` (`procurement:plan_lots`): converted drafts without a lot only. */
export const AssignLotsRequestSchema = z.object({
  items: z.array(z.object({ projectId: Uuid, lotChoice: LotChoiceSchema })).min(1).max(500),
});
export type AssignLotsRequest = z.infer<typeof AssignLotsRequestSchema>;

// --- BEAP, Matching Grants (B4) -----------------------------------------------

export const BeapItemInputSchema = z
  .object({
    proposalId: Uuid,
    included: z.boolean(),
    exclusionReason: z.string().trim().max(1000).nullable().default(null),
    lotTitle: z.string().trim().max(200).nullable().default(null),
    procurementMethod: ProcurementMethodEnum.nullable().default(null),
    plannedStartDate: IsoDate.nullable().default(null),
    plannedEndDate: IsoDate.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (!v.included && (!v.exclusionReason || v.exclusionReason.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['exclusionReason'], message: 'Give the reason for the exclusion' });
    }
    if (v.plannedStartDate && v.plannedEndDate && v.plannedEndDate < v.plannedStartDate) {
      ctx.addIssue({ code: 'custom', path: ['plannedEndDate'], message: 'The end is before the start' });
    }
  });
export type BeapItemInput = z.infer<typeof BeapItemInputSchema>;

/**
 * `PUT /cycles/:cycleId/beap` (`needs:prepare_beap`, owning organisation): creates or edits the
 * State's BEAP while DRAFT or RETURNED. Submitting (`POST /cycles/:cycleId/beap/submit`) needs every
 * proposal at Funding listed, every included item with a lot title, a procurement method and both
 * dates, and the narrative. Counterpart evidence may follow (A5).
 */
export const SaveBeapRequestSchema = z.object({
  items: z.array(BeapItemInputSchema).min(1).max(500),
  narrativeDocumentId: Uuid.nullable().default(null),
  counterpartDeclaredNgn: z.number().nonnegative().max(1e13).nullable().default(null),
  counterpartEvidenceDocumentId: Uuid.nullable().default(null),
});
export type SaveBeapRequest = z.infer<typeof SaveBeapRequestSchema>;
export type SaveBeapRequestInput = z.input<typeof SaveBeapRequestSchema>;

/** `POST /cycles/:cycleId/beap/review-items`: the reviewer at the current BEAP step. */
export const BeapItemReviewRequestSchema = z.object({
  items: z
    .array(
      z
        .object({ proposalId: Uuid, outcome: BeapReviewOutcomeEnum, comment: z.string().trim().max(2000).nullable().default(null) })
        .superRefine((v, ctx) => {
          if (v.outcome !== 'ACCEPTED' && (!v.comment || v.comment.length < 5)) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Write the comment' });
        })
    )
    .min(1)
    .max(500),
});
export type BeapItemReviewRequest = z.infer<typeof BeapItemReviewRequestSchema>;

/** `PUT /cycles/:cycleId/beap/counterpart` (`needs:prepare_beap`, owning organisation): also after approval (A5). */
export const RecordCounterpartRequestSchema = z.object({
  counterpartDeclaredNgn: z.number().positive().max(1e13),
  /** A cycle document of kind COUNTERPART_EVIDENCE. */
  counterpartEvidenceDocumentId: Uuid,
});
export type RecordCounterpartRequest = z.infer<typeof RecordCounterpartRequestSchema>;

// --- Project integration (C5) -------------------------------------------------

/** `GET /api/v1/needs/pipeline` (Portfolio → Pipeline): proposals at Approval or Funding, and converted drafts not yet live. */
export const NeedsPipelineRowSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  cycleId: Uuid,
  interventionYear: z.number().int(),
  projectTypeName: z.string(),
  route: NeedsProposalRouteEnum,
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  stage: NeedsStageEnum,
  status: NeedsProposalStatusEnum,
  statusLabel: z.string(),
  /** Funded, else approved, else costed, else preliminary. */
  amountNgn: z.number().nullable(),
  projectId: Uuid.nullable(),
  projectCode: z.string().nullable(),
  projectStatus: z.string().nullable(),
});
export type NeedsPipelineRow = z.infer<typeof NeedsPipelineRowSchema>;

export const NeedsPipelineQuerySchema = z.object({
  projectTypeId: Uuid.optional(),
  interventionYear: z.coerce.number().int().optional(),
  stateCode: z.string().optional(),
});
export type NeedsPipelineQuery = z.infer<typeof NeedsPipelineQuerySchema>;

/** A document from the project's proposal or its cycle, read-only on the project (wave 4 section 0 item 3: read-through). */
export const ProjectNeedsDocumentSchema = z.object({
  id: Uuid,
  scope: z.enum(['PROPOSAL', 'CYCLE', 'VERSION']),
  kind: z.string(),
  kindLabel: z.string(),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  uploadedByName: z.string(),
  uploadedAt: z.string(),
});
export type ProjectNeedsDocument = z.infer<typeof ProjectNeedsDocumentSchema>;

/**
 * `GET /projects/:projectId/needs-origin` (any web reader of the project): the Origin card, the
 * Documents "Needs assessment" group and the Facilities tab of Sprints & scope. Files:
 * `GET /projects/:projectId/needs-origin/files/:scope/:id` → `NeedsFileLinkDto`.
 */
export const ProjectNeedsOriginDtoSchema = z.object({
  projectId: Uuid,
  origin: ProjectOriginEnum.nullable(),
  originLabel: z.string(),
  proposal: z
    .object({
      id: Uuid,
      reference: z.string(),
      title: z.string(),
      route: NeedsProposalRouteEnum,
      cycleId: Uuid,
      interventionYear: z.number().int(),
      projectTypeName: z.string(),
      status: NeedsProposalStatusEnum,
      statusLabel: z.string(),
      costedAmountNgn: z.number().nullable(),
      approvedAmountNgn: z.number().nullable(),
      fundedAmountNgn: z.number().nullable(),
      rank: z.number().int().nullable(),
      versionCount: z.number().int(),
      outOfCycleReason: OutOfCycleReasonEnum.nullable(),
      outOfCycleReasonLabel: z.string().nullable(),
      /** True when the viewer may open the proposal page (`needs:view` on its cycle). */
      canOpenProposal: z.boolean(),
    })
    .nullable(),
  documents: z.array(ProjectNeedsDocumentSchema),
  /** The current version's breakdown rows (unit IDs match the project's facility units). */
  breakdown: z.array(FacilityBreakdownRowSchema),
});
export type ProjectNeedsOriginDto = z.infer<typeof ProjectNeedsOriginDtoSchema>;

/** `POST /out-of-cycle/:proposalId/needs-assessment/preview`: the request's optional needs assessment (template v2, one file). */
export const OutOfCycleFileRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  fileBase64: z.string().min(1).max(Math.ceil((NEEDS_FILE_MAX_BYTES * 4) / 3) + 8),
});
export type OutOfCycleFileRequest = z.infer<typeof OutOfCycleFileRequestSchema>;

/** `…/needs-assessment/confirm`: the same file with the preview's sha256 (another file: 409 NEEDS_FILE_CHANGED). */
export const OutOfCycleFileConfirmRequestSchema = OutOfCycleFileRequestSchema.extend({ sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first') });
export type OutOfCycleFileConfirmRequest = z.infer<typeof OutOfCycleFileConfirmRequestSchema>;

/** `POST /out-of-cycle/:proposalId/withdraw`. */
export const WithdrawOutOfCycleRequestSchema = z.object({ reason: z.string().trim().min(5, 'Give the reason').max(1000) });
export type WithdrawOutOfCycleRequest = z.infer<typeof WithdrawOutOfCycleRequestSchema>;
