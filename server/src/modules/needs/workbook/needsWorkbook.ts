import ExcelJS from 'exceljs';
import {
  breakdownRowCost,
  costingSummary,
  DEFAULT_COSTING_ZONE_FACTORS,
  DEFAULT_FACILITIES,
  EXISTING_CONDITION_LABELS,
  ExistingConditionEnum,
  FACILITY_BREAKDOWN_COLUMNS,
  FACILITY_CRITICALITY_LABELS,
  FacilityCriticalityEnum,
  findStateByName,
  INTERVENTION_ACTION_LABELS,
  InterventionActionEnum,
  lineAmount,
  missingMinimumFields,
  NEEDS_BOQ_LINES_MAX,
  NEEDS_BREAKDOWN_ROWS_MAX,
  NEEDS_SITES_MAX,
  NEEDS_TEMPLATE_FIELD_LABELS,
  NEEDS_TEMPLATE_SHEETS,
  NEEDS_TEMPLATE_VERSION,
  NIGERIA_LGAS,
  NIGERIA_STATES,
  NIGERIA_ZONES,
  normalizeUnitOfMeasure,
  ParsedNeedsAssessmentSchema,
  SCHOOL_LEVEL_LABELS,
  SchoolLevelEnum,
  SCOPE_WORKBOOK_VERSION,
  stateByCode,
  standardRateFor,
  UNITS_OF_MEASURE,
  validateBreakdownRows,
  zoneOfState,
  type BreakdownRowDraft,
  type CostingStandard,
  type FacilityArchetype,
  type FacilityBreakdownRow,
  type NeedsBoqLine,
  type NeedsFileIssue,
  type NeedsStage,
  type NeedsTemplateFieldKey,
  type NigeriaLga,
  type NigeriaZoneCode,
  type ParsedNeedsAssessment,
  type ParsedNeedsProject,
  type ProposalSite,
  type SchoolLevel,
} from '@insite/shared';
import {
  CELL_BOX,
  decimalValidation,
  headerRow,
  listRange,
  listValidation,
  metaRow,
  MONEY_FMT,
  PCT_FMT,
  QTY_FMT,
  sectionRow,
  setRow,
  SHEET_FONT,
  solidFill,
  stepRows,
  tableBody,
  titleBand,
  UBEC_SHEET_COLOR as COLOR,
  UBEC_SHEET_FIRST_DATA_ROW,
  UBEC_SHEET_HEADER_ROW,
  wrappedHeight,
} from '../../../utils/ubecSheetStyle';
import {
  cellText,
  cellValue,
  findSheet,
  isBlank,
  labelledValue,
  loadWorkbook,
  normHeader,
  parseSheetNumber,
  readTable,
  type SheetIssue,
} from '../../../utils/sheetReader';
import { lgaRangeName, parseSchoolLevel, parseScopeWorkbook, resolveLgaText } from '../../scope/workbook/scopeWorkbook';

/**
 * Needs pipeline wave 2 (Track A): the needs assessment template v2 (`INSITE-NEEDS-v2`, D-N.6, plan
 * 6.4) and its parser. Pure: no database, no storage. The service (Track B) loads the context and
 * calls these.
 *
 * Sheets: Instructions (version stamp, costing standard version, rules), Project (label / value),
 * Sites, Facilities breakdown (plan 6.3), BoQ (lines by unit ID; item code from the costing standard;
 * standard rate pre-filled by formula; Amount a locked formula), Costing summary (subtotal, S&M and
 * contingency: percentages are inputs, amounts locked formulas), Rates (protected copy of the
 * standard) and a hidden, protected Lists sheet. UBEC styling: title band rows 1–2, headers row 3,
 * data from row 4. The parser finds the header row among the top 10 rows and the columns by name.
 *
 * A pre-v2 scope workbook (`SCOPE_WORKBOOK_VERSION`, A3) is read with `parseScopeWorkbook` into the
 * same shape with no breakdown rows, with a warning; the caller allows it at Identification only
 * (`NEEDS_LEGACY_TEMPLATE_STAGES`).
 */

/** A facility of the tenant catalogue (retired ones included; new versions refuse them). */
export interface NeedsWorkbookFacility {
  id: string;
  code: string;
  name: string;
  isRetired: boolean;
}

export interface NeedsWorkbookBuildData {
  /** Tenant short name for the title band and file name ("UBEC"). */
  tenantShortName: string;
  /** The programme (project type) name, written in the Project sheet. */
  programmeName: string;
  interventionYear: number;
  /** Matching Grants: the cycle's State (pre-filled, LGA lists narrowed to it); null for DI. */
  stateCode: string | null;
  /** The cycle's costing standard (Rates sheet, BoQ item dropdown, standard rates pre-filled). */
  costingStandard: { version: number; standard: CostingStandard } | null;
  facilities: NeedsWorkbookFacility[];
  /** A new version of a proposal: its current version, written into every sheet. */
  prefill: ParsedNeedsAssessment | null;
  /** The proposal's reference, for the file name of a pre-filled template. */
  proposalReference: string | null;
}

export interface NeedsWorkbookParseContext {
  facilities: NeedsWorkbookFacility[];
  /** The cycle's intervention year: a file naming another year is an issue. */
  interventionYear: number;
  /** Matching Grants: the cycle's State (a file naming another State is an issue; LGAs read against it). Null for DI. */
  cycleStateCode: string | null;
  /**
   * Template fields the version must have at the stage it is uploaded for (`minimumFieldsFor`).
   * DRAWINGS is never checked here (drawings are proposal documents, checked at submission).
   */
  requiredFields: NeedsTemplateFieldKey[];
  /** The costing standard the cycle uses: amounts and the costing summary are recomputed with it. */
  costingStandard: { version: number; standard: CostingStandard } | null;
  /** Essential facility groups and the S&M rule are flags (Track B), not parser issues. */
}

export interface NeedsWorkbookParseResult {
  /** Null while `issues` is not empty. */
  parsed: ParsedNeedsAssessment | null;
  /** Blocking: the file is refused (sheet, row, column, reason). */
  issues: NeedsFileIssue[];
  /** Non-blocking: shown in the preview (e.g. an old v1 file read at Identification only). */
  warnings: NeedsFileIssue[];
  /** The stamp read from the Instructions sheet (`INSITE-NEEDS-v2`, `SCOPE_WORKBOOK_VERSION`) or null. */
  templateVersion: string | null;
  /** A pre-v2 scope workbook (A3): read into the same shape with no breakdown rows. */
  isLegacyTemplate: boolean;
}

// ---------------------------------------------------------------------------
// Layout (exported for the fixtures and tests)
// ---------------------------------------------------------------------------

const S = NEEDS_TEMPLATE_SHEETS;
const HR = UBEC_SHEET_HEADER_ROW;
const FR = UBEC_SHEET_FIRST_DATA_ROW;
export const NEEDS_WORKBOOK_HEADER_ROW = HR;
export const NEEDS_WORKBOOK_FIRST_DATA_ROW = FR;

/** Stages a pre-v2 scope workbook may be uploaded at (decision 4 of wave 2). */
export const NEEDS_LEGACY_TEMPLATE_STAGES: readonly NeedsStage[] = ['IDENTIFICATION'];

/** Project sheet rows (label in column A, value in column B), in order from row 4. */
export const NEEDS_PROJECT_FIELDS = [
  { key: 'title', label: 'Project title' },
  { key: 'programme', label: 'Programme' },
  { key: 'interventionYear', label: 'Intervention year' },
  { key: 'state', label: 'State' },
  { key: 'justification', label: 'Justification' },
  { key: 'assumptions', label: 'Assumptions' },
  { key: 'beneficiaries', label: 'Beneficiaries' },
  { key: 'estimatedDurationMonths', label: 'Estimated duration (months)' },
] as const;
export type NeedsProjectFieldKey = (typeof NEEDS_PROJECT_FIELDS)[number]['key'];
const projectLabel = (key: NeedsProjectFieldKey) => NEEDS_PROJECT_FIELDS.find((f) => f.key === key)!.label;
const projectRow = (key: NeedsProjectFieldKey) => FR + NEEDS_PROJECT_FIELDS.findIndex((f) => f.key === key);

export const NEEDS_SITES_COLUMNS = ['Site no.', 'School name', 'School level', 'LGA', 'Address', 'Latitude', 'Longitude', 'Enrolment'] as const;
export const NEEDS_BREAKDOWN_HEADERS: string[] = Object.values(FACILITY_BREAKDOWN_COLUMNS);
export const NEEDS_BOQ_COLUMNS = ['Item no.', 'Unit ID', 'Item code', 'Description', 'Unit of measure', 'Quantity', 'Rate (₦)', 'Amount (₦)'] as const;
export const NEEDS_RATES_COLUMNS = ['Item code', 'Description', 'Facility', 'Unit of measure', 'Base rate (₦)'] as const;

