import {
  ExistingConditionEnum,
  FacilityCriticalityEnum,
  InterventionActionEnum,
  type EssentialFacilityGroup,
  type FacilityBreakdownRow,
} from '../schemas/needsPipeline.schema';
import { FACILITY_UNIT_CODE_REGEX, normalizeUnitOfMeasure } from '../schemas/scope.schema';

/**
 * Needs pipeline N1: the intervention and facilities breakdown (plan 6.3, D-N.7, D-N.17), pure.
 * One row is one facility at one site. The template parser (wave 2) reads the sheet into loose rows
 * and calls `validateBreakdownRows`; rows without issues parse with `FacilityBreakdownRowSchema`.
 */

/** Column headers of the Facilities breakdown sheet (template v2), also used in row issues. */
export const FACILITY_BREAKDOWN_COLUMNS = {
  unitId: 'Unit ID',
  siteNumber: 'Site no.',
  facilityCode: 'Facility',
  interventionAction: 'Intervention action',
  existingQuantity: 'Existing quantity',
  existingCondition: 'Existing condition',
  requiredQuantity: 'Required quantity',
  proposedQuantity: 'Proposed quantity',
  unitOfMeasure: 'Unit of measure',
  preliminaryCostNgn: 'Preliminary cost (₦)',
  technicalJustification: 'Technical justification',
  criticality: 'Priority',
  supportingEvidence: 'Supporting evidence',
} as const;
export type FacilityBreakdownColumnKey = keyof typeof FACILITY_BREAKDOWN_COLUMNS;

/** A breakdown row as read from the sheet: any field may be missing or of the wrong kind. */
export interface BreakdownRowDraft {
  /** Sheet row number, for the issue list. */
  row: number;
  unitId?: string | null;
  siteNumber?: number | null;
  facilityCode?: string | null;
  interventionAction?: string | null;
  existingQuantity?: number | null;
  existingCondition?: string | null;
  requiredQuantity?: number | null;
  proposedQuantity?: number | null;
  unitOfMeasure?: string | null;
  preliminaryCostNgn?: number | null;
  technicalJustification?: string | null;
  criticality?: string | null;
  supportingEvidence?: string | null;
}

export interface BreakdownRowIssue {
  row: number;
  /** The column header. */
  column: string;
  reason: string;
}

