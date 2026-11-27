import ExcelJS from 'exceljs';
import {
  DEFAULT_FACILITIES,
  INTERVENTION_ACTION_LABELS,
  InterventionActionEnum,
  EXISTING_CONDITION_LABELS,
  FACILITY_CRITICALITY_LABELS,
  lgaByCode,
  NEEDS_TEMPLATE_SHEETS,
  SCHOOL_LEVEL_LABELS,
  stateByCode,
  type InterventionAction,
} from '@insite/shared';
import {
  NEEDS_BOQ_COLUMNS,
  NEEDS_BREAKDOWN_HEADERS,
  NEEDS_COSTING_ROWS,
  NEEDS_PROJECT_FIELDS,
  NEEDS_SITES_COLUMNS,
  NEEDS_WORKBOOK_FIRST_DATA_ROW as FR,
} from '../../../modules/needs/workbook/needsWorkbook';
import type { NeedsFixtureSpec } from './needsFixtureSpecs';

/**
 * Needs pipeline wave 2 (Track A): types a fixture spec into a blank template v2 with exceljs, as a
 * person filling in the file would (names and labels from the lists, not codes). Used by the fixture
 * generator and the round-trip test.
 */

const S = NEEDS_TEMPLATE_SHEETS;

const facilityText = (codeOrText: string) => DEFAULT_FACILITIES.find((f) => f.code === codeOrText)?.name ?? codeOrText;
const actionText = (a: string) => (InterventionActionEnum.safeParse(a).success ? INTERVENTION_ACTION_LABELS[a as InterventionAction] : a);

function col(headers: readonly string[], header: string): number {
  const i = headers.indexOf(header);
  if (i < 0) throw new Error(`No column ${header}`);
  return i + 1;
}

function labelRow(ws: ExcelJS.Worksheet, label: string): number {
  let found = 0;
  ws.eachRow((row, n) => {
    if (String(row.getCell(1).value ?? '') === label) found = n;
  });
  if (!found) throw new Error(`No row ${label} on ${ws.name}`);
  return found;
}

export interface FillOptions {
  /** Leave the Project sheet's State blank (cycle or LGA derivation tests). */
  blankState?: boolean;
  /** Write this year instead of the spec's. */
  yearOverride?: number | string | null;
  /** Write this State name instead of the spec's. */
  stateNameOverride?: string;
  /** Per BoQ line index, a wrong Amount typed over the formula. */
  amountOverrides?: Record<number, number>;
}

export async function fillNeedsWorkbook(blank: Buffer, spec: NeedsFixtureSpec, opts: FillOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(blank as unknown as ArrayBuffer);

  // Project
  const proj = wb.getWorksheet(S.PROJECT)!;
  const setProject = (key: (typeof NEEDS_PROJECT_FIELDS)[number]['key'], value: string | number | null) => {
    const label = NEEDS_PROJECT_FIELDS.find((f) => f.key === key)!.label;
    proj.getCell(labelRow(proj, label), 2).value = value;
  };
  setProject('title', spec.project.title);
  setProject('interventionYear', opts.yearOverride !== undefined ? opts.yearOverride : spec.project.interventionYear);
  setProject('state', opts.blankState ? null : opts.stateNameOverride ?? stateByCode(spec.project.stateCode)!.name);
  setProject('justification', spec.project.justification);
  setProject('assumptions', spec.project.assumptions);
  setProject('beneficiaries', spec.project.beneficiaries);
  setProject('estimatedDurationMonths', spec.project.estimatedDurationMonths);

  // Sites
  const sites = wb.getWorksheet(S.SITES)!;
  spec.sites.forEach((s, i) => {
    const r = FR + i;
    const put = (h: (typeof NEEDS_SITES_COLUMNS)[number], v: ExcelJS.CellValue) => (sites.getCell(r, col(NEEDS_SITES_COLUMNS, h)).value = v);
    put('Site no.', s.siteNumber);
    put('School name', s.schoolName);
    put('School level', SCHOOL_LEVEL_LABELS[s.schoolLevel]);
    put('LGA', lgaByCode(s.lgaCode)?.name ?? s.lgaCode);
    put('Address', s.address);
    put('Latitude', s.latitude);
    put('Longitude', s.longitude);
    put('Enrolment', s.enrolment);
  });

  // Facilities breakdown
  const bd = wb.getWorksheet(S.BREAKDOWN)!;
  spec.rows.forEach((row, i) => {
    const r = FR + i;
    const put = (h: string, v: ExcelJS.CellValue) => (bd.getCell(r, col(NEEDS_BREAKDOWN_HEADERS, h)).value = v);
    put('Unit ID', row.unitId);
    put('Site no.', row.siteNumber);
    put('Facility', facilityText(row.facility));
    put('Intervention action', actionText(row.action));
    put('Existing quantity', row.existingQuantity);
    put('Existing condition', EXISTING_CONDITION_LABELS[row.condition]);
    put('Required quantity', row.requiredQuantity);
    put('Proposed quantity', row.proposedQuantity);
    put('Unit of measure', row.unit);
    put('Preliminary cost (₦)', row.preliminaryCostNgn);
    put('Technical justification', row.justification);
    put('Priority', FACILITY_CRITICALITY_LABELS[row.priority]);
    put('Supporting evidence', row.evidence);
  });

  // BoQ: typed values replace the rate formula; Amount keeps its formula unless overridden.
  const boq = wb.getWorksheet(S.BOQ)!;
  spec.lines.forEach((l, i) => {
    const r = FR + i;
    const put = (h: (typeof NEEDS_BOQ_COLUMNS)[number], v: ExcelJS.CellValue) => (boq.getCell(r, col(NEEDS_BOQ_COLUMNS, h)).value = v);
    put('Item no.', l.wbsCode);
    put('Unit ID', l.unitId);
    put('Item code', l.itemCode);
    put('Description', l.description);
    put('Unit of measure', l.unit);
    put('Quantity', l.quantity);
    put('Rate (₦)', l.rate);
    const amount = opts.amountOverrides?.[i];
    const amountCell = boq.getCell(r, col(NEEDS_BOQ_COLUMNS, 'Amount (₦)'));
    if (amount !== undefined) amountCell.value = amount;
    else amountCell.value = { formula: `IF(OR(F${r}="",G${r}=""),"",ROUND(F${r}*G${r},2))`, result: Math.round(l.quantity * l.rate * 100) / 100 } as ExcelJS.CellFormulaValue;
  });

  // Costing summary percentages
  const cs = wb.getWorksheet(S.COSTING)!;
  cs.getCell(labelRow(cs, NEEDS_COSTING_ROWS.smPct), 2).value = spec.supervisionMonitoringPct;
  cs.getCell(labelRow(cs, NEEDS_COSTING_ROWS.contingencyPct), 2).value = spec.contingencyPct;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
