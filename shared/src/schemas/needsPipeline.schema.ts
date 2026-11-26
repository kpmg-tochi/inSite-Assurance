import { z } from 'zod';
import { ApprovalOrganizationScopeEnum } from '../enums';
import { NigeriaLgaCodeSchema, NigeriaStateCodeSchema } from '../data/nigeriaAdminAreas';
import { FACILITY_CODE_REGEX } from './facility.schema';
import { FACILITY_UNIT_CODE_REGEX, UnitOfMeasureEnum } from './scope.schema';
import { SchoolLevelEnum } from './site.schema';

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

/** Wave 4 settles the transitions. */
export const NeedsSubmissionStatusEnum = z.enum(['DRAFT', 'IN_REVIEW', 'RETURNED', 'APPROVED']);
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

/** Site verification inside a validation record. Wave 3 settles the fields. */
export const SiteVerificationSchema = z.object({
  method: SiteVerificationMethodEnum,
  verifiedOn: IsoDate,
  officerName: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(4000).nullable().default(null),
  evidenceDocumentIds: z.array(Uuid).max(50).default([]),
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

/** Wave 4 settles: BEAP lot, batch, procurement method and timeline per proposal. */
export const NeedsSubmissionItemDtoSchema = z.object({
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  amountNgn: z.number().nullable(),
  included: z.boolean(),
  /** Why it was excluded (required then). */
  exclusionReason: z.string().nullable(),
  lotTitle: z.string().nullable(),
  batchNumber: z.number().int().nullable(),
  procurementMethod: z.string().nullable(),
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

/** A list put to an approval chain: the portfolio, a BEAP, or one out-of-cycle request. Wave 4 settles. */
export const NeedsSubmissionDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  kind: NeedsSubmissionKindEnum,
  chainType: NeedsChainTypeEnum,
  status: NeedsSubmissionStatusEnum,
  submittedByUserId: Uuid.nullable(),
  submittedByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  memoDocumentId: Uuid.nullable(),
  /** BEAP only (A5). */
  counterpartDeclaredNgn: z.number().nullable(),
  counterpartEvidenceDocumentId: Uuid.nullable(),
  items: z.array(NeedsSubmissionItemDtoSchema),
  totalNgn: z.number(),
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