/** Costing summary rows (label in A, value in B), from row 4. Percentages are inputs; amounts formulas. */
export const NEEDS_COSTING_ROWS = {
  subtotal: 'Works subtotal (₦)',
  smPct: 'Supervision and monitoring rate (%)',
  smAmount: 'Supervision and monitoring amount (₦)',
  contingencyPct: 'Contingency rate (%)',
  contingencyAmount: 'Contingency amount (₦)',
  total: 'Total (₦)',
} as const;
const COSTING_ORDER = ['subtotal', 'smPct', 'smAmount', 'contingencyPct', 'contingencyAmount', 'total'] as const;
const costingRow = (key: (typeof COSTING_ORDER)[number]) => FR + COSTING_ORDER.indexOf(key);

/** Instructions labels the parser reads. */
export const NEEDS_INSTRUCTION_LABELS = { version: 'Version', costingStandardVersion: 'Costing standard version' } as const;

/** Pre-sized rows that carry dropdowns and formulas. */
const ROWS = { breakdown: 300, boq: 1000 } as const;

/** Columns of the hidden Lists sheet. */
const LISTS = {
  facilities: 'A',
  units: 'B',
  actions: 'C',
  conditions: 'D',
  priorities: 'E',
  levels: 'F',
  states: 'G',
  stateZones: 'H',
  lgas: 'I',
} as const;

const RATES_ZONE_COL = { code: 'G', factor: 'H' } as const;

const sanitiseFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "UBEC needs assessment 2027 Direct Intervention.xlsx" (blank) or "2027-DI-014 needs assessment.xlsx" (pre-filled). */
export function needsTemplateFileName(data: Pick<NeedsWorkbookBuildData, 'tenantShortName' | 'programmeName' | 'interventionYear' | 'proposalReference' | 'prefill'>): string {
  if (data.prefill && data.proposalReference) return `${sanitiseFileName(data.proposalReference)} needs assessment.xlsx`;
  return `${sanitiseFileName(`${data.tenantShortName} needs assessment ${data.interventionYear} ${data.programmeName}`)}.xlsx`;
}

const facilityNameOf = (facilities: readonly NeedsWorkbookFacility[], code: string) =>
  facilities.find((f) => f.code.toUpperCase() === code.toUpperCase())?.name ?? code;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Builds the template: blank for a cycle, or pre-filled from a proposal's current version. */
