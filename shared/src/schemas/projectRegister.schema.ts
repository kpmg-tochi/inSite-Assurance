import { z } from 'zod';
import { ProjectListFiltersSchema } from './deliveryModel.schema';
import { ScopeWorkbookIssueSchema } from './scopeWorkbook.schema';

/**
 * UBEC IRL (2026-11-25): the project register. Register fields on the project (intervention year,
 * funding source, the client's own project ID), register filters and export, and the bulk import of
 * existing projects (drafts for projects not started, live imported projects for projects already
 * under way). See CLAUDE.md "Project register (UBEC IRL)".
 */

// ---------------------------------------------------------------------------
// Register fields
// ---------------------------------------------------------------------------

export const INTERVENTION_YEAR_MIN = 2000;
export const INTERVENTION_YEAR_MAX = 2100;

/** The budget year the project is funded from. */
export const InterventionYearSchema = z
  .number({ invalid_type_error: 'Enter the year, e.g. 2025' })
  .int('Enter a whole year, e.g. 2025')
  .min(INTERVENTION_YEAR_MIN, `Enter a year from ${INTERVENTION_YEAR_MIN}`)
  .max(INTERVENTION_YEAR_MAX, `Enter a year up to ${INTERVENTION_YEAR_MAX}`);

/** Free text; the form offers FUNDING_SOURCE_SUGGESTIONS. */
export const FundingSourceSchema = z.string().trim().min(2, 'Enter at least 2 characters').max(120);

/** Suggestions for the funding source (free text: any other value is accepted). */
export const FUNDING_SOURCE_SUGGESTIONS = [
  'UBEC Intervention Fund',
  'Matching grant (SUBEB counterpart)',
  'Special intervention',
  'Development partner',
] as const;

/**
 * Client demo updates C4: the funding source as a fixed list (UBEC fund components and programmes).
 * Stored as `Project.fundingSourceCode`; `Project.fundingSource` keeps the text (the label, or
 * "label: detail" for a development partner or "Other"), so screens reading the text still work.
 */
export const FundingSourceCodeEnum = z.enum([
  'MATCHING_GRANT',
  'DIRECT_INTERVENTION',
  'GOOD_PERFORMANCE_FUND',
  'SPECIAL_NEEDS_FUND',
  'CONSTITUENCY_PROJECTS',
  'ZONAL_INTERVENTION',
  'NORTH_EAST_INTERVENTION',
  'DEVELOPMENT_PARTNER',
  'OTHER',
]);
export type FundingSourceCode = z.infer<typeof FundingSourceCodeEnum>;

export interface FundingSourceOption {
  code: FundingSourceCode;
  label: string;
  /** The form asks for a detail (partner name, or what "Other" is). */
  needsDetail: boolean;
}

export const FUNDING_SOURCES: readonly FundingSourceOption[] = [
  { code: 'MATCHING_GRANT', label: 'Matching Grant', needsDetail: false },
  { code: 'DIRECT_INTERVENTION', label: 'Direct Intervention (Educational Imbalance Fund)', needsDetail: false },
  { code: 'GOOD_PERFORMANCE_FUND', label: 'Good Performance Fund', needsDetail: false },
  { code: 'SPECIAL_NEEDS_FUND', label: 'Special Needs Education Fund', needsDetail: false },
  { code: 'CONSTITUENCY_PROJECTS', label: 'Constituency Projects', needsDetail: false },
  { code: 'ZONAL_INTERVENTION', label: 'Zonal Intervention Projects (ZIP)', needsDetail: false },
  { code: 'NORTH_EAST_INTERVENTION', label: 'North East Intervention', needsDetail: false },
  { code: 'DEVELOPMENT_PARTNER', label: 'Development partner', needsDetail: true },
  { code: 'OTHER', label: 'Other', needsDetail: true },
];

export function fundingSourceLabel(code: string | null | undefined): string | null {
  return FUNDING_SOURCES.find((f) => f.code === code)?.label ?? null;
}

