import ExcelJS from 'exceljs';

/**
 * UBEC spreadsheet styling, shared by every .xlsx the platform writes (the needs assessment
 * template, the project register export and import template). Extracted from the needs assessment
 * workbook (redesign R2c) without changing its output.
 *
 * Layout of a data sheet: row 1 is the title band, row 2 a one-line hint, row 3 the column headers,
 * data from row 4 (`UBEC_SHEET_HEADER_ROW`).
 */

export const UBEC_SHEET_HEADER_ROW = 3;
export const UBEC_SHEET_FIRST_DATA_ROW = UBEC_SHEET_HEADER_ROW + 1;

/** UBEC palette (web/src/index.css): dark green surface, deep green primary, amber accent. */
export const UBEC_SHEET_COLOR = {
  navy: 'FF122F2A',
  primary: 'FF00715D',
  amber: 'FFFFBF00',
  ink: 'FF0C201D',
  white: 'FFFFFFFF',
  hint: 'FFDCEFE8',
  band: 'FFEEF6F3',
  label: 'FFF1F7F5',
  border: 'FFC5D9D2',
  headerBorder: 'FF005A4A',
  calc: 'FFE6E9E8',
  calcText: 'FF4B5B57',
} as const;
const COLOR = UBEC_SHEET_COLOR;

export const solidFill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const line = (argb: string): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });
export const CELL_BOX: Partial<ExcelJS.Borders> = { top: line(COLOR.border), left: line(COLOR.border), bottom: line(COLOR.border), right: line(COLOR.border) };
export const HEADER_BOX: Partial<ExcelJS.Borders> = {
  top: line(COLOR.headerBorder),
  left: line(COLOR.headerBorder),
  bottom: line(COLOR.headerBorder),
  right: line(COLOR.headerBorder),
};
export const SHEET_FONT = 'Calibri';
export const MONEY_FMT = '"₦"#,##0.00';
export const QTY_FMT = '#,##0.00';
export const DATE_FMT = 'd mmm yyyy';
export const PCT_FMT = '0.0"%"';

/** Row 1: dark green title band with an amber rule; row 2: the sheet's hint on a light green band. */
export function titleBand(ws: ExcelJS.Worksheet, width: number, title: string, hint: string) {
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: SHEET_FONT, bold: true, size: 14, color: { argb: COLOR.white } };
  t.fill = solidFill(COLOR.navy);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  if (width > 1) ws.mergeCells(1, 1, 1, width);
  for (let c = 1; c <= width; c++) ws.getCell(1, c).border = { bottom: { style: 'medium', color: { argb: COLOR.amber } } };
  ws.getRow(1).height = 32;

  const h = ws.getCell(2, 1);
  h.value = hint;
  h.font = { name: SHEET_FONT, italic: true, size: 10, color: { argb: COLOR.ink } };
  h.fill = solidFill(COLOR.hint);
  h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  if (width > 1) ws.mergeCells(2, 1, 2, width);
  ws.getRow(2).height = 30;
}

/** Row 3: white bold headers on the brand green; title, hint and headers stay in view. */
export function headerRow(ws: ExcelJS.Worksheet, headers: readonly string[], widths: number[]) {
  const HR = UBEC_SHEET_HEADER_ROW;
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? 16;
    const c = ws.getCell(HR, i + 1);
    c.value = h;
    c.font = { name: SHEET_FONT, bold: true, color: { argb: COLOR.white } };
    c.fill = solidFill(COLOR.primary);
    c.border = HEADER_BOX;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    c.protection = { locked: true };
  });
  ws.getRow(HR).height = 24;
  ws.views = [{ state: 'frozen', ySplit: HR, showGridLines: false }];
  Object.assign(ws.pageSetup, { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${HR}` });
}

export interface BodyColumn {
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  /** Calculated (e.g. the BoQ Amount): grey, italic, locked. */
  calculated?: boolean;
}

export const colLetter = (n: number) => String.fromCharCode(64 + n);

/**
 * Borders, formats and alignment on the pre-sized rows; alternating tints by conditional formatting
 * (MOD(ROW(),2)), so the banding survives sorting and inserted rows and adds one rule, not a fill per cell.
 */
export function tableBody(ws: ExcelJS.Worksheet, columns: BodyColumn[], lastRow: number) {
  const HR = UBEC_SHEET_HEADER_ROW;
  const FR = UBEC_SHEET_FIRST_DATA_ROW;
  const alignment = (col: BodyColumn): Partial<ExcelJS.Alignment> => {
    const horizontal = col.align ?? 'left';
    return { horizontal, indent: horizontal === 'center' ? undefined : 1 };
  };
  // Headers line up with their column.
  columns.forEach((col, i) => {
    const h = ws.getCell(HR, i + 1);
    h.alignment = { ...h.alignment, ...alignment(col) };
  });
  for (let r = FR; r <= lastRow; r++) {
    columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.border = CELL_BOX;
      cell.alignment = { vertical: 'top', ...alignment(col), wrapText: col.wrap || undefined };
      if (col.numFmt) cell.numFmt = col.numFmt;
      if (col.calculated) {
        cell.fill = solidFill(COLOR.calc);
        cell.font = { name: SHEET_FONT, italic: true, color: { argb: COLOR.calcText } };
        cell.protection = { locked: true };
      } else {
        cell.protection = { locked: false };
      }
    });
  }
  // Tint the input columns only: a calculated column keeps its grey.
  let first = 0;
  while (first < columns.length) {
    if (columns[first].calculated) {
      first++;
      continue;
    }
    let last = first;
    while (last + 1 < columns.length && !columns[last + 1].calculated) last++;
    ws.addConditionalFormatting({
      ref: `${colLetter(first + 1)}${FR}:${colLetter(last + 1)}${lastRow}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: ['MOD(ROW(),2)=1'],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOR.band } } },
        },
      ],
    });
    first = last + 1;
  }
}

