import { z } from 'zod';
import { FACILITY_CODE_REGEX } from './facility.schema';
import { FormLibraryDtoSchema } from './form.schema';
import { CostingStandardSchema, CostingStandardVersionDtoSchema } from './costingStandard.schema';
import { EssentialFacilityGroupSchema, NeedsFileIssueSchema } from './needsPipeline.schema';

/**
 * Needs pipeline wave 2 (N2): the Standards page (`/app/standards`, read by any web user, written with
 * `standards:manage`). Three parts: costing standards (versioned rate library, Excel round trip),
 * design standards (standard drawings and specifications, plus each programme's essential facility
 * groups) and monitoring standards (a read-only view of the form library).
 */

const Uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Costing standards: list, Excel template and upload
// ---------------------------------------------------------------------------

/** Version stamp of the costing standard workbook (Instructions sheet). */
export const COSTING_STANDARD_TEMPLATE_VERSION = 'INSITE-COSTING-v1';
export const COSTING_STANDARD_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** A row of the versions list (GET /api/v1/costing-standards). */
export const CostingStandardVersionSummaryDtoSchema = z.object({
  id: Uuid,
  version: z.number().int(),
  rateCount: z.number().int(),
  ceilingCount: z.number().int(),
  supervisionMonitoringPct: z.number(),
  contingencyPct: z.number(),
  note: z.string().nullable(),
  isLocked: z.boolean(),
  isLatest: z.boolean(),
  /** Cycles that use the version (they lock it). */
  cycleCount: z.number().int(),
  savedByName: z.string(),
  savedAt: z.string(),
});
export type CostingStandardVersionSummaryDto = z.infer<typeof CostingStandardVersionSummaryDtoSchema>;

const FileBase64 = z.string().min(1).max(Math.ceil((COSTING_STANDARD_FILE_MAX_BYTES * 4) / 3) + 8);

/** POST /api/v1/costing-standards/import/preview: nothing is written. */
export const CostingStandardImportPreviewRequestSchema = z.object({
  fileBase64: FileBase64,
  fileName: z.string().trim().max(200).optional(),
});
export type CostingStandardImportPreviewRequest = z.infer<typeof CostingStandardImportPreviewRequestSchema>;

/** POST /api/v1/costing-standards/import/confirm: the previewed file (same sha256, else 409 COSTING_STANDARD_FILE_CHANGED). */
export const CostingStandardImportConfirmRequestSchema = CostingStandardImportPreviewRequestSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file first'),
  /** What changed, for the versions list. */
  note: z.string().trim().max(500).nullable().default(null),
});
export type CostingStandardImportConfirmRequest = z.infer<typeof CostingStandardImportConfirmRequestSchema>;
export type CostingStandardImportConfirmRequestInput = z.input<typeof CostingStandardImportConfirmRequestSchema>;

/** Differences between a file (or a save) and the latest version, by item code. */
export const CostingStandardChangesSchema = z.object({
  added: z.array(z.string()),
  changed: z.array(z.object({ itemCode: z.string(), fromRateNgn: z.number(), toRateNgn: z.number() })),
  removed: z.array(z.string()),
  /** S&M %, contingency %, a zone factor or a ceiling changed. */
  settingsChanged: z.boolean(),
});
export type CostingStandardChanges = z.infer<typeof CostingStandardChangesSchema>;

export const CostingStandardImportPreviewDtoSchema = z.object({
  sha256: z.string(),
  /** Null while the file has blocking issues. */
  standard: CostingStandardSchema.nullable(),
  issues: z.array(NeedsFileIssueSchema),
  warnings: z.array(NeedsFileIssueSchema),
  changes: CostingStandardChangesSchema.nullable(),
  /** The version the save would write: latest + 1 when the latest is locked (or none exists), else the latest, edited in place. */
  targetVersion: z.number().int(),
  editsLatestInPlace: z.boolean(),
});
export type CostingStandardImportPreviewDto = z.infer<typeof CostingStandardImportPreviewDtoSchema>;