export async function buildNeedsWorkbook(data: NeedsWorkbookBuildData): Promise<{ buffer: Buffer; fileName: string }> {
  const pre = data.prefill;
  const std = data.costingStandard?.standard ?? null;
  const stdVersion = data.costingStandard?.version ?? null;
  const cycleState = stateByCode(data.stateCode);
  const prefillState = stateByCode(pre?.project.stateCode ?? null);
  const brand = data.tenantShortName ? `${data.tenantShortName} · ` : '';
  const subject = pre
    ? `${data.proposalReference ? `${data.proposalReference} · ` : ''}${pre.project.title ?? 'Needs assessment'}`
    : `${data.programmeName} ${data.interventionYear}${cycleState ? ` · ${cycleState.name}` : ''}`;
  const docName = 'Needs assessment';
  const sheetTitle = (sheet: string) => `${brand}${docName} · ${sheet}`;
  const hint = (text: string) => `${subject}  |  ${text}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = data.tenantShortName || 'InSite Assurance';
  wb.created = new Date();
  wb.title = `${docName} · ${subject}`;

  const activeFacilities = data.facilities.filter((f) => !f.isRetired);
  const levels = SchoolLevelEnum.options.map((l) => SCHOOL_LEVEL_LABELS[l]);
  const actions = InterventionActionEnum.options.map((a) => INTERVENTION_ACTION_LABELS[a]);
  const conditions = ExistingConditionEnum.options.map((c) => EXISTING_CONDITION_LABELS[c]);
  const priorities = FacilityCriticalityEnum.options.map((c) => FACILITY_CRITICALITY_LABELS[c]);
  const listRef = (col: string, n: number) => `${S.LISTS}!${listRange(col, n)}`;
  const facilityList = listRef(LISTS.facilities, activeFacilities.length);
  const uomList = listRef(LISTS.units, UNITS_OF_MEASURE.length);
  const actionList = listRef(LISTS.actions, actions.length);
  const conditionList = listRef(LISTS.conditions, conditions.length);
  const priorityList = listRef(LISTS.priorities, priorities.length);
  const levelList = listRef(LISTS.levels, levels.length);
  const stateList = listRef(LISTS.states, NIGERIA_STATES.length);
  const allLgaList = listRef(LISTS.lgas, NIGERIA_LGAS.length);
  const stateZoneTable = `${S.LISTS}!$${LISTS.states}$2:$${LISTS.stateZones}$${NIGERIA_STATES.length + 1}`;
  const stateCell = `${S.PROJECT}!$B$${projectRow('state')}`;
  const lgaListFormula = `IF(${stateCell}="",${allLgaList},INDIRECT("LGA_"&SUBSTITUTE(SUBSTITUTE(${stateCell}," ","_"),"-","_")))`;

  // ---- Instructions
  const ins = wb.addWorksheet(S.INSTRUCTIONS, { properties: { tabColor: { argb: COLOR.navy } } });
  ins.columns = [{ width: 28 }, { width: 100 }];
  ins.views = [{ showGridLines: false }];
  titleBand(ins, 2, `${brand}${docName}`, pre ? `${subject}: a new version of this proposed project.` : `${subject}: one file per proposed project.`);
  metaRow(ins, 4, NEEDS_INSTRUCTION_LABELS.version, NEEDS_TEMPLATE_VERSION);
  metaRow(ins, 5, NEEDS_INSTRUCTION_LABELS.costingStandardVersion, stdVersion !== null ? String(stdVersion) : '–');
  metaRow(ins, 6, 'Programme', data.programmeName);
  metaRow(ins, 7, 'Intervention year', String(data.interventionYear));
  metaRow(ins, 8, 'Proposed project', data.proposalReference ?? '(new proposal)');
  sectionRow(ins, 10, 'How to fill it in');
  const steps = [
    `${S.PROJECT}: the project title (the need), the State, the justification, assumptions, beneficiaries and the estimated duration. Programme and intervention year are filled in for the cycle${cycleState ? `, and so is the State (${cycleState.name})` : ''}.`,
    `${S.SITES}: one row per school, numbered 1, 2, 3… with no gaps. Pick the school level and the LGA from the lists (the LGA list follows the State). Add the latitude and longitude in decimal degrees where you have them, and the enrolment.`,
    `${S.BREAKDOWN}: one row per facility per site. Give each row its own Unit ID (U01, U02…). Existing quantity and condition describe what is there now; required quantity is the assessed need; proposed quantity is what this project delivers (it may be below the need). Use proposed quantity 0 only to record a facility that exists and needs no work. "Absent" means an existing quantity of 0. Toilets, water and solar power are checked for every site.`,
    `${S.BOQ}: one row per bill line, tagged with the Unit ID of its breakdown row. Pick the item code from the costing standard: the standard rate for the State's zone is filled in and can be changed (a rate far from the standard is flagged for the costing officer). Amount is quantity × rate and is recomputed on upload. A Direct Intervention draft may leave the BoQ empty until the design stage.`,
    `Preliminary cost on the ${S.BREAKDOWN} sheet: leave it blank where the unit has BoQ lines (it is their total); enter it where the unit has none yet.`,
    `${S.COSTING}: the works subtotal comes from the BoQ. The supervision and monitoring rate and the contingency rate come from the costing standard; the supervision and monitoring line is required on a costed version.`,
    `${S.RATES}: the costing standard (version ${stdVersion ?? '–'}), read-only, with the zone factors.`,
    'Do not rename the sheets or the column headers, and keep the title rows above the headers. Drawings, photos and site reports are uploaded on the proposed project, not in this file.',
    'Upload the file on the Needs assessment page. You will see what will be saved, with any errors by sheet, row and column, before anything is saved.',
  ];
  stepRows(ins, 11, steps);
  const keyRow = 11 + steps.length + 1;
  sectionRow(ins, keyRow, 'Colour key');
  const key: Array<[string, ExcelJS.Fill | null, string]> = [
    ['Input', null, 'White and light green rows: enter data here. Cells with a list arrow take a value from the list.'],
    ['Calculated', solidFill(COLOR.calc), 'Grey cells are calculated and protected. The sheets have no password (Review → Unprotect Sheet).'],
  ];
  key.forEach(([label, fill, t], i) => {
    const r = keyRow + 1 + i;
    const a = ins.getCell(`A${r}`);
    a.value = label;
    a.border = CELL_BOX;
    a.alignment = { vertical: 'middle', horizontal: 'center' };
    if (fill) a.fill = fill;
    a.font = label === 'Calculated' ? { name: SHEET_FONT, italic: true, color: { argb: COLOR.calcText } } : { name: SHEET_FONT };
    const b = ins.getCell(`B${r}`);
    b.value = t;
    b.border = CELL_BOX;
    b.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    ins.getRow(r).height = wrappedHeight(t.length, 100);
  });

  // ---- Project
  const proj = wb.addWorksheet(S.PROJECT, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(proj, 2, sheetTitle(S.PROJECT), hint('The proposed project. Keep the labels in column A.'));
  headerRow(proj, ['Field', 'Value'], [32, 80]);
  const projectValues: Record<NeedsProjectFieldKey, string | number | null> = {
    title: pre?.project.title ?? null,
    programme: data.programmeName,
    interventionYear: data.interventionYear,
    state: (cycleState ?? prefillState)?.name ?? null,
    justification: pre?.project.justification ?? null,
    assumptions: pre?.project.assumptions ?? null,
    beneficiaries: pre?.project.beneficiaries ?? null,
    estimatedDurationMonths: pre?.project.estimatedDurationMonths ?? null,
  };
  NEEDS_PROJECT_FIELDS.forEach((f) => {
    const r = projectRow(f.key);
    const label = proj.getCell(`A${r}`);
    label.value = f.label;
    label.font = { name: SHEET_FONT, bold: true, color: { argb: COLOR.ink } };
    label.fill = solidFill(COLOR.label);
    label.border = CELL_BOX;
    label.alignment = { vertical: 'top', indent: 1 };
    const cell = proj.getCell(`B${r}`);
    const v = projectValues[f.key];
    if (v !== null && v !== '') cell.value = v;
    cell.border = CELL_BOX;
    cell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
    if (f.key === 'state') cell.dataValidation = listValidation(stateList, 'Choose a State from the list.');
    if (f.key === 'interventionYear') {
      cell.dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [2000, 2100], showErrorMessage: true, error: 'Enter a year from 2000 to 2100.' };
    }
    if (f.key === 'estimatedDurationMonths') {
      cell.dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 120], showErrorMessage: true, error: 'Enter whole months from 1 to 120.' };
    }
    if (f.key === 'justification' || f.key === 'assumptions' || f.key === 'beneficiaries') {
      proj.getRow(r).height = Math.max(f.key === 'beneficiaries' ? 30 : 60, wrappedHeight(String(v ?? '').length, 80));
    }
  });

  // ---- Sites
  const sitesLast = NEEDS_SITES_MAX + HR;
  const sitesWs = wb.addWorksheet(S.SITES, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(sitesWs, NEEDS_SITES_COLUMNS.length, sheetTitle(S.SITES), hint('One row per school, numbered 1, 2, 3… The LGA list follows the State on the Project sheet.'));
  headerRow(sitesWs, NEEDS_SITES_COLUMNS, [9, 46, 24, 26, 46, 14, 14, 12]);
  tableBody(
    sitesWs,
    [{ align: 'center' }, { wrap: true }, { align: 'center' }, {}, { wrap: true }, { numFmt: '0.000000', align: 'right' }, { numFmt: '0.000000', align: 'right' }, { numFmt: '#,##0', align: 'right' }],
    sitesLast
  );
  (pre?.sites ?? []).forEach((s, i) => {
    setRow(sitesWs, i + FR, [
      s.siteNumber,
      s.schoolName,
      SCHOOL_LEVEL_LABELS[s.schoolLevel],
      NIGERIA_LGAS.find((l) => l.code === s.lgaCode)?.name ?? s.lgaCode,
      s.address ?? null,
      s.latitude ?? null,
      s.longitude ?? null,
      s.enrolment ?? null,
    ]);
  });
  for (let r = FR; r <= sitesLast; r++) {
    sitesWs.getCell(`A${r}`).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, NEEDS_SITES_MAX], showErrorMessage: true, error: 'Site numbers are 1, 2, 3…' };
    sitesWs.getCell(`C${r}`).dataValidation = listValidation(levelList, 'Choose ECCDE, Primary or Junior Secondary (JSS).');
    sitesWs.getCell(`D${r}`).dataValidation = listValidation(lgaListFormula, 'Choose an LGA of the State on the Project sheet.');
    sitesWs.getCell(`F${r}`).dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-90, 90], showErrorMessage: true, error: 'Enter the latitude in decimal degrees, e.g. 9.6520.' };
    sitesWs.getCell(`G${r}`).dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-180, 180], showErrorMessage: true, error: 'Enter the longitude in decimal degrees, e.g. 6.5150.' };
    sitesWs.getCell(`H${r}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Enter the number of pupils.' };
  }
  sitesWs.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: NEEDS_SITES_COLUMNS.length } };

  // ---- Facilities breakdown
  const bdRows = pre?.breakdownRows ?? [];
  const bdLast = Math.max(ROWS.breakdown, bdRows.length) + HR;
  const bd = wb.addWorksheet(S.BREAKDOWN, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(
    bd,
    NEEDS_BREAKDOWN_HEADERS.length,
    sheetTitle(S.BREAKDOWN),
    hint('One row per facility per site. Proposed quantity 0 only records a facility that exists and needs no work. Preliminary cost: blank where the unit has BoQ lines.')
  );
  headerRow(bd, NEEDS_BREAKDOWN_HEADERS, [10, 9, 28, 20, 12, 18, 12, 12, 12, 18, 50, 13, 34]);
  tableBody(
    bd,
    [
      { align: 'center' },
      { align: 'center' },
      {},
      {},
      { numFmt: QTY_FMT, align: 'right' },
      {},
      { numFmt: QTY_FMT, align: 'right' },
      { numFmt: QTY_FMT, align: 'right' },
      { align: 'center' },
      { numFmt: MONEY_FMT, align: 'right' },
      { wrap: true },
      {},
      { wrap: true },
    ],
    bdLast
  );
  bdRows.forEach((r, i) => {
    setRow(bd, i + FR, [
      r.unitId,
      r.siteNumber,
      facilityNameOf(data.facilities, r.facilityCode),
      INTERVENTION_ACTION_LABELS[r.interventionAction],
      r.existingQuantity,
      EXISTING_CONDITION_LABELS[r.existingCondition],
      r.requiredQuantity,
      r.proposedQuantity,
      r.unitOfMeasure,
      // The cost of a unit with BoQ lines is their total: written only where it was entered.
      (pre?.boqLines ?? []).some((l) => l.unitId === r.unitId) ? null : r.preliminaryCostNgn,
      r.technicalJustification,
      FACILITY_CRITICALITY_LABELS[r.criticality],
      r.supportingEvidence ?? null,
    ]);
  });
  const siteList = `${S.SITES}!$A$${FR}:$A$${sitesLast}`;
  for (let r = FR; r <= bdLast; r++) {
    bd.getCell(`B${r}`).dataValidation = listValidation(siteList, 'Choose a site number from the Sites sheet.');
    bd.getCell(`C${r}`).dataValidation = listValidation(facilityList, 'Choose a facility from the list.');
    bd.getCell(`D${r}`).dataValidation = listValidation(actionList, 'Choose an intervention action from the list.');
    bd.getCell(`E${r}`).dataValidation = decimalValidation(0, 'Enter the existing quantity (0 or more).');
    bd.getCell(`F${r}`).dataValidation = listValidation(conditionList, 'Choose the existing condition from the list.');
    bd.getCell(`G${r}`).dataValidation = decimalValidation(0, 'Enter the required quantity (0 or more).');
    bd.getCell(`H${r}`).dataValidation = decimalValidation(0, 'Enter the proposed quantity (0 or more).');
    bd.getCell(`I${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    bd.getCell(`J${r}`).dataValidation = decimalValidation(0, 'Enter the preliminary cost in naira.');
    bd.getCell(`L${r}`).dataValidation = listValidation(priorityList, 'Choose the priority from the list.');
  }
  bd.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: NEEDS_BREAKDOWN_HEADERS.length } };

  // ---- BoQ: Amount is a locked formula; Rate is pre-filled with the standard rate by formula.
  const lines = pre?.boqLines ?? [];
  const boqLast = Math.max(ROWS.boq, lines.length) + HR;
  const ratesLast = Math.max(FR, (std?.rates.length ?? 0) + HR);
  const boq = wb.addWorksheet(S.BOQ, { properties: { tabColor: { argb: COLOR.primary } } });
  for (let c = 1; c <= 7; c++) boq.getColumn(c).protection = { locked: false };
  titleBand(
    boq,
    NEEDS_BOQ_COLUMNS.length,
    sheetTitle(S.BOQ),
    hint('One row per bill line, tagged with the Unit ID of its breakdown row. Pick the item code: the standard rate is filled in (editable). Amount = Quantity × Rate.')
  );
  headerRow(boq, NEEDS_BOQ_COLUMNS, [11, 10, 14, 56, 12, 12, 18, 20]);
  for (const r of [1, 2]) for (let c = 1; c <= NEEDS_BOQ_COLUMNS.length; c++) boq.getCell(r, c).protection = { locked: true };
  tableBody(
    boq,
    [
      { align: 'left' },
      { align: 'center' },
      { align: 'left' },
      { wrap: true },
      { align: 'center' },
      { numFmt: QTY_FMT, align: 'right' },
      { numFmt: MONEY_FMT, align: 'right' },
      { numFmt: MONEY_FMT, align: 'right', calculated: true },
    ],
    boqLast
  );
  const zoneFactor = cycleState
    ? String(std ? std.zoneFactors[cycleState.zone] ?? 1 : 1)
    : `IFERROR(VLOOKUP(VLOOKUP(${stateCell},${stateZoneTable},2,FALSE),${S.RATES}!$${RATES_ZONE_COL.code}$${FR}:$${RATES_ZONE_COL.factor}$${FR + NIGERIA_ZONES.length - 1},2,FALSE),1)`;
  const unitIdList = `'${S.BREAKDOWN}'!$A$${FR}:$A$${bdLast}`;
  const itemList = `${S.RATES}!$A$${FR}:$A$${ratesLast}`;
  for (let r = FR; r <= boqLast; r++) {
    const ln = lines[r - FR];
    if (ln) setRow(boq, r, [ln.wbsCode, ln.unitId, ln.itemCode ?? null, ln.description, ln.unit, ln.totalQuantity, ln.rateNgn]);
    boq.getCell(`B${r}`).dataValidation = listValidation(unitIdList, 'Choose a Unit ID from the Facilities breakdown sheet.');
    if (std?.rates.length) {
      boq.getCell(`C${r}`).dataValidation = { ...listValidation(itemList, 'Choose an item code from the costing standard, or leave it blank.'), showErrorMessage: false };
    }
    boq.getCell(`E${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    boq.getCell(`F${r}`).dataValidation = decimalValidation(0, 'Enter the quantity as a number.');
    boq.getCell(`G${r}`).dataValidation = decimalValidation(0, 'Enter the rate as a number.');
    if (!ln && std?.rates.length) {
      boq.getCell(`G${r}`).value = {
        formula: `IF(C${r}="","",IFERROR(ROUND(VLOOKUP(C${r},${S.RATES}!$A$${FR}:$E$${ratesLast},5,FALSE)*${zoneFactor},2),""))`,
        result: '',
      } as ExcelJS.CellFormulaValue;
    }
    boq.getCell(`H${r}`).value = {
      formula: `IF(OR(F${r}="",G${r}=""),"",ROUND(F${r}*G${r},2))`,
      result: ln ? lineAmount(ln.totalQuantity, ln.rateNgn) : '',
    } as ExcelJS.CellFormulaValue;
  }
  boq.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: NEEDS_BOQ_COLUMNS.length } };
  await boq.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
    formatColumns: true,
    formatRows: true,
    insertRows: true,
    deleteRows: true,
    sort: true,
    autoFilter: true,
  });

  // ---- Costing summary
  const cs = wb.addWorksheet(S.COSTING, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(cs, 2, sheetTitle(S.COSTING), hint('Subtotal from the BoQ; the rates are from the costing standard (editable); amounts are calculated.'));
  headerRow(cs, ['Item', 'Value'], [42, 24]);
  const subtotal = lines.reduce((s, l) => s + lineAmount(l.totalQuantity, l.rateNgn), 0);
  const smPct = pre?.costingSummary?.supervisionMonitoringPct ?? std?.supervisionMonitoringPct ?? 0;
  const contPct = pre?.costingSummary?.contingencyPct ?? std?.contingencyPct ?? 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const smAmount = round2((subtotal * smPct) / 100);
  const contAmount = round2((subtotal * contPct) / 100);
  const values: Record<(typeof COSTING_ORDER)[number], ExcelJS.CellValue> = {
    subtotal: { formula: `SUM(${S.BOQ}!H${FR}:H${boqLast})`, result: round2(subtotal) } as ExcelJS.CellFormulaValue,
    smPct,
    smAmount: { formula: `ROUND(B${costingRow('subtotal')}*B${costingRow('smPct')}/100,2)`, result: smAmount } as ExcelJS.CellFormulaValue,
    contingencyPct: contPct,
    contingencyAmount: { formula: `ROUND(B${costingRow('subtotal')}*B${costingRow('contingencyPct')}/100,2)`, result: contAmount } as ExcelJS.CellFormulaValue,
    total: {
      formula: `B${costingRow('subtotal')}+B${costingRow('smAmount')}+B${costingRow('contingencyAmount')}`,
      result: round2(subtotal + smAmount + contAmount),
    } as ExcelJS.CellFormulaValue,
  };
  COSTING_ORDER.forEach((k) => {
    const r = costingRow(k);
    const a = cs.getCell(`A${r}`);
    a.value = NEEDS_COSTING_ROWS[k];
    a.font = { name: SHEET_FONT, bold: k === 'total', color: { argb: COLOR.ink } };
    a.fill = solidFill(COLOR.label);
    a.border = CELL_BOX;
    a.alignment = { vertical: 'middle', indent: 1 };
    a.protection = { locked: true };
    const b = cs.getCell(`B${r}`);
    b.value = values[k];
    b.border = CELL_BOX;
    b.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    const isPct = k === 'smPct' || k === 'contingencyPct';
    b.numFmt = isPct ? PCT_FMT : MONEY_FMT;
    if (isPct) {
      b.protection = { locked: false };
      b.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100], showErrorMessage: true, error: 'Enter a percentage from 0 to 100, e.g. 5.' };
    } else {
      b.protection = { locked: true };
      b.fill = solidFill(COLOR.calc);
      b.font = { name: SHEET_FONT, italic: true, bold: k === 'total', color: { argb: COLOR.calcText } };
    }
  });
  const noteRow = costingRow('total') + 2;
  cs.getCell(`A${noteRow}`).value = `Costing standard version ${stdVersion ?? '–'}. The supervision and monitoring line is required on a costed version.`;
  cs.getCell(`A${noteRow}`).font = { name: SHEET_FONT, italic: true, size: 10, color: { argb: COLOR.calcText } };
  cs.mergeCells(noteRow, 1, noteRow, 2);
  await cs.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatCells: true, formatColumns: true });

  // ---- Rates (protected copy of the standard)
  const rates = wb.addWorksheet(S.RATES, { properties: { tabColor: { argb: COLOR.navy } } });
  titleBand(
    rates,
    8,
    sheetTitle(S.RATES),
    std ? `Costing standard version ${stdVersion}: base rates in naira; the rate for a State is the base rate × its zone factor. Read-only.` : 'No costing standard yet: enter rates on the BoQ sheet.'
  );
  headerRow(rates, [...NEEDS_RATES_COLUMNS, '', 'Zone', 'Factor'], [14, 60, 22, 14, 18, 3, 26, 10]);
  rates.getCell(HR, 6).fill = { type: 'pattern', pattern: 'none' };
  rates.getCell(HR, 6).border = {};
  (std?.rates ?? []).forEach((rate, i) => {
    const r = FR + i;
    setRow(rates, r, [rate.itemCode, rate.description, rate.facilityCode ? facilityNameOf(data.facilities, rate.facilityCode) : 'Any facility', rate.unitOfMeasure, rate.rateNgn]);
    for (let c = 1; c <= 5; c++) {
      const cell = rates.getCell(r, c);
      cell.border = CELL_BOX;
      cell.alignment = { vertical: 'top', wrapText: c === 2, horizontal: c === 5 ? 'right' : 'left', indent: 1 };
      if (i % 2 === 1) cell.fill = solidFill(COLOR.band);
    }
    rates.getCell(r, 5).numFmt = MONEY_FMT;
  });
  NIGERIA_ZONES.forEach((z, i) => {
    const r = FR + i;
    // Zone codes in the lookup column (the BoQ rate formula matches the State's zone code).
    rates.getCell(`${RATES_ZONE_COL.code}${r}`).value = z.code;
    rates.getCell(`${RATES_ZONE_COL.factor}${r}`).value = std ? std.zoneFactors[z.code] ?? 1 : 1;
    rates.getCell(`I${r}`).value = z.name;
    for (const c of [RATES_ZONE_COL.code, RATES_ZONE_COL.factor, 'I']) rates.getCell(`${c}${r}`).border = CELL_BOX;
  });
  rates.getCell(`I${HR}`).value = 'Zone name';
  rates.getCell(`I${HR}`).font = { name: SHEET_FONT, bold: true, color: { argb: COLOR.white } };
  rates.getCell(`I${HR}`).fill = solidFill(COLOR.primary);
  rates.getColumn(9).width = 26;
  if (std) {
    const r = FR + NIGERIA_ZONES.length + 1;
    rates.getCell(`G${r}`).value = 'S&M (%)';
    rates.getCell(`H${r}`).value = std.supervisionMonitoringPct;
    rates.getCell(`G${r + 1}`).value = 'Contingency (%)';
    rates.getCell(`H${r + 1}`).value = std.contingencyPct;
  }
  await rates.protect('', { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: false });

  // ---- Lists (hidden, protected; last in the tab order)
  const lists = wb.addWorksheet(S.LISTS, { state: 'hidden' });
  lists.columns = [
    { header: 'Facilities', width: 34 },
    { header: 'Units of measure', width: 18 },
    { header: 'Intervention actions', width: 22 },
    { header: 'Existing conditions', width: 22 },
    { header: 'Priorities', width: 14 },
    { header: 'School levels', width: 24 },
    { header: 'States', width: 28 },
    { header: 'State zones', width: 12 },
    { header: 'LGAs', width: 28 },
  ];
  activeFacilities.forEach((f, i) => (lists.getCell(`${LISTS.facilities}${i + 2}`).value = f.name));
  UNITS_OF_MEASURE.forEach((u, i) => (lists.getCell(`${LISTS.units}${i + 2}`).value = u.code));
  actions.forEach((a, i) => (lists.getCell(`${LISTS.actions}${i + 2}`).value = a));
  conditions.forEach((c, i) => (lists.getCell(`${LISTS.conditions}${i + 2}`).value = c));
  priorities.forEach((p, i) => (lists.getCell(`${LISTS.priorities}${i + 2}`).value = p));
  levels.forEach((l, i) => (lists.getCell(`${LISTS.levels}${i + 2}`).value = l));
  NIGERIA_STATES.forEach((s, i) => {
    lists.getCell(`${LISTS.states}${i + 2}`).value = s.name;
    lists.getCell(`${LISTS.stateZones}${i + 2}`).value = s.zone;
  });
  const lgaBlocks: Array<{ name: string; first: number; last: number }> = [];
  NIGERIA_LGAS.forEach((l, i) => {
    const r = i + 2;
    lists.getCell(`${LISTS.lgas}${r}`).value = l.name;
    const name = lgaRangeName(stateByCode(l.stateCode)!.name);
    const block = lgaBlocks[lgaBlocks.length - 1];
    if (block && block.name === name) block.last = r;
    else lgaBlocks.push({ name, first: r, last: r });
  });
  for (const b of lgaBlocks) wb.definedNames.add(`${S.LISTS}!$${LISTS.lgas}$${b.first}:$${LISTS.lgas}$${b.last}`, b.name);
  await lists.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  const out = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(out as ArrayBuffer), fileName: needsTemplateFileName(data) };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: number | null): v is number => v !== null && Number.isFinite(v);
const UNIT_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const ITEM_CODE_REGEX = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

/** An enum value from its code or its label (case and punctuation ignored); null when neither. */
function enumFrom<T extends string>(raw: string, labels: Record<T, string>): T | null {
  const n = normHeader(raw);
  if (!n) return null;
  for (const [code, label] of Object.entries(labels) as Array<[T, string]>) {
    if (normHeader(code) === n || normHeader(label) === n) return code;
  }
  return null;
}

/** Facilities by code, name or "Name (CODE)"; active ones win a name clash. */
function facilityResolver(facilities: readonly NeedsWorkbookFacility[]) {
  const byCode = new Map(facilities.map((f) => [f.code.toUpperCase(), f]));
  const byName = new Map<string, NeedsWorkbookFacility>();
  for (const f of [...facilities].sort((a, b) => Number(a.isRetired) - Number(b.isRetired))) {
    const k = normHeader(f.name);
    if (!byName.has(k)) byName.set(k, f);
  }
  return (raw: string): NeedsWorkbookFacility | null => {
    const t = raw.trim();
    if (!t) return null;
    const inBrackets = t.match(/\(([A-Za-z0-9_]+)\)\s*$/);
    return byCode.get(t.toUpperCase()) ?? (inBrackets ? byCode.get(inBrackets[1].toUpperCase()) : undefined) ?? byName.get(normHeader(t)) ?? null;
  };
}

/** A percentage cell: 5, "5", "5%" → 5; a fraction typed as a percentage (0.05 shown as 5 %) → 5. */
function readPercent(raw: unknown): number | null {
  if (isBlank(raw)) return null;
  const n = parseSheetNumber(raw);
  if (n === null || Number.isNaN(n)) return NaN;
  if (typeof raw === 'number' && n > 0 && n < 1) return round2(n * 100);
  return n;
}

interface Collector {
  issues: NeedsFileIssue[];
  warnings: NeedsFileIssue[];
  issue: (sheet: string, row: number | null, column: string | null, reason: string) => void;
  warn: (sheet: string, row: number | null, column: string | null, reason: string) => void;
  /** readTable's missing-column issues. */
  sheetIssues: SheetIssue[];
  flushSheetIssues: () => void;
}

function collector(): Collector {
  const c: Collector = {
    issues: [],
    warnings: [],
    sheetIssues: [],
    issue: (sheet, row, column, reason) => c.issues.push({ sheet, row, column, reason }),
    warn: (sheet, row, column, reason) => c.warnings.push({ sheet, row, column, reason }),
    flushSheetIssues: () => {
      for (const i of c.sheetIssues.splice(0)) c.issues.push({ sheet: i.sheet, row: i.row, column: i.column, reason: i.message });
    },
  };
  return c;
}

const fileIssue = (reason: string): NeedsFileIssue => ({ sheet: S.FILE, row: null, column: null, reason });

/** Sheet named for a missing minimum field (and its column on the Project sheet). */
const FIELD_LOCATION: Record<NeedsTemplateFieldKey, { sheet: string; column: string | null }> = {
  NEED: { sheet: S.PROJECT, column: projectLabel('title') },
  JUSTIFICATION: { sheet: S.PROJECT, column: projectLabel('justification') },
  SITES: { sheet: S.SITES, column: null },
  BREAKDOWN: { sheet: S.BREAKDOWN, column: null },
  BOQ: { sheet: S.BOQ, column: null },
  DRAWINGS: { sheet: S.FILE, column: null },
  PRELIMINARY_COST: { sheet: S.BOQ, column: null },
};

const FIELD_HINT: Partial<Record<NeedsTemplateFieldKey, string>> = {
  BREAKDOWN: ' Add at least one row with a proposed quantity above 0.',
  PRELIMINARY_COST: ` Add BoQ lines, or enter the preliminary cost of every proposed row on the ${S.BREAKDOWN} sheet.`,
};

/** Checks the intervention year against the cycle; blank takes the cycle's year (warning). */
function checkYear(c: Collector, yearText: string | null, ctx: NeedsWorkbookParseContext, row: number | null): number {
  const label = projectLabel('interventionYear');
  if (!yearText) {
    c.warn(S.PROJECT, row, label, `No intervention year given: the cycle's year ${ctx.interventionYear} is used.`);
    return ctx.interventionYear;
  }
  const year = parseSheetNumber(yearText);
  if (!isNum(year) || !Number.isInteger(year)) {
    c.issue(S.PROJECT, row, label, `"${yearText}" is not a year.`);
    return ctx.interventionYear;
  }
  if (year !== ctx.interventionYear) c.issue(S.PROJECT, row, label, `This file is for ${year}; the cycle is for the intervention year ${ctx.interventionYear}.`);
  return year;
}

