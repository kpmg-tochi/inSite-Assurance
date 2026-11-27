import ExcelJS from 'exceljs';
import {
  APPROVED_LIST_COLUMNS,
  APPROVED_LIST_HEADER_LABELS,
  APPROVED_LIST_KIND_TEMPLATE_LABELS,
  APPROVED_LIST_MAX_ROWS,
  APPROVED_LIST_SHEETS,
  APPROVED_LIST_TEMPLATE_VERSION,
  ApprovedListColumnKey,
  ApprovedListIssue,
  ApprovedListKind,
  type AppropriatedScheduleColumn,
  findLgaByName,
  findStateByName,
  INTERVENTION_YEAR_MAX,
  INTERVENTION_YEAR_MIN,
  NIGERIA_STATES,
  parseSheetDate,
  parseSheetNumber,
  stateByCode,
} from '@insite/shared';
import {
  CELL_BOX,
  DATE_FMT,
  DATE_VALIDATION,
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
  wrappedHeight,
  type BodyColumn,
} from '../../utils/ubecSheetStyle';
import { cellText, cellValue, findSheet, isBlank, labelledValue, loadWorkbook, normHeader, readTable, type SheetIssue } from '../../utils/sheetReader';

/**
 * Client demo updates E3 (wave 4): the approved list upload workbook (pure, no database).
 * - `buildApprovedListWorkbook`: Instructions (version stamp, steps, columns), the List sheet (one
 *   labelled row per header field: label in column A, value in column B), the Rows sheet (header in
 *   row 3, one row per approved project) and a hidden Lists sheet for the dropdowns. Built empty for
 *   the template; the demo pack fills the header and rows.
 * - `parseApprovedListWorkbook`: reads a filled file back with every rule that needs no database
 *   (header fields, row values, States and LGAs, duplicates). The import service adds the workspace
 *   checks (Project ID links, the list it replaces).
 */

const S = APPROVED_LIST_SHEETS;
const L = APPROVED_LIST_HEADER_LABELS;
const HR = UBEC_SHEET_HEADER_ROW;
const FR = UBEC_SHEET_FIRST_DATA_ROW;
/** Pre-sized rows with dropdowns in the template. */
const TEMPLATE_ROWS = 300;

/** "UBEC approved list template.xlsx" (from the workspace short name). */
export function approvedListTemplateFileName(shortName: string | null): string {
  return shortName ? `${shortName} approved list template.xlsx` : 'Approved list template.xlsx';
}

/** "Federal Capital Territory" reads "FCT" in titles; other States "Kano State". */
function stateTitle(stateCode: string): string {
  const state = stateByCode(stateCode);
  if (!state) return stateCode;
  return state.code === 'FC' ? 'FCT' : `${state.name} State`;
}

/** The title a list gets when the file leaves it blank (as the seeded lists are titled). */
export function defaultApprovedListTitle(kind: ApprovedListKind, year: number, stateCode: string | null): string {
  if (kind === 'MG_BEAP') return `Approved BEAP ${year}${stateCode ? `: ${stateTitle(stateCode)}` : ''}`;
  return `Approved Projects & Implementation Schedule ${year}`;
}

/** Reads the List sheet's kind: the template label, the code, or the obvious words. */
export function parseApprovedListKind(text: string | null): ApprovedListKind | null {
  if (!text) return null;
  const t = text.trim();
  for (const [kind, label] of Object.entries(APPROVED_LIST_KIND_TEMPLATE_LABELS) as Array<[ApprovedListKind, string]>) {
    if (normHeader(label) === normHeader(t) || normHeader(kind) === normHeader(t)) return kind;
  }
  const n = t.toLowerCase();
  const mg = /matching|beap|\bmg\b/.test(n);
  const di = /direct|schedule|\bdi\b/.test(n);
  if (mg && !di) return 'MG_BEAP';
  if (di && !mg) return 'DI_SCHEDULE';
  return null;
}

