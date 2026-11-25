import { isIsoCalendarDate } from './scope';

/**
 * Lenient readers for spreadsheet values (needs assessment and project register imports). Pure, so
 * the server parser and the row validation share them.
 */

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

/** A date, an Excel serial, "YYYY-MM-DD" or day-first "DD/MM/YYYY" → YYYY-MM-DD; null when unreadable. */
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
