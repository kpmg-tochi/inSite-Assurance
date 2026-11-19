/**
 * Formats a UTC ISO datestring or Date into a compact relative elapsed time string
 * (e.g., "Just now", "2m", "3h", "5d", "2w", "3mo", "1y").
 */
export function formatElapsedTime(
  utcDateInput: string | Date | null | undefined,
  now: Date = new Date()
): string {
  if (!utcDateInput) return '';
  const date =
    utcDateInput instanceof Date ? utcDateInput : new Date(utcDateInput);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return '';

  const diffSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestamp) / 1000)
  );

  if (diffSeconds < 60) return 'Just now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y`;
}

/**
 * Calendar date (YYYY-MM-DD) of `instant` in an IANA time zone, e.g. "Africa/Lagos".
 * Falls back to UTC when the zone is unknown to the runtime.
 */
export function calendarDateInTimeZone(instant: string | Date, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error('calendarDateInTimeZone: invalid date');
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** True when `timeZone` is an IANA zone this runtime can format with. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