export interface BreakdownFacilityRef {
  code: string;
  name?: string;
  isRetired?: boolean;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Every problem in the breakdown rows, with row, column and reason. Rules (plan 6.3):
 * - the facility is in the tenant catalogue and not retired;
 * - the site is on the Sites sheet;
 * - one row per facility, intervention action and site (wave 1 decision: the action is part of the
 *   key, so a school can renovate one classroom block and build another);
 * - quantities are not negative; a proposed quantity of 0 only records an existing facility
 *   (existing quantity above 0); "Absent" means an existing quantity of 0;
 * - the unit ID is set and unique in the file; the justification is given.
 */
export function validateBreakdownRows(
  rows: readonly BreakdownRowDraft[],
  sites: ReadonlyArray<{ siteNumber: number }>,
  facilities: readonly BreakdownFacilityRef[]
): BreakdownRowIssue[] {
  const issues: BreakdownRowIssue[] = [];
  const add = (row: number, key: FacilityBreakdownColumnKey, reason: string) => issues.push({ row, column: FACILITY_BREAKDOWN_COLUMNS[key], reason });
  const facilityByCode = new Map(facilities.map((f) => [f.code.toUpperCase(), f]));
  const siteNumbers = new Set(sites.map((s) => s.siteNumber));
  const unitIds = new Map<string, number>();
  const combos = new Map<string, number>();

  for (const r of rows) {
    const unitId = text(r.unitId).toUpperCase();
    if (!unitId) add(r.row, 'unitId', 'Enter the unit ID.');
    else if (!FACILITY_UNIT_CODE_REGEX.test(unitId)) add(r.row, 'unitId', 'Use up to 20 letters, digits, dots, dashes or underscores, e.g. U01.');
    else if (unitIds.has(unitId)) add(r.row, 'unitId', `"${unitId}" is already used in row ${unitIds.get(unitId)}.`);
    else unitIds.set(unitId, r.row);

    const facilityCode = text(r.facilityCode).toUpperCase();
    const facility = facilityByCode.get(facilityCode);
    if (!facilityCode) add(r.row, 'facilityCode', 'Choose the facility.');
    else if (!facility) add(r.row, 'facilityCode', `"${text(r.facilityCode)}" is not in the facility catalogue.`);
    else if (facility.isRetired) add(r.row, 'facilityCode', `${facility.name ?? facility.code} is retired and cannot be proposed.`);

    if (!isNumber(r.siteNumber)) add(r.row, 'siteNumber', 'Enter the site number from the Sites sheet.');
    else if (!siteNumbers.has(r.siteNumber)) add(r.row, 'siteNumber', `Site ${r.siteNumber} is not on the Sites sheet.`);

    const action = InterventionActionEnum.safeParse(r.interventionAction);
    if (!action.success) add(r.row, 'interventionAction', 'Choose the intervention action from the list.');

    if (facility && isNumber(r.siteNumber) && action.success) {
      const key = `${facilityCode}|${action.data}|${r.siteNumber}`;
      if (combos.has(key)) add(r.row, 'facilityCode', `Row ${combos.get(key)} already has this facility and intervention action at site ${r.siteNumber}.`);
      else combos.set(key, r.row);
    }

    const condition = ExistingConditionEnum.safeParse(r.existingCondition);
    if (!condition.success) add(r.row, 'existingCondition', 'Choose the existing condition from the list.');
    if (!isNumber(r.existingQuantity) || r.existingQuantity < 0) add(r.row, 'existingQuantity', 'Enter the existing quantity (0 or more).');
    else if (condition.success && condition.data === 'ABSENT' && r.existingQuantity !== 0) {
      add(r.row, 'existingQuantity', 'An absent facility has an existing quantity of 0.');
    }
    if (!isNumber(r.requiredQuantity) || r.requiredQuantity < 0) add(r.row, 'requiredQuantity', 'Enter the required quantity (0 or more).');
    if (!isNumber(r.proposedQuantity) || r.proposedQuantity < 0) add(r.row, 'proposedQuantity', 'Enter the proposed quantity.');
    else if (r.proposedQuantity === 0 && !(isNumber(r.existingQuantity) && r.existingQuantity > 0)) {
      add(r.row, 'proposedQuantity', 'Enter a proposed quantity above zero (0 is only for a facility that exists and needs no work).');
    }

    if (!normalizeUnitOfMeasure(r.unitOfMeasure)) add(r.row, 'unitOfMeasure', 'Choose the unit of measure from the list.');
    if (r.preliminaryCostNgn != null && (!isNumber(r.preliminaryCostNgn) || r.preliminaryCostNgn < 0)) {
      add(r.row, 'preliminaryCostNgn', 'The preliminary cost cannot be negative.');
    }
    if (!text(r.technicalJustification)) add(r.row, 'technicalJustification', 'Enter the technical justification.');
    if (!FacilityCriticalityEnum.safeParse(r.criticality).success) add(r.row, 'criticality', 'Choose the priority from the list.');
  }
  return issues;
}

type RowForGaps = Pick<FacilityBreakdownRow, 'siteNumber' | 'facilityCode' | 'existingQuantity' | 'existingCondition' | 'proposedQuantity'>;

export interface EssentialFacilityGap {
  siteNumber: number;
  schoolName: string | null;
  groupLabel: string;
  facilityCodes: string[];
}

/**
 * D-N.17: for each site and each essential group (toilets, water, solar), the breakdown must show a
 * proposed row or an existing row in condition Functional. Each miss is a gap: a warning that needs
 * a written justification before validation can pass.
 */
export function essentialFacilityGaps(
  rows: readonly RowForGaps[],
  sites: ReadonlyArray<{ siteNumber: number; schoolName?: string | null }>,
  groups: readonly EssentialFacilityGroup[]
): EssentialFacilityGap[] {
  const gaps: EssentialFacilityGap[] = [];
  for (const site of sites) {
    const siteRows = rows.filter((r) => r.siteNumber === site.siteNumber);
    for (const group of groups) {
      const codes = new Set(group.facilityCodes.map((c) => c.toUpperCase()));
      const covered = siteRows.some(
        (r) =>
          codes.has(r.facilityCode.toUpperCase()) &&
          (r.proposedQuantity > 0 || (r.existingCondition === 'FUNCTIONAL' && r.existingQuantity > 0))
      );
      if (!covered) gaps.push({ siteNumber: site.siteNumber, schoolName: site.schoolName ?? null, groupLabel: group.label, facilityCodes: [...group.facilityCodes] });
    }
  }
  return gaps;
}

type RowForTotals = Pick<
  FacilityBreakdownRow,
  'siteNumber' | 'facilityCode' | 'existingQuantity' | 'requiredQuantity' | 'proposedQuantity' | 'preliminaryCostNgn'
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What is still needed after this project: required − proposed, never below 0. */
export function breakdownShortfall(row: Pick<FacilityBreakdownRow, 'requiredQuantity' | 'proposedQuantity'>): number {
  return Math.max(0, round2(row.requiredQuantity - row.proposedQuantity));
}

export interface BreakdownTotals {
  rowCount: number;
  /** Rows that propose work (proposed quantity above 0): the future facility units. */
  proposedRowCount: number;
  siteCount: number;
  facilityCount: number;
  rowsWithShortfall: number;
  /** Sum of the rows' preliminary costs; null when no row has one. */
  preliminaryCostNgn: number | null;
}

export function breakdownTotals(rows: readonly RowForTotals[]): BreakdownTotals {
  const costs = rows.map((r) => r.preliminaryCostNgn).filter((v): v is number => v !== null && v !== undefined);
  return {
    rowCount: rows.length,
    proposedRowCount: rows.filter((r) => r.proposedQuantity > 0).length,
    siteCount: new Set(rows.map((r) => r.siteNumber)).size,
    facilityCount: new Set(rows.map((r) => r.facilityCode.toUpperCase())).size,
    rowsWithShortfall: rows.filter((r) => breakdownShortfall(r) > 0).length,
    preliminaryCostNgn: costs.length ? round2(costs.reduce((s, v) => s + v, 0)) : null,
  };
}

export interface BreakdownFacilityGroup<R extends RowForTotals = RowForTotals> {
  facilityCode: string;
  /** "Number of sites" of the owner's table: derived, never typed. */
  siteCount: number;
  siteNumbers: number[];
  existingQuantity: number;
  requiredQuantity: number;
  proposedQuantity: number;
  shortfall: number;
  preliminaryCostNgn: number | null;
  /** The group's rows in site order. */
  rows: R[];
}

/** The breakdown grouped by facility (first appearance order), with site sub-rows (D-N.7). */
export function groupBreakdownByFacility<R extends RowForTotals>(rows: readonly R[]): BreakdownFacilityGroup<R>[] {
  const byCode = new Map<string, R[]>();
  for (const r of rows) {
    const code = r.facilityCode.toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), r]);
  }
  return [...byCode].map(([facilityCode, group]) => {
    const sorted = [...group].sort((a, b) => a.siteNumber - b.siteNumber);
    const siteNumbers = [...new Set(sorted.map((r) => r.siteNumber))];
    const sum = (pick: (r: R) => number) => round2(sorted.reduce((s, r) => s + pick(r), 0));
    const costs = sorted.map((r) => r.preliminaryCostNgn).filter((v): v is number => v !== null && v !== undefined);
    return {
      facilityCode,
      siteCount: siteNumbers.length,
      siteNumbers,
      existingQuantity: sum((r) => r.existingQuantity),
      requiredQuantity: sum((r) => r.requiredQuantity),
      proposedQuantity: sum((r) => r.proposedQuantity),
      shortfall: sum((r) => breakdownShortfall(r)),
      preliminaryCostNgn: costs.length ? round2(costs.reduce((s, v) => s + v, 0)) : null,
      rows: sorted,
    };
  });
}