/** The text stored in `Project.fundingSource` for a code (and its detail, when the code takes one). */
export function fundingSourceText(code: FundingSourceCode, detail?: string | null): string {
  const option = FUNDING_SOURCES.find((f) => f.code === code)!;
  const d = detail?.trim();
  return option.needsDetail && d ? `${option.label}: ${d}` : option.label;
}

/** Maps a label, code or older free text onto a code (register import); null when unknown. */
export function fundingSourceCodeFromText(text: string | null | undefined): FundingSourceCode | null {
  if (!text) return null;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = norm(text);
  if (!n) return null;
  for (const f of FUNDING_SOURCES) {
    if (norm(f.code) === n || norm(f.label) === n) return f.code;
  }
  for (const f of FUNDING_SOURCES) {
    if (f.needsDetail && n.startsWith(norm(f.label))) return f.code;
  }
  if (n.includes('matching')) return 'MATCHING_GRANT';
  if (n.includes('imbalance') || n.includes('direct intervention') || n.includes('intervention fund')) return 'DIRECT_INTERVENTION';
  if (n.includes('special needs')) return 'SPECIAL_NEEDS_FUND';
  if (n.includes('good performance')) return 'GOOD_PERFORMANCE_FUND';
  if (n.includes('constituency')) return 'CONSTITUENCY_PROJECTS';
  if (n.includes('zonal') || n === 'zip') return 'ZONAL_INTERVENTION';
  if (n.includes('north east')) return 'NORTH_EAST_INTERVENTION';
  if (n.includes('partner') || n.includes('besda') || n.includes('world bank')) return 'DEVELOPMENT_PARTNER';
  return null;
}

/** The client's own project ID (e.g. UBEC/DI/2025/KN/014); unique per workspace when set. */
export const ExternalReferenceSchema = z
  .string()
  .trim()
  .min(1, 'Enter the project ID')
  .max(60, 'Up to 60 characters')
  .regex(/^[^\r\n\t]+$/, 'One line only');

// ---------------------------------------------------------------------------
// Register filters (GET /projects, /projects/portfolio/overview, /projects/export.*)
// ---------------------------------------------------------------------------

/** The register's status buttons, applied server-side for the export (and the list when sent). */
export const ProjectRegisterStatusFilterEnum = z.enum(['ongoing', 'behind', 'completed', 'archived']);
export type ProjectRegisterStatusFilter = z.infer<typeof ProjectRegisterStatusFilterEnum>;

export const ProjectRegisterFiltersSchema = ProjectListFiltersSchema.extend({
  /** Free-text search: name, code, client project ID, state, LGA, region, contractor, type. */
  q: z.string().trim().max(120).optional(),
  status: ProjectRegisterStatusFilterEnum.optional(),
});
export type ProjectRegisterFilters = z.infer<typeof ProjectRegisterFiltersSchema>;

