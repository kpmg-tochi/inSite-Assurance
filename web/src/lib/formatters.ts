import {
  currencySymbol,
  formatCompactMoney,
  formatDateInZone,
  formatDateTimeInZone,
  formatMoney,
  formatRegistrationShort,
  timeZoneAbbreviation,
} from '@insite/shared';

/**
 * Display context for money and dates (Phase 6): the signed-in tenant's currency and time zone.
 * Set once by the auth context when the user loads; formatters below read it, so call sites do
 * not change. Before sign-in the defaults are NGN and the browser zone.
 */
const display: { currency: string; timeZone: string | null } = { currency: 'NGN', timeZone: null };

export function setDisplayContext(ctx: { currency?: string | null; timeZone?: string | null }) {
  display.currency = ctx.currency || 'NGN';
  display.timeZone = ctx.timeZone || null;
}

export function displayCurrency(): string {
  return display.currency;
}

export function displayCurrencySymbol(): string {
  return currencySymbol(display.currency);
}

/** The tenant's time zone (Phase 16: KPI periods), or the browser's before the profile loads. */
export function displayTimeZone(): string {
  return display.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos';
}

/** Short zone label for column headers, e.g. "WAT" (was hardcoded). */
export function displayZoneLabel(): string {
  return display.timeZone ? timeZoneAbbreviation(display.timeZone) : 'local time';
}

/** Money in the tenant currency. (Name kept from when everything was Naira.) */
export function formatNaira(amount: number | null | undefined): string {
  return formatMoney(amount, { currency: display.currency });
}

export function formatCompactNaira(amount: number | null | undefined): string {
  return formatCompactMoney(amount, { currency: display.currency });
}

export function getInitials(fullName: string): string {
  if (!fullName) return 'IS';
  const cleaned = fullName
    .replace(/^(QS|Engr\.|Dr\.|Arc\.|Mr\.|Mrs\.|Ms\.)\s+/i, '')
    .split(',')[0]
    .trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Phase 12: "QSRBN #3842", or null when there is no registration number (nothing is shown; the
 * old "Verified Credential" placeholder claimed something that was not on file).
 */
export function formatRegistrationCredential(bodyCode?: string | null, number?: string | null): string | null {
  return formatRegistrationShort({ bodyCode, number });
}

export function formatDateShort(isoString?: string | null): string {
  return formatDateInZone(isoString, display.timeZone);
}

/** Date and time in the tenant zone, e.g. "19 Nov 2026, 14:05". */
export function formatDateTimeShort(isoString?: string | null): string {
  return formatDateTimeInZone(isoString, display.timeZone, { withZone: false });
}