/**
 * The file's State. A Matching Grants cycle's State wins (blank → the cycle's, warning; another → issue).
 * A Direct Intervention file names its State; blank is an issue unless `derive` finds one State.
 */
function checkState(c: Collector, stateText: string | null, ctx: NeedsWorkbookParseContext, row: number | null): { stateCode: string | null; unknown: boolean } {
  const label = projectLabel('state');
  const named = stateText ? findStateByName(stateText) : null;
  if (stateText && !named) {
    c.issue(S.PROJECT, row, label, `"${stateText}" is not a State on the list.`);
    return { stateCode: stateByCode(ctx.cycleStateCode)?.code ?? null, unknown: true };
  }
  const cycle = stateByCode(ctx.cycleStateCode);
  if (cycle) {
    if (!named) {
      c.warn(S.PROJECT, row, label, `No State given: the cycle's State (${cycle.name}) is used.`);
      return { stateCode: cycle.code, unknown: false };
    }
    if (named.code !== cycle.code) c.issue(S.PROJECT, row, label, `This file is for ${named.name}; the cycle is for ${cycle.name}.`);
    return { stateCode: cycle.code, unknown: false };
  }
  return { stateCode: named?.code ?? null, unknown: false };
}

function textField(c: Collector, value: string | null, max: number, sheet: string, row: number | null, column: string): string | null {
  if (!value) return null;
  if (value.length > max) {
    c.issue(sheet, row, column, `Longer than ${max} characters.`);
    return value.slice(0, max);
  }
  return value;
}

