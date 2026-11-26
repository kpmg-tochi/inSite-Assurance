/** Calendar-date helpers for the Overview (YYYY-MM-DD / YYYY-MM strings; no zone shift). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of a YYYY-MM-DD date (chart x values; Apex formats datetime axes in UTC). */
export function dateMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** "24 Nov 2026" from YYYY-MM-DD. */
export function fmtDay(date: string, withYear = true): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function fmtDayFromMs(ms: number, withYear = true): string {
  return fmtDay(new Date(ms).toISOString().slice(0, 10), withYear);
}

export function fmtRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDay(start, !sameYear)} – ${fmtDay(end)}`;
}

/** "Nov" or "Nov 2026" from YYYY-MM. */
export function fmtMonth(month: string, withYear = false): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTHS[(m || 1) - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

/** "Q3 2026" from "2026-Q3". */
export function fmtQuarter(quarter: string): string {
  const match = /^(\d{4})-Q(\d)$/.exec(quarter);
  return match ? `Q${match[2]} ${match[1]}` : quarter;
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "–" : `${value.toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
