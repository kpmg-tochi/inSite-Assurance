import ExcelJS from 'exceljs';
import {
  FACILITY_ARCHETYPE_META,
  FUNDING_SOURCE_SUGGESTIONS,
  FacilityArchetype,
  lineAmount,
  normalizeUnitOfMeasure,
  SCOPE_WORKBOOK_COLUMNS,
  SCOPE_WORKBOOK_PROJECT_FIELDS,
  SCOPE_WORKBOOK_SHEETS,
  SCOPE_WORKBOOK_VERSION,
  ScopeWorkbookIssue,
  ScopeWorkbookProjectFieldKey,
  UNITS_OF_MEASURE,
  unitNeedsQuantity,
  validateSprints,
} from '@insite/shared';
import {
  CELL_BOX as BOX,
  DATE_FMT as DATE,
  DATE_VALIDATION,
  decimalValidation,
  headerRow,
  isoToDate,
  listRange as colRange,
  listValidation,
  MONEY_FMT as MONEY,
  QTY_FMT as QTY,
  setRow,
  SHEET_FONT as FONT,
  solidFill as solid,
  tableBody,
  titleBand,
  UBEC_SHEET_COLOR as COLOR,
  UBEC_SHEET_HEADER_ROW,
  wrappedHeight,
} from '../../../utils/ubecSheetStyle';
import { cellText as text, cellValue, findSheet, isBlank, normHeader, parseSheetDate, parseSheetNumber, readTable } from '../../../utils/sheetReader';

export { parseSheetDate, parseSheetNumber };

/**
 * Redesign R2c: the needs-assessment workbook as pure functions over plain data, so the Needs
 * Assessment module can build and read the same workbook without a project.
 * - buildScopeWorkbook: Instructions (version stamp), Project, Facility units, BoQ, Sprints and a
 *   hidden, protected Lists sheet that feeds the dropdowns. Users see it as the "Needs assessment
 *   template" (blank) or the project's "Needs assessment"; UBEC styling (title bands, brand headers,
 *   banded rows, protected Amount formula).
 * - parseScopeWorkbook: finds the header row and the columns by header name, checks the stamp and
 *   re-validates every row (dropdowns can be bypassed by pasting). Amounts are always recomputed.
 */

const S = SCOPE_WORKBOOK_SHEETS;

/** Rows that carry dropdowns and formulas beyond the pre-filled data. */
const ROWS = { units: 300, boq: 1000, sprints: 100 } as const;

export interface WorkbookFacility {
  id: string;
  code: string;
  name: string;
  archetype: FacilityArchetype;
  isRetired: boolean;
}

export interface WorkbookSprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  deliverables: string;
}

export interface WorkbookUnit {
  code: string;
  facilityName: string;
  label: string;
  plannedQuantity: number | null;
  quantityUnit: string | null;
  startSprint: number | null;
  endSprint: number | null;
}

export interface WorkbookLine {
  wbsCode: string;
  unitCode: string;
  description: string;
  unit: string;
  totalQuantity: number;
  rateNgn: number;
}

