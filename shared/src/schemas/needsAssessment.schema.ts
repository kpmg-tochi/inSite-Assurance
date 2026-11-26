import { z } from 'zod';
import { SchoolLevelEnum } from './site.schema';
import { ScopeWorkbookIssueSchema, ScopeWorkbookPreviewDtoSchema } from './scopeWorkbook.schema';
import { LotChoiceSchema } from './lot.schema';
import { FundingSourceCodeEnum } from './projectRegister.schema';

/**
 * Client demo updates D1 (wave 2): start a project from the needs assessment. Template parsing only
 * (the AI path is not built; decision Z stands). `POST /api/v1/projects/from-needs-assessment/preview`
 * writes nothing; `/confirm` (same sha256 or 409 NEEDS_ASSESSMENT_FILE_CHANGED) creates the draft,
 * applies the type, assigns the lot/batch code, and imports sites, work phases, units and BoQ in one
 * transaction (audit PROJECT_DRAFT_CREATED + SCOPE_IMPORTED + SITES_SAVED). A file that is not the
 * template is 422 NOT_NEEDS_ASSESSMENT_TEMPLATE ("download the template, or start without one").
 */

/** Where a value came from: the template now; AI later (no contract change then). */
export const NeedsAssessmentValueSourceEnum = z.enum(['TEMPLATE', 'AI']);
export type NeedsAssessmentValueSource = z.infer<typeof NeedsAssessmentValueSourceEnum>;

/** The draft fields the template can fill (wizard keys; the web tags them). */
export const NeedsAssessmentFieldKeyEnum = z.enum([
  'name',
  'projectTypeId',
  'interventionYear',
  'lot',
  'stateCode',
  'lgaCode',
  'fundingSourceCode',
  'totalBudgetNgn',
  'description',
  'strategicJustification',
  'assumptions',
  'sites',
  'scope',
]);
export type NeedsAssessmentFieldKey = z.infer<typeof NeedsAssessmentFieldKeyEnum>;

export const NEEDS_ASSESSMENT_FIELD_LABELS: Record<NeedsAssessmentFieldKey, string> = {
  name: 'Project name',
  projectTypeId: 'Delivery model',
  interventionYear: 'Intervention year',
  lot: 'Lot',
  stateCode: 'State',
  lgaCode: 'LGA',
  fundingSourceCode: 'Funding source',
  totalBudgetNgn: 'Budget',
  description: 'Description',
  strategicJustification: 'Strategic justification',
  assumptions: 'Assumptions',
  sites: 'Sites',
  scope: 'BoQ & work phases',
};

export const NeedsAssessmentFieldValueSchema = z.object({
  key: NeedsAssessmentFieldKeyEnum,
  label: z.string(),
  /** The value as the draft will store it (id, code, number or text); null when missing or invalid. */
  value: z.union([z.string(), z.number()]).nullable(),
  /** What people read ("Direct Intervention", "Kano", "LOT 5 BATCH 7 (new lot: …)"). */
  display: z.string().nullable(),
  source: NeedsAssessmentValueSourceEnum.nullable(),
  /** Missing or doubtful: the wizard highlights it "Needs your input" and activation waits for it. */
  needsInput: z.boolean(),
  message: z.string().nullable(),
});
export type NeedsAssessmentFieldValue = z.infer<typeof NeedsAssessmentFieldValueSchema>;

export const NeedsAssessmentSiteRowSchema = z.object({
  siteNumber: z.number().int(),
  schoolName: z.string().nullable(),
  schoolLevel: SchoolLevelEnum.nullable(),
  lgaCode: z.string().nullable(),
  lgaName: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  unitCount: z.number().int(),
  amountNgn: z.number(),
});
export type NeedsAssessmentSiteRow = z.infer<typeof NeedsAssessmentSiteRowSchema>;

/** POST /api/v1/projects/from-needs-assessment/preview */
export const NeedsAssessmentPreviewRequestSchema = z.object({
  fileBase64: z.string().min(1).max(15_000_000),
  fileName: z.string().max(200).optional(),
});
export type NeedsAssessmentPreviewRequest = z.infer<typeof NeedsAssessmentPreviewRequestSchema>;

export const NeedsAssessmentPreviewDtoSchema = z.object({
  fileName: z.string().nullable(),
  sha256: z.string(),
  fields: z.array(NeedsAssessmentFieldValueSchema),
  sites: z.array(NeedsAssessmentSiteRowSchema),
  /** The scope part (work phases, units, lines, totals, row issues), as the in-project import shows it. */
  scope: ScopeWorkbookPreviewDtoSchema,
  /** "LOT 5 BATCH 7" when the year and lot are known. */
  codePreview: z.string().nullable(),
  /** Field keys the person must still give (before confirm: the confirm body; after: the wizard). */
  needsInput: z.array(NeedsAssessmentFieldKeyEnum),
  issues: z.array(ScopeWorkbookIssueSchema),
  warnings: z.array(ScopeWorkbookIssueSchema),
  canConfirm: z.boolean(),
});
export type NeedsAssessmentPreviewDto = z.infer<typeof NeedsAssessmentPreviewDtoSchema>;

/**
 * POST /api/v1/projects/from-needs-assessment/confirm. `overrides` fills what the template left out
 * (at least the delivery model when the tenant has types, the year and the lot); sent values win.
 */
export const NeedsAssessmentConfirmRequestSchema = NeedsAssessmentPreviewRequestSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first'),
  overrides: z
    .object({
      name: z.string().trim().min(3).max(200).optional(),
      projectTypeId: z.string().uuid().optional(),
      interventionYear: z.number().int().min(2000).max(2100).optional(),
      lotChoice: LotChoiceSchema.optional(),
      stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
      fundingSourceCode: FundingSourceCodeEnum.optional(),
      totalBudgetNgn: z.number().positive().optional(),
    })
    .default({}),
});
export type NeedsAssessmentConfirmRequest = z.infer<typeof NeedsAssessmentConfirmRequestSchema>;

export const NeedsAssessmentConfirmResultDtoSchema = z.object({
  projectId: z.string().uuid(),
  codePrefix: z.string(),
  /** Still to give in the wizard. */
  needsInput: z.array(NeedsAssessmentFieldKeyEnum),
});
export type NeedsAssessmentConfirmResultDto = z.infer<typeof NeedsAssessmentConfirmResultDtoSchema>;

/**
 * Kept in `Project.setupState.needsAssessment` by confirm, and returned on the setup DTO
 * (`needsAssessmentImport`) so the wizard tags fields "From needs assessment" / "Needs your input".
 * `needsInput` on the DTO is recomputed: keys still missing on the draft now.
 */
export const NeedsAssessmentImportStateSchema = z.object({
  importedAt: z.string(),
  fileName: z.string().nullable(),
  /** Keys filled from the file, with their source. */
  filled: z.array(z.object({ key: NeedsAssessmentFieldKeyEnum, source: NeedsAssessmentValueSourceEnum })),
  needsInput: z.array(NeedsAssessmentFieldKeyEnum),
});
export type NeedsAssessmentImportState = z.infer<typeof NeedsAssessmentImportStateSchema>;
