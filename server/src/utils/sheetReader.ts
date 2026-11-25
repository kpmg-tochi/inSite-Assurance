import ExcelJS from 'exceljs';
import { parseSheetDate, parseSheetNumber } from '@insite/shared';

/**
 * Reading uploaded .xlsx files (needs assessment, project register import): cell values unwrapped,
 * numbers and dates parsed leniently, sheets and columns found by name (case and punctuation
 * ignored), header row found among the top rows. Extracted from the needs assessment parser
 * (redesign R2c) without changing its behaviour.
 */

/** Row-level issue shape shared by the importers. */
export interface SheetIssue {
  sheet: string;
  /** Spreadsheet row number (1-based), null for sheet-level issues. */
  row: number | null;
  column: string | null;
  code: string;
  message: string;
}

/** Plain value of a cell (formula results, rich text and hyperlinks unwrapped). */
export function cellValue(value: ExcelJS.CellValue): unknown {
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

export const cellText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
export const isBlank = (v: unknown) => v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export { parseSheetDate, parseSheetNumber };

export interface SheetTable {
  sheet: string;
  /** Normalised header → column number. */
  columns: Map<string, number>;
  rows: Array<{ row: number; get: (header: string) => unknown }>;
}

/** Rows searched for the header row: the title band and hint sit above it (row 3); older files have it in row 1. */
const HEADER_SEARCH_ROWS = 10;

function headersOf(ws: ExcelJS.Worksheet, r: number): Map<string, number> {
  const columns = new Map<string, number>();
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
    // A merged title band repeats its text in every cell: only the master cell counts.
    if (cell.isMerged && cell.master !== cell) return;
    const h = normHeader(cellText(cellValue(cell.value)));
    if (h && !columns.has(h)) columns.set(h, col);
  });
  return columns;
}

/**
 * The header row is the first of the top rows that holds every required header; failing that, the one
 * holding most of them (its missing columns are reported), else row 1.
 */
function findHeaderRow(ws: ExcelJS.Worksheet, required: string[]): { headerRow: number; columns: Map<string, number> } {
  let best = { headerRow: 1, columns: headersOf(ws, 1), hits: -1 };
  for (let r = 1; r <= Math.min(HEADER_SEARCH_ROWS, Math.max(1, ws.rowCount)); r++) {
    const columns = headersOf(ws, r);
    const hits = required.filter((h) => columns.has(normHeader(h))).length;
    if (hits === required.length) return { headerRow: r, columns };
    if (hits > best.hits && hits > 0) best = { headerRow: r, columns, hits };
  }
  return { headerRow: best.headerRow, columns: best.columns };
}

/**
 * The rows under the header row, with a getter by header name. Missing required columns are
 * reported and null is returned. Blank rows are skipped.
 */
export function readTable(
  ws: ExcelJS.Worksheet,
  sheet: string,
  required: string[],
  issues: SheetIssue[],
  /** Computed columns (e.g. an Amount formula) that do not make a row non-blank. */
  computed: string[] = []
): SheetTable | null {
  const { headerRow, columns } = findHeaderRow(ws, required);
  const missing = required.filter((h) => !columns.has(normHeader(h)));
  for (const h of missing) {
    issues.push({ sheet, row: headerRow, column: h, code: 'WORKBOOK_COLUMN_MISSING', message: `The ${sheet} sheet has no "${h}" column.` });
  }
  if (missing.length) return null;
  const rows: SheetTable['rows'] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => {
      const c = columns.get(normHeader(header));
      return c === undefined ? '' : cellValue(row.getCell(c).value);
    };
    // A row is blank when every input column is blank (a cleared row can keep a stale formula result).
    const skip = new Set(computed.map((h) => columns.get(normHeader(h))));
    const values = [...columns.values()].filter((c) => !skip.has(c)).map((c) => cellValue(row.getCell(c).value));
    if (values.every(isBlank)) continue;
    rows.push({ row: r, get });
  }
  return { sheet, columns, rows };
}

export function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((w) => normHeader(w.name) === normHeader(name));
}

/** Loads an .xlsx buffer; false when it is not a readable workbook. */
export async function loadWorkbook(wb: ExcelJS.Workbook, buffer: Buffer): Promise<boolean> {
  try {
    if (!(buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('not a zip');
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return true;
  } catch {
    return false;
  }
}

/** The value next to a label in column A (e.g. "Version" on an Instructions sheet), or null. */
export function labelledValue(ws: ExcelJS.Worksheet | undefined, label: string): string | null {
  if (!ws) return null;
  let out: string | null = null;
  ws.eachRow((row) => {
    if (normHeader(cellText(cellValue(row.getCell(1).value))) === normHeader(label)) out = cellText(cellValue(row.getCell(2).value)) || null;
  });
  return out;
}