/** Cell by cell: assigning row.values would drop the cells' styles. */
export function setRow(ws: ExcelJS.Worksheet, r: number, values: ExcelJS.CellValue[]) {
  values.forEach((v, i) => (ws.getCell(r, i + 1).value = v));
}

export function listValidation(formula: string, error: string): ExcelJS.DataValidation {
  return { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorTitle: 'Not on the list', error };
}

export function decimalValidation(min: number, error: string): ExcelJS.DataValidation {
  return { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [min], showErrorMessage: true, error };
}

export const DATE_VALIDATION: ExcelJS.DataValidation = {
  type: 'date',
  operator: 'greaterThan',
  allowBlank: true,
  formulae: [new Date(Date.UTC(2000, 0, 1))],
  showErrorMessage: true,
  error: 'Enter a date, e.g. 2027-01-04.',
};

export const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Lists sheet ranges keep their header in row 1. */
export const listRange = (col: string, n: number) => `$${col}$2:$${col}$${Math.max(2, n + 1)}`;

/** Rough height for a wrapped text cell (not every spreadsheet app grows rows on open). */
export const wrappedHeight = (textLength: number, width: number) => Math.max(18, Math.ceil(textLength / (width * 1.1)) * 15 + 4);

/** A label / value row on an Instructions sheet (label on the light green, both boxed). */
export function metaRow(ws: ExcelJS.Worksheet, r: number, label: string, value: string) {
  const key = ws.getCell(`A${r}`);
  key.value = label;
  key.font = { name: SHEET_FONT, bold: true, color: { argb: COLOR.ink } };
  key.fill = solidFill(COLOR.label);
  key.border = CELL_BOX;
  key.alignment = { vertical: 'middle', indent: 1 };
  const val = ws.getCell(`B${r}`);
  val.value = value;
  val.border = CELL_BOX;
  val.alignment = { vertical: 'middle', indent: 1 };
}

/** A green section heading across columns A–B of an Instructions sheet. */
export function sectionRow(ws: ExcelJS.Worksheet, r: number, label: string) {
  const c = ws.getCell(`A${r}`);
  c.value = label;
  c.font = { name: SHEET_FONT, bold: true, color: { argb: COLOR.white } };
  c.fill = solidFill(COLOR.primary);
  c.alignment = { vertical: 'middle', indent: 1 };
  ws.mergeCells(r, 1, r, 2);
  ws.getRow(r).height = 22;
}

/** Numbered steps under a section heading (columns A–B, every other row tinted). */
export function stepRows(ws: ExcelJS.Worksheet, firstRow: number, steps: string[], width = 100) {
  steps.forEach((t, i) => {
    const r = i + firstRow;
    const n = ws.getCell(`A${r}`);
    n.value = `${i + 1}.`;
    n.alignment = { vertical: 'top', horizontal: 'center' };
    const b = ws.getCell(`B${r}`);
    b.value = t;
    b.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    for (const c of [n, b]) {
      c.border = CELL_BOX;
      if (i % 2 === 1) c.fill = solidFill(COLOR.band);
    }
    ws.getRow(r).height = wrappedHeight(t.length, width);
  });
}

/**
 * Moves a "Lists" sheet to the end of the tab order, hidden and protected (no password: it guards
 * against slips, not people). Returns the new sheet.
 */
export async function hideListsSheet(wb: ExcelJS.Workbook, lists: ExcelJS.Worksheet, name: string): Promise<ExcelJS.Worksheet> {
  wb.removeWorksheet(lists.id);
  const hidden = wb.addWorksheet(name, { state: 'hidden' });
  hidden.columns = lists.columns.map((c) => ({ header: String(c.header ?? ''), width: c.width }));
  lists.eachRow((row, n) => {
    if (n > 1) hidden.getRow(n).values = row.values as ExcelJS.CellValue[];
  });
  await hidden.protect('', { selectLockedCells: true, selectUnlockedCells: true });
  return hidden;
}
