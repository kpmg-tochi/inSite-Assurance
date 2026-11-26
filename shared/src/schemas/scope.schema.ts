import { z } from 'zod';
import { FacilitySummarySchema } from './facility.schema';

/**
 * Redesign R2b: project scope (spec section 5).
 * - Sprint: a named period with deliverables. Numbers follow date order; overlaps are refused;
 *   status is derived (R4 adds LATE and VERIFIED with sprint verification).
 * - Facility unit: one physical instance of a catalogue facility on the project ("Ground floor
 *   male toilet"), with a start and end sprint; supply units carry a planned quantity.
 * - Scope line: a BoqItem row tagged with a unit. The amount is always rate × quantity, computed
 *   by the server.
 * Validation rules are pure and shared (utils/scope.ts) so the page and the workbook importer agree.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Units of measure (fixed for v1, decision D-R2.7)
// ---------------------------------------------------------------------------

export const UNITS_OF_MEASURE = [
  { code: 'm', label: 'Metre' },
  { code: 'm2', label: 'Square metre' },
  { code: 'm3', label: 'Cubic metre' },
  { code: 'nr', label: 'Number' },
  { code: 'item', label: 'Item' },
  { code: 'LS', label: 'Lump sum' },
  { code: 'kg', label: 'Kilogram' },
  { code: 't', label: 'Tonne' },
  { code: 'set', label: 'Set' },
  { code: 'lot', label: 'Lot' },
  { code: 'l', label: 'Litre' },
] as const;

export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number]['code'];
export const UnitOfMeasureEnum = z.enum(UNITS_OF_MEASURE.map((u) => u.code) as [UnitOfMeasure, ...UnitOfMeasure[]]);

/** Case-insensitive match onto the fixed list ("M2" → "m2", "ls" → "LS"); null when unknown. */
export function normalizeUnitOfMeasure(raw: string | null | undefined): UnitOfMeasure | null {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return null;
  return UNITS_OF_MEASURE.find((u) => u.code.toLowerCase() === t || u.label.toLowerCase() === t)?.code ?? null;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** Redesign R4e: ENDED within the verification period, LATE after it unverified, VERIFIED once verified. */
export const SprintStatusEnum = z.enum(['UPCOMING', 'ACTIVE', 'ENDED', 'LATE', 'VERIFIED']);
export type SprintStatus = z.infer<typeof SprintStatusEnum>;

export const ProjectSprintDtoSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  deliverables: z.string(),
  status: SprintStatusEnum,
  /** Redesign R4e: the M&E verification (D-R4.31). */
  verificationOutcome: z.enum(['MET', 'PARTLY_MET', 'NOT_MET']).nullable(),
  verifiedAt: z.string().nullable(),
  /** End date + the type's sprintVerificationDays. */
  verificationDueDate: z.string(),
  /** Facility units whose start–end range covers this sprint. */
  unitCount: z.number().int(),
  /** Units that start or end in this sprint (the sprint cannot be removed on a live project). */
  referencedByUnits: z.boolean(),
});
export type ProjectSprintDto = z.infer<typeof ProjectSprintDtoSchema>;

export const FacilityUnitDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  facility: FacilitySummarySchema,
  plannedQuantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
  startSprintId: z.string().uuid().nullable(),
  endSprintId: z.string().uuid().nullable(),
  startSprintNumber: z.number().int().nullable(),
  endSprintNumber: z.number().int().nullable(),
  /** Client demo updates C2 (wave 2): the site the unit is at; null on single-site and older projects. */
  siteId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int(),
  /**
   * Redesign R4d (D-R4.26): % complete observed by the latest accepted monitoring report, and that
   * visit's date (YYYY-MM-DD); both null until one is accepted. Its lines follow it.
   */
  progressPct: z.number().nullable(),
  progressAsOf: z.string().nullable(),
  lineCount: z.number().int(),
  amountNgn: z.number(),
  /** A line has captures, reports, defects or findings: the unit cannot be removed. */
  hasEvidence: z.boolean(),
});
export type FacilityUnitDto = z.infer<typeof FacilityUnitDtoSchema>;

