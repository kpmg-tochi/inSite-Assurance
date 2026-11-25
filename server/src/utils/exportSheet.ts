import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { XLSX_CONTENT_TYPE } from '@insite/shared';
import {
  CELL_BOX,
  DATE_FMT,
  headerRow,
  MONEY_FMT,
  SHEET_FONT as FONT,
  solidFill as solid,
  titleBand,
  UBEC_SHEET_COLOR,
  UBEC_SHEET_FIRST_DATA_ROW,
  UBEC_SHEET_HEADER_ROW,
} from './ubecSheetStyle';

/**
 * UBEC IRL: report sheets for the screen exports (.xlsx) in the shared UBEC look (`ubecSheetStyle.ts`,
 * the needs-assessment workbook's styling): title band, hint line, white-on-green headers, thin
 * borders, banded rows, ₦ and date formats, frozen headers, an autofilter and an optional totals row.
 * Sheets are read-only reports: nothing is protected or validated.
 */

const COLOR = { ...UBEC_SHEET_COLOR, muted: 'FF6B7C78' } as const;

const FORMATS = {
  date: DATE_FMT,
  datetime: `${DATE_FMT} hh:mm`,
  money: MONEY_FMT,
  number: '#,##0.0',
  integer: '0',
} as const;
export type ExportCellFormat = keyof typeof FORMATS | 'text';

/** Title band (row 1), hint (row 2), headers (row 3): data starts on row 4. */
export const EXPORT_HEADER_ROW = UBEC_SHEET_HEADER_ROW;
export const EXPORT_FIRST_DATA_ROW = UBEC_SHEET_FIRST_DATA_ROW;

export interface ExportColumn<T> {
  header: string;
  width?: number;
  format?: ExportCellFormat;
  wrap?: boolean;
  value: (row: T) => ExcelJS.CellValue;
}

export interface ExportSheet<T> {
  /** Tab name (Excel: at most 31 characters, no []:*?/\). */
  name: string;
  /** Row 1, e.g. "UBEC · Visits · PRG-105". */
  title: string;
  /** Row 2: what the rows are and which filters apply. */
  hint: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Shown in the first data row when there are no rows. */
  emptyText?: string;
  /** Voided or otherwise inactive rows: grey italic text. */
  muted?: (row: T) => boolean;
  /** A bold totals row under the data (values by column index; the label goes in column 1). */
  totals?: { label: string; values: Record<number, ExcelJS.CellValue> };
}

export function columnLetter(n: number): string {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

const alignFor = (format: ExportCellFormat | undefined): 'left' | 'right' | 'center' =>
  format === 'money' || format === 'number' || format === 'integer' ? 'right' : format === 'date' || format === 'datetime' ? 'center' : 'left';

function addSheet<T>(wb: ExcelJS.Workbook, spec: ExportSheet<T>) {
  const ws = wb.addWorksheet(spec.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31), { properties: { tabColor: { argb: COLOR.primary } } });
  const width = spec.columns.length;

  titleBand(ws, width, spec.title, spec.hint);
  headerRow(
    ws,
    spec.columns.map((c) => c.header),
    spec.columns.map((c) => c.width ?? 16)
  );
  // Headers line up with their column; report headers wrap onto two lines.
  spec.columns.forEach((col, i) => {
    const horizontal = alignFor(col.format);
    ws.getCell(EXPORT_HEADER_ROW, i + 1).alignment = { vertical: 'middle', horizontal, wrapText: true, indent: horizontal === 'center' ? undefined : 1 };
  });
  ws.getRow(EXPORT_HEADER_ROW).height = 30;

  let r = EXPORT_FIRST_DATA_ROW;
  for (const row of spec.rows) {
    const muted = spec.muted?.(row) ?? false;
    spec.columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      const v = col.value(row);
      cell.value = v === undefined || v === '' ? null : v;
      cell.border = CELL_BOX;
      const horizontal = alignFor(col.format);
      cell.alignment = { vertical: 'top', horizontal, indent: horizontal === 'center' ? undefined : 1, wrapText: col.wrap || undefined };
      if (col.format && col.format !== 'text') cell.numFmt = FORMATS[col.format];
      cell.font = muted ? { name: FONT, italic: true, color: { argb: COLOR.muted } } : { name: FONT };
    });
    r++;
  }
  const lastDataRow = r - 1;

  if (spec.rows.length === 0) {
    const c = ws.getCell(r, 1);
    c.value = spec.emptyText ?? 'No rows match these filters.';
    c.font = { name: FONT, italic: true, color: { argb: COLOR.muted } };
    c.alignment = { horizontal: 'left', indent: 1 };
    if (width > 1) ws.mergeCells(r, 1, r, width);
    r++;
  } else {
    // Banding by conditional formatting, so it survives sorting and filtering.
    ws.addConditionalFormatting({
      ref: `A${EXPORT_FIRST_DATA_ROW}:${columnLetter(width)}${lastDataRow}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: ['MOD(ROW(),2)=1'],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOR.band } } },
        },
      ],
    });
    ws.autoFilter = { from: { row: EXPORT_HEADER_ROW, column: 1 }, to: { row: lastDataRow, column: width } };
  }

  if (spec.totals) {
    spec.columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = i === 0 ? spec.totals!.label : (spec.totals!.values[i] ?? null);
      cell.font = { name: FONT, bold: true, color: { argb: COLOR.ink } };
      cell.fill = solid(COLOR.label);
      cell.border = { ...CELL_BOX, top: { style: 'medium', color: { argb: COLOR.primary } } };
      const horizontal = i === 0 ? 'left' : alignFor(col.format);
      cell.alignment = { vertical: 'middle', horizontal, indent: horizontal === 'center' ? undefined : 1 };
      if (i > 0 && col.format && col.format !== 'text') cell.numFmt = FORMATS[col.format];
    });
    ws.getRow(r).height = 22;
  }
}

export async function buildExportWorkbook(params: {
  brandName: string | null;
  title: string;
  generatedAt: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ExportSheet<any>[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = params.brandName ?? 'InSite Assurance';
  wb.created = params.generatedAt;
  wb.title = params.title;
  for (const sheet of params.sheets) addSheet(wb, sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Sends the workbook as a download (spaces kept in the quoted name; non-ASCII goes to filename*). */
export function sendXlsx(res: Response, fileName: string, buffer: Buffer): void {
  res.attachment(fileName);
  res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

// ---------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------

/** A YYYY-MM-DD calendar date as an Excel date (null when empty or malformed). */
export function dateCell(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * An instant as the wall-clock time in `timeZone` (Excel has no zones: the hint line names the zone).
 * Falls back to UTC for an unknown zone.
 */
export function dateTimeCell(instant: Date | string | null | undefined, timeZone: string): Date | null {
  if (!instant) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
  } catch {
    return d;
  }
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')));
}

/** "Generated 25 Nov 2026 14:05 (Africa/Lagos) by Ada Obi". */
export function generatedLine(now: Date, timeZone: string, byName: string | null | undefined): string {
  let when: string;
  try {
    when = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  } catch {
    when = now.toISOString().slice(0, 16).replace('T', ' ');
  }
  return `Generated ${when} (${timeZone})${byName ? ` by ${byName}` : ''}`;
}
