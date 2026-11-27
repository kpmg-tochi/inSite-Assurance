import { z } from 'zod';

/**
 * Client demo updates D1 (wave 2): drafts started from a needs assessment carry which fields the file
 * filled (`setupState.needsAssessment`, the setup DTO's `needsAssessmentImport`). Needs pipeline wave 4
 * (M2) removed the D1 flow itself; the field keys and the import state stay for the drafts it made.
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

// Needs pipeline wave 4 (M2): the D1 preview / confirm contracts (`/projects/from-needs-assessment`) were
// removed with the flow; the pipeline upload (`/api/v1/needs/cycles/:cycleId/uploads`) replaces it.

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
