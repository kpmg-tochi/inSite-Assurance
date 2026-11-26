import { z } from 'zod';

/**
 * Client demo updates E3 (wave 3, read-only): annual approved project lists. Per intervention year,
 * the Approved Projects & Implementation Schedule (Direct Intervention, approved by the ES) and the
 * Approved BEAP per state (Matching Grants, approved by UBEC). Each project links to its row; the
 * first red-flag rule compares the project budget with the approved estimate (tolerance
 * `Tenant.budgetMismatchTolerancePct`, default ±10%). Lists are seeded in wave 3; upload is wave 4.
 */

export const ApprovedListKindEnum = z.enum(['DI_SCHEDULE', 'MG_BEAP']);
export type ApprovedListKind = z.infer<typeof ApprovedListKindEnum>;

export const APPROVED_LIST_KIND_LABELS: Record<ApprovedListKind, string> = {
  DI_SCHEDULE: 'Approved Projects & Implementation Schedule (Direct Intervention)',
  MG_BEAP: 'Approved BEAP (Matching Grants)',
};

export const DEFAULT_BUDGET_MISMATCH_TOLERANCE_PCT = 10;

export const BudgetMismatchDtoSchema = z.object({
  projectBudgetNgn: z.number().nullable(),
  approvedEstimateNgn: z.number(),
  /** (budget − estimate) / estimate × 100, one decimal; null without a budget. */
  differencePct: z.number().nullable(),
  tolerancePct: z.number(),
  /** True when the difference is outside ± tolerance: a red flag. */
  flagged: z.boolean(),
  /** "Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)". */
  summary: z.string(),
});
export type BudgetMismatchDto = z.infer<typeof BudgetMismatchDtoSchema>;

export const ApprovedListLinkedProjectSchema = z.object({
  id: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  interventionYear: z.number().int().nullable(),
  totalBudgetNgn: z.number().nullable(),
  mismatch: BudgetMismatchDtoSchema.nullable(),
});
export type ApprovedListLinkedProject = z.infer<typeof ApprovedListLinkedProjectSchema>;

export const ApprovedListRowDtoSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  /** The row's reference on the approved list (e.g. "KN/2026/014"). */
  rowRef: z.string(),
  projectTitle: z.string(),
  /** Schools named on the row (free text, one line each). */
  schoolNames: z.array(z.string()),
  stateCode: z.string(),
  lgaCodes: z.array(z.string()),
  facilityScope: z.string().nullable(),
  costEstimateNgn: z.number(),
  lotTitle: z.string().nullable(),
  linkedProjects: z.array(ApprovedListLinkedProjectSchema),
  /** NOT_LINKED, LINKED (within tolerance), MISMATCH (a linked project is outside it), MULTIPLE (linked to two projects). */
  matchStatus: z.enum(['NOT_LINKED', 'LINKED', 'MISMATCH', 'MULTIPLE']),
});
export type ApprovedListRowDto = z.infer<typeof ApprovedListRowDtoSchema>;

export const ApprovedListSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  interventionYear: z.number().int(),
  kind: ApprovedListKindEnum,
  /** MG BEAPs are per state; null for the DI schedule. */
  stateCode: z.string().nullable(),
  title: z.string(),
  approvedBy: z.string(),
  approvedOn: z.string(),
  rowCount: z.number().int(),
  totalEstimateNgn: z.number(),
  linkedRowCount: z.number().int(),
  mismatchCount: z.number().int(),
  /** Wave 4: the last upload (null for seeded lists). */
  sourceFileName: z.string().nullable().optional(),
  importedAt: z.string().nullable().optional(),
  importedByName: z.string().nullable().optional(),
});
export type ApprovedListSummaryDto = z.infer<typeof ApprovedListSummaryDtoSchema>;

export const ApprovedListDetailDtoSchema = ApprovedListSummaryDtoSchema.extend({
  rows: z.array(ApprovedListRowDtoSchema),
});
export type ApprovedListDetailDto = z.infer<typeof ApprovedListDetailDtoSchema>;

