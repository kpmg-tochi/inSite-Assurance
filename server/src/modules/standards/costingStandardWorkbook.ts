import ExcelJS from 'exceljs';
import {
  COSTING_RATES_MAX,
  COSTING_STANDARD_TEMPLATE_VERSION,
  CostingStandardSchema,
  INTERVENTION_ACTION_LABELS,
  InterventionActionEnum,
  NIGERIA_ZONES,
  normalizeUnitOfMeasure,
  parseSheetNumber,
  UNITS_OF_MEASURE,
  type CostingCeiling,
  type CostingStandard,
  type CostingStandardRate,
  type CostingZoneFactors,
  type InterventionAction,
  type NeedsFileIssue,
} from '@insite/shared';
import {
  CELL_BOX,
  decimalValidation,
  headerRow,
  hideListsSheet,
  listRange,
  listValidation,
  metaRow,
  MONEY_FMT,
  sectionRow,
  SHEET_FONT,
  solidFill,
  stepRows,
  tableBody,
  titleBand,
  UBEC_SHEET_COLOR,
  UBEC_SHEET_FIRST_DATA_ROW,
  UBEC_SHEET_HEADER_ROW,
  type BodyColumn,
} from '../../utils/ubecSheetStyle';
import { cellText, cellValue, findSheet, isBlank, labelledValue, loadWorkbook, normHeader, readTable, type SheetIssue } from '../../utils/sheetReader';

/** A text cell that is an amount: optional currency sign, thousands separators, decimals, optional %. */
const AMOUNT_TEXT = /^\s*(?:₦|NGN|N)?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s*%?\s*$/i;

/**
 * Rates, factors, percentages and ceilings must be numbers. The lenient register reader
 * (`parseSheetNumber`) strips every other character, so "about 85k" would read as 85; here a text
 * cell that is not an amount is an issue (NaN).
 */
function strictSheetNumber(raw: unknown): number | null {
  if (typeof raw === 'string' && (!AMOUNT_TEXT.test(raw) || !/\d/.test(raw))) return NaN;
  return parseSheetNumber(raw);
}

/**
 * Needs pipeline wave 2 (N2, D-N.8): the costing standard workbook (pure, no database).
 * - `buildCostingStandardWorkbook`: Instructions (version stamp `INSITE-COSTING-v1`, the version the
 *   file was built from, the rules), Rates, Zone factors, Settings, Ceilings and a hidden Lists sheet
 *   for the dropdowns (facility codes, units of measure, intervention actions). Pre-filled from a
 *   version, or blank (zone factors 1) when the tenant has none.
 * - `parseCostingStandardWorkbook`: reads a filled file back into a `CostingStandard` with every rule
 *   that needs no database beyond the tenant's facility codes (passed in). Issues carry sheet, row,
 *   column and reason; any issue means no standard.
 */

export const COSTING_STANDARD_SHEETS = {
  instructions: 'Instructions',
  rates: 'Rates',
  zoneFactors: 'Zone factors',
  settings: 'Settings',
  ceilings: 'Ceilings',
  lists: 'Lists',
} as const;
const S = COSTING_STANDARD_SHEETS;

export const COSTING_RATE_HEADERS = {
  itemCode: 'Item code',
  description: 'Description',
  facilityCode: 'Facility code',
  unit: 'Unit',
  rate: 'Rate (₦)',
} as const;

export const COSTING_ZONE_HEADERS = { code: 'Zone code', name: 'Zone', factor: 'Factor' } as const;

export const COSTING_SETTINGS_LABELS = {
  supervisionMonitoringPct: 'Supervision and monitoring %',
  contingencyPct: 'Contingency %',
} as const;

export const COSTING_CEILING_HEADERS = {
  facilityCode: 'Facility code',
  interventionAction: 'Intervention action',
  max: 'Max ₦ per unit',
} as const;

/** Label on the Instructions sheet naming the version the file was built from. */
export const BUILT_FROM_LABEL = 'Built from';