/** "a; b\nc" → ["a", "b", "c"] (blank parts dropped). */
export function splitList(value: string, commas: boolean): string[] {
  return value
    .split(commas ? /[;,\r\n]+/ : /[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The header as the List sheet gives it. */
export interface ApprovedListHeaderInput {
  interventionYear?: number | null;
  kind?: ApprovedListKind | null;
  /** State name (or code); BEAP only. */
  state?: string | null;
  title?: string | null;
  approvedBy?: string | null;
  /** YYYY-MM-DD. */
  approvedOn?: string | null;
}

/** A Rows sheet column: the approved list's, or the appropriated schedule's "Proposal reference" (needs pipeline wave 4). */
type WorkbookColumnKey = AppropriatedScheduleColumn['key'];

/** One Rows sheet row as written (the demo pack and tests). Schools and LGAs as text ("a; b"). */
export type ApprovedListRowInput = Partial<Record<WorkbookColumnKey, string | number | null>>;

export interface ApprovedListWorkbookData {
  generatedAt: Date;
  /** Short workspace name for the title bands (e.g. "UBEC"). */
  brandName: string | null;
  /** State names for the dropdowns (default: Nigeria's 36 States and the FCT). */
  states?: string[];
  /** Pre-filled header and rows (the demo pack, tests); empty for the template. */
  header?: ApprovedListHeaderInput;
  rows?: ApprovedListRowInput[];
  /**
   * Needs pipeline wave 4 (D-N.12): the appropriated schedule is this workbook with its own Rows
   * columns (`APPROPRIATED_SCHEDULE_COLUMNS`), title, introduction and steps. Default: the approved list's.
   */
  columns?: readonly AppropriatedScheduleColumn[];
  title?: string;
  intro?: string;
  steps?: string[];
}

const COLUMN_STYLE: Record<WorkbookColumnKey, BodyColumn & { width: number }> = {
  rowRef: { width: 18 },
  projectTitle: { width: 44, wrap: true },
  schools: { width: 34, wrap: true },
  state: { width: 18 },
  lgas: { width: 22, wrap: true },
  facilityScope: { width: 34, wrap: true },
  costEstimate: { width: 20, numFmt: MONEY_FMT, align: 'right' },
  lotTitle: { width: 36, wrap: true },
  projectRef: { width: 22 },
  proposalRef: { width: 22 },
};

const LIST_FIELD_NOTES: Record<keyof typeof L, string> = {
  interventionYear: `Required. The year the list approves projects for (${INTERVENTION_YEAR_MIN}–${INTERVENTION_YEAR_MAX}).`,
  kind: 'Required. Choose from the list: the Direct Intervention schedule or a Matching Grants BEAP.',
  state: 'Required for a BEAP (one BEAP per State); leave blank for the Direct Intervention schedule.',
  title: 'Optional. Blank gives "Approved Projects & Implementation Schedule <year>" or "Approved BEAP <year>: <State> State".',
  approvedBy: 'Required. Who approved the list, e.g. "Executive Secretary, UBEC" or "UBEC Board".',
  approvedOn: 'Required. The approval date (YYYY-MM-DD or DD/MM/YYYY).',
};

export async function buildApprovedListWorkbook(data: ApprovedListWorkbookData): Promise<Buffer> {
  const brand = data.brandName;
  const title = `${brand ? `${brand} · ` : ''}${data.title ?? 'Approved list upload'}`;
  const cols = data.columns ?? APPROVED_LIST_COLUMNS;
  const states = data.states ?? NIGERIA_STATES.map((s) => s.name);
  const kindLabels = Object.values(APPROVED_LIST_KIND_TEMPLATE_LABELS);
  const wb = new ExcelJS.Workbook();
  wb.creator = brand ?? 'InSite Assurance';
  wb.created = data.generatedAt;
  wb.title = title;

  // Instructions
  const ins = wb.addWorksheet(S.instructions, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.navy } } });
  ins.columns = [{ width: 26 }, { width: 100 }];
  ins.views = [{ showGridLines: false }];
  titleBand(
    ins,
    2,
    title,
    data.intro ??
      'One approved list per file: the Approved Projects & Implementation Schedule (Direct Intervention) or one State\'s Approved BEAP (Matching Grants). Upload it from the Needs assessment page; you will see what changes before anything is saved.'
  );
  metaRow(ins, 4, 'Version', APPROVED_LIST_TEMPLATE_VERSION);
  metaRow(ins, 5, 'Generated', data.generatedAt.toISOString().slice(0, 10));
  sectionRow(ins, 7, 'How to fill it in');
  const steps = data.steps ?? [
    `${S.list}: the intervention year, the kind of list, the State (BEAP only), who approved it and when. Keep the labels in column A; type or pick the values in column B.`,
    `${S.rows}: one row per approved project. Keep the title rows and the green header row; do not rename the sheets or the headers.`,
    'Uploading replaces the list with the same intervention year, kind and State: rows are matched by their row ref, so a row you keep keeps its linked projects; rows not in the file are removed and their projects unlinked.',
    'Project ID (optional): the project a row is for, by its code (e.g. LOT 5 BATCH 7) or its client project ID. The project must have the list\'s intervention year (or none). Blank keeps the current link.',
    'Each linked project\'s budget is compared with the row\'s cost estimate; a difference beyond the workspace tolerance is flagged.',
    'The whole file is saved or nothing is: fix every error shown and upload it again.',
  ];
  stepRows(ins, 8, steps);
  const colRow = 8 + steps.length + 1;
  sectionRow(ins, colRow, `Columns of the ${S.rows} sheet`);
  cols.forEach((c, i) => {
    const r = colRow + 1 + i;
    const a = ins.getCell(`A${r}`);
    a.value = c.header;
    a.font = { name: SHEET_FONT, bold: c.required, color: { argb: UBEC_SHEET_COLOR.ink } };
    a.fill = solidFill(UBEC_SHEET_COLOR.label);
    a.border = CELL_BOX;
    a.alignment = { vertical: 'top', indent: 1 };
    const b = ins.getCell(`B${r}`);
    b.value = `${c.required ? 'Required. ' : ''}${c.note}`;
    b.border = CELL_BOX;
    b.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    ins.getRow(r).height = wrappedHeight(String(b.value).length, 100);
  });

  // Lists (moved to the end, hidden)
  const lists = wb.addWorksheet(S.lists);
  lists.columns = [
    { header: 'Kinds', width: 60 },
    { header: 'States', width: 28 },
  ];
  kindLabels.forEach((v, i) => (lists.getCell(`A${i + 2}`).value = v));
  states.forEach((v, i) => (lists.getCell(`B${i + 2}`).value = v));
  const ref = (col: string, n: number) => `${S.lists}!${listRange(col, n)}`;

  // List (the header)
  const head = wb.addWorksheet(S.list, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  titleBand(head, 3, `${title} · ${S.list}`, 'The list this file holds. Bold fields are required (State: BEAP only).');
  headerRow(head, ['Field', 'Value', 'Notes'], [24, 60, 80]);
  const h = data.header ?? {};
  const headerValues: Record<keyof typeof L, ExcelJS.CellValue> = {
    interventionYear: h.interventionYear ?? null,
    kind: h.kind ? APPROVED_LIST_KIND_TEMPLATE_LABELS[h.kind] : null,
    state: h.state ?? null,
    title: h.title ?? null,
    approvedBy: h.approvedBy ?? null,
    approvedOn: h.approvedOn && /^\d{4}-\d{2}-\d{2}$/.test(h.approvedOn) ? new Date(`${h.approvedOn}T00:00:00Z`) : (h.approvedOn ?? null),
  };
  (Object.keys(L) as Array<keyof typeof L>).forEach((key, i) => {
    const r = FR + i;
    const a = head.getCell(r, 1);
    a.value = L[key];
    a.font = { name: SHEET_FONT, bold: key !== 'title', color: { argb: UBEC_SHEET_COLOR.ink } };
    a.fill = solidFill(UBEC_SHEET_COLOR.label);
    a.border = CELL_BOX;
    a.alignment = { vertical: 'middle', indent: 1 };
    a.protection = { locked: true };
    const b = head.getCell(r, 2);
    b.value = headerValues[key];
    b.border = CELL_BOX;
    b.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    b.protection = { locked: false };
    const c = head.getCell(r, 3);
    c.value = LIST_FIELD_NOTES[key];
    c.font = { name: SHEET_FONT, italic: true, size: 10, color: { argb: UBEC_SHEET_COLOR.calcText } };
    c.border = CELL_BOX;
    c.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    head.getRow(r).height = 22;
    if (key === 'kind') b.dataValidation = listValidation(ref('A', kindLabels.length), 'Choose the kind of list from the list.');
    if (key === 'state') b.dataValidation = listValidation(ref('B', states.length), 'Choose a State from the list.');
    if (key === 'interventionYear') {
      b.dataValidation = {
        type: 'whole',
        operator: 'between',
        allowBlank: true,
        formulae: [INTERVENTION_YEAR_MIN, INTERVENTION_YEAR_MAX],
        showErrorMessage: true,
        error: `Enter a year from ${INTERVENTION_YEAR_MIN} to ${INTERVENTION_YEAR_MAX}.`,
      };
    }
    if (key === 'approvedOn') {
      b.numFmt = DATE_FMT;
      b.dataValidation = DATE_VALIDATION;
    }
  });

  // Rows
  const ws = wb.addWorksheet(S.rows, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  titleBand(ws, cols.length, `${title} · ${S.rows}`, 'One row per approved project. Bold headers on the Instructions sheet are required.');
  headerRow(
    ws,
    cols.map((c) => c.header),
    cols.map((c) => COLUMN_STYLE[c.key].width)
  );
  const rows = data.rows ?? [];
  const last = Math.max(TEMPLATE_ROWS, rows.length) + HR;
  tableBody(
    ws,
    cols.map((c) => COLUMN_STYLE[c.key]),
    last
  );
  const letter = (key: WorkbookColumnKey) => String.fromCharCode(65 + cols.findIndex((c) => c.key === key));
  for (let r = FR; r <= last; r++) {
    ws.getCell(`${letter('state')}${r}`).dataValidation = listValidation(ref('B', states.length), 'Choose a State from the list.');
    ws.getCell(`${letter('costEstimate')}${r}`).dataValidation = decimalValidation(0, 'Enter the amount in naira as a number.');
  }
  ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: cols.length } };
  rows.forEach((row, i) => {
    cols.forEach((c, j) => {
      const v = row[c.key];
      if (v === undefined || v === null || v === '') return;
      ws.getCell(FR + i, j + 1).value = v;
    });
  });

  await hideListsSheet(wb, lists, S.lists);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Reading a filled file (rules that need no database)
// ---------------------------------------------------------------------------

export interface ParsedApprovedListHeader {
  interventionYear: number | null;
  kind: ApprovedListKind | null;
  /** BEAP only (a State on a DI schedule is ignored with a warning). */
  stateCode: string | null;
  /** As given, else the default title (null while the year or kind is missing). */
  title: string | null;
  titleGiven: boolean;
  approvedBy: string | null;
  approvedOn: string | null;
}

export interface ParsedApprovedListRow {
  /** Spreadsheet row number. */
  row: number;
  rowRef: string | null;
  projectTitle: string | null;
  schoolNames: string[];
  stateCode: string | null;
  lgaCodes: string[];
  facilityScope: string | null;
  costEstimateNgn: number | null;
  lotTitle: string | null;
  /** The Project ID column as typed (resolved by the import service). */
  projectRef: string | null;
  issues: ApprovedListIssue[];
  warnings: ApprovedListIssue[];
}

export interface ParsedApprovedList {
  version: string | null;
  header: ParsedApprovedListHeader;
  rows: ParsedApprovedListRow[];
  /** Sheet-level and List sheet issues (row issues are on each row). */
  issues: ApprovedListIssue[];
  warnings: ApprovedListIssue[];
}

/** The raw value next to a label in column A of the List sheet (dates and numbers kept as such). */
function labelledRaw(ws: ExcelJS.Worksheet, label: string): unknown {
  let out: unknown = '';
  ws.eachRow((row) => {
    if (normHeader(cellText(cellValue(row.getCell(1).value))) === normHeader(label)) out = cellValue(row.getCell(2).value);
  });
  return out;
}

const EMPTY_HEADER: ParsedApprovedListHeader = {
  interventionYear: null,
  kind: null,
  stateCode: null,
  title: null,
  titleGiven: false,
  approvedBy: null,
  approvedOn: null,
};

function readHeader(ws: ExcelJS.Worksheet, issues: ApprovedListIssue[], warnings: ApprovedListIssue[]): ParsedApprovedListHeader {
  const bad = (column: string, code: string, message: string) => issues.push({ sheet: S.list, row: null, column, code, message });
  const text = (label: string) => {
    const t = cellText(labelledRaw(ws, label));
    return t ? t.replace(/\s+/g, ' ') : null;
  };

  // Intervention year
  let interventionYear: number | null = null;
  const yearRaw = labelledRaw(ws, L.interventionYear);
  if (isBlank(yearRaw)) bad(L.interventionYear, 'INTERVENTION_YEAR_REQUIRED', 'Enter the intervention year.');
  else {
    const n = yearRaw instanceof Date ? yearRaw.getUTCFullYear() : parseSheetNumber(yearRaw);
    if (n === null || !Number.isInteger(n) || n < INTERVENTION_YEAR_MIN || n > INTERVENTION_YEAR_MAX) {
      bad(L.interventionYear, 'INTERVENTION_YEAR_INVALID', `The intervention year must be a year from ${INTERVENTION_YEAR_MIN} to ${INTERVENTION_YEAR_MAX}.`);
    } else interventionYear = n;
  }

  // Kind
  const kindText = text(L.kind);
  const kind = parseApprovedListKind(kindText);
  if (!kindText) bad(L.kind, 'LIST_KIND_REQUIRED', 'Choose the kind of list.');
  else if (!kind) bad(L.kind, 'LIST_KIND_UNKNOWN', `"${kindText}" is not a kind of list: choose the Direct Intervention schedule or a Matching Grants BEAP.`);

  // State (BEAP only)
  let stateCode: string | null = null;
  const stateText = text(L.state);
  if (kind === 'MG_BEAP') {
    if (!stateText) bad(L.state, 'STATE_REQUIRED', 'A BEAP is for one State: choose it.');
    else {
      const state = findStateByName(stateText);
      if (!state) bad(L.state, 'UNKNOWN_STATE', `"${stateText}" is not a State on the list.`);
      else stateCode = state.code;
    }
  } else if (kind === 'DI_SCHEDULE' && stateText) {
    warnings.push({ sheet: S.list, row: null, column: L.state, code: 'STATE_IGNORED', message: 'The Direct Intervention schedule covers every State: the State is ignored.' });
  }

  // Title, approval
  const titleText = text(L.title);
  const title = titleText ?? (kind && interventionYear !== null && (kind === 'DI_SCHEDULE' || stateCode) ? defaultApprovedListTitle(kind, interventionYear, stateCode) : null);
  if (titleText && titleText.length > 200) bad(L.title, 'TITLE_TOO_LONG', 'The title is longer than 200 characters.');
  const approvedBy = text(L.approvedBy);
  if (!approvedBy) bad(L.approvedBy, 'APPROVED_BY_REQUIRED', 'Enter who approved the list.');
  else if (approvedBy.length > 200) bad(L.approvedBy, 'APPROVED_BY_TOO_LONG', '"Approved by" is longer than 200 characters.');
  const approvedRaw = labelledRaw(ws, L.approvedOn);
  let approvedOn: string | null = null;
  if (isBlank(approvedRaw)) bad(L.approvedOn, 'APPROVED_ON_REQUIRED', 'Enter the approval date.');
  else {
    approvedOn = parseSheetDate(approvedRaw);
    if (!approvedOn) bad(L.approvedOn, 'APPROVED_ON_INVALID', `"${cellText(approvedRaw)}" is not a date: use YYYY-MM-DD or DD/MM/YYYY.`);
  }
  return { interventionYear, kind, stateCode, title, titleGiven: Boolean(titleText), approvedBy, approvedOn };
}

/** Row ref key: case and surrounding spaces ignored. */
export const rowRefKey = (ref: string) => ref.trim().replace(/\s+/g, ' ').toUpperCase();

function readRows(ws: ExcelJS.Worksheet, header: ParsedApprovedListHeader, issues: SheetIssue[]): ParsedApprovedListRow[] {
  const required = APPROVED_LIST_COLUMNS.filter((c) => c.required).map((c) => c.header);
  const table = readTable(ws, S.rows, required, issues);
  if (!table) return [];
  const headerOf = (key: ApprovedListColumnKey) => APPROVED_LIST_COLUMNS.find((c) => c.key === key)!.header;
  const refsSeen = new Map<string, number>();
  return table.rows.map((r) => {
    const rowIssues: ApprovedListIssue[] = [];
    const rowWarnings: ApprovedListIssue[] = [];
    const bad = (key: ApprovedListColumnKey, code: string, message: string) =>
      rowIssues.push({ sheet: S.rows, row: r.row, column: headerOf(key), code, message: `Row ${r.row}: ${message}` });
    const warn = (key: ApprovedListColumnKey, code: string, message: string) =>
      rowWarnings.push({ sheet: S.rows, row: r.row, column: headerOf(key), code, message: `Row ${r.row}: ${message}` });
    const raw = (key: ApprovedListColumnKey) => r.get(headerOf(key));
    const text = (key: ApprovedListColumnKey) => {
      const t = cellText(raw(key));
      return t ? t : null;
    };
    const line = (key: ApprovedListColumnKey) => text(key)?.replace(/\s+/g, ' ') ?? null;

    // Row ref
    const rowRef = line('rowRef');
    if (!rowRef) bad('rowRef', 'ROW_REF_REQUIRED', 'Enter the row ref.');
    else if (rowRef.length > 60) bad('rowRef', 'ROW_REF_TOO_LONG', 'The row ref is longer than 60 characters.');
    else {
      const key = rowRefKey(rowRef);
      const first = refsSeen.get(key);
      if (first !== undefined) bad('rowRef', 'DUPLICATE_ROW_REF', `Row ref "${rowRef}" also appears on row ${first}.`);
      else refsSeen.set(key, r.row);
    }

    // Title, schools, scope, lot
    const projectTitle = line('projectTitle');
    if (!projectTitle) bad('projectTitle', 'PROJECT_TITLE_REQUIRED', 'Enter the project title.');
    else if (projectTitle.length > 500) bad('projectTitle', 'PROJECT_TITLE_TOO_LONG', 'The project title is longer than 500 characters.');
    const schoolNames = splitList(text('schools') ?? '', false);
    const facilityScope = text('facilityScope');
    const lotTitle = line('lotTitle');

    // State: valid; on a BEAP, the BEAP's State.
    let stateCode: string | null = null;
    const stateText = line('state');
    if (!stateText) bad('state', 'STATE_REQUIRED', 'Choose the State.');
    else {
      const state = findStateByName(stateText);
      if (!state) bad('state', 'UNKNOWN_STATE', `"${stateText}" is not a State on the list.`);
      else {
        stateCode = state.code;
        if (header.kind === 'MG_BEAP' && header.stateCode && state.code !== header.stateCode) {
          bad('state', 'STATE_NOT_ON_BEAP', `${state.name} is not the BEAP's State (${stateByCode(header.stateCode)?.name ?? header.stateCode}).`);
        }
      }
    }

    // LGAs of the row's State
    const lgaCodes: string[] = [];
    for (const name of splitList(text('lgas') ?? '', true)) {
      if (!stateCode) continue;
      const lga = findLgaByName(stateCode, name);
      if (!lga) bad('lgas', 'LGA_NOT_IN_STATE', `"${name}" is not an LGA of ${stateByCode(stateCode)?.name ?? stateCode}.`);
      else if (lgaCodes.includes(lga.code)) warn('lgas', 'DUPLICATE_LGA', `${lga.name} is named twice.`);
      else lgaCodes.push(lga.code);
    }

    // Cost estimate
    let costEstimateNgn: number | null = null;
    const estimateRaw = raw('costEstimate');
    if (isBlank(estimateRaw)) bad('costEstimate', 'COST_ESTIMATE_REQUIRED', 'Enter the cost estimate.');
    else {
      const n = parseSheetNumber(estimateRaw);
      if (n === null || Number.isNaN(n) || n <= 0) bad('costEstimate', 'COST_ESTIMATE_INVALID', `The cost estimate must be an amount above 0 ("${cellText(estimateRaw)}").`);
      else if (n >= 1e16) bad('costEstimate', 'COST_ESTIMATE_INVALID', 'The cost estimate is too large.');
      else costEstimateNgn = Math.round(n * 100) / 100;
    }

    return {
      row: r.row,
      rowRef,
      projectTitle,
      schoolNames,
      stateCode,
      lgaCodes,
      facilityScope,
      costEstimateNgn,
      lotTitle,
      projectRef: line('projectRef'),
      issues: rowIssues,
      warnings: rowWarnings,
    };
  });
}

/** Reads a filled approved list file: version, header and rows, with every rule that needs no database. */
export async function parseApprovedListWorkbook(buffer: Buffer): Promise<ParsedApprovedList> {
  const issues: ApprovedListIssue[] = [];
  const warnings: ApprovedListIssue[] = [];
  const empty = (version: string | null): ParsedApprovedList => ({ version, header: EMPTY_HEADER, rows: [], issues, warnings });
  const wb = new ExcelJS.Workbook();
  if (!(await loadWorkbook(wb, buffer))) {
    issues.push({ sheet: '', row: null, column: null, code: 'WORKBOOK_UNREADABLE', message: 'This is not an .xlsx file. Download the approved list template and fill it in.' });
    return empty(null);
  }
  const version = labelledValue(findSheet(wb, S.instructions), 'Version');
  if (version !== APPROVED_LIST_TEMPLATE_VERSION) {
    issues.push({
      sheet: S.instructions,
      row: null,
      column: 'Version',
      code: 'WORKBOOK_VERSION_MISMATCH',
      message: !version
        ? 'This is not an approved list file (no version stamp). Download the approved list template and fill it in.'
        : version.startsWith('INSITE-APPROVED-LIST-')
          ? `This approved list file is version "${version}"; this platform reads "${APPROVED_LIST_TEMPLATE_VERSION}". Download a new template.`
          : `This is not an approved list file: it comes from another template ("${version}"). Download the approved list template and fill it in.`,
    });
    return empty(version);
  }
  const head = findSheet(wb, S.list);
  const rowsSheet = findSheet(wb, S.rows);
  for (const [name, sheet] of [
    [S.list, head],
    [S.rows, rowsSheet],
  ] as const) {
    if (!sheet) issues.push({ sheet: name, row: null, column: null, code: 'WORKBOOK_SHEET_MISSING', message: `The "${name}" sheet is missing.` });
  }
  if (!head || !rowsSheet) return empty(version);

  const header = readHeader(head, issues, warnings);
  const rows = readRows(rowsSheet, header, issues);
  if (rows.length > APPROVED_LIST_MAX_ROWS) {
    issues.push({ sheet: S.rows, row: null, column: null, code: 'TOO_MANY_ROWS', message: `The file has ${rows.length} rows; a list may have at most ${APPROVED_LIST_MAX_ROWS}.` });
  }
  if (rows.length === 0 && !issues.some((i) => i.code === 'WORKBOOK_COLUMN_MISSING')) {
    issues.push({ sheet: S.rows, row: null, column: null, code: 'NO_ROWS', message: 'The Rows sheet has no rows.' });
  }
  return { version, header, rows, issues, warnings };
}