function durationField(c: Collector, text: string | null, row: number | null): number | null {
  if (!text) return null;
  const n = parseSheetNumber(text);
  if (!isNum(n) || !Number.isInteger(n) || n < 1 || n > 120) {
    c.issue(S.PROJECT, row, projectLabel('estimatedDurationMonths'), `"${text}" is not a number of whole months from 1 to 120.`);
    return null;
  }
  return n;
}

/** Recomputed summary with the file's percentages (null without lines). */
function summaryOf(lines: readonly NeedsBoqLine[], ctx: NeedsWorkbookParseContext, zone: NigeriaZoneCode | null, smPct: number, contPct: number) {
  if (!lines.length) return null;
  const s = costingSummary(
    lines,
    {
      rates: ctx.costingStandard?.standard.rates ?? [],
      zoneFactors: ctx.costingStandard?.standard.zoneFactors ?? DEFAULT_COSTING_ZONE_FACTORS,
      supervisionMonitoringPct: smPct,
      contingencyPct: contPct,
    },
    zone
  );
  return {
    subtotalNgn: s.subtotalNgn,
    supervisionMonitoringPct: s.supervisionMonitoringPct,
    supervisionMonitoringNgn: s.supervisionMonitoringNgn,
    contingencyPct: s.contingencyPct,
    contingencyNgn: s.contingencyNgn,
    totalNgn: s.totalNgn,
  };
}