const HR = UBEC_SHEET_HEADER_ROW;
const FR = UBEC_SHEET_FIRST_DATA_ROW;
/** Pre-sized rows with dropdowns beyond the filled ones. */
const SPARE_ROWS = 200;

/** "UBEC costing standard v3.xlsx"; "UBEC costing standard.xlsx" before the first version. */
export function costingStandardFileName(shortName: string | null, version: number | null): string {
  const base = shortName ? `${shortName} costing standard` : 'Costing standard';
  return `${base}${version !== null ? ` v${version}` : ''}.xlsx`;
}

export interface CostingStandardWorkbookData {
  generatedAt: Date;
  /** Short workspace name for the title bands (e.g. "UBEC"). */
  brandName: string | null;
  /** The version the file is built from; null = blank structure. */
  version: number | null;
  standard: CostingStandard | null;
  /** The tenant's facility codes (dropdown), unretired first. */
  facilityCodes: string[];
}

const RATE_COLUMNS: Array<BodyColumn & { width: number }> = [
  { width: 18 },
  { width: 60, wrap: true },
  { width: 24 },
  { width: 10, align: 'center' },
  { width: 18, numFmt: MONEY_FMT, align: 'right' },
];

const CEILING_COLUMNS: Array<BodyColumn & { width: number }> = [
  { width: 24 },
  { width: 24 },
  { width: 20, numFmt: MONEY_FMT, align: 'right' },
];

function labelCell(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: SHEET_FONT, bold: true, color: { argb: UBEC_SHEET_COLOR.ink } };
  cell.fill = solidFill(UBEC_SHEET_COLOR.label);
  cell.border = CELL_BOX;
  cell.alignment = { vertical: 'middle', indent: 1 };
  cell.protection = { locked: true };
}

function noteCell(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: SHEET_FONT, italic: true, size: 10, color: { argb: UBEC_SHEET_COLOR.calcText } };
  cell.border = CELL_BOX;
  cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
}

