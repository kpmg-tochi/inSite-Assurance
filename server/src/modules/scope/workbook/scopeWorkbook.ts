import ExcelJS from 'exceljs';
import {
  FACILITY_ARCHETYPE_META,
  FacilityArchetype,
  isIsoCalendarDate,
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

/**
 * Redesign R2c: the needs-assessment workbook as pure functions over plain data, so the Needs
 * Assessment module can build and read the same workbook without a project.
 * - buildScopeWorkbook: Instructions (version stamp), Project, Facility units, BoQ, Sprints and a
 *   hidden, protected Lists sheet that feeds the dropdowns.
 * - parseScopeWorkbook: finds columns by header name, checks the stamp and re-validates every row
 *   (dropdowns can be bypassed by pasting). Amounts are always recomputed.
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
  /** e.g. "PRG-101 · Kaduna Model School"; null for a blank needs-assessment workbook. */
  title: string | null;
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

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E4FF' } };

function headerRow(ws: ExcelJS.Worksheet, headers: readonly string[], widths: number[]) {
  ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] ?? 16 }));
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function listValidation(formula: string, error: string): ExcelJS.DataValidation {
  return { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorTitle: 'Not on the list', error };
}

function decimalValidation(min: number, error: string): ExcelJS.DataValidation {
  return { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [min], showErrorMessage: true, error };
}

const DATE_VALIDATION: ExcelJS.DataValidation = {
  type: 'date',
  operator: 'greaterThan',
  allowBlank: true,
  formulae: [new Date(Date.UTC(2000, 0, 1))],
  showErrorMessage: true,
  error: 'Enter a date (YYYY-MM-DD).',
};

const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const colRange = (col: string, n: number) => `$${col}$2:$${col}$${Math.max(2, n + 1)}`;