export const ScopeLineDtoSchema = z.object({
  id: z.string().uuid(),
  facilityUnitId: z.string().uuid().nullable(),
  /** Item no. */
  wbsCode: z.string(),
  section: z.string(),
  description: z.string(),
  /** Unit of measure (legacy lines may hold a value outside UNITS_OF_MEASURE). */
  unit: z.string(),
  totalQuantity: z.number(),
  rateNgn: z.number(),
  /** Amount: rate × quantity. */
  budgetedCostNgn: z.number(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  cumulativeCertifiedPct: z.number(),
  hasEvidence: z.boolean(),
});
export type ScopeLineDto = z.infer<typeof ScopeLineDtoSchema>;

export const ScopeFacilityGroupSchema = z.object({
  facility: FacilitySummarySchema,
  unitIds: z.array(z.string().uuid()),
  amountNgn: z.number(),
});
export type ScopeFacilityGroup = z.infer<typeof ScopeFacilityGroupSchema>;

export const ProjectScopeDtoSchema = z.object({
  projectId: z.string().uuid(),
  projectStatus: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  /** Project zone calendar date the sprint statuses were derived for. */
  today: z.string(),
  budgetNgn: z.number().nullable(),
  /** The project's % complete as stored (`Project.certifiedProgressPct`: budget-weighted over the lines, or the imported %). */
  progressPct: z.number(),
  sprints: z.array(ProjectSprintDtoSchema),
  /** Units in facility order, then unit order. */
  units: z.array(FacilityUnitDtoSchema),
  facilityGroups: z.array(ScopeFacilityGroupSchema),
  lines: z.array(ScopeLineDtoSchema),
  totals: z.object({
    lineCount: z.number().int(),
    unitCount: z.number().int(),
    sprintCount: z.number().int(),
    amountNgn: z.number(),
    /** Lines with no facility unit (legacy projects). */
    unassignedLineCount: z.number().int(),
  }),
  /** Set when the scope total is above the project budget. */
  budgetWarning: z.string().nullable(),
  /** Workbook import is allowed (drafts only, D-R2.10). */
  importAllowed: z.boolean(),
});
export type ProjectScopeDto = z.infer<typeof ProjectScopeDtoSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const SprintInputSchema = z.object({
  /** Existing sprint; omit to add. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name the work phase').max(120),
  startDate: IsoDate,
  endDate: IsoDate,
  /** Omitted keeps an existing sprint's text (empty for a new one). */
  deliverables: z.string().trim().max(4000).optional(),
});
export type SprintInput = z.infer<typeof SprintInputSchema>;
export type SprintInputValue = z.input<typeof SprintInputSchema>;

/**
 * PUT /scope/sprints: the full sprint list. Numbers are assigned by date order. A sprint left out
 * is removed: on a draft its units lose that sprint; on a live project it is refused while a unit
 * starts or ends in it.
 */
export const SaveSprintsRequestSchema = z.object({
  sprints: z.array(SprintInputSchema).max(200),
});
export type SaveSprintsRequest = z.infer<typeof SaveSprintsRequestSchema>;

export const FACILITY_UNIT_CODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

const UnitCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FACILITY_UNIT_CODE_REGEX, 'Unit ID: up to 20 letters, digits, dots, dashes or underscores, e.g. U01');

export const CreateFacilityUnitRequestSchema = z.object({
  /** Omit to get the next free "Unnn". */
  code: UnitCodeSchema.optional(),
  facilityId: z.string().uuid(),
  label: z.string().trim().min(2, 'Enter a label, e.g. Ground floor male toilet').max(160),
  plannedQuantity: z.number().positive().nullable().optional(),
  quantityUnit: UnitOfMeasureEnum.nullable().optional(),
  startSprintId: z.string().uuid().nullable().optional(),
  endSprintId: z.string().uuid().nullable().optional(),
  /** Wave 2: a site of the project (422 SITE_NOT_FOUND otherwise); omitted keeps, null clears. */
  siteId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
export type CreateFacilityUnitRequest = z.infer<typeof CreateFacilityUnitRequestSchema>;

export const UpdateFacilityUnitRequestSchema = CreateFacilityUnitRequestSchema.partial();
export type UpdateFacilityUnitRequest = z.infer<typeof UpdateFacilityUnitRequestSchema>;

export const CreateScopeLineRequestSchema = z.object({
  facilityUnitId: z.string().uuid(),
  /** Item no., unique per project. */
  wbsCode: z.string().trim().min(1, 'Enter the item no.').max(32),
  description: z.string().trim().min(3, 'Enter at least 3 characters').max(600),
  unit: UnitOfMeasureEnum,
  totalQuantity: z.number().positive('Quantity must be above zero'),
  rateNgn: z.number().nonnegative('The rate cannot be negative'),
});
export type CreateScopeLineRequest = z.infer<typeof CreateScopeLineRequestSchema>;

/** Every field optional. `unit` also accepts the line's current (legacy) value unchanged. */
export const UpdateScopeLineRequestSchema = CreateScopeLineRequestSchema.extend({
  unit: z.string().trim().min(1).max(32),
}).partial();
export type UpdateScopeLineRequest = z.infer<typeof UpdateScopeLineRequestSchema>;
