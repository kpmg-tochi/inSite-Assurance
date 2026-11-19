import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import { BoqPreviewResponse, BoqPreviewRow } from '@insite/shared';
import { AppError } from '../../middleware/error.middleware';

/**
 * The one BOQ parser (Phase 6). CSV and .xlsx both arrive as base64 and are parsed here, so the web
 * no longer splits CSV itself. The parser never guesses silently: every default it applies and
 * every row it cannot use is reported per row.
 */

export const MAX_BOQ_FILE_BYTES = 10 * 1024 * 1024;

/** Plain value of an ExcelJS cell (formula results, rich text and hyperlinks unwrapped). */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return value.text;
    return '';
  }
  return value;
}

type Field = 'wbsCode' | 'section' | 'description' | 'unit' | 'quantity' | 'rate' | 'amount' | 'holdPoint';

/** Accepted header names per field, compared lower-case with spaces and punctuation removed. */
const HEADER_SYNONYMS: Record<Field, string[]> = {
  wbsCode: ['wbs', 'wbscode', 'itemno', 'itemnumber', 'itemref', 'ref', 'code', 'no', 'sn', 'item'],
  section: ['section', 'bill', 'billno', 'billsection', 'trade', 'category', 'group'],
  description: ['description', 'itemdescription', 'workitem', 'workdescription', 'particulars', 'desc', 'details'],
  unit: ['unit', 'units', 'uom', 'unitofmeasure'],
  quantity: ['quantity', 'qty', 'totalquantity', 'quantities'],
  rate: ['rate', 'unitrate', 'ratengn', 'unitprice', 'price', 'unitcost'],
  amount: ['amount', 'total', 'totalamount', 'amountngn', 'budgetedcost', 'budgetedcostngn', 'totalcost', 'cost', 'value'],
  holdPoint: ['holdpoint', 'isholdpoint', 'hold', 'hp'],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Maps column index to field. Exact synonyms win over the looser "item" match for WBS. */
function detectColumns(headers: string[]): Map<number, Field> {
  const map = new Map<number, Field>();
  const taken = new Set<Field>();
  const fields = Object.keys(HEADER_SYNONYMS) as Field[];
  // Two passes: specific synonyms first, then the generic ones at the end of each list.
  for (const pass of [0, 1]) {
    headers.forEach((raw, col) => {
      if (!raw || map.has(col)) return;
      const h = norm(raw);
      for (const field of fields) {
        if (taken.has(field)) continue;
        const synonyms = HEADER_SYNONYMS[field];
        const list = pass === 0 ? synonyms.slice(0, Math.max(1, synonyms.length - 2)) : synonyms;
        if (list.includes(h)) {
          map.set(col, field);
          taken.add(field);
          break;
        }
      }
    });
  }
  return map;
}

/**
 * Parses a number as written in a BOQ: "12,500", "1 200.50", "₦8,500,000", "(1,000)". Returns
 * null for empty cells and NaN for text that is not a number.
 */
export function parseBoqNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  let text = String(raw).trim();
  if (text === '' || text === '-' || text === '–') return null;
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '').replace(/[^\d.,\-\s]/g, '').replace(/\s/g, '');
  // Thousands separators: "12,500" or "1,200,000.50". A single comma followed by 1-2 digits is a decimal comma.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if (text === '') return NaN;
  const n = Number(text);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

function parseBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  return ['y', 'yes', 'true', '1', 'x', 'hp'].includes(String(raw ?? '').trim().toLowerCase());
}

async function readSheet(buffer: Buffer): Promise<{ fileType: 'XLSX' | 'CSV'; headers: string[]; rows: unknown[][] }> {
  const workbook = new ExcelJS.Workbook();
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK": .xlsx
  try {
    if (isZip) {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } else {
      await workbook.csv.read(Readable.from(buffer));
    }
  } catch {
    throw new AppError('Could not read the BOQ file. Upload an .xlsx or .csv file.', 400, 'INVALID_BOQ_FILE');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw new AppError('Uploaded BOQ file contains no rows', 400, 'EMPTY_BOQ_FILE');
  }
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellValue(cell.value)).trim();
  });
  const rows: unknown[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values: unknown[] = [];
    headers.forEach((_h, col) => {
      values[col] = cellValue(row.getCell(col).value);
    });
    rows.push(values);
  }
  return { fileType: isZip ? 'XLSX' : 'CSV', headers, rows };
}