/** Minimum fields for the stage → one issue per missing field. */
function checkMinimumFields(c: Collector, draft: ParsedNeedsAssessment, required: readonly NeedsTemplateFieldKey[]) {
  for (const key of missingMinimumFields(draft, required, { drawingCount: 0 })) {
    const where = FIELD_LOCATION[key];
    // Rows refused on that sheet already explain why it reads as empty.
    if (where.sheet !== S.PROJECT && c.issues.some((i) => i.sheet === where.sheet && i.row !== null)) continue;
    c.issue(where.sheet, null, where.column, `${NEEDS_TEMPLATE_FIELD_LABELS[key]} is required at this stage.${FIELD_HINT[key] ?? ''}`);
  }
}

/** The final shape check; anything it still refuses is reported as a file-level issue. */
function finish(c: Collector, draft: ParsedNeedsAssessment, templateVersion: string, isLegacyTemplate: boolean): NeedsWorkbookParseResult {
  if (c.issues.length) return { parsed: null, issues: c.issues, warnings: c.warnings, templateVersion, isLegacyTemplate };
  const parsed = ParsedNeedsAssessmentSchema.safeParse(draft);
  if (!parsed.success) {
    for (const i of parsed.error.issues) c.issues.push(fileIssue(`${i.path.join('.')}: ${i.message}`));
    return { parsed: null, issues: c.issues, warnings: c.warnings, templateVersion, isLegacyTemplate };
  }
  return { parsed: parsed.data, issues: [], warnings: c.warnings, templateVersion, isLegacyTemplate };
}

/** Reads a filled template (v2, or a v1 scope workbook at Identification only). */
export async function parseNeedsWorkbook(buffer: Buffer, ctx: NeedsWorkbookParseContext): Promise<NeedsWorkbookParseResult> {
  const wb = new ExcelJS.Workbook();
  if (!(await loadWorkbook(wb, buffer))) {
    return {
      parsed: null,
      issues: [fileIssue('This is not an .xlsx file. Download the needs assessment template and fill it in.')],
      warnings: [],
      templateVersion: null,
      isLegacyTemplate: false,
    };
  }
  const version = labelledValue(findSheet(wb, S.INSTRUCTIONS), NEEDS_INSTRUCTION_LABELS.version);
  if (version === SCOPE_WORKBOOK_VERSION) return parseLegacy(buffer, ctx);
  if (version !== NEEDS_TEMPLATE_VERSION) {
    return {
      parsed: null,
      issues: [
        fileIssue(
          version
            ? `This file is "${version}", not a needs assessment template (${NEEDS_TEMPLATE_VERSION}). Download the needs assessment template for the cycle and fill it in.`
            : 'This is not a needs assessment file (no version stamp on the Instructions sheet). Download the needs assessment template for the cycle and fill it in.'
        ),
      ],
      warnings: [],
      templateVersion: version,
      isLegacyTemplate: false,
    };
  }
  return parseV2(wb, ctx);
}

