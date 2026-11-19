import {
  currencySymbol,
  formatCompactMoney,
  formatDateInZone,
  formatDateTimeInZone,
  formatMoney,
  PROFESSIONAL_LICENSE_META,
  ProfessionalLicenseType,
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

export function formatLicenseCredential(
  licenseType?: ProfessionalLicenseType | null,
  licenseNumber?: string | null
): string {
  if (!licenseType || !licenseNumber) {
    return 'Verified Credential';
  }
  const meta = PROFESSIONAL_LICENSE_META[licenseType];
  return `${meta ? meta.code : licenseType} #${licenseNumber}`;
}

export function formatDateShort(isoString?: string | null): string {
  return formatDateInZone(isoString, display.timeZone);
}

/** Date and time in the tenant zone, e.g. "19 Nov 2026, 14:05". */
export function formatDateTimeShort(isoString?: string | null): string {
  return formatDateTimeInZone(isoString, display.timeZone, { withZone: false });
}