/** Result of a save (JSON save or upload confirm). */
export const CostingStandardSaveResultDtoSchema = z.object({
  version: CostingStandardVersionDtoSchema,
  createdNewVersion: z.boolean(),
});
export type CostingStandardSaveResultDto = z.infer<typeof CostingStandardSaveResultDtoSchema>;

// ---------------------------------------------------------------------------
// Design standards: documents (table `design_standard_documents`, wave 2 migration)
// ---------------------------------------------------------------------------

export const DesignStandardDocumentKindEnum = z.enum(['STANDARD_DRAWING', 'SPECIFICATION', 'GUIDELINE', 'OTHER']);
export type DesignStandardDocumentKind = z.infer<typeof DesignStandardDocumentKindEnum>;

export const DESIGN_STANDARD_DOCUMENT_KIND_LABELS: Record<DesignStandardDocumentKind, string> = {
  STANDARD_DRAWING: 'Standard drawing',
  SPECIFICATION: 'Specification',
  GUIDELINE: 'Guideline',
  OTHER: 'Other',
};

/** POST /api/v1/standards/design-documents (file uploaded first through …/design-documents/presign). */
export const RegisterDesignStandardDocumentRequestSchema = z.object({
  objectKey: z.string().trim().min(1).max(600),
  kind: DesignStandardDocumentKindEnum,
  title: z.string().trim().min(2).max(200),
  /** Facilities the document applies to; empty = general. */
  facilityCodes: z.array(z.string().trim().toUpperCase().regex(FACILITY_CODE_REGEX, 'Unknown facility code')).max(60).default([]),
  /** A new version of this document; the earlier one stays in the history. */
  supersedesId: Uuid.nullable().default(null),
});
export type RegisterDesignStandardDocumentRequest = z.infer<typeof RegisterDesignStandardDocumentRequestSchema>;
export type RegisterDesignStandardDocumentRequestInput = z.input<typeof RegisterDesignStandardDocumentRequestSchema>;

export const DesignStandardDocumentDtoSchema = z.object({
  id: Uuid,
  kind: DesignStandardDocumentKindEnum,
  title: z.string(),
  facilityCodes: z.array(z.string()),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  supersedesId: Uuid.nullable(),
  /** False once a newer version supersedes it. */
  isCurrent: z.boolean(),
  uploadedByName: z.string(),
  uploadedAt: z.string(),
});
export type DesignStandardDocumentDto = z.infer<typeof DesignStandardDocumentDtoSchema>;

/** A programme's essential facility groups (D-N.17), with facility names. */
export const ProgrammeEssentialGroupsSchema = z.object({
  projectTypeId: Uuid,
  projectTypeName: z.string(),
  groups: z.array(EssentialFacilityGroupSchema.extend({ facilityNames: z.array(z.string()) })),
});
export type ProgrammeEssentialGroups = z.infer<typeof ProgrammeEssentialGroupsSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/standards (any web user)
// ---------------------------------------------------------------------------

export const StandardsOverviewDtoSchema = z.object({
  costing: z.object({
    /** The latest version; null before the first save. */
    current: CostingStandardVersionDtoSchema.nullable(),
    versions: z.array(CostingStandardVersionSummaryDtoSchema),
  }),
  design: z.object({
    /** Current documents first; superseded ones are listed with `isCurrent: false`. */
    documents: z.array(DesignStandardDocumentDtoSchema),
    /** Programmes with the needs pipeline enabled. */
    essentialGroups: z.array(ProgrammeEssentialGroupsSchema),
  }),
  /** The form library, unarchived components only, read-only (same shape as GET /form-library). */
  monitoring: FormLibraryDtoSchema,
});
export type StandardsOverviewDto = z.infer<typeof StandardsOverviewDtoSchema>;