function parseV2(wb: ExcelJS.Workbook, ctx: NeedsWorkbookParseContext): NeedsWorkbookParseResult {
  const c = collector();
  const ins = findSheet(wb, S.INSTRUCTIONS);
  const sheets = {
    project: findSheet(wb, S.PROJECT),
    sites: findSheet(wb, S.SITES),
    breakdown: findSheet(wb, S.BREAKDOWN),
    boq: findSheet(wb, S.BOQ),
    costing: findSheet(wb, S.COSTING),
  };
  const sheetNames = { project: S.PROJECT, sites: S.SITES, breakdown: S.BREAKDOWN, boq: S.BOQ, costing: S.COSTING };
  for (const [k, ws] of Object.entries(sheets)) {
    if (!ws) c.issue(sheetNames[k as keyof typeof sheetNames], null, null, `The "${sheetNames[k as keyof typeof sheetNames]}" sheet is missing.`);
  }

  // Costing standard version stamped in the file.
  const stdText = labelledValue(ins, NEEDS_INSTRUCTION_LABELS.costingStandardVersion);
  const stdNum = stdText ? parseSheetNumber(stdText) : null;
  const costingStandardVersion = isNum(stdNum) && Number.isInteger(stdNum) && stdNum > 0 ? stdNum : null;
  if (ctx.costingStandard && costingStandardVersion !== null && costingStandardVersion !== ctx.costingStandard.version) {
    c.warn(
      S.INSTRUCTIONS,
      null,
      NEEDS_INSTRUCTION_LABELS.costingStandardVersion,
      `The file was made with costing standard version ${costingStandardVersion}; the cycle uses version ${ctx.costingStandard.version}. Rates are compared with version ${ctx.costingStandard.version}.`
    );
  }

  // Project
  const values: Partial<Record<NeedsProjectFieldKey, { text: string; row: number }>> = {};
  if (sheets.project) {
    const byLabel = new Map<string, NeedsProjectFieldKey>(NEEDS_PROJECT_FIELDS.map((f) => [normHeader(f.label), f.key]));
    sheets.project.eachRow((row, n) => {
      const key = byLabel.get(normHeader(cellText(cellValue(row.getCell(1).value))));
      if (!key) return;
      const v = cellText(cellValue(row.getCell(2).value));
      if (v) values[key] = { text: v, row: n };
    });
  }
  const rowOf = (k: NeedsProjectFieldKey) => values[k]?.row ?? null;
  const textOf = (k: NeedsProjectFieldKey) => values[k]?.text ?? null;
  const interventionYear = checkYear(c, textOf('interventionYear'), ctx, rowOf('interventionYear'));
  const stateCheck = checkState(c, textOf('state'), ctx, rowOf('state'));
  let stateCode = stateCheck.stateCode;

  // Sites (LGAs read against the State; a Direct Intervention file without a State may get one from its LGAs)
  const siteNumbersSeen = new Set<number>();
  const sites: ProposalSite[] = [];
  if (sheets.sites) {
    const t = readTable(sheets.sites, S.SITES, ['Site no.', 'School name', 'School level', 'LGA'], c.sheetIssues);
    c.flushSheetIssues();
    const rows = t?.rows ?? [];
    // DI without a State: the LGAs (unique names or codes) must agree on one.
    if (!stateCode && !stateCheck.unknown) {
      const found = new Set<string>();
      let unresolved = false;
      for (const r of rows) {
        const lgaText = cellText(r.get('LGA'));
        if (!lgaText) continue;
        const l = resolveLgaText(lgaText, null);
        if ('lga' in l) found.add(l.lga.stateCode);
        else unresolved = true;
      }
      if (found.size === 1 && !unresolved) {
        stateCode = [...found][0];
        c.warn(S.PROJECT, rowOf('state'), projectLabel('state'), `No State given: ${stateByCode(stateCode)!.name} is taken from the sites' LGAs.`);
      } else {
        c.issue(S.PROJECT, rowOf('state'), projectLabel('state'), 'Choose the State on the Project sheet.');
      }
    }
    const lgaState = stateCode;
    for (const r of rows) {
      let ok = true;
      const bad = (column: string, reason: string) => {
        c.issue(S.SITES, r.row, column, reason);
        ok = false;
      };
      const number = parseSheetNumber(r.get('Site no.'));
      if (!isNum(number) || !Number.isInteger(number) || number < 1) bad('Site no.', 'Number the sites 1, 2, 3…');
      else if (siteNumbersSeen.has(number)) bad('Site no.', `Site ${number} appears twice.`);
      if (isNum(number)) siteNumbersSeen.add(number);
      const schoolName = cellText(r.get('School name'));
      if (schoolName.length < 3) bad('School name', 'Enter the school name.');
      else if (schoolName.length > 200) bad('School name', 'The school name is longer than 200 characters.');
      const levelText = cellText(r.get('School level'));
      const schoolLevel: SchoolLevel | null = parseSchoolLevel(levelText);
      if (!levelText) bad('School level', 'Choose the school level.');
      else if (!schoolLevel) bad('School level', `"${levelText}" is not a school level (ECCDE, Primary or Junior Secondary (JSS)).`);
      const lgaText = cellText(r.get('LGA'));
      let lga: NigeriaLga | null = null;
      if (!lgaText) bad('LGA', 'Choose the LGA.');
      else if (lgaState || stateCheck.unknown === false) {
        const found = resolveLgaText(lgaText, lgaState);
        if ('lga' in found) lga = found.lga;
        else bad('LGA', found.message);
      }
      const address = t?.columns.has(normHeader('Address')) ? cellText(r.get('Address')) : '';
      if (address.length > 300) bad('Address', 'The address is longer than 300 characters.');
      const coord = (column: 'Latitude' | 'Longitude', max: number) => {
        if (!t?.columns.has(normHeader(column))) return null;
        const raw = r.get(column);
        if (isBlank(raw)) return null;
        const n = parseSheetNumber(raw);
        if (!isNum(n) || Math.abs(n) > max) {
          bad(column, `"${cellText(raw)}" is not a ${column.toLowerCase()} in decimal degrees.`);
          return null;
        }
        return n;
      };
      const latitude = coord('Latitude', 90);
      const longitude = coord('Longitude', 180);
      if (ok && (latitude === null) !== (longitude === null)) bad('Latitude', 'Enter both the latitude and the longitude, or neither.');
      let enrolment: number | null = null;
      const enrolRaw = t?.columns.has(normHeader('Enrolment')) ? r.get('Enrolment') : '';
      if (!isBlank(enrolRaw)) {
        const n = parseSheetNumber(enrolRaw);
        if (!isNum(n) || !Number.isInteger(n) || n < 0) bad('Enrolment', `"${cellText(enrolRaw)}" is not a number of pupils.`);
        else enrolment = n;
      }
      if (ok && lga && schoolLevel && isNum(number)) {
        sites.push({ siteNumber: number, schoolName, schoolLevel, lgaCode: lga.code, address: address || null, latitude, longitude, enrolment });
      }
    }
    sites.sort((a, b) => a.siteNumber - b.siteNumber);
    if (siteNumbersSeen.size > NEEDS_SITES_MAX) c.issue(S.SITES, null, null, `A proposed project has up to ${NEEDS_SITES_MAX} sites.`);
    const numbers = [...siteNumbersSeen].sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1)) c.issue(S.SITES, null, 'Site no.', 'Number the sites 1, 2, 3… with no gaps.');
  }
  const zone = zoneOfState(stateCode);

  // Facilities breakdown
  const resolveFacility = facilityResolver(ctx.facilities);
  const breakdown: FacilityBreakdownRow[] = [];
  const unitIdsSeen = new Map<string, number>();
  const proposedQtyByUnit = new Map<string, number | null>();
  if (sheets.breakdown) {
    const B = FACILITY_BREAKDOWN_COLUMNS;
    const required = [B.unitId, B.siteNumber, B.facilityCode, B.interventionAction, B.existingQuantity, B.existingCondition, B.requiredQuantity, B.proposedQuantity, B.unitOfMeasure, B.technicalJustification, B.criticality];
    const t = readTable(sheets.breakdown, S.BREAKDOWN, required, c.sheetIssues);
    c.flushSheetIssues();
    const drafts: BreakdownRowDraft[] = [];
    const num = (raw: unknown) => {
      const n = parseSheetNumber(raw);
      return n === null ? null : n;
    };
    for (const r of t?.rows ?? []) {
      const facilityText = cellText(r.get(B.facilityCode));
      const facility = resolveFacility(facilityText);
      const actionText = cellText(r.get(B.interventionAction));
      const conditionText = cellText(r.get(B.existingCondition));
      const priorityText = cellText(r.get(B.criticality));
      const uomText = cellText(r.get(B.unitOfMeasure));
      const costRaw = t?.columns.has(normHeader(B.preliminaryCostNgn)) ? r.get(B.preliminaryCostNgn) : '';
      const draft: BreakdownRowDraft = {
        row: r.row,
        unitId: cellText(r.get(B.unitId)),
        siteNumber: num(r.get(B.siteNumber)),
        facilityCode: facility ? facility.code : facilityText,
        interventionAction: enumFrom(actionText, INTERVENTION_ACTION_LABELS) ?? actionText,
        existingQuantity: num(r.get(B.existingQuantity)),
        existingCondition: enumFrom(conditionText, EXISTING_CONDITION_LABELS) ?? conditionText,
        requiredQuantity: num(r.get(B.requiredQuantity)),
        proposedQuantity: num(r.get(B.proposedQuantity)),
        unitOfMeasure: normalizeUnitOfMeasure(uomText) ?? uomText,
        preliminaryCostNgn: isBlank(costRaw) ? null : num(costRaw),
        technicalJustification: cellText(r.get(B.technicalJustification)),
        criticality: enumFrom(priorityText, FACILITY_CRITICALITY_LABELS) ?? priorityText,
        supportingEvidence: t?.columns.has(normHeader(B.supportingEvidence)) ? cellText(r.get(B.supportingEvidence)) || null : null,
      };
      drafts.push(draft);
      const unitId = (draft.unitId ?? '').toUpperCase();
      if (unitId && !unitIdsSeen.has(unitId)) unitIdsSeen.set(unitId, r.row);
      if (unitId) proposedQtyByUnit.set(unitId, isNum(draft.proposedQuantity ?? null) ? draft.proposedQuantity! : null);
    }
    if (drafts.length > NEEDS_BREAKDOWN_ROWS_MAX) c.issue(S.BREAKDOWN, null, null, `A proposed project has up to ${NEEDS_BREAKDOWN_ROWS_MAX} breakdown rows.`);
    const rowIssues = validateBreakdownRows(
      drafts,
      [...siteNumbersSeen].map((siteNumber) => ({ siteNumber })),
      ctx.facilities.map((f) => ({ code: f.code, name: f.name, isRetired: f.isRetired }))
    );
    for (const i of rowIssues) c.issue(S.BREAKDOWN, i.row, i.column, i.reason);
    const badRows = new Set(rowIssues.map((i) => i.row));
    for (const d of drafts) {
      const text = (v: string | null | undefined) => (v ?? '').trim();
      if (text(d.technicalJustification).length > 2000) {
        c.issue(S.BREAKDOWN, d.row, B.technicalJustification, 'Longer than 2,000 characters.');
        continue;
      }
      if (text(d.supportingEvidence).length > 1000) {
        c.issue(S.BREAKDOWN, d.row, B.supportingEvidence, 'Longer than 1,000 characters.');
        continue;
      }
      if (badRows.has(d.row)) continue;
      breakdown.push({
        unitId: text(d.unitId).toUpperCase(),
        siteNumber: d.siteNumber!,
        facilityCode: text(d.facilityCode).toUpperCase(),
        interventionAction: d.interventionAction as FacilityBreakdownRow['interventionAction'],
        existingQuantity: d.existingQuantity!,
        existingCondition: d.existingCondition as FacilityBreakdownRow['existingCondition'],
        requiredQuantity: d.requiredQuantity!,
        proposedQuantity: d.proposedQuantity!,
        unitOfMeasure: d.unitOfMeasure as FacilityBreakdownRow['unitOfMeasure'],
        preliminaryCostNgn: d.preliminaryCostNgn ?? null,
        technicalJustification: text(d.technicalJustification),
        criticality: d.criticality as FacilityBreakdownRow['criticality'],
        supportingEvidence: d.supportingEvidence ?? null,
        evidenceDocumentIds: [],
      });
    }
  }

  // BoQ
  const std = ctx.costingStandard?.standard ?? null;
  const lines: NeedsBoqLine[] = [];
  if (sheets.boq) {
    const t = readTable(sheets.boq, S.BOQ, ['Item no.', 'Unit ID', 'Description', 'Unit of measure', 'Quantity', 'Rate'], c.sheetIssues, ['Amount', 'Rate']);
    c.flushSheetIssues();
    const itemNos = new Map<string, number>();
    const hasItemCode = t?.columns.has(normHeader('Item code')) ?? false;
    for (const r of t?.rows ?? []) {
      let ok = true;
      const bad = (column: string, reason: string) => {
        c.issue(S.BOQ, r.row, column, reason);
        ok = false;
      };
      const wbsCode = cellText(r.get('Item no.'));
      if (!wbsCode) bad('Item no.', 'Enter the item no.');
      else if (wbsCode.length > 32) bad('Item no.', 'The item no. is longer than 32 characters.');
      else if (itemNos.has(wbsCode)) bad('Item no.', `Item no. ${wbsCode} is also on row ${itemNos.get(wbsCode)}.`);
      else itemNos.set(wbsCode, r.row);

      const unitId = cellText(r.get('Unit ID')).toUpperCase();
      if (!unitId) bad('Unit ID', 'Choose the Unit ID of the breakdown row the line belongs to.');
      else if (!UNIT_ID_REGEX.test(unitId)) bad('Unit ID', `"${unitId}" is not a valid Unit ID.`);
      else if (!unitIdsSeen.has(unitId)) bad('Unit ID', `Unit ID ${unitId} is not on the ${S.BREAKDOWN} sheet.`);
      else if (proposedQtyByUnit.get(unitId) === 0) bad('Unit ID', `Unit ${unitId} proposes no work (proposed quantity 0): it cannot have BoQ lines.`);

      const itemCodeText = hasItemCode ? cellText(r.get('Item code')).toUpperCase() : '';
      const itemCode = itemCodeText || null;
      const stdRate = std && itemCode ? std.rates.find((x) => x.itemCode === itemCode) ?? null : null;
      if (itemCode && !ITEM_CODE_REGEX.test(itemCode)) bad('Item code', `"${itemCode}" is not a valid item code.`);
      else if (itemCode && std && !stdRate) {
        c.warn(S.BOQ, r.row, 'Item code', `${itemCode} is not in costing standard version ${ctx.costingStandard!.version}: the rate is not compared with the standard.`);
      }

      let description = cellText(r.get('Description'));
      if (!description && stdRate) description = stdRate.description;
      if (description.length < 3) bad('Description', 'Enter a description of at least 3 characters.');
      else if (description.length > 600) bad('Description', 'The description is longer than 600 characters.');

      const uomText = cellText(r.get('Unit of measure'));
      const unit = normalizeUnitOfMeasure(uomText) ?? (!uomText && stdRate ? stdRate.unitOfMeasure : null);
      if (!uomText && !unit) bad('Unit of measure', 'Choose the unit of measure.');
      else if (!unit) bad('Unit of measure', `"${uomText}" is not a unit of measure on the list.`);

      const qty = parseSheetNumber(r.get('Quantity'));
      if (qty === null) bad('Quantity', 'Enter the quantity.');
      else if (!isNum(qty) || qty <= 0) bad('Quantity', `"${cellText(r.get('Quantity'))}" is not a quantity above zero.`);

      let rate = parseSheetNumber(r.get('Rate'));
      if (rate === null && stdRate && std) {
        rate = standardRateFor(std, itemCode, zone);
        c.warn(S.BOQ, r.row, 'Rate', `No rate given: the standard rate for ${itemCode} (${rate?.toLocaleString('en-GB')}) is used.`);
      }
      if (rate === null) bad('Rate', 'Enter the rate.');
      else if (!isNum(rate) || rate < 0) bad('Rate', `"${cellText(r.get('Rate'))}" is not a rate of zero or more.`);
      if (!ok) continue;

      const amount = lineAmount(qty!, rate!);
      const sheetAmount = t?.columns.has(normHeader('Amount')) ? parseSheetNumber(r.get('Amount')) : null;
      if (isNum(sheetAmount) && Math.abs(sheetAmount - amount) > 0.01) {
        c.warn(S.BOQ, r.row, 'Amount', `The sheet says ${sheetAmount.toLocaleString('en-GB')}; quantity × rate is ${amount.toLocaleString('en-GB')}, which is used.`);
      }
      lines.push({ wbsCode, unitId, itemCode, description, unit: unit!, totalQuantity: qty!, rateNgn: rate!, amountNgn: amount });
    }
    if ((t?.rows.length ?? 0) > NEEDS_BOQ_LINES_MAX) c.issue(S.BOQ, null, null, `A proposed project has up to ${NEEDS_BOQ_LINES_MAX} BoQ lines.`);
  }

  // Breakdown rows with lines cost their lines' total.
  for (const row of breakdown) row.preliminaryCostNgn = breakdownRowCost(row, lines);

  // Costing summary: the file's percentages (blank = 0), amounts recomputed.
  let smPct = 0;
  let contPct = 0;
  if (sheets.costing) {
    const readPct = (label: string): number => {
      let raw: unknown = '';
      let at: number | null = null;
      sheets.costing!.eachRow((row, n) => {
        if (normHeader(cellText(cellValue(row.getCell(1).value))) === normHeader(label)) {
          raw = cellValue(row.getCell(2).value);
          at = n;
        }
      });
      const p = readPercent(raw);
      if (p === null) return 0;
      if (!isNum(p) || p < 0 || p > 100) {
        c.issue(S.COSTING, at, label, `"${cellText(raw)}" is not a percentage from 0 to 100.`);
        return 0;
      }
      return p;
    };
    smPct = readPct(NEEDS_COSTING_ROWS.smPct);
    contPct = readPct(NEEDS_COSTING_ROWS.contingencyPct);
  }

  const project: ParsedNeedsProject = {
    title: textField(c, textOf('title'), 300, S.PROJECT, rowOf('title'), projectLabel('title')),
    programme: textField(c, textOf('programme'), 120, S.PROJECT, rowOf('programme'), projectLabel('programme')),
    interventionYear,
    stateCode,
    justification: textField(c, textOf('justification'), 8000, S.PROJECT, rowOf('justification'), projectLabel('justification')),
    assumptions: textField(c, textOf('assumptions'), 8000, S.PROJECT, rowOf('assumptions'), projectLabel('assumptions')),
    beneficiaries: textField(c, textOf('beneficiaries'), 2000, S.PROJECT, rowOf('beneficiaries'), projectLabel('beneficiaries')),
    estimatedDurationMonths: durationField(c, textOf('estimatedDurationMonths'), rowOf('estimatedDurationMonths')),
  };
  const draft: ParsedNeedsAssessment = {
    templateVersion: NEEDS_TEMPLATE_VERSION,
    costingStandardVersion,
    project,
    sites,
    breakdownRows: breakdown,
    boqLines: lines,
    costingSummary: summaryOf(lines, ctx, zone, smPct, contPct),
  };
  checkMinimumFields(
    c,
    draft,
    ctx.requiredFields.filter((f) => f !== 'DRAWINGS')
  );
  return finish(c, draft, NEEDS_TEMPLATE_VERSION, false);
}