/** GET /projects/register/options: what the register filters can choose from (visible projects only). */
export const ProjectRegisterFilterOptionsDtoSchema = z.object({
  lgas: z.array(z.string()),
  contractors: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  interventionYears: z.array(z.number().int()),
  fundingSources: z.array(z.string()),
  owners: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type ProjectRegisterFilterOptionsDto = z.infer<typeof ProjectRegisterFilterOptionsDtoSchema>;

// ---------------------------------------------------------------------------
// Bulk import (GET /project-register/template, POST /project-register/import/preview|confirm)
// ---------------------------------------------------------------------------

/** Written on the Instructions sheet; a file with another stamp is refused. */
export const PROJECT_REGISTER_TEMPLATE_VERSION = 'INSITE-REGISTER-v1';

export const PROJECT_REGISTER_SHEETS = {
  instructions: 'Instructions',
  projects: 'Projects',
  lists: 'Lists',
} as const;

/**
 * Where a project stands when it is imported. NOT_STARTED creates a draft (set up and activated as
 * today); ONGOING and COMPLETED create live imported projects.
 */
export const ProjectRegisterImportStatusEnum = z.enum(['NOT_STARTED', 'ONGOING', 'COMPLETED']);
export type ProjectRegisterImportStatus = z.infer<typeof ProjectRegisterImportStatusEnum>;

export const PROJECT_REGISTER_IMPORT_STATUS_LABELS: Record<ProjectRegisterImportStatus, string> = {
  NOT_STARTED: 'Not started',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
};

/** Accepted spellings per status (compared lower-case, punctuation ignored). Blank = NOT_STARTED. */
export const PROJECT_REGISTER_IMPORT_STATUS_ALIASES: Record<ProjectRegisterImportStatus, string[]> = {
  NOT_STARTED: ['not started', 'notstarted', 'planned', 'draft', 'new', 'awarded'],
  ONGOING: ['ongoing', 'on going', 'in progress', 'under construction', 'active', 'started'],
  COMPLETED: ['completed', 'complete', 'done', 'finished'],
};

export type ProjectRegisterColumnKey =
  | 'code'
  | 'externalReference'
  | 'name'
  | 'school'
  | 'state'
  | 'lga'
  | 'siteAddress'
  | 'latitude'
  | 'longitude'
  | 'projectType'
  | 'owner'
  | 'contractor'
  | 'contractSum'
  | 'budget'
  | 'contractAwardDate'
  | 'contractSignedDate'
  | 'plannedStartDate'
  | 'plannedCompletionDate'
  | 'interventionYear'
  | 'fundingSource'
  | 'status'
  | 'percentComplete';

/**
 * The Projects sheet columns, in template order. Matched by header name (case and punctuation
 * ignored); `aliases` are other accepted headers. The client project ID header is the workspace's
 * term (e.g. "UBEC project ID"), so the importer also accepts that term.
 */
export const PROJECT_REGISTER_COLUMNS: ReadonlyArray<{
  key: ProjectRegisterColumnKey;
  header: string;
  aliases?: string[];
  required: boolean;
  note: string;
}> = [
  { key: 'code', header: 'Code', required: false, note: 'Optional, e.g. PRG-120. Blank or already used: the next free code in the series is given.' },
  { key: 'externalReference', header: 'Client project ID', aliases: ['External reference', 'Project ID'], required: false, note: "Your own project ID, unique in the workspace." },
  { key: 'name', header: 'Project name', required: true, note: 'At least 3 characters.' },
  { key: 'school', header: 'School', required: false, note: 'The school the project is for (primary beneficiary).' },
  { key: 'state', header: 'State', aliases: ['Region'], required: true, note: 'From the list.' },
  { key: 'lga', header: 'LGA', required: false, note: 'Local government area.' },
  { key: 'siteAddress', header: 'Site address', required: false, note: '' },
  { key: 'latitude', header: 'Latitude', required: false, note: 'Decimal degrees. Required for ongoing and completed projects.' },
  { key: 'longitude', header: 'Longitude', required: false, note: 'Decimal degrees. Required for ongoing and completed projects.' },
  { key: 'projectType', header: 'Project type', aliases: ['Delivery model'], required: false, note: 'From the list (required when the workspace has project types).' },
  { key: 'owner', header: 'Owning organisation', aliases: ['Owner'], required: false, note: 'From the list.' },
  { key: 'contractor', header: 'Contractor', required: false, note: 'Company name. A new name is added to the organisations. Required for ongoing and completed projects.' },
  { key: 'contractSum', header: 'Contract sum (NGN)', aliases: ['Contract sum'], required: false, note: '' },
  { key: 'budget', header: 'Budget (NGN)', aliases: ['Budget'], required: false, note: 'Blank: the contract sum is used. One of the two is required.' },
  { key: 'contractAwardDate', header: 'Contract award date', required: false, note: 'YYYY-MM-DD or DD/MM/YYYY.' },
  { key: 'contractSignedDate', header: 'Contract signed date', required: false, note: '' },
  { key: 'plannedStartDate', header: 'Planned start', required: false, note: '' },
  { key: 'plannedCompletionDate', header: 'Planned completion', required: false, note: '' },
  { key: 'interventionYear', header: 'Intervention year', required: false, note: `${INTERVENTION_YEAR_MIN}–${INTERVENTION_YEAR_MAX}.` },
  { key: 'fundingSource', header: 'Funding source', required: false, note: 'From the list or your own words.' },
  { key: 'status', header: 'Status', required: false, note: 'Not started (blank), Ongoing or Completed.' },
  { key: 'percentComplete', header: '% complete', aliases: ['Percent complete', 'Progress'], required: false, note: '0–100. Required for ongoing projects.' },
];

/** Largest file accepted (decoded). */
export const PROJECT_REGISTER_MAX_BYTES = 10 * 1024 * 1024;
/** Most rows in one import. */
export const PROJECT_REGISTER_MAX_ROWS = 500;

export const ProjectRegisterIssueSchema = ScopeWorkbookIssueSchema;
export type ProjectRegisterIssue = z.infer<typeof ProjectRegisterIssueSchema>;

export const ProjectRegisterImportModeEnum = z.enum(['DRAFT', 'LIVE']);
export type ProjectRegisterImportMode = z.infer<typeof ProjectRegisterImportModeEnum>;

export const ProjectRegisterPreviewRowSchema = z.object({
  /** Spreadsheet row number. */
  row: z.number().int(),
  /** The code the project gets (the file's, or the next free one); null when the row cannot be numbered. */
  code: z.string().nullable(),
  /** True when the code was given by the platform (blank or already used in the file). */
  codeAssigned: z.boolean(),
  externalReference: z.string().nullable(),
  name: z.string(),
  school: z.string().nullable(),
  regionName: z.string().nullable(),
  lga: z.string().nullable(),
  projectTypeName: z.string().nullable(),
  ownerName: z.string().nullable(),
  contractorName: z.string().nullable(),
  /** The contractor is not in the organisations yet and is added on confirm. */
  contractorIsNew: z.boolean(),
  contractSumNgn: z.number().nullable(),
  budgetNgn: z.number().nullable(),
  interventionYear: z.number().int().nullable(),
  fundingSource: z.string().nullable(),
  status: ProjectRegisterImportStatusEnum,
  mode: ProjectRegisterImportModeEnum,
  percentComplete: z.number().nullable(),
  issues: z.array(ProjectRegisterIssueSchema),
  warnings: z.array(ProjectRegisterIssueSchema),
});
export type ProjectRegisterPreviewRow = z.infer<typeof ProjectRegisterPreviewRowSchema>;

export const ProjectRegisterImportPreviewDtoSchema = z.object({
  fileName: z.string().nullable(),
  sha256: z.string(),
  version: z.string().nullable(),
  rows: z.array(ProjectRegisterPreviewRowSchema),
  /** Every error (sheet-level and row-level): confirm is refused while there are any. */
  issues: z.array(ProjectRegisterIssueSchema),
  warnings: z.array(ProjectRegisterIssueSchema),
  totals: z.object({
    rowCount: z.number().int(),
    draftCount: z.number().int(),
    liveCount: z.number().int(),
    newContractorCount: z.number().int(),
    /** Rows with at least one error. */
    rowsWithErrors: z.number().int(),
  }),
  canConfirm: z.boolean(),
});
export type ProjectRegisterImportPreviewDto = z.infer<typeof ProjectRegisterImportPreviewDtoSchema>;

const FileBase64 = z.string().min(1).max(15_000_000);

export const ProjectRegisterImportPreviewRequestSchema = z.object({
  fileBase64: FileBase64,
  fileName: z.string().max(200).optional(),
});
export type ProjectRegisterImportPreviewRequest = z.infer<typeof ProjectRegisterImportPreviewRequestSchema>;

export const ProjectRegisterImportConfirmRequestSchema = ProjectRegisterImportPreviewRequestSchema.extend({
  /** The preview's sha256: the file must be the one that was previewed. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first'),
});
export type ProjectRegisterImportConfirmRequest = z.infer<typeof ProjectRegisterImportConfirmRequestSchema>;

export const ProjectRegisterImportResultDtoSchema = z.object({
  created: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      mode: ProjectRegisterImportModeEnum,
    })
  ),
  draftCount: z.number().int(),
  liveCount: z.number().int(),
});
export type ProjectRegisterImportResultDto = z.infer<typeof ProjectRegisterImportResultDtoSchema>;