/** GET /api/v1/approved-lists?interventionYear= */
export const ApprovedListsQuerySchema = z.object({
  interventionYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type ApprovedListsQuery = z.infer<typeof ApprovedListsQuerySchema>;

export const ApprovedListsOverviewDtoSchema = z.object({
  years: z.array(z.number().int()),
  interventionYear: z.number().int().nullable(),
  tolerancePct: z.number(),
  lists: z.array(ApprovedListSummaryDtoSchema),
  /** Linked projects outside the tolerance (the red flags), across the year's lists. */
  mismatches: z.array(ApprovedListLinkedProjectSchema.extend({ rowId: z.string().uuid(), rowRef: z.string(), listTitle: z.string() })),
});
export type ApprovedListsOverviewDto = z.infer<typeof ApprovedListsOverviewDtoSchema>;

/** PUT /projects/:id/approved-list-row (setup editors). null unlinks. */
export const LinkApprovedListRowRequestSchema = z.object({
  rowId: z.string().uuid().nullable(),
});
export type LinkApprovedListRowRequest = z.infer<typeof LinkApprovedListRowRequestSchema>;

/** The project's link, on the overview and the basics section. */
export const ProjectApprovedListLinkDtoSchema = z.object({
  rowId: z.string().uuid(),
  rowRef: z.string(),
  listId: z.string().uuid(),
  listTitle: z.string(),
  kind: ApprovedListKindEnum,
  projectTitle: z.string(),
  costEstimateNgn: z.number(),
  mismatch: BudgetMismatchDtoSchema,
});
export type ProjectApprovedListLinkDto = z.infer<typeof ProjectApprovedListLinkDtoSchema>;

/** "₦84.0m" */
function compactNaira(v: number): string {
  if (Math.abs(v) >= 1e9) return `₦${(v / 1e9).toFixed(1)}bn`;
  if (Math.abs(v) >= 1e6) return `₦${(v / 1e6).toFixed(1)}m`;
  return `₦${Math.round(v).toLocaleString('en-NG')}`;
}

/** The budget-mismatch rule (pure). */
export function budgetMismatch(
  projectBudgetNgn: number | null,
  approvedEstimateNgn: number,
  tolerancePct: number = DEFAULT_BUDGET_MISMATCH_TOLERANCE_PCT,
  kind: ApprovedListKind = 'DI_SCHEDULE'
): BudgetMismatchDto {
  const listWord = kind === 'MG_BEAP' ? 'approved BEAP' : 'approved schedule';
  if (projectBudgetNgn === null || approvedEstimateNgn <= 0) {
    return {
      projectBudgetNgn,
      approvedEstimateNgn,
      differencePct: null,
      tolerancePct,
      flagged: false,
      summary: `No budget to compare with the ${listWord} (${compactNaira(approvedEstimateNgn)})`,
    };
  }
  // Round once from the raw value (rounding the one-decimal figure again would turn 17.48 into 18).
  const raw = ((projectBudgetNgn - approvedEstimateNgn) / approvedEstimateNgn) * 100;
  const differencePct = Math.round(raw * 10) / 10;
  const flagged = Math.abs(raw) > tolerancePct;
  const sign = raw > 0 ? '+' : '';
  return {
    projectBudgetNgn,
    approvedEstimateNgn,
    differencePct,
    tolerancePct,
    flagged,
    summary: `Budget ${compactNaira(projectBudgetNgn)} vs ${listWord} ${compactNaira(approvedEstimateNgn)} (${sign}${Math.round(raw)}%)`,
  };
}

// ---------------------------------------------------------------------------
// Client demo updates E3 (wave 4): upload from the template
// ---------------------------------------------------------------------------
//
// Same pattern as the project register and needs assessment imports: `GET /api/v1/approved-lists/template`
// (.xlsx), `POST /import/preview` (nothing written), `POST /import/confirm` (same sha256 or 409
// APPROVED_LIST_FILE_CHANGED; any error refuses the whole file, 422 APPROVED_LIST_IMPORT_INVALID; one
// transaction under a per-tenant advisory lock; audited APPROVED_LIST_IMPORTED on the tenant ledger).
// Permission `approved_lists:manage`.
//
// A file holds ONE list: the List sheet (intervention year, kind, State for a BEAP, title, approved by,
// approved on) and the Rows sheet. Uploading replaces the tenant's list with the same year, kind and
// State (DI: no State): rows are matched by row reference (kept rows keep their id, so project links
// survive), new rows are added and rows missing from the file are removed (their projects unlinked,
// listed in the preview). The optional "Project ID" column links a project (its code, as shown or
// stored, or its client project ID); match status and the budget-mismatch flag are re-evaluated for
// every row and shown in the preview and the result. Deterministic rules only.

export const APPROVED_LIST_TEMPLATE_VERSION = 'INSITE-APPROVED-LIST-v1';
export const APPROVED_LIST_SHEETS = { instructions: 'Instructions', list: 'List', rows: 'Rows', lists: 'Lists' } as const;
export const APPROVED_LIST_MAX_BYTES = 10 * 1024 * 1024;
export const APPROVED_LIST_MAX_ROWS = 2000;

/** Labels of the List sheet (label in column A, value in column B; read with `labelledValue`). */
export const APPROVED_LIST_HEADER_LABELS = {
  interventionYear: 'Intervention year',
  kind: 'List',
  state: 'State',
  title: 'Title',
  approvedBy: 'Approved by',
  approvedOn: 'Approved on',
} as const;

/** What the List sheet's "List" dropdown offers, per kind. */
export const APPROVED_LIST_KIND_TEMPLATE_LABELS: Record<ApprovedListKind, string> = {
  DI_SCHEDULE: 'Direct Intervention: Approved Projects & Implementation Schedule',
  MG_BEAP: 'Matching Grants: Approved BEAP',
};

export type ApprovedListColumnKey =
  | 'rowRef'
  | 'projectTitle'
  | 'schools'
  | 'state'
  | 'lgas'
  | 'facilityScope'
  | 'costEstimate'
  | 'lotTitle'
  | 'projectRef';

export interface ApprovedListColumn {
  key: ApprovedListColumnKey;
  header: string;
  required: boolean;
  note: string;
}

export const APPROVED_LIST_COLUMNS: readonly ApprovedListColumn[] = [
  { key: 'rowRef', header: 'Row ref', required: true, note: 'The reference on the approved list (e.g. KN/2026/014). Unique in the file; a later upload updates the row with the same reference.' },
  { key: 'projectTitle', header: 'Project title', required: true, note: 'As approved.' },
  { key: 'schools', header: 'School(s)', required: false, note: 'One or more schools, separated by ";" or new lines.' },
  { key: 'state', header: 'State', required: true, note: "From the list. On a BEAP, every row is in the BEAP's State." },
  { key: 'lgas', header: 'LGA(s)', required: false, note: 'One or more LGAs of the State, separated by ";".' },
  { key: 'facilityScope', header: 'Facility scope', required: false, note: 'Free text, e.g. "2 classrooms, 1 toilet block, 60 pupils\' desks".' },
  { key: 'costEstimate', header: 'Cost estimate (₦)', required: true, note: 'The approved estimate in naira, a number above 0. Project budgets are compared with it.' },
  { key: 'lotTitle', header: 'Lot title', required: false, note: 'The lot the project is procured in, if known.' },
  { key: 'projectRef', header: 'Project ID', required: false, note: 'Optional: the project this row is for, by its code (e.g. LOT 5 BATCH 7) or its client project ID. Blank keeps the current link.' },
];

const ApprovedListIssueSchema = z.object({
  sheet: z.string(),
  row: z.number().int().nullable(),
  column: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});
export type ApprovedListIssue = z.infer<typeof ApprovedListIssueSchema>;

/** NEW (not on the current list), UPDATED (same ref, a value changed), UNCHANGED. */
export const ApprovedListImportRowActionEnum = z.enum(['NEW', 'UPDATED', 'UNCHANGED']);
export type ApprovedListImportRowAction = z.infer<typeof ApprovedListImportRowActionEnum>;

/** KEPT (current link kept), FROM_FILE (the Project ID column links it), NONE. */
export const ApprovedListLinkSourceEnum = z.enum(['KEPT', 'FROM_FILE', 'NONE']);
export type ApprovedListLinkSource = z.infer<typeof ApprovedListLinkSourceEnum>;

export const ApprovedListImportPreviewRowSchema = z.object({
  row: z.number().int(),
  rowRef: z.string().nullable(),
  projectTitle: z.string().nullable(),
  schoolNames: z.array(z.string()),
  stateCode: z.string().nullable(),
  lgaCodes: z.array(z.string()),
  facilityScope: z.string().nullable(),
  costEstimateNgn: z.number().nullable(),
  lotTitle: z.string().nullable(),
  action: ApprovedListImportRowActionEnum,
  linkSource: ApprovedListLinkSourceEnum,
  /** The projects linked once imported (visible ones named; see `ApprovedListRowDto`). */
  linkedProjects: z.array(ApprovedListLinkedProjectSchema),
  matchStatus: ApprovedListRowDtoSchema.shape.matchStatus,
  issues: z.array(ApprovedListIssueSchema),
  warnings: z.array(ApprovedListIssueSchema),
});
export type ApprovedListImportPreviewRow = z.infer<typeof ApprovedListImportPreviewRowSchema>;

export const ApprovedListImportPreviewDtoSchema = z.object({
  fileName: z.string().nullable(),
  sha256: z.string(),
  version: z.string().nullable(),
  list: z.object({
    interventionYear: z.number().int().nullable(),
    kind: ApprovedListKindEnum.nullable(),
    stateCode: z.string().nullable(),
    title: z.string().nullable(),
    approvedBy: z.string().nullable(),
    approvedOn: z.string().nullable(),
  }),
  /** The list this upload replaces (same year, kind and State), or null for a new list. */
  replaces: z
    .object({ listId: z.string().uuid(), title: z.string(), rowCount: z.number().int(), importedAt: z.string().nullable() })
    .nullable(),
  rows: z.array(ApprovedListImportPreviewRowSchema),
  /** Rows of the current list that are not in the file: removed on confirm, their projects unlinked. */
  removedRows: z.array(
    z.object({ rowRef: z.string(), projectTitle: z.string(), linkedProjects: z.array(ApprovedListLinkedProjectSchema) })
  ),
  /** Every error (sheet-level and row-level): confirm is refused while there are any. */
  issues: z.array(ApprovedListIssueSchema),
  warnings: z.array(ApprovedListIssueSchema),
  totals: z.object({
    rowCount: z.number().int(),
    newCount: z.number().int(),
    updatedCount: z.number().int(),
    unchangedCount: z.number().int(),
    removedCount: z.number().int(),
    linkedCount: z.number().int(),
    mismatchCount: z.number().int(),
    totalEstimateNgn: z.number(),
    rowsWithErrors: z.number().int(),
  }),
  canConfirm: z.boolean(),
});
export type ApprovedListImportPreviewDto = z.infer<typeof ApprovedListImportPreviewDtoSchema>;

const ApprovedListFileBase64 = z.string().min(1).max(15_000_000);

export const ApprovedListImportPreviewRequestSchema = z.object({
  fileBase64: ApprovedListFileBase64,
  fileName: z.string().max(200).optional(),
});
export type ApprovedListImportPreviewRequest = z.infer<typeof ApprovedListImportPreviewRequestSchema>;

export const ApprovedListImportConfirmRequestSchema = ApprovedListImportPreviewRequestSchema.extend({
  /** The preview's sha256: the file must be the one that was previewed. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first'),
});
export type ApprovedListImportConfirmRequest = z.infer<typeof ApprovedListImportConfirmRequestSchema>;

/** The list as saved, with every row's match re-run (the detail DTO), plus what changed. */
export const ApprovedListImportResultDtoSchema = z.object({
  list: ApprovedListDetailDtoSchema,
  created: z.boolean(),
  newCount: z.number().int(),
  updatedCount: z.number().int(),
  removedCount: z.number().int(),
  /** Projects whose link changed (linked from the file, or unlinked with a removed row). */
  relinkedProjectCount: z.number().int(),
});
export type ApprovedListImportResultDto = z.infer<typeof ApprovedListImportResultDtoSchema>;

// ---------------------------------------------------------------------------
// Design refinement (2026-11-26): every row of a year in one request
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/approved-lists/rows?interventionYear= (`approved_lists:view`): the year's overview (same
 * fields and rules as GET /approved-lists) plus every row of the year's lists, in list order then row
 * order, so the Needs assessment page filters one table by project type, State, list and match status.
 */
export const ApprovedListYearRowsDtoSchema = ApprovedListsOverviewDtoSchema.extend({
  rows: z.array(ApprovedListRowDtoSchema),
});
export type ApprovedListYearRowsDto = z.infer<typeof ApprovedListYearRowsDtoSchema>;
