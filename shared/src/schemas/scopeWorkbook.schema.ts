import { z } from 'zod';
import { FacilityArchetypeEnum } from './facility.schema';
import { ProjectScopeDtoSchema } from './scope.schema';

/**
 * Redesign R2c: the needs-assessment workbook (spec section 7). The server generates an .xlsx with
 * dropdowns fed by the tenant's live lists; the importer finds columns by header name, checks the
 * version stamp and re-validates every row. Preview writes nothing; confirm re-parses the same bytes.
 */

/** Written on the Instructions sheet; a workbook with another stamp is refused. */
export const SCOPE_WORKBOOK_VERSION = 'INSITE-SCOPE-v1';

export const SCOPE_WORKBOOK_SHEETS = {
  instructions: 'Instructions',
  project: 'Project',
  units: 'Facility units',
  boq: 'BoQ',
  sprints: 'Sprints',
  /** Client demo updates C2/D1 (wave 2): one row per site; optional (older files have none). */
  sites: 'Sites',
  lists: 'Lists',
} as const;

/** Column headers per sheet (matched by name, in any order; case and punctuation ignored). */
export const SCOPE_WORKBOOK_COLUMNS = {
  units: ['Unit ID', 'Facility', 'Label', 'Quantity', 'Quantity unit', 'Start sprint', 'End sprint'],
  boq: ['Item no.', 'Unit ID', 'Description', 'Unit of measure', 'Quantity', 'Rate', 'Amount'],
  sprints: ['No.', 'Name', 'Start date', 'End date', 'Deliverables'],
  /** Wave 2: "Site" on a unit is the site number from the Sites sheet (optional column). */
  sites: ['Site no.', 'School name', 'School level', 'LGA', 'Address', 'Latitude', 'Longitude'],
} as const;

/** Wave 2: the optional column on the Facility units sheet naming the unit's site (site number). */
export const SCOPE_WORKBOOK_UNIT_SITE_COLUMN = 'Site no.';

/** Project sheet rows (label in column A, value in column B). */
export const SCOPE_WORKBOOK_PROJECT_FIELDS = [
  { key: 'name', label: 'Project name' },
  { key: 'school', label: 'School' },
  { key: 'region', label: 'Region' },
  { key: 'lga', label: 'LGA' },
  { key: 'siteAddress', label: 'Site address' },
  { key: 'latitude', label: 'Latitude' },
  { key: 'longitude', label: 'Longitude' },
  { key: 'deliveryModel', label: 'Delivery model' },
  { key: 'budget', label: 'Budget (NGN)' },
  // UBEC IRL register fields (files made before them still import: rows are matched by label).
  { key: 'interventionYear', label: 'Intervention year' },
  { key: 'fundingSource', label: 'Funding source' },
  // Client demo updates (wave 2, D1): needs assessment first.
  { key: 'state', label: 'State' },
  { key: 'lotTitle', label: 'Lot title' },
  { key: 'strategicJustification', label: 'Strategic justification' },
  { key: 'assumptions', label: 'Assumptions' },
] as const;
export type ScopeWorkbookProjectFieldKey = (typeof SCOPE_WORKBOOK_PROJECT_FIELDS)[number]['key'];

/** Largest workbook accepted (decoded). */
export const SCOPE_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024;

export const ScopeWorkbookIssueSchema = z.object({
  sheet: z.string(),
  /** Spreadsheet row number (1-based), null for sheet-level issues. */
  row: z.number().int().nullable(),
  column: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});
export type ScopeWorkbookIssue = z.infer<typeof ScopeWorkbookIssueSchema>;

export const ScopeWorkbookProjectChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  workbookValue: z.string(),
  currentValue: z.string().nullable(),
  /** FILL: the project field is empty and takes the workbook value. SAME: already equal. KEEP: differs, not overwritten. */
  action: z.enum(['FILL', 'SAME', 'KEEP']),
});
export type ScopeWorkbookProjectChange = z.infer<typeof ScopeWorkbookProjectChangeSchema>;

export const ScopeWorkbookPreviewDtoSchema = z.object({
  fileName: z.string().nullable(),
  sha256: z.string(),
  version: z.string().nullable(),
  sprints: z.array(
    z.object({ number: z.number().int(), name: z.string(), startDate: z.string(), endDate: z.string(), deliverables: z.string() })
  ),
  units: z.array(
    z.object({
      code: z.string(),
      facilityCode: z.string(),
      facilityName: z.string(),
      archetype: FacilityArchetypeEnum,
      label: z.string(),
      plannedQuantity: z.number().nullable(),
      quantityUnit: z.string().nullable(),
      startSprint: z.number().int().nullable(),
      endSprint: z.number().int().nullable(),
      lineCount: z.number().int(),
      amountNgn: z.number(),
    })
  ),
  lines: z.array(
    z.object({
      row: z.number().int(),
      wbsCode: z.string(),
      unitCode: z.string(),
      description: z.string(),
      unit: z.string(),
      totalQuantity: z.number(),
      rateNgn: z.number(),
      /** Recomputed: quantity × rate (the sheet's Amount is ignored). */
      amountNgn: z.number(),
    })
  ),
  /** Lines grouped by facility, then by the units' sprint range. */
  groups: z.array(
    z.object({
      facilityCode: z.string(),
      facilityName: z.string(),
      sprintLabel: z.string(),
      unitCodes: z.array(z.string()),
      lineCount: z.number().int(),
      amountNgn: z.number(),
    })
  ),
  projectChanges: z.array(ScopeWorkbookProjectChangeSchema),
  /** Row-level errors: confirm is refused while there are any. */
  issues: z.array(ScopeWorkbookIssueSchema),
  warnings: z.array(ScopeWorkbookIssueSchema),
  totals: z.object({
    sprintCount: z.number().int(),
    unitCount: z.number().int(),
    lineCount: z.number().int(),
    amountNgn: z.number(),
    budgetNgn: z.number().nullable(),
  }),
  /** What confirm replaces on the draft. */
  replaces: z.object({ sprintCount: z.number().int(), unitCount: z.number().int(), lineCount: z.number().int() }),
  canConfirm: z.boolean(),
});
export type ScopeWorkbookPreviewDto = z.infer<typeof ScopeWorkbookPreviewDtoSchema>;

const FileBase64 = z.string().min(1).max(15_000_000);

export const ScopeImportPreviewRequestSchema = z.object({
  fileBase64: FileBase64,
  fileName: z.string().max(200).optional(),
});
export type ScopeImportPreviewRequest = z.infer<typeof ScopeImportPreviewRequestSchema>;

export const ScopeImportConfirmRequestSchema = ScopeImportPreviewRequestSchema.extend({
  /** The preview's sha256: the file must be the one that was previewed. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first'),
});
export type ScopeImportConfirmRequest = z.infer<typeof ScopeImportConfirmRequestSchema>;

export const ScopeImportResultDtoSchema = z.object({
  scope: ProjectScopeDtoSchema,
  /** Project fields filled from the Project sheet. */
  filledProjectFields: z.array(z.string()),
});
export type ScopeImportResultDto = z.infer<typeof ScopeImportResultDtoSchema>;