/** Parses a base64 .xlsx or .csv into a per-row preview. Nothing is saved. */
export async function previewBoqSpreadsheet(base64Content: string): Promise<BoqPreviewResponse> {
  const buffer = Buffer.from(base64Content, 'base64');
  if (buffer.length > MAX_BOQ_FILE_BYTES) {
    throw new AppError('BOQ file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  }
  const { fileType, headers, rows } = await readSheet(buffer);
  const columns = detectColumns(headers);
  const colOf = (f: Field) => [...columns.entries()].find(([, v]) => v === f)?.[0];
  const detectedColumns: Record<string, string | null> = {};
  for (const f of Object.keys(HEADER_SYNONYMS) as Field[]) {
    const c = colOf(f);
    detectedColumns[f] = c === undefined ? null : headers[c];
  }
  if (colOf('description') === undefined) {
    throw new AppError(
      'No description column found. Name one of the columns "Description".',
      422,
      'BOQ_DESCRIPTION_COLUMN_MISSING'
    );
  }
  if (colOf('quantity') === undefined) {
    throw new AppError('No quantity column found. Name one of the columns "Quantity".', 422, 'BOQ_QUANTITY_COLUMN_MISSING');
  }

  const out: BoqPreviewRow[] = [];
  const seenWbs = new Map<string, number>();
  let generated = 0;
  rows.forEach((values, idx) => {
    const rowNumber = idx + 2;
    const get = (f: Field) => {
      const c = colOf(f);
      return c === undefined ? '' : values[c];
    };
    const isBlank = values.every((v) => v === '' || v === null || v === undefined);
    if (isBlank) return;

    const warnings: string[] = [];
    const errors: string[] = [];
    const description = String(get('description') ?? '').trim();
    let wbsCode = String(get('wbsCode') ?? '').trim();
    const section = String(get('section') ?? '').trim() || 'GENERAL';
    let unit = String(get('unit') ?? '').trim();
    const quantity = parseBoqNumber(get('quantity'));
    const rate = parseBoqNumber(get('rate'));
    const amount = parseBoqNumber(get('amount'));

    if (description.length < 3) errors.push('Description is missing or shorter than 3 characters.');
    if (quantity === null) errors.push('Quantity is empty.');
    else if (Number.isNaN(quantity)) errors.push(`Quantity "${String(get('quantity'))}" is not a number.`);
    else if (quantity <= 0) errors.push('Quantity must be above zero.');
    if (rate !== null && Number.isNaN(rate)) errors.push(`Rate "${String(get('rate'))}" is not a number.`);
    else if (rate !== null && rate < 0) errors.push('Rate cannot be negative.');
    if (amount !== null && Number.isNaN(amount)) errors.push(`Amount "${String(get('amount'))}" is not a number.`);
    else if (amount !== null && amount < 0) errors.push('Amount cannot be negative.');

    if (!wbsCode) {
      generated += 1;
      wbsCode = `AUTO.${String(generated).padStart(3, '0')}`;
      warnings.push(`No WBS code; ${wbsCode} was assigned.`);
    } else if (wbsCode.length > 32) {
      errors.push('WBS code is longer than 32 characters.');
    }
    if (!unit) {
      unit = 'item';
      warnings.push('No unit; "item" was assigned.');
    }
    if (seenWbs.has(wbsCode)) {
      errors.push(`WBS code ${wbsCode} also appears on row ${seenWbs.get(wbsCode)}.`);
    } else {
      seenWbs.set(wbsCode, rowNumber);
    }

    let budgeted = 0;
    let unitRate = 0;
    const q = quantity !== null && !Number.isNaN(quantity) ? quantity : 0;
    if (amount !== null && !Number.isNaN(amount) && amount > 0) {
      budgeted = amount;
      unitRate = rate !== null && !Number.isNaN(rate) ? rate : q > 0 ? amount / q : 0;
      if (rate !== null && !Number.isNaN(rate) && q > 0) {
        const expected = q * rate;
        if (expected > 0 && Math.abs(expected - amount) / expected > 0.01) {
          warnings.push(`Amount ${amount.toLocaleString()} differs from quantity × rate (${expected.toLocaleString()}). The amount was kept.`);
        }
      }
    } else if (rate !== null && !Number.isNaN(rate)) {
      unitRate = rate;
      budgeted = q * rate;
    } else {
      warnings.push('No rate or amount; the item is priced at zero.');
    }
    if (description.length > 600) errors.push('Description is longer than 600 characters.');

    out.push({
      rowNumber,
      item:
        errors.length === 0
          ? {
              wbsCode,
              section: section.slice(0, 160),
              description,
              unit: unit.slice(0, 32),
              totalQuantity: q,
              rateNgn: Math.round(unitRate * 100) / 100,
              budgetedCostNgn: Math.round(budgeted * 100) / 100,
              isHoldPoint: parseBool(get('holdPoint')),
            }
          : null,
      warnings,
      errors,
    });
  });

  if (out.length === 0) {
    throw new AppError('Uploaded BOQ file contains no rows', 400, 'EMPTY_BOQ_FILE');
  }
  return {
    fileType,
    detectedColumns,
    rows: out,
    validCount: out.filter((r) => r.item).length,
    warningCount: out.filter((r) => r.warnings.length > 0).length,
    errorCount: out.filter((r) => r.errors.length > 0).length,
    totalBudgetedCostNgn: out.reduce((s, r) => s + (r.item?.budgetedCostNgn ?? 0), 0),
  };
}