export interface WorkbookBuildData {
  generatedAt: Date;
  /** e.g. "PRG-101 · Kaduna Model School"; null for the blank needs-assessment template. */
  title: string | null;
  /** Short workspace name for the title bands (e.g. "UBEC"); omitted when the name is long. */
  brandName?: string | null;
  project: Partial<Record<ScopeWorkbookProjectFieldKey, string | number | null>>;
  /** Active facilities (the dropdown). */
  facilities: Array<Pick<WorkbookFacility, 'code' | 'name'>>;
  regions: string[];
  deliveryModels: string[];
  sprints: WorkbookSprint[];
  units: WorkbookUnit[];
  lines: WorkbookLine[];
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Layout of the data sheets (Project, Facility units, BoQ, Sprints): row 1 is the title band, row 2
 * a one-line hint, row 3 the column headers, data from row 4. Files made before the title band had
 * their headers in row 1; the parser finds the header row by name, so both layouts import.
 */
export const SCOPE_WORKBOOK_HEADER_ROW = UBEC_SHEET_HEADER_ROW;
export const SCOPE_WORKBOOK_FIRST_DATA_ROW = SCOPE_WORKBOOK_HEADER_ROW + 1;
const HR = SCOPE_WORKBOOK_HEADER_ROW;
const FR = SCOPE_WORKBOOK_FIRST_DATA_ROW;

// Styling helpers: server/src/utils/ubecSheetStyle.ts (shared with the project register workbooks).

export async function buildScopeWorkbook(data: WorkbookBuildData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.brandName ?? 'InSite Assurance';
  wb.created = data.generatedAt;
  wb.title = data.title ? `Needs assessment · ${data.title}` : 'Needs assessment template';

  const brand = data.brandName ? `${data.brandName} · ` : '';
  const docName = data.title ? 'Needs assessment' : 'Needs assessment template';
  const subject = data.title ?? 'Blank template';
  const sheetTitle = (sheet: string) => `${brand}${docName} · ${sheet}`;
  const hint = (text: string) => `${subject}  |  ${text}`;

  // Instructions
  const ins = wb.addWorksheet(S.instructions, { properties: { tabColor: { argb: COLOR.navy } } });
  ins.columns = [{ width: 24 }, { width: 100 }];
  ins.views = [{ showGridLines: false }];
  titleBand(ins, 2, `${brand}${docName}`, data.title ?? 'Blank template: one file per project. Fill it in and import it on the project.');
  const meta: Array<[string, string]> = [
    ['Version', SCOPE_WORKBOOK_VERSION],
    ['Generated', data.generatedAt.toISOString().slice(0, 10)],
    ['Project', data.title ?? '(blank template)'],
  ];
  meta.forEach(([k, v], i) => {
    const r = i + 4;
    const key = ins.getCell(`A${r}`);
    key.value = k;
    key.font = { name: FONT, bold: true, color: { argb: COLOR.ink } };
    key.fill = solid(COLOR.label);
    key.border = BOX;
    key.alignment = { vertical: 'middle', indent: 1 };
    const val = ins.getCell(`B${r}`);
    val.value = v;
    val.border = BOX;
    val.alignment = { vertical: 'middle', indent: 1 };
  });

  const section = (r: number, label: string) => {
    const c = ins.getCell(`A${r}`);
    c.value = label;
    c.font = { name: FONT, bold: true, color: { argb: COLOR.white } };
    c.fill = solid(COLOR.primary);
    c.alignment = { vertical: 'middle', indent: 1 };
    ins.mergeCells(r, 1, r, 2);
    ins.getRow(r).height = 22;
  };
  const steps = [
    'Project: fill in the project details. On a draft, empty project fields take these values; existing values are not overwritten.',
    'Sprints (work phases): one row per work phase, numbered 1, 2, 3… in date order. Work phases may differ in length and leave gaps, but may not overlap.',
    'Facility units: one row per physical facility on site (e.g. "Ground floor male toilet"). Pick the facility from the list. Give each unit its own Unit ID (U01, U02…). Supply items (furniture, equipment) need a quantity.',
    'BoQ: one row per bill line. Pick the Unit ID of the facility unit it belongs to and the unit of measure. Rates and amounts are in naira. Amount is quantity × rate and is recomputed on upload.',
    'Do not rename the sheets or the column headers, and keep the title rows above the headers.',
    'Import the file on the project\'s "BoQ & work phases" step (Import needs assessment). You will see a preview with any errors before anything is saved.',
    'Drawings and other attachments go to the project documents, not this file.',
  ];
  section(8, 'How to fill it in');
  steps.forEach((t, i) => {
    const r = i + 9;
    const n = ins.getCell(`A${r}`);
    n.value = `${i + 1}.`;
    n.alignment = { vertical: 'top', horizontal: 'center' };
    const b = ins.getCell(`B${r}`);
    b.value = t;
    b.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    for (const c of [n, b]) {
      c.border = BOX;
      if (i % 2 === 1) c.fill = solid(COLOR.band);
    }
    ins.getRow(r).height = wrappedHeight(t.length, 100);
  });
  const keyRow = 9 + steps.length + 1;
  section(keyRow, 'Colour key');
  const key: Array<[string, ExcelJS.Fill | null, string]> = [
    ['Input', null, 'White and light green rows: enter data here. Cells with a list arrow take a value from the list.'],
    ['Calculated', solid(COLOR.calc), 'Grey cells are calculated (the BoQ Amount) and protected. The sheet has no password (Review → Unprotect Sheet).'],
    ['Headers', solid(COLOR.primary), 'Green header row: the importer reads the columns by these names.'],
  ];
  key.forEach(([label, fill, t], i) => {
    const r = keyRow + 1 + i;
    const a = ins.getCell(`A${r}`);
    a.value = label;
    a.border = BOX;
    a.alignment = { vertical: 'middle', horizontal: 'center' };
    if (fill) a.fill = fill;
    a.font = label === 'Headers' ? { name: FONT, bold: true, color: { argb: COLOR.white } } : label === 'Calculated' ? { name: FONT, italic: true, color: { argb: COLOR.calcText } } : { name: FONT };
    const b = ins.getCell(`B${r}`);
    b.value = t;
    b.border = BOX;
    b.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    ins.getRow(r).height = wrappedHeight(t.length, 100);
  });

  // Lists (hidden, protected): the dropdown sources.
  const lists = wb.addWorksheet(S.lists);
  lists.columns = [{ header: 'Facilities', width: 34 }, { header: 'Units of measure', width: 18 }, { header: 'Regions', width: 28 }, { header: 'Delivery models', width: 28 }, { header: 'Funding sources', width: 36 }];
  data.facilities.forEach((f, i) => (lists.getCell(`A${i + 2}`).value = f.name));
  UNITS_OF_MEASURE.forEach((u, i) => (lists.getCell(`B${i + 2}`).value = u.code));
  data.regions.forEach((r, i) => (lists.getCell(`C${i + 2}`).value = r));
  data.deliveryModels.forEach((m, i) => (lists.getCell(`D${i + 2}`).value = m));
  FUNDING_SOURCE_SUGGESTIONS.forEach((s, i) => (lists.getCell(`E${i + 2}`).value = s));
  const facilityList = `${S.lists}!${colRange('A', data.facilities.length)}`;
  const uomList = `${S.lists}!${colRange('B', UNITS_OF_MEASURE.length)}`;
  const regionList = `${S.lists}!${colRange('C', data.regions.length)}`;
  const modelList = `${S.lists}!${colRange('D', data.deliveryModels.length)}`;
  const fundingList = `${S.lists}!${colRange('E', FUNDING_SOURCE_SUGGESTIONS.length)}`;

  // Project (label / value)
  const proj = wb.addWorksheet(S.project, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(proj, 2, sheetTitle(S.project), hint('Empty project fields on a draft take these values.'));
  headerRow(proj, ['Field', 'Value'], [30, 70]);
  SCOPE_WORKBOOK_PROJECT_FIELDS.forEach((f, i) => {
    const r = i + FR;
    const label = proj.getCell(`A${r}`);
    label.value = f.label;
    label.font = { name: FONT, bold: true, color: { argb: COLOR.ink } };
    label.fill = solid(COLOR.label);
    label.border = BOX;
    label.alignment = { vertical: 'top', indent: 1 };
    const cell = proj.getCell(`B${r}`);
    const v = data.project[f.key];
    if (v !== null && v !== undefined && v !== '') cell.value = v;
    cell.border = BOX;
    cell.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
    if (f.key === 'region' && data.regions.length) cell.dataValidation = listValidation(regionList, 'Choose a zone or state from the list.');
    if (f.key === 'deliveryModel' && data.deliveryModels.length) cell.dataValidation = listValidation(modelList, 'Choose a delivery model from the list.');
    // UBEC IRL: suggestions only (any other funding source is accepted), and a year from 2000 to 2100.
    if (f.key === 'fundingSource') cell.dataValidation = { ...listValidation(fundingList, ''), showErrorMessage: false };
    if (f.key === 'interventionYear') {
      cell.dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [2000, 2100], showErrorMessage: true, error: 'Enter a year from 2000 to 2100.' };
    }
    if (f.key === 'budget') {
      cell.dataValidation = decimalValidation(0, 'Enter the budget as a number.');
      cell.numFmt = MONEY;
    }
    if (f.key === 'latitude' || f.key === 'longitude') {
      cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-180, 180], showErrorMessage: true, error: 'Enter decimal degrees.' };
      cell.numFmt = '0.000000';
    }
    if (f.key === 'strategicJustification' || f.key === 'assumptions') {
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };
      proj.getRow(r).height = Math.max(60, wrappedHeight(String(v ?? '').length, 70));
    }
  });

  // Facility units
  const unitsLast = ROWS.units + HR;
  const units = wb.addWorksheet(S.units, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(units, SCOPE_WORKBOOK_COLUMNS.units.length, sheetTitle(S.units), hint('One row per physical facility on site. Supply items need a quantity.'));
  headerRow(units, SCOPE_WORKBOOK_COLUMNS.units, [12, 32, 44, 14, 16, 14, 14]);
  tableBody(units, [{ align: 'center' }, {}, { wrap: true }, { numFmt: QTY, align: 'right' }, { align: 'center' }, { align: 'center' }, { align: 'center' }], unitsLast);
  data.units.forEach((u, i) => {
    setRow(units, i + FR, [u.code, u.facilityName, u.label, u.plannedQuantity ?? null, u.quantityUnit ?? null, u.startSprint ?? null, u.endSprint ?? null]);
  });
  const sprintsLast = ROWS.sprints + HR;
  const sprintList = `${S.sprints}!$A$${FR}:$A$${sprintsLast}`;
  for (let r = FR; r <= unitsLast; r++) {
    units.getCell(`B${r}`).dataValidation = listValidation(facilityList, 'Choose a facility from the list.');
    units.getCell(`D${r}`).dataValidation = decimalValidation(0, 'Enter the quantity as a number.');
    units.getCell(`E${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    units.getCell(`F${r}`).dataValidation = listValidation(sprintList, 'Choose a work phase number from the Sprints sheet.');
    units.getCell(`G${r}`).dataValidation = listValidation(sprintList, 'Choose a work phase number from the Sprints sheet.');
  }
  units.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: SCOPE_WORKBOOK_COLUMNS.units.length } };

  // BoQ: Amount is a protected formula; input columns (also below the pre-sized rows) stay editable.
  const boqLast = Math.max(ROWS.boq, data.lines.length) + HR;
  const boq = wb.addWorksheet(S.boq, { properties: { tabColor: { argb: COLOR.primary } } });
  for (let c = 1; c <= 6; c++) boq.getColumn(c).protection = { locked: false };
  titleBand(boq, SCOPE_WORKBOOK_COLUMNS.boq.length, sheetTitle(S.boq), hint('One row per bill line. Rates and amounts in naira; Amount = Quantity × Rate (grey, calculated).'));
  headerRow(boq, SCOPE_WORKBOOK_COLUMNS.boq, [11, 11, 60, 16, 14, 18, 20]);
  for (const r of [1, 2]) for (let c = 1; c <= 7; c++) boq.getCell(r, c).protection = { locked: true };
  tableBody(
    boq,
    [{ align: 'left' }, { align: 'center' }, { wrap: true }, { align: 'center' }, { numFmt: QTY, align: 'right' }, { numFmt: MONEY, align: 'right' }, { numFmt: MONEY, align: 'right', calculated: true }],
    boqLast
  );
  data.lines.forEach((l, i) => {
    setRow(boq, i + FR, [l.wbsCode, l.unitCode, l.description, l.unit, l.totalQuantity, l.rateNgn]);
  });
  const unitIdList = `'${S.units}'!$A$${FR}:$A$${unitsLast}`;
  for (let r = FR; r <= boqLast; r++) {
    boq.getCell(`B${r}`).dataValidation = listValidation(unitIdList, 'Choose a Unit ID from the Facility units sheet.');
    boq.getCell(`D${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    boq.getCell(`E${r}`).dataValidation = decimalValidation(0, 'Enter the quantity as a number.');
    boq.getCell(`F${r}`).dataValidation = decimalValidation(0, 'Enter the rate as a number.');
    const ln = data.lines[r - FR];
    boq.getCell(`G${r}`).value = {
      formula: `IF(OR(E${r}="",F${r}=""),"",E${r}*F${r})`,
      result: ln ? lineAmount(ln.totalQuantity, ln.rateNgn) : '',
    } as ExcelJS.CellFormulaValue;
  }
  boq.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: SCOPE_WORKBOOK_COLUMNS.boq.length } };
  // No password: it guards the formulas against slips; rows can still be added, deleted, sorted and filtered.
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

  // Sprints
  const sprints = wb.addWorksheet(S.sprints, { properties: { tabColor: { argb: COLOR.primary } } });
  titleBand(sprints, SCOPE_WORKBOOK_COLUMNS.sprints.length, sheetTitle(S.sprints), hint('One row per work phase, numbered 1, 2, 3… in date order; work phases may not overlap.'));
  headerRow(sprints, SCOPE_WORKBOOK_COLUMNS.sprints, [8, 32, 16, 16, 70]);
  tableBody(sprints, [{ align: 'center' }, {}, { numFmt: DATE, align: 'center' }, { numFmt: DATE, align: 'center' }, { wrap: true }], sprintsLast);
  data.sprints.forEach((s, i) => {
    setRow(sprints, i + FR, [s.number, s.name, isoToDate(s.startDate), isoToDate(s.endDate), s.deliverables]);
  });
  for (let r = FR; r <= sprintsLast; r++) {
    sprints.getCell(`A${r}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1], showErrorMessage: true, error: 'Work phase numbers are 1, 2, 3…' };
    for (const c of ['C', 'D']) sprints.getCell(`${c}${r}`).dataValidation = DATE_VALIDATION;
  }

  // Lists last in the tab order, hidden and protected (no password: it guards against slips, not people).
  wb.removeWorksheet(lists.id);
  const hidden = wb.addWorksheet(S.lists, { state: 'hidden' });
  hidden.columns = lists.columns.map((c) => ({ header: String(c.header ?? ''), width: c.width }));
  lists.eachRow((row, n) => {
    if (n > 1) hidden.getRow(n).values = row.values as ExcelJS.CellValue[];
  });
  await hidden.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface WorkbookParseContext {
  /** Every facility of the tenant, retired ones included. */
  facilities: WorkbookFacility[];
  /** Retired facilities the project already uses (a draft's own round-trip keeps them). */
  allowedRetiredFacilityIds?: Set<string>;
}

export interface ParsedUnit {
  row: number;
  code: string;
  facility: WorkbookFacility;
  label: string;
  plannedQuantity: number | null;
  quantityUnit: string | null;
  startSprint: number | null;
  endSprint: number | null;
}

export interface ParsedLine {
  row: number;
  wbsCode: string;
  unitCode: string;
  description: string;
  unit: string;
  totalQuantity: number;
  rateNgn: number;
  amountNgn: number;
}

export interface ParsedScopeWorkbook {
  version: string | null;
  project: Partial<Record<ScopeWorkbookProjectFieldKey, string>>;
  sprints: WorkbookSprint[];
  units: ParsedUnit[];
  lines: ParsedLine[];
  issues: ScopeWorkbookIssue[];
  warnings: ScopeWorkbookIssue[];
}

// Reading helpers: server/src/utils/sheetReader.ts (shared with the project register import).

export async function parseScopeWorkbook(buffer: Buffer, context: WorkbookParseContext): Promise<ParsedScopeWorkbook> {
  const issues: ScopeWorkbookIssue[] = [];
  const warnings: ScopeWorkbookIssue[] = [];
  const result: ParsedScopeWorkbook = { version: null, project: {}, sprints: [], units: [], lines: [], issues, warnings };
  const wb = new ExcelJS.Workbook();
  try {
    if (!(buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('not a zip');
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    issues.push({ sheet: '', row: null, column: null, code: 'WORKBOOK_UNREADABLE', message: 'This is not an .xlsx file. Download the needs assessment template and fill it in.' });
    return result;
  }

  // Version stamp
  const ins = findSheet(wb, S.instructions);
  if (ins) {
    ins.eachRow((row) => {
      if (normHeader(text(cellValue(row.getCell(1).value))) === 'version') result.version = text(cellValue(row.getCell(2).value)) || null;
    });
  }
  if (result.version !== SCOPE_WORKBOOK_VERSION) {
    issues.push({
      sheet: S.instructions,
      row: null,
      column: 'Version',
      code: 'WORKBOOK_VERSION_MISMATCH',
      message: result.version
        ? `This needs assessment file is version "${result.version}"; this platform reads "${SCOPE_WORKBOOK_VERSION}". Download a new needs assessment template.`
        : 'This is not a needs assessment file (no version stamp). Download the needs assessment template and fill it in.',
    });
    return result;
  }

  const sheets = {
    project: findSheet(wb, S.project),
    units: findSheet(wb, S.units),
    boq: findSheet(wb, S.boq),
    sprints: findSheet(wb, S.sprints),
  };
  for (const [key, ws] of Object.entries(sheets)) {
    if (!ws && key !== 'sprints') {
      const name = S[key as keyof typeof S];
      issues.push({ sheet: name, row: null, column: null, code: 'WORKBOOK_SHEET_MISSING', message: `The "${name}" sheet is missing.` });
    }
  }

  // Project sheet: label in column A, value in column B.
  if (sheets.project) {
    const byLabel = new Map<string, ScopeWorkbookProjectFieldKey>(SCOPE_WORKBOOK_PROJECT_FIELDS.map((f) => [normHeader(f.label), f.key]));
    sheets.project.eachRow((row) => {
      const key = byLabel.get(normHeader(text(cellValue(row.getCell(1).value))));
      if (!key) return;
      const v = text(cellValue(row.getCell(2).value));
      if (v) result.project[key] = v;
    });
  }

  // Sprints (optional sheet)
  const sprintNumbers = new Set<number>();
  if (sheets.sprints) {
    const t = readTable(sheets.sprints, S.sprints, ['No.', 'Name', 'Start date', 'End date'], issues);
    if (t) {
      const parsed: Array<WorkbookSprint & { row: number }> = [];
      for (const r of t.rows) {
        const number = parseSheetNumber(r.get('No.'));
        const name = text(r.get('Name'));
        const startDate = parseSheetDate(r.get('Start date'));
        const endDate = parseSheetDate(r.get('End date'));
        let ok = true;
        const bad = (column: string, code: string, message: string) => {
          issues.push({ sheet: S.sprints, row: r.row, column, code, message: `Row ${r.row}: ${message}` });
          ok = false;
        };
        if (number === null || Number.isNaN(number) || !Number.isInteger(number) || number < 1) bad('No.', 'INVALID_SPRINT_NUMBER', 'the work phase number must be 1, 2, 3…');
        else if (sprintNumbers.has(number)) bad('No.', 'DUPLICATE_SPRINT_NUMBER', `work phase ${number} appears twice.`);
        if (!name) bad('Name', 'MISSING_VALUE', 'name the work phase.');
        if (!startDate) bad('Start date', 'BAD_DATE', `"${text(r.get('Start date'))}" is not a date.`);
        if (!endDate) bad('End date', 'BAD_DATE', `"${text(r.get('End date'))}" is not a date.`);
        if (number !== null && !Number.isNaN(number)) sprintNumbers.add(number);
        if (ok) parsed.push({ row: r.row, number: number!, name, startDate: startDate!, endDate: endDate!, deliverables: text(r.get('Deliverables')) });
      }
      for (const i of validateSprints(parsed)) {
        const s = parsed[i.index ?? 0];
        issues.push({
          sheet: S.sprints,
          row: s?.row ?? null,
          column: i.field === 'endDate' ? 'End date' : 'Start date',
          code: i.code === 'SPRINT_OVERLAP' ? 'OVERLAPPING_SPRINTS' : i.code,
          message: `Row ${s?.row}: ${i.message}`,
        });
      }
      const byNumber = [...parsed].sort((a, b) => a.number - b.number);
      const byDate = [...parsed].sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (byNumber.some((s, i) => byDate[i] !== s)) {
        issues.push({ sheet: S.sprints, row: null, column: 'No.', code: 'SPRINT_NUMBER_ORDER', message: 'Work phase numbers must follow the dates: work phase 1 first, then 2, 3…' });
      }
      result.sprints = byNumber.map(({ row: _row, ...s }) => s);
    }
  }

  // Facility units
  const unitCodes = new Set<string>();
  if (sheets.units) {
    const t = readTable(sheets.units, S.units, ['Unit ID', 'Facility', 'Label', 'Quantity', 'Start sprint', 'End sprint'], issues);
    const byCode = new Map(context.facilities.map((f) => [f.code.toUpperCase(), f]));
    const byName = new Map<string, WorkbookFacility>();
    for (const f of [...context.facilities].sort((a, b) => Number(a.isRetired) - Number(b.isRetired))) {
      if (!byName.has(f.name.trim().toLowerCase())) byName.set(f.name.trim().toLowerCase(), f);
    }
    for (const r of t?.rows ?? []) {
      let ok = true;
      const bad = (column: string, code: string, message: string) => {
        issues.push({ sheet: S.units, row: r.row, column, code, message: `Row ${r.row}: ${message}` });
        ok = false;
      };
      const code = text(r.get('Unit ID')).toUpperCase();
      if (!code) bad('Unit ID', 'MISSING_VALUE', 'enter the Unit ID (e.g. U01).');
      else if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(code)) bad('Unit ID', 'INVALID_UNIT_ID', `"${code}" is not a valid Unit ID (letters and digits, up to 20).`);
      else if (unitCodes.has(code)) bad('Unit ID', 'DUPLICATE_UNIT_ID', `Unit ID ${code} appears twice.`);
      if (code) unitCodes.add(code);
      const facilityText = text(r.get('Facility'));
      const facility = byCode.get(facilityText.toUpperCase()) ?? byName.get(facilityText.toLowerCase());
      if (!facilityText) bad('Facility', 'MISSING_VALUE', 'choose the facility.');
      else if (!facility) bad('Facility', 'UNKNOWN_FACILITY', `"${facilityText}" is not a facility on the list.`);
      else if (facility.isRetired && !context.allowedRetiredFacilityIds?.has(facility.id)) {
        bad('Facility', 'FACILITY_RETIRED', `"${facility.name}" is retired and cannot be added.`);
      }
      const label = text(r.get('Label'));
      if (label.length < 2) bad('Label', 'MISSING_VALUE', 'enter a label, e.g. Ground floor male toilet.');
      const qty = parseSheetNumber(r.get('Quantity'));
      const needsQty = facility ? unitNeedsQuantity(facility.archetype) : false;
      if (qty !== null && (Number.isNaN(qty) || qty <= 0)) bad('Quantity', 'INVALID_NUMBER', `quantity "${text(r.get('Quantity'))}" must be a number above zero.`);
      else if (needsQty && qty === null) bad('Quantity', 'MISSING_QUANTITY', `${facility!.name} is a supply item (${FACILITY_ARCHETYPE_META[facility!.archetype].label}): enter the planned quantity.`);
      const qtyUnitText = t?.columns.has(normHeader('Quantity unit')) ? text(r.get('Quantity unit')) : '';
      const qtyUnit = qtyUnitText ? normalizeUnitOfMeasure(qtyUnitText) : null;
      if (qtyUnitText && !qtyUnit) bad('Quantity unit', 'UNKNOWN_UNIT_OF_MEASURE', `"${qtyUnitText}" is not a unit of measure on the list.`);
      const sprintRef = (column: 'Start sprint' | 'End sprint') => {
        const raw = r.get(column);
        if (isBlank(raw)) return null;
        const n = parseSheetNumber(raw);
        if (n === null || Number.isNaN(n) || !Number.isInteger(n)) {
          bad(column, 'INVALID_SPRINT_NUMBER', `${column.toLowerCase()} "${text(raw)}" must be a work phase number.`);
          return null;
        }
        if (!sprintNumbers.has(n)) {
          bad(column, 'UNKNOWN_SPRINT', `${column.toLowerCase()} ${n} is not on the Sprints sheet.`);
          return null;
        }
        return n;
      };
      const startSprint = sprintRef('Start sprint');
      const endSprint = sprintRef('End sprint');
      if (startSprint !== null && endSprint !== null && startSprint > endSprint) {
        bad('End sprint', 'UNIT_SPRINT_ORDER', `the unit ends in work phase ${endSprint}, before it starts in work phase ${startSprint}.`);
      }
      if (ok && facility) {
        result.units.push({
          row: r.row,
          code,
          facility,
          label,
          plannedQuantity: needsQty ? qty : null,
          quantityUnit: needsQty ? qtyUnit ?? 'nr' : null,
          startSprint,
          endSprint,
        });
        if (!needsQty && qty !== null) {
          warnings.push({ sheet: S.units, row: r.row, column: 'Quantity', code: 'QUANTITY_IGNORED', message: `Row ${r.row}: ${facility.name} is not a supply item; the quantity is ignored.` });
        }
      }
    }
  }

  // BoQ
  if (sheets.boq) {
    const t = readTable(sheets.boq, S.boq, ['Item no.', 'Unit ID', 'Description', 'Unit of measure', 'Quantity', 'Rate'], issues, ['Amount']);
    const itemNos = new Map<string, number>();
    for (const r of t?.rows ?? []) {
      let ok = true;
      const bad = (column: string, code: string, message: string) => {
        issues.push({ sheet: S.boq, row: r.row, column, code, message: `Row ${r.row}: ${message}` });
        ok = false;
      };
      const wbsCode = text(r.get('Item no.'));
      if (!wbsCode) bad('Item no.', 'MISSING_VALUE', 'enter the item no.');
      else if (wbsCode.length > 32) bad('Item no.', 'INVALID_ITEM_NO', 'the item no. is longer than 32 characters.');
      else if (itemNos.has(wbsCode)) bad('Item no.', 'DUPLICATE_ITEM_NO', `item no. ${wbsCode} also appears on row ${itemNos.get(wbsCode)}.`);
      else itemNos.set(wbsCode, r.row);
      const unitCode = text(r.get('Unit ID')).toUpperCase();
      if (!unitCode) bad('Unit ID', 'MISSING_VALUE', 'choose the Unit ID of the facility unit.');
      else if (!unitCodes.has(unitCode)) bad('Unit ID', 'UNKNOWN_UNIT_ID', `Unit ID ${unitCode} is not on the Facility units sheet.`);
      const description = text(r.get('Description'));
      if (description.length < 3) bad('Description', 'MISSING_VALUE', 'enter a description of at least 3 characters.');
      else if (description.length > 600) bad('Description', 'TOO_LONG', 'the description is longer than 600 characters.');
      const uomText = text(r.get('Unit of measure'));
      const unit = normalizeUnitOfMeasure(uomText);
      if (!uomText) bad('Unit of measure', 'MISSING_VALUE', 'choose the unit of measure.');
      else if (!unit) bad('Unit of measure', 'UNKNOWN_UNIT_OF_MEASURE', `"${uomText}" is not a unit of measure on the list.`);
      const qty = parseSheetNumber(r.get('Quantity'));
      if (qty === null) bad('Quantity', 'MISSING_QUANTITY', 'enter the quantity.');
      else if (Number.isNaN(qty) || qty <= 0) bad('Quantity', 'INVALID_NUMBER', `quantity "${text(r.get('Quantity'))}" must be a number above zero.`);
      const rate = parseSheetNumber(r.get('Rate'));
      if (rate === null) bad('Rate', 'MISSING_VALUE', 'enter the rate.');
      else if (Number.isNaN(rate) || rate < 0) bad('Rate', 'INVALID_NUMBER', `rate "${text(r.get('Rate'))}" must be a number of zero or more.`);
      if (!ok) continue;
      const amount = lineAmount(qty!, rate!);
      const sheetAmount = t?.columns.has(normHeader('Amount')) ? parseSheetNumber(r.get('Amount')) : null;
      if (sheetAmount !== null && !Number.isNaN(sheetAmount) && Math.abs(sheetAmount - amount) > 0.01) {
        warnings.push({
          sheet: S.boq,
          row: r.row,
          column: 'Amount',
          code: 'AMOUNT_RECOMPUTED',
          message: `Row ${r.row}: the sheet says ${sheetAmount.toLocaleString()}; quantity × rate is ${amount.toLocaleString()}, which is used.`,
        });
      }
      result.lines.push({ row: r.row, wbsCode, unitCode, description, unit: unit!, totalQuantity: qty!, rateNgn: rate!, amountNgn: amount });
    }
  }
  if (result.lines.length === 0 && issues.length === 0) {
    warnings.push({ sheet: S.boq, row: null, column: null, code: 'NO_LINES', message: 'The BoQ sheet has no lines. Add them before activating the project.' });
  }
  return result;
}