export async function buildScopeWorkbook(data: WorkbookBuildData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InSite Assurance';
  wb.created = data.generatedAt;

  // Instructions
  const ins = wb.addWorksheet(S.instructions);
  ins.columns = [{ width: 26 }, { width: 100 }];
  ins.getCell('A1').value = 'Needs-assessment workbook';
  ins.getCell('A1').font = { bold: true, size: 14 };
  const meta: Array<[string, string]> = [
    ['Version', SCOPE_WORKBOOK_VERSION],
    ['Generated', data.generatedAt.toISOString().slice(0, 10)],
    ['Project', data.title ?? '(blank workbook)'],
  ];
  meta.forEach(([k, v], i) => {
    ins.getCell(`A${i + 3}`).value = k;
    ins.getCell(`A${i + 3}`).font = { bold: true };
    ins.getCell(`B${i + 3}`).value = v;
  });
  const steps = [
    'Project: fill in the project details. On a draft, empty project fields take these values; existing values are not overwritten.',
    'Sprints: one row per sprint, numbered 1, 2, 3… in date order. Sprints may differ in length and leave gaps, but may not overlap.',
    'Facility units: one row per physical facility on site (e.g. "Ground floor male toilet"). Pick the facility from the list. Give each unit its own Unit ID (U01, U02…). Supply items (furniture, equipment) need a quantity.',
    'BoQ: one row per bill line. Pick the Unit ID of the facility unit it belongs to and the unit of measure. Amount is quantity × rate and is recomputed on upload.',
    'Do not rename the sheets or the column headers. Columns may be reordered.',
    'Upload the file on the project\'s "Scope & sprints" step. You will see a preview with any errors before anything is saved.',
    'Drawings and other attachments go to the project documents, not this workbook.',
  ];
  ins.getCell('A8').value = 'How to fill it in';
  ins.getCell('A8').font = { bold: true };
  steps.forEach((t, i) => {
    ins.getCell(`A${i + 9}`).value = `${i + 1}.`;
    ins.getCell(`B${i + 9}`).value = t;
    ins.getCell(`B${i + 9}`).alignment = { wrapText: true, vertical: 'top' };
  });

  // Lists (hidden, protected): the dropdown sources.
  const lists = wb.addWorksheet(S.lists);
  lists.columns = [{ header: 'Facilities', width: 34 }, { header: 'Units of measure', width: 18 }, { header: 'Regions', width: 28 }, { header: 'Delivery models', width: 28 }];
  data.facilities.forEach((f, i) => (lists.getCell(`A${i + 2}`).value = f.name));
  UNITS_OF_MEASURE.forEach((u, i) => (lists.getCell(`B${i + 2}`).value = u.code));
  data.regions.forEach((r, i) => (lists.getCell(`C${i + 2}`).value = r));
  data.deliveryModels.forEach((m, i) => (lists.getCell(`D${i + 2}`).value = m));
  const facilityList = `${S.lists}!${colRange('A', data.facilities.length)}`;
  const uomList = `${S.lists}!${colRange('B', UNITS_OF_MEASURE.length)}`;
  const regionList = `${S.lists}!${colRange('C', data.regions.length)}`;
  const modelList = `${S.lists}!${colRange('D', data.deliveryModels.length)}`;

  // Project (label / value)
  const proj = wb.addWorksheet(S.project);
  headerRow(proj, ['Field', 'Value'], [28, 60]);
  SCOPE_WORKBOOK_PROJECT_FIELDS.forEach((f, i) => {
    const r = i + 2;
    proj.getCell(`A${r}`).value = f.label;
    proj.getCell(`A${r}`).font = { bold: true };
    const v = data.project[f.key];
    if (v !== null && v !== undefined && v !== '') proj.getCell(`B${r}`).value = v;
    const cell = proj.getCell(`B${r}`);
    if (f.key === 'region' && data.regions.length) cell.dataValidation = listValidation(regionList, 'Choose a region from the list.');
    if (f.key === 'deliveryModel' && data.deliveryModels.length) cell.dataValidation = listValidation(modelList, 'Choose a delivery model from the list.');
    if (f.key === 'budget') cell.dataValidation = decimalValidation(0, 'Enter the budget as a number.');
    if (f.key === 'latitude' || f.key === 'longitude') {
      cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-180, 180], showErrorMessage: true, error: 'Enter decimal degrees.' };
    }
    if (f.key === 'strategicJustification' || f.key === 'assumptions') cell.alignment = { wrapText: true, vertical: 'top' };
  });

  // Facility units
  const units = wb.addWorksheet(S.units);
  headerRow(units, SCOPE_WORKBOOK_COLUMNS.units, [10, 30, 40, 12, 14, 12, 12]);
  data.units.forEach((u, i) => {
    units.getRow(i + 2).values = [u.code, u.facilityName, u.label, u.plannedQuantity ?? null, u.quantityUnit ?? null, u.startSprint ?? null, u.endSprint ?? null];
  });
  const sprintList = `${S.sprints}!$A$2:$A$${ROWS.sprints + 1}`;
  for (let r = 2; r <= ROWS.units + 1; r++) {
    units.getCell(`B${r}`).dataValidation = listValidation(facilityList, 'Choose a facility from the list.');
    units.getCell(`D${r}`).dataValidation = decimalValidation(0, 'Enter the quantity as a number.');
    units.getCell(`E${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    units.getCell(`F${r}`).dataValidation = listValidation(sprintList, 'Choose a sprint number from the Sprints sheet.');
    units.getCell(`G${r}`).dataValidation = listValidation(sprintList, 'Choose a sprint number from the Sprints sheet.');
  }

  // BoQ
  const boq = wb.addWorksheet(S.boq);
  headerRow(boq, SCOPE_WORKBOOK_COLUMNS.boq, [10, 10, 60, 16, 12, 16, 18]);
  data.lines.forEach((l, i) => {
    boq.getRow(i + 2).values = [l.wbsCode, l.unitCode, l.description, l.unit, l.totalQuantity, l.rateNgn];
  });
  const unitIdList = `'${S.units}'!$A$2:$A$${ROWS.units + 1}`;
  for (let r = 2; r <= Math.max(ROWS.boq, data.lines.length) + 1; r++) {
    boq.getCell(`B${r}`).dataValidation = listValidation(unitIdList, 'Choose a Unit ID from the Facility units sheet.');
    boq.getCell(`D${r}`).dataValidation = listValidation(uomList, 'Choose a unit of measure from the list.');
    boq.getCell(`E${r}`).dataValidation = decimalValidation(0, 'Enter the quantity as a number.');
    boq.getCell(`F${r}`).dataValidation = decimalValidation(0, 'Enter the rate as a number.');
    const line = data.lines[r - 2];
    boq.getCell(`G${r}`).value = {
      formula: `IF(OR(E${r}="",F${r}=""),"",E${r}*F${r})`,
      result: line ? lineAmount(line.totalQuantity, line.rateNgn) : '',
    } as ExcelJS.CellFormulaValue;
    boq.getCell(`G${r}`).numFmt = '#,##0.00';
    boq.getCell(`F${r}`).numFmt = '#,##0.00';
  }

  // Sprints
  const sprints = wb.addWorksheet(S.sprints);
  headerRow(sprints, SCOPE_WORKBOOK_COLUMNS.sprints, [8, 30, 14, 14, 70]);
  data.sprints.forEach((s, i) => {
    sprints.getRow(i + 2).values = [s.number, s.name, isoToDate(s.startDate), isoToDate(s.endDate), s.deliverables];
  });
  for (let r = 2; r <= ROWS.sprints + 1; r++) {
    sprints.getCell(`A${r}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1], showErrorMessage: true, error: 'Sprint numbers are 1, 2, 3…' };
    for (const c of ['C', 'D']) {
      sprints.getCell(`${c}${r}`).dataValidation = DATE_VALIDATION;
      sprints.getCell(`${c}${r}`).numFmt = 'yyyy-mm-dd';
    }
    sprints.getCell(`E${r}`).alignment = { wrapText: true, vertical: 'top' };
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