export async function buildCostingStandardWorkbook(data: CostingStandardWorkbookData): Promise<Buffer> {
  const brand = data.brandName;
  const title = `${brand ? `${brand} · ` : ''}Costing standard`;
  const standard = data.standard;
  const actionLabels = InterventionActionEnum.options.map((a) => INTERVENTION_ACTION_LABELS[a]);
  const unitCodes = UNITS_OF_MEASURE.map((u) => u.code);
  const wb = new ExcelJS.Workbook();
  wb.creator = brand ?? 'InSite Assurance';
  wb.created = data.generatedAt;
  wb.title = title;

  // Instructions
  const ins = wb.addWorksheet(S.instructions, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.navy } } });
  ins.columns = [{ width: 30 }, { width: 100 }];
  ins.views = [{ showGridLines: false }];
  titleBand(
    ins,
    2,
    title,
    'The rates, zone factors, supervision and contingency percentages and cost ceilings that needs assessments are costed against. Upload it on the Standards page; you will see what changes before anything is saved.'
  );
  metaRow(ins, 4, 'Version', COSTING_STANDARD_TEMPLATE_VERSION);
  metaRow(ins, 5, BUILT_FROM_LABEL, data.version !== null ? `Version ${data.version}` : 'No version yet (blank)');
  metaRow(ins, 6, 'Generated', data.generatedAt.toISOString().slice(0, 10));
  sectionRow(ins, 8, 'How to fill it in');
  const steps = [
    `${S.rates}: one row per rated item. The item code is the key (up to 40 capital letters, digits, dots, dashes or underscores) and must be unique. Facility code: pick the facility the item belongs to, or leave it blank for an item used across facilities. Unit: pick from the list. Rate: the base rate in naira, before the zone factor.`,
    `${S.zoneFactors}: the multiplier on every rate in each geopolitical zone (1 = the base rate; up to 10). Keep the six zone rows.`,
    `${S.settings}: the supervision and monitoring line and the contingency, each as a percentage of the works subtotal (0–100).`,
    `${S.ceilings}: the most one unit of a facility may cost. Leave the intervention action blank for a ceiling that applies to every action without its own ceiling. A facility and action may be listed once.`,
    'Keep the title rows and the green header rows; do not rename the sheets or the headers.',
    'Saving: while no cycle or needs assessment uses the latest version, it is edited in place; once one does, the upload becomes the next version and the earlier one stays as it was.',
    'The whole file is saved or nothing is: fix every error shown and upload it again.',
  ];
  stepRows(ins, 9, steps);

  // Lists (moved to the end, hidden)
  const lists = wb.addWorksheet(S.lists);
  lists.columns = [
    { header: 'Facility codes', width: 28 },
    { header: 'Units', width: 12 },
    { header: 'Intervention actions', width: 24 },
  ];
  data.facilityCodes.forEach((v, i) => (lists.getCell(`A${i + 2}`).value = v));
  unitCodes.forEach((v, i) => (lists.getCell(`B${i + 2}`).value = v));
  actionLabels.forEach((v, i) => (lists.getCell(`C${i + 2}`).value = v));
  const ref = (col: string, n: number) => `${S.lists}!${listRange(col, n)}`;

  // Rates
  const rates = wb.addWorksheet(S.rates, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  const rateHeaders = Object.values(COSTING_RATE_HEADERS);
  titleBand(rates, rateHeaders.length, `${title} · ${S.rates}`, 'One row per rated item. Rates are base rates in naira, before the zone factor.');
  headerRow(rates, rateHeaders, RATE_COLUMNS.map((c) => c.width));
  const rateRows = standard?.rates ?? [];
  const lastRate = HR + rateRows.length + SPARE_ROWS;
  tableBody(rates, RATE_COLUMNS, lastRate);
  for (let r = FR; r <= lastRate; r++) {
    if (data.facilityCodes.length) rates.getCell(r, 3).dataValidation = listValidation(ref('A', data.facilityCodes.length), 'Choose a facility code from the list, or leave it blank.');
    rates.getCell(r, 4).dataValidation = listValidation(ref('B', unitCodes.length), 'Choose a unit from the list.');
    rates.getCell(r, 5).dataValidation = decimalValidation(0, 'Enter the rate in naira as a number.');
  }
  rateRows.forEach((rate, i) => {
    const r = FR + i;
    rates.getCell(r, 1).value = rate.itemCode;
    rates.getCell(r, 2).value = rate.description;
    rates.getCell(r, 3).value = rate.facilityCode;
    rates.getCell(r, 4).value = rate.unitOfMeasure;
    rates.getCell(r, 5).value = rate.rateNgn;
  });
  rates.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: rateHeaders.length } };

  // Zone factors
  const zones = wb.addWorksheet(S.zoneFactors, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  const zoneHeaders = Object.values(COSTING_ZONE_HEADERS);
  titleBand(zones, zoneHeaders.length, `${title} · ${S.zoneFactors}`, 'The multiplier on every rate per zone (1 = the base rate).');
  headerRow(zones, zoneHeaders, [14, 24, 12]);
  tableBody(zones, [{ calculated: true }, { calculated: true }, { numFmt: '0.00', align: 'right' }], HR + NIGERIA_ZONES.length);
  NIGERIA_ZONES.forEach((zone, i) => {
    const r = FR + i;
    zones.getCell(r, 1).value = zone.code;
    zones.getCell(r, 2).value = zone.name;
    zones.getCell(r, 3).value = standard ? standard.zoneFactors[zone.code as keyof CostingZoneFactors] : 1;
    zones.getCell(r, 3).dataValidation = {
      type: 'decimal',
      operator: 'between',
      allowBlank: false,
      formulae: [0.01, 10],
      showErrorMessage: true,
      error: 'Enter a factor above 0 and at most 10.',
    };
  });

  // Settings
  const settings = wb.addWorksheet(S.settings, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  titleBand(settings, 3, `${title} · ${S.settings}`, 'Percentages of the works subtotal.');
  headerRow(settings, ['Field', 'Value', 'Notes'], [32, 16, 80]);
  const settingRows: Array<[string, number, string]> = [
    [COSTING_SETTINGS_LABELS.supervisionMonitoringPct, standard?.supervisionMonitoringPct ?? 0, 'Required. The supervision and monitoring line every needs assessment must carry (0–100).'],
    [COSTING_SETTINGS_LABELS.contingencyPct, standard?.contingencyPct ?? 0, 'Required. The contingency on the works subtotal (0–100).'],
  ];
  settingRows.forEach(([label, value, note], i) => {
    const r = FR + i;
    labelCell(settings.getCell(r, 1), label);
    const b = settings.getCell(r, 2);
    b.value = value;
    b.border = CELL_BOX;
    b.numFmt = '0.00';
    b.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    b.protection = { locked: false };
    b.dataValidation = { type: 'decimal', operator: 'between', allowBlank: false, formulae: [0, 100], showErrorMessage: true, error: 'Enter a percentage from 0 to 100.' };
    noteCell(settings.getCell(r, 3), note);
    settings.getRow(r).height = 22;
  });

  // Ceilings
  const ceilings = wb.addWorksheet(S.ceilings, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  const ceilingHeaders = Object.values(COSTING_CEILING_HEADERS);
  titleBand(ceilings, ceilingHeaders.length, `${title} · ${S.ceilings}`, 'The most one unit of a facility may cost. Blank intervention action: every action without its own ceiling.');
  headerRow(ceilings, ceilingHeaders, CEILING_COLUMNS.map((c) => c.width));
  const ceilingRows = standard?.ceilings ?? [];
  const lastCeiling = HR + ceilingRows.length + 50;
  tableBody(ceilings, CEILING_COLUMNS, lastCeiling);
  for (let r = FR; r <= lastCeiling; r++) {
    if (data.facilityCodes.length) ceilings.getCell(r, 1).dataValidation = listValidation(ref('A', data.facilityCodes.length), 'Choose a facility code from the list.');
    ceilings.getCell(r, 2).dataValidation = listValidation(ref('C', actionLabels.length), 'Choose an intervention action from the list, or leave it blank.');
    ceilings.getCell(r, 3).dataValidation = decimalValidation(0, 'Enter the amount in naira as a number.');
  }
  ceilingRows.forEach((c, i) => {
    const r = FR + i;
    ceilings.getCell(r, 1).value = c.facilityCode;
    ceilings.getCell(r, 2).value = c.interventionAction ? INTERVENTION_ACTION_LABELS[c.interventionAction] : null;
    ceilings.getCell(r, 3).value = c.maxNgnPerUnit;
  });

  await hideListsSheet(wb, lists, S.lists);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Reading a filled file
// ---------------------------------------------------------------------------

export interface CostingStandardParseContext {
  /** Every facility code of the tenant's catalogue (retired included). */
  facilityCodes: ReadonlySet<string>;
}

export interface CostingStandardParseResult {
  /** Null while the file has issues. */
  standard: CostingStandard | null;
  issues: NeedsFileIssue[];
  warnings: NeedsFileIssue[];
  templateVersion: string | null;
  /** The version the file says it was built from ("Version 3" → 3), null when blank or unknown. */
  builtFromVersion: number | null;
}

const issueOf = (i: SheetIssue): NeedsFileIssue => ({ sheet: i.sheet, row: i.row, column: i.column, reason: i.message });

/** Intervention action from its label or code (case and punctuation ignored); undefined when unknown. */
export function parseInterventionAction(text: string): InterventionAction | undefined {
  const n = normHeader(text);
  return InterventionActionEnum.options.find((a) => normHeader(a) === n || normHeader(INTERVENTION_ACTION_LABELS[a]) === n);
}

function readRates(ws: ExcelJS.Worksheet, ctx: CostingStandardParseContext, issues: NeedsFileIssue[]): CostingStandardRate[] {
  const H = COSTING_RATE_HEADERS;
  const sheetIssues: SheetIssue[] = [];
  const table = readTable(ws, S.rates, Object.values(H), sheetIssues);
  issues.push(...sheetIssues.map(issueOf));
  if (!table) return [];
  const out: CostingStandardRate[] = [];
  const seen = new Map<string, number>();
  for (const r of table.rows) {
    const bad = (column: string, reason: string) => issues.push({ sheet: S.rates, row: r.row, column, reason: `Row ${r.row}: ${reason}` });
    const before = issues.length;
    const itemCode = cellText(r.get(H.itemCode)).toUpperCase();
    if (!itemCode) bad(H.itemCode, 'Enter the item code.');
    else if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(itemCode)) bad(H.itemCode, `"${itemCode}" is not an item code: use up to 40 capital letters, digits, dots, dashes or underscores.`);
    else if (seen.has(itemCode)) bad(H.itemCode, `The item code "${itemCode}" is also on row ${seen.get(itemCode)}.`);
    else seen.set(itemCode, r.row);

    const description = cellText(r.get(H.description)).replace(/\s+/g, ' ');
    if (description.length < 3) bad(H.description, 'Enter a description (at least 3 characters).');
    else if (description.length > 600) bad(H.description, 'The description is longer than 600 characters.');

    const facilityText = cellText(r.get(H.facilityCode)).toUpperCase();
    const facilityCode = facilityText || null;
    if (facilityCode && !ctx.facilityCodes.has(facilityCode)) bad(H.facilityCode, `"${facilityCode}" is not a facility code of this workspace.`);

    const unitText = cellText(r.get(H.unit));
    const unit = normalizeUnitOfMeasure(unitText);
    if (!unitText) bad(H.unit, 'Choose the unit.');
    else if (!unit) bad(H.unit, `"${unitText}" is not a unit on the list.`);

    const rateRaw = r.get(H.rate);
    let rateNgn: number | null = null;
    if (isBlank(rateRaw)) bad(H.rate, 'Enter the rate.');
    else {
      const n = strictSheetNumber(rateRaw);
      if (n === null || Number.isNaN(n) || n < 0) bad(H.rate, `The rate must be an amount of 0 or more ("${cellText(rateRaw)}").`);
      else if (n >= 1e14) bad(H.rate, 'The rate is too large.');
      else rateNgn = Math.round(n * 100) / 100;
    }
    if (issues.length === before) out.push({ itemCode, description, facilityCode, unitOfMeasure: unit!, rateNgn: rateNgn! });
  }
  if (table.rows.length > COSTING_RATES_MAX) {
    issues.push({ sheet: S.rates, row: null, column: null, reason: `The file has ${table.rows.length} rates; a standard may have at most ${COSTING_RATES_MAX}.` });
  }
  return out;
}

function readZoneFactors(ws: ExcelJS.Worksheet, issues: NeedsFileIssue[], warnings: NeedsFileIssue[]): CostingZoneFactors {
  const H = COSTING_ZONE_HEADERS;
  const sheetIssues: SheetIssue[] = [];
  const factors = Object.fromEntries(NIGERIA_ZONES.map((z) => [z.code, 1])) as CostingZoneFactors;
  const table = readTable(ws, S.zoneFactors, [H.code, H.factor], sheetIssues);
  issues.push(...sheetIssues.map(issueOf));
  if (!table) return factors;
  const found = new Set<string>();
  for (const r of table.rows) {
    const codeText = cellText(r.get(H.code));
    const nameText = cellText(r.get(H.name));
    const zone = NIGERIA_ZONES.find((z) => normHeader(z.code) === normHeader(codeText) || (nameText && normHeader(z.name) === normHeader(nameText)));
    if (!zone) {
      issues.push({ sheet: S.zoneFactors, row: r.row, column: H.code, reason: `Row ${r.row}: "${codeText || nameText}" is not a zone.` });
      continue;
    }
    if (found.has(zone.code)) {
      issues.push({ sheet: S.zoneFactors, row: r.row, column: H.code, reason: `Row ${r.row}: ${zone.name} is listed twice.` });
      continue;
    }
    found.add(zone.code);
    const raw = r.get(H.factor);
    const n = isBlank(raw) ? null : strictSheetNumber(raw);
    if (isBlank(raw)) issues.push({ sheet: S.zoneFactors, row: r.row, column: H.factor, reason: `Row ${r.row}: enter the factor for ${zone.name} (1 = the base rate).` });
    else if (n === null || Number.isNaN(n) || n <= 0 || n > 10) {
      issues.push({ sheet: S.zoneFactors, row: r.row, column: H.factor, reason: `Row ${r.row}: the factor for ${zone.name} must be above 0 and at most 10 ("${cellText(raw)}").` });
    } else factors[zone.code as keyof CostingZoneFactors] = n;
  }
  for (const zone of NIGERIA_ZONES) {
    if (!found.has(zone.code)) warnings.push({ sheet: S.zoneFactors, row: null, column: H.code, reason: `${zone.name} is not listed: its factor is 1.` });
  }
  return factors;
}

function readSettings(ws: ExcelJS.Worksheet, issues: NeedsFileIssue[]): { supervisionMonitoringPct: number; contingencyPct: number } {
  const out = { supervisionMonitoringPct: 0, contingencyPct: 0 };
  for (const key of Object.keys(COSTING_SETTINGS_LABELS) as Array<keyof typeof COSTING_SETTINGS_LABELS>) {
    const label = COSTING_SETTINGS_LABELS[key];
    let row: number | null = null;
    let raw: unknown = '';
    ws.eachRow((r, n) => {
      if (row === null && normHeader(cellText(cellValue(r.getCell(1).value))) === normHeader(label)) {
        row = n;
        raw = cellValue(r.getCell(2).value);
      }
    });
    if (row === null) {
      issues.push({ sheet: S.settings, row: null, column: label, reason: `The "${label}" row is missing.` });
      continue;
    }
    const n = isBlank(raw) ? null : strictSheetNumber(raw);
    if (isBlank(raw)) issues.push({ sheet: S.settings, row, column: label, reason: `Enter the ${label.toLowerCase().replace(' %', '')} percentage.` });
    else if (n === null || Number.isNaN(n) || n < 0 || n > 100) issues.push({ sheet: S.settings, row, column: label, reason: `${label} must be from 0 to 100 ("${cellText(raw)}").` });
    else out[key] = Math.round(n * 100) / 100;
  }
  return out;
}

function readCeilings(ws: ExcelJS.Worksheet, ctx: CostingStandardParseContext, issues: NeedsFileIssue[]): CostingCeiling[] {
  const H = COSTING_CEILING_HEADERS;
  const sheetIssues: SheetIssue[] = [];
  const table = readTable(ws, S.ceilings, Object.values(H), sheetIssues);
  issues.push(...sheetIssues.map(issueOf));
  if (!table) return [];
  const out: CostingCeiling[] = [];
  const seen = new Map<string, number>();
  for (const r of table.rows) {
    const bad = (column: string, reason: string) => issues.push({ sheet: S.ceilings, row: r.row, column, reason: `Row ${r.row}: ${reason}` });
    const before = issues.length;
    const facilityCode = cellText(r.get(H.facilityCode)).toUpperCase();
    if (!facilityCode) bad(H.facilityCode, 'Choose the facility code.');
    else if (!ctx.facilityCodes.has(facilityCode)) bad(H.facilityCode, `"${facilityCode}" is not a facility code of this workspace.`);
    const actionText = cellText(r.get(H.interventionAction));
    let interventionAction: InterventionAction | null = null;
    if (actionText) {
      const a = parseInterventionAction(actionText);
      if (!a) bad(H.interventionAction, `"${actionText}" is not an intervention action on the list.`);
      else interventionAction = a;
    }
    const raw = r.get(H.max);
    let max: number | null = null;
    if (isBlank(raw)) bad(H.max, 'Enter the most one unit may cost.');
    else {
      const n = strictSheetNumber(raw);
      if (n === null || Number.isNaN(n) || n <= 0) bad(H.max, `The ceiling must be an amount above 0 ("${cellText(raw)}").`);
      else if (n >= 1e14) bad(H.max, 'The ceiling is too large.');
      else max = Math.round(n * 100) / 100;
    }
    if (facilityCode) {
      const key = `${facilityCode}|${interventionAction ?? '*'}`;
      if (seen.has(key)) bad(H.facilityCode, `This ceiling is also on row ${seen.get(key)}.`);
      else seen.set(key, r.row);
    }
    if (issues.length === before) out.push({ facilityCode, interventionAction, maxNgnPerUnit: max! });
  }
  if (out.length > 500) issues.push({ sheet: S.ceilings, row: null, column: null, reason: 'A standard may have at most 500 ceilings.' });
  return out;
}

/** Reads a filled costing standard file. */
export async function parseCostingStandardWorkbook(buffer: Buffer, ctx: CostingStandardParseContext): Promise<CostingStandardParseResult> {
  const issues: NeedsFileIssue[] = [];
  const warnings: NeedsFileIssue[] = [];
  const result = (templateVersion: string | null, builtFromVersion: number | null, standard: CostingStandard | null): CostingStandardParseResult => ({
    standard: issues.length ? null : standard,
    issues,
    warnings,
    templateVersion,
    builtFromVersion,
  });
  const wb = new ExcelJS.Workbook();
  if (!(await loadWorkbook(wb, buffer))) {
    issues.push({ sheet: '', row: null, column: null, reason: 'This is not an .xlsx file. Download the costing standard and fill it in.' });
    return result(null, null, null);
  }
  const instructions = findSheet(wb, S.instructions);
  const version = labelledValue(instructions, 'Version');
  if (version !== COSTING_STANDARD_TEMPLATE_VERSION) {
    issues.push({
      sheet: S.instructions,
      row: null,
      column: 'Version',
      reason: !version
        ? 'This is not a costing standard file (no version stamp). Download the costing standard and fill it in.'
        : version.startsWith('INSITE-COSTING-')
          ? `This costing standard file is version "${version}"; this platform reads "${COSTING_STANDARD_TEMPLATE_VERSION}". Download it again.`
          : `This is not a costing standard file: it comes from another template ("${version}"). Download the costing standard and fill it in.`,
    });
    return result(version, null, null);
  }
  const builtFrom = /(\d+)/.exec(labelledValue(instructions, BUILT_FROM_LABEL) ?? '');
  const builtFromVersion = builtFrom ? Number(builtFrom[1]) : null;

  const sheets = {
    rates: findSheet(wb, S.rates),
    zoneFactors: findSheet(wb, S.zoneFactors),
    settings: findSheet(wb, S.settings),
    ceilings: findSheet(wb, S.ceilings),
  };
  for (const key of Object.keys(sheets) as Array<keyof typeof sheets>) {
    if (!sheets[key]) issues.push({ sheet: S[key], row: null, column: null, reason: `The "${S[key]}" sheet is missing.` });
  }
  if (!sheets.rates || !sheets.zoneFactors || !sheets.settings || !sheets.ceilings) return result(version, builtFromVersion, null);

  const rates = readRates(sheets.rates, ctx, issues);
  const zoneFactors = readZoneFactors(sheets.zoneFactors, issues, warnings);
  const settings = readSettings(sheets.settings, issues);
  const ceilings = readCeilings(sheets.ceilings, ctx, issues);
  if (rates.length === 0 && !issues.some((i) => i.sheet === S.rates)) {
    warnings.push({ sheet: S.rates, row: null, column: null, reason: 'The Rates sheet has no rates.' });
  }
  if (issues.length) return result(version, builtFromVersion, null);

  const parsed = CostingStandardSchema.safeParse({ rates, zoneFactors, ...settings, ceilings });
  if (!parsed.success) {
    for (const e of parsed.error.issues) {
      const [part, index] = e.path;
      const sheet = part === 'rates' ? S.rates : part === 'ceilings' ? S.ceilings : part === 'zoneFactors' ? S.zoneFactors : S.settings;
      issues.push({ sheet, row: typeof index === 'number' ? FR + index : null, column: null, reason: e.message });
    }
    return result(version, builtFromVersion, null);
  }
  return result(version, builtFromVersion, parsed.data);
}
