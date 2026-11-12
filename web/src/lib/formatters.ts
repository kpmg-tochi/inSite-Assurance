import {
  PROFESSIONAL_LICENSE_META,
  ProfessionalLicenseType,
} from '@insite/shared';

export function formatNaira(amount: number | null | undefined): string {
  const num = Number(amount ?? 0);
  return `₦${num.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatCompactNaira(amount: number | null | undefined): string {
  const num = Number(amount ?? 0);
  if (Math.abs(num) >= 1_000_000_000) {
    return `₦${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(num) >= 1_000_000) {
    return `₦${(num / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(num) >= 1_000) {
    return `₦${(num / 1_000).toFixed(1)}K`;
  }
  return `₦${num.toLocaleString()}`;
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
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTimeShort(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