/** Plain value of a cell (formula results, rich text and hyperlinks unwrapped). */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return cellValue((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String((value as { text: unknown }).text);
    if ('error' in value) return '';
    return '';
  }
  return value;
}

const text = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const isBlank = (v: unknown) => v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** "12,500", "₦8,500,000", 1200.5 → number; '' → null; anything else → NaN. */
export function parseSheetNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  let t = String(raw).trim();
  if (t === '' || t === '-' || t === '–') return null;
  t = t.replace(/[^\d.,-]/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  if (t === '' || t === '-') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** A date cell, an Excel serial, "YYYY-MM-DD" or day-first "DD/MM/YYYY" → YYYY-MM-DD; null when unreadable. */
export function parseSheetDate(raw: unknown): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    return new Date(Math.round((raw - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const t = String(raw ?? '').trim();
  if (isIsoCalendarDate(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isIsoCalendarDate(iso) ? iso : null;
  }
  return null;
}

interface Table {
  sheet: string;
  /** Normalised header → column number. */
  columns: Map<string, number>;
  rows: Array<{ row: number; get: (header: string) => unknown }>;
}

function readTable(
  ws: ExcelJS.Worksheet,
  sheet: string,
  required: string[],
  issues: ScopeWorkbookIssue[],
  /** Computed columns (the Amount formula) that do not make a row non-blank. */
  computed: string[] = []
): Table | null {
  const columns = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const h = normHeader(text(cellValue(cell.value)));
    if (h && !columns.has(h)) columns.set(h, col);
  });
  const missing = required.filter((h) => !columns.has(normHeader(h)));
  for (const h of missing) {
    issues.push({ sheet, row: 1, column: h, code: 'WORKBOOK_COLUMN_MISSING', message: `The ${sheet} sheet has no "${h}" column.` });
  }
  if (missing.length) return null;
  const rows: Table['rows'] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => {
      const c = columns.get(normHeader(header));
      return c === undefined ? '' : cellValue(row.getCell(c).value);
    };
    // A row is blank when every input column is blank (a cleared row can keep a stale Amount result).
    const skip = new Set(computed.map((h) => columns.get(normHeader(h))));
    const values = [...columns.values()].filter((c) => !skip.has(c)).map((c) => cellValue(row.getCell(c).value));
    if (values.every(isBlank)) continue;
    rows.push({ row: r, get });
  }
  return { sheet, columns, rows };
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((w) => normHeader(w.name) === normHeader(name));
}

export async function parseScopeWorkbook(buffer: Buffer, context: WorkbookParseContext): Promise<ParsedScopeWorkbook> {
  const issues: ScopeWorkbookIssue[] = [];
  const warnings: ScopeWorkbookIssue[] = [];
  const result: ParsedScopeWorkbook = { version: null, project: {}, sprints: [], units: [], lines: [], issues, warnings };
  const wb = new ExcelJS.Workbook();
  try {
    if (!(buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('not a zip');
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    issues.push({ sheet: '', row: null, column: null, code: 'WORKBOOK_UNREADABLE', message: 'This is not an .xlsx workbook. Download the workbook and fill it in.' });
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
        ? `This workbook is version "${result.version}"; this platform reads "${SCOPE_WORKBOOK_VERSION}". Download a new workbook.`
        : 'This is not the scope workbook (no version stamp). Download the workbook and fill it in.',
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
        if (number === null || Number.isNaN(number) || !Number.isInteger(number) || number < 1) bad('No.', 'INVALID_SPRINT_NUMBER', 'the sprint number must be 1, 2, 3…');
        else if (sprintNumbers.has(number)) bad('No.', 'DUPLICATE_SPRINT_NUMBER', `sprint ${number} appears twice.`);
        if (!name) bad('Name', 'MISSING_VALUE', 'name the sprint.');
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
        issues.push({ sheet: S.sprints, row: null, column: 'No.', code: 'SPRINT_NUMBER_ORDER', message: 'Sprint numbers must follow the dates: sprint 1 first, then 2, 3…' });
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
          bad(column, 'INVALID_SPRINT_NUMBER', `${column.toLowerCase()} "${text(raw)}" must be a sprint number.`);
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
        bad('End sprint', 'UNIT_SPRINT_ORDER', `the unit ends in sprint ${endSprint}, before it starts in sprint ${startSprint}.`);
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
