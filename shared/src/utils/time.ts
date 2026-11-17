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
