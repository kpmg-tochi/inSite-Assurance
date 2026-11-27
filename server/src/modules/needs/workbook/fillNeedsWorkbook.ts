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
  type CostingStandard,
  type ExistingCondition,
  type FacilityCriticality,
  type InterventionAction,
  type SchoolLevel,
} from '@insite/shared';
import {
  buildNeedsWorkbook,
  NEEDS_BOQ_COLUMNS,
  NEEDS_BREAKDOWN_HEADERS,
  NEEDS_COSTING_ROWS,
  NEEDS_PROJECT_FIELDS,
  NEEDS_SITES_COLUMNS,
  NEEDS_WORKBOOK_FIRST_DATA_ROW as FR,
  type NeedsWorkbookFacility,
} from './needsWorkbook';

/**
 * Needs pipeline wave 2 (Track A), moved out of the tests in wave 5 (N9): types a needs assessment
 * spec into a blank template v2 with exceljs, as a person filling in the file would (names and labels
 * from the lists, not codes). Used by the test fixture generator and the round-trip test (through
 * `src/tests/fixtures/needs/fillNeedsWorkbook.ts`), the seed (`seedNeedsPipeline.ts`) and the demo
 * pack (`scripts/buildDemoPack.ts`).
 */

export interface NeedsFileSite {
  siteNumber: number;
  schoolName: string;
  schoolLevel: SchoolLevel;
  lgaCode: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  enrolment: number | null;
}

export interface NeedsFileRow {
  unitId: string;
  siteNumber: number;
  /** A facility code (written as its catalogue name) or any text (written as is). */
  facility: string;
  /** An action code (written as its label) or any text. */
  action: InterventionAction | string;
  existingQuantity: number | null;
  condition: ExistingCondition;
  requiredQuantity: number;
  proposedQuantity: number | null;
  unit: string;
  preliminaryCostNgn: number | null;
  justification: string;
  priority: FacilityCriticality;
  evidence: string | null;
}

export interface NeedsFileLine {
  wbsCode: string;
  unitId: string;
  itemCode: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
}

export interface NeedsFileSpec {
  name: string;
  programme: 'DI' | 'MG';
  /** Parses without issues against the seeded context. */
  valid: boolean;
  project: {
    title: string;
    interventionYear: number;
    /** State code; written as the State name. */
    stateCode: string;
    justification: string;
    assumptions: string | null;
    beneficiaries: string | null;
    estimatedDurationMonths: number | null;
  };
  sites: NeedsFileSite[];
  rows: NeedsFileRow[];
  lines: NeedsFileLine[];
  supervisionMonitoringPct: number;
  contingencyPct: number;
}

const S = NEEDS_TEMPLATE_SHEETS;

const defaultFacilityText = (codeOrText: string) => DEFAULT_FACILITIES.find((f) => f.code === codeOrText)?.name ?? codeOrText;
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
  /** The facility names to write (a tenant whose catalogue renamed the defaults); else the default names. */
  facilities?: readonly NeedsWorkbookFacility[];
}

export async function fillNeedsWorkbook(blank: Buffer, spec: NeedsFileSpec, opts: FillOptions = {}): Promise<Buffer> {
  const facilityText = (codeOrText: string) => opts.facilities?.find((f) => f.code === codeOrText)?.name ?? defaultFacilityText(codeOrText);
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

/** What a blank template for one cycle needs (the facility catalogue and the costing standard of the tenant). */
export interface NeedsFileContext {
  tenantShortName: string;
  programmeName: string;
  interventionYear: number;
  /** Matching Grants: the cycle's State; null for a national cycle. */
  stateCode: string | null;
  costingStandard: { version: number; standard: CostingStandard } | null;
  facilities: NeedsWorkbookFacility[];
}

/** Blank templates per context, built once per process (building one takes a few hundred milliseconds). */
const blankCache = new Map<string, Promise<Buffer>>();

/** A blank template v2 for the cycle with the spec typed in (facility names from the context's catalogue). */
export async function buildNeedsFile(spec: NeedsFileSpec, ctx: NeedsFileContext, opts: Omit<FillOptions, 'facilities'> = {}): Promise<Buffer> {
  const key = JSON.stringify([ctx.tenantShortName, ctx.programmeName, ctx.interventionYear, ctx.stateCode, ctx.costingStandard, ctx.facilities.map((f) => [f.code, f.name, f.isRetired])]);
  let blank = blankCache.get(key);
  if (!blank) {
    blank = buildNeedsWorkbook({ ...ctx, prefill: null, proposalReference: null }).then((r) => r.buffer);
    blankCache.set(key, blank);
  }
  return fillNeedsWorkbook(await blank, spec, { ...opts, facilities: ctx.facilities });
}
