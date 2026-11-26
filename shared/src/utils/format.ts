/**
 * Tenant-aware money and date formatting (Phase 6). Every surface (web, PDF, mobile) formats with
 * the tenant's currency and time zone instead of a hardcoded Naira / WAT.
 *
 * Intl support differs between runtimes (Hermes on older devices lacks some options), so every
 * call falls back to a plain format rather than throwing.
 */

export interface MoneyFormatOptions {
  /** ISO 4217 code, e.g. "NGN". Defaults to NGN. */
  currency?: string | null;
  locale?: string;
  /** Fraction digits; defaults to 0. */
  maximumFractionDigits?: number;
}

const DEFAULT_CURRENCY = 'NGN';
const DEFAULT_LOCALE = 'en-GB';

/** Symbol for a currency code, e.g. "NGN" -> "₦", "USD" -> "$". Falls back to the code. */
export function currencySymbol(currency?: string | null, locale = DEFAULT_LOCALE): string {
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** "₦8,500,000" for NGN, "$1,200" for USD. */
export function formatMoney(amount: number | null | undefined, options: MoneyFormatOptions = {}): string {
  const num = Number(amount ?? 0);
  const value = Number.isFinite(num) ? num : 0;
  const digits = options.maximumFractionDigits ?? 0;
  const symbol = currencySymbol(options.currency, options.locale);
  let body: string;
  try {
    body = Math.abs(value).toLocaleString(options.locale ?? DEFAULT_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
  } catch {
    body = Math.abs(value).toFixed(digits);
  }
  return `${value < 0 ? '-' : ''}${symbol}${body}`;
}

/** "₦8.50B", "₦12.40M", "₦3.2K". */
export function formatCompactMoney(amount: number | null | undefined, options: MoneyFormatOptions = {}): string {
  const num = Number(amount ?? 0);
  const value = Number.isFinite(num) ? num : 0;
  const symbol = currencySymbol(options.currency, options.locale);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${symbol}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  return formatMoney(value, options);
}

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short zone name at an instant, e.g. "WAT", "GMT+1", "EST". Falls back to the IANA id. */
export function timeZoneAbbreviation(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) {
      // en-US gives "GMT+1" for Africa/Lagos; the common name is clearer where one exists.
      if (timeZone === 'Africa/Lagos' && /^GMT\+1$/.test(name)) return 'WAT';
      return name;
    }
  } catch {
    // fall through
  }
  return timeZone;
}

/** "19 Nov 2026" in the given zone. */
export function formatDateInZone(
  input: string | Date | null | undefined,
  timeZone?: string | null,
  locale = DEFAULT_LOCALE
): string {
  const d = toDate(input);
  if (!d) return '—';
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  try {
    return d.toLocaleDateString(locale, timeZone ? { ...opts, timeZone } : opts);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * A calendar date ("2026-11-26", no time) as people read it: "26 Nov 2026", the same day in any
 * zone. Used by server-written texts (notifications, labels); anything else is returned as given.
 */
export function formatCalendarDate(date: string | null | undefined): string {
  if (!date) return '—';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return formatDateInZone(`${date}T12:00:00Z`, 'UTC');
}

/** "19 Nov 2026, 14:05 WAT" in the given zone. */
export function formatDateTimeInZone(
  input: string | Date | null | undefined,
  timeZone?: string | null,
  options: { locale?: string; withZone?: boolean } = {}
): string {
  const d = toDate(input);
  if (!d) return '—';
  const locale = options.locale ?? DEFAULT_LOCALE;
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  let text: string;
  try {
    text = d.toLocaleString(locale, timeZone ? { ...opts, timeZone } : opts);
  } catch {
    text = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    return text;
  }
  if (options.withZone !== false && timeZone) {
    text += ` ${timeZoneAbbreviation(timeZone, d)}`;
  }
  return text;
}

/** "14:05" in the given zone. */
export function formatTimeInZone(input: string | Date | null | undefined, timeZone?: string | null): string {
  const d = toDate(input);
  if (!d) return '—';
  try {
    return d.toLocaleTimeString(DEFAULT_LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** UTC offset in minutes of a zone at an instant, e.g. Africa/Lagos -> 60. */
export function timeZoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** Common IANA zones for pickers; any valid IANA id is accepted by the server. */
export const COMMON_TIME_ZONES: string[] = [
  'Africa/Lagos',
  'Africa/Abidjan',
  'Africa/Accra',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Africa/Kigali',
  'Africa/Kinshasa',
  'Africa/Dakar',
  'Africa/Casablanca',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];
