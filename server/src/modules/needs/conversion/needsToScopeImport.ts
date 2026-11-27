import { INTERVENTION_ACTION_LABELS, lineAmount, type ParsedNeedsAssessment, type SchoolLevel, type UnitOfMeasure } from '@insite/shared';

/**
 * Needs pipeline wave 3, N7a (M1): what a funded proposal becomes in its draft project, pure
 * (D-N.7: nothing is re-typed).
 *
 * - each site → a `ProjectSite` (same number, school, level, LGA, address, GPS);
 * - each breakdown row with a proposed quantity above zero → a `FacilityUnit` (code = the row's unit
 *   ID, on its site, planned quantity = the proposed quantity in the row's unit of measure); a row
 *   with proposed quantity 0 records an existing facility and becomes no unit (wave 1 item 10);
 * - each BoQ line → a `BoqItem` on the unit its unit ID names; the amount is recomputed
 *   (`lineAmount`). Work phases (sprints) are set after award: none are created.
 *
 * A file the converter cannot map (a line whose unit ID has no proposed row, a row on a site the
 * file does not list, no unit at all) gives issues; the converter refuses it.
 */

export interface ScopeImportSite {
  siteNumber: number;
  schoolName: string;
  schoolLevel: SchoolLevel;
  lgaCode: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ScopeImportUnit {
  code: string;
  facilityCode: string;
  label: string;
  siteNumber: number;
  plannedQuantity: number;
  quantityUnit: UnitOfMeasure;
  sortOrder: number;
}

export interface ScopeImportLine {
  unitCode: string;
  wbsCode: string;
  description: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
  rateNgn: number;
  amountNgn: number;
}

export interface ScopeImportIssue {
  code: 'NO_SITES' | 'NO_UNITS' | 'UNIT_SITE_UNKNOWN' | 'LINE_UNIT_UNKNOWN';
  message: string;
}

export interface ScopeImportPlan {
  sites: ScopeImportSite[];
  units: ScopeImportUnit[];
  lines: ScopeImportLine[];
  totals: { siteCount: number; unitCount: number; lineCount: number; amountNgn: number };
  issues: ScopeImportIssue[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `facilityNames`: facility code → name for the unit labels (the code is used when a name is missing). */
export function needsToScopeImport(parsed: Pick<ParsedNeedsAssessment, 'sites' | 'breakdownRows' | 'boqLines'>, facilityNames: ReadonlyMap<string, string> = new Map()): ScopeImportPlan {
  const issues: ScopeImportIssue[] = [];
  const sites: ScopeImportSite[] = [...parsed.sites]
    .sort((a, b) => a.siteNumber - b.siteNumber)
    .map((s) => ({
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      schoolLevel: s.schoolLevel,
      lgaCode: s.lgaCode,
      address: s.address ?? null,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
    }));
  if (sites.length === 0) issues.push({ code: 'NO_SITES', message: 'The needs assessment lists no site.' });
  const siteNumbers = new Set(sites.map((s) => s.siteNumber));

  const units: ScopeImportUnit[] = [];
  for (const row of parsed.breakdownRows) {
    if (!(row.proposedQuantity > 0)) continue;
    if (!siteNumbers.has(row.siteNumber)) {
      issues.push({ code: 'UNIT_SITE_UNKNOWN', message: `Unit ${row.unitId} is on site ${row.siteNumber}, which the Sites sheet does not list.` });
      continue;
    }
    const facility = facilityNames.get(row.facilityCode.toUpperCase()) ?? row.facilityCode;
    units.push({
      code: row.unitId.toUpperCase(),
      facilityCode: row.facilityCode.toUpperCase(),
      label: `${facility}, ${INTERVENTION_ACTION_LABELS[row.interventionAction].toLowerCase()} (site ${row.siteNumber})`,
      siteNumber: row.siteNumber,
      plannedQuantity: row.proposedQuantity,
      quantityUnit: row.unitOfMeasure,
      sortOrder: (units.length + 1) * 10,
    });
  }
  if (units.length === 0) issues.push({ code: 'NO_UNITS', message: 'The facilities breakdown proposes no work (no row with a proposed quantity above zero).' });
  const unitCodes = new Set(units.map((u) => u.code));

  const lines: ScopeImportLine[] = [];
  for (const l of parsed.boqLines) {
    const unitCode = l.unitId.toUpperCase();
    if (!unitCodes.has(unitCode)) {
      issues.push({ code: 'LINE_UNIT_UNKNOWN', message: `BoQ item ${l.wbsCode} names unit ${unitCode}, which has no proposed row in the facilities breakdown.` });
      continue;
    }
    lines.push({
      unitCode,
      wbsCode: l.wbsCode,
      description: l.description,
      unit: l.unit,
      totalQuantity: l.totalQuantity,
      rateNgn: l.rateNgn,
      amountNgn: lineAmount(l.totalQuantity, l.rateNgn),
    });
  }

  return {
    sites,
    units,
    lines,
    totals: { siteCount: sites.length, unitCount: units.length, lineCount: lines.length, amountNgn: round2(lines.reduce((s, l) => s + l.amountNgn, 0)) },
    issues,
  };
}