// ---------------------------------------------------------------------------
// Old files (A3): a v1 scope workbook, read at Identification only
// ---------------------------------------------------------------------------

const ARCHETYPE_BY_CODE = new Map<string, FacilityArchetype>(DEFAULT_FACILITIES.map((f) => [f.code, f.archetype]));

export const LEGACY_TEMPLATE_WARNING =
  'Old template: this file was made with the earlier needs assessment template. It is read at Identification only, without the intervention and facilities breakdown: upload the v2 template before Validation.';

async function parseLegacy(buffer: Buffer, ctx: NeedsWorkbookParseContext): Promise<NeedsWorkbookParseResult> {
  const c = collector();
  // The catalogue has no archetype here: the default catalogue's, else building works (no quantity rule).
  const v1 = await parseScopeWorkbook(buffer, {
    facilities: ctx.facilities.map((f) => ({ ...f, archetype: ARCHETYPE_BY_CODE.get(f.code.toUpperCase()) ?? 'BUILDING_WORKS' })),
    stateCode: ctx.cycleStateCode,
  });
  c.warn(S.INSTRUCTIONS, null, NEEDS_INSTRUCTION_LABELS.version, LEGACY_TEMPLATE_WARNING);
  for (const i of v1.issues) c.issue(i.sheet, i.row, i.column, i.message);
  // Warnings about project activation, sprints and units do not apply to a proposed project.
  for (const w of v1.warnings) if (w.code === 'AMOUNT_RECOMPUTED' || w.code === 'UNKNOWN_STATE') c.warn(w.sheet, w.row, w.column, w.message);

  const yearText = v1.project.interventionYear ?? null;
  const interventionYear = checkYear(c, yearText, ctx, null);
  const stateText = v1.project.state ?? null;
  const stateCheck = checkState(c, stateText, ctx, null);
  let stateCode = stateCheck.stateCode;
  if (!stateCode && !stateCheck.unknown) {
    const states = new Set(v1.sites.map((s) => s.lgaCode.slice(0, 2)));
    if (states.size === 1) {
      stateCode = [...states][0];
      c.warn(S.PROJECT, null, 'State', `No State given: ${stateByCode(stateCode)?.name ?? stateCode} is taken from the sites' LGAs.`);
    } else c.issue(S.PROJECT, null, 'State', 'Choose the State on the Project sheet.');
  }
  // Sites read against the file's own State: in a Direct Intervention cycle every LGA must be in it.
  for (const s of v1.sites) {
    if (stateCode && !s.lgaCode.startsWith(`${stateCode}-`)) c.issue('Sites', s.row, 'LGA', `${s.lgaName} is not an LGA of ${stateByCode(stateCode)?.name ?? stateCode}.`);
  }
  const zone = zoneOfState(stateCode);
  const sites: ProposalSite[] = v1.sites.map((s) => ({
    siteNumber: s.siteNumber,
    schoolName: s.schoolName,
    schoolLevel: s.schoolLevel,
    lgaCode: s.lgaCode,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    enrolment: null,
  }));
  if (sites.length > NEEDS_SITES_MAX) c.issue('Sites', null, null, `A proposed project has up to ${NEEDS_SITES_MAX} sites.`);
  const lines: NeedsBoqLine[] = v1.lines.map((l) => ({
    wbsCode: l.wbsCode,
    unitId: l.unitCode,
    itemCode: null,
    description: l.description,
    unit: l.unit as NeedsBoqLine['unit'],
    totalQuantity: l.totalQuantity,
    rateNgn: l.rateNgn,
    amountNgn: l.amountNgn,
  }));
  if (lines.length > NEEDS_BOQ_LINES_MAX) c.issue('BoQ', null, null, `A proposed project has up to ${NEEDS_BOQ_LINES_MAX} BoQ lines.`);
  // The v1 file has no costing summary: the cycle's standard percentages apply.
  const std = ctx.costingStandard?.standard ?? null;
  const project: ParsedNeedsProject = {
    title: textField(c, v1.project.name ?? null, 300, S.PROJECT, null, 'Project name'),
    programme: textField(c, v1.project.deliveryModel ?? null, 120, S.PROJECT, null, 'Delivery model'),
    interventionYear,
    stateCode,
    justification: textField(c, v1.project.strategicJustification ?? null, 8000, S.PROJECT, null, 'Strategic justification'),
    assumptions: textField(c, v1.project.assumptions ?? null, 8000, S.PROJECT, null, 'Assumptions'),
    beneficiaries: null,
    estimatedDurationMonths: null,
  };
  const draft: ParsedNeedsAssessment = {
    templateVersion: SCOPE_WORKBOOK_VERSION,
    costingStandardVersion: null,
    project,
    sites,
    breakdownRows: [],
    boqLines: lines,
    costingSummary: summaryOf(lines, ctx, zone, std?.supervisionMonitoringPct ?? 0, std?.contingencyPct ?? 0),
  };
  checkMinimumFields(
    c,
    draft,
    ctx.requiredFields.filter((f) => f !== 'DRAWINGS' && f !== 'BREAKDOWN')
  );
  return finish(c, draft, SCOPE_WORKBOOK_VERSION, true);
}

