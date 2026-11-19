import {
  calendarDateInTimeZone,
  DEFAULT_WORK_WEEK_DAYS,
  formatDueLabel,
  getReportingPeriodForDate,
  isWithinWorkingHours,
  periodNoun,
  type CadenceSettings,
  type MobileBaselinePack,
  type ReportingCadence,
} from '@insite/shared';

/**
 * Reporting cadence on the device (Phase 8). Settings come from the project's baseline pack and all
 * maths is the shared module, so the app agrees with the server on what is due when.
 */

/** A period as a calendar window: reports with workday_date in [start, end] belong to it. */
export interface PeriodWindow {
  start: string;
  end: string;
}

export interface DevicePeriod extends PeriodWindow {
  cadence: ReportingCadence;
  /** null for inspection-only projects (nothing is due). */
  dueAt: string | null;
  lateAfter: string | null;
  timezone: string;
}

/** Settings from a pack. Packs saved before Phase 8 have none: daily, Monday to Saturday. */
export function cadenceSettingsFromPack(pack: MobileBaselinePack | null | undefined, fallbackTimeZone: string): CadenceSettings {
  if (pack?.cadence) return { ...pack.cadence, timezone: pack.cadence.timezone || pack.timezone || fallbackTimeZone };
  return {
    reportingCadence: pack?.reportingCadence ?? 'DAILY',
    workWeekDays: DEFAULT_WORK_WEEK_DAYS,
    periodStartDayOfWeek: 1,
    customIntervalDays: null,
    workdayStartTime: '07:00',
    workdayEndTime: '19:00',
    reportDueTime: null,
    reportGraceMinutes: 0,
    cadenceAnchorDate: null,
    timezone: pack?.timezone || fallbackTimeZone,
  };
}

/** The period containing `at`. Inspection-only projects use the day itself with no due time. */
export function periodAt(settings: CadenceSettings, at: Date = new Date()): DevicePeriod {
  const today = calendarDateInTimeZone(at, settings.timezone);
  const p = getReportingPeriodForDate(settings, today);
  if (!p) return { start: today, end: today, cadence: settings.reportingCadence, dueAt: null, lateAfter: null, timezone: settings.timezone };
  return {
    start: p.periodStart,
    end: p.calendarEnd,
    cadence: settings.reportingCadence,
    dueAt: p.dueAt,
    lateAfter: p.lateAfter,
    timezone: settings.timezone,
  };
}

/** Wording that follows the cadence: "This week's deliverables", "Weekly report". */
export function cadenceCopy(cadence: ReportingCadence) {
  const n = periodNoun(cadence);
  return {
    deliverablesHeading: `${n.current} deliverables`,
    reportNoun: n.report,
    submittedLabel: cadence === 'DAILY' ? 'Submitted today' : cadence === 'INSPECTION_ONLY' ? 'Submitted' : 'Submitted this period',
    pendingLabel: cadence === 'DAILY' ? 'Not yet reported today' : cadence === 'INSPECTION_ONLY' ? 'Not yet reported' : 'Not yet reported this period',
  };
}

/** "Due Sat 17:00", "Overdue since Sat 17:00", or null when nothing is due. */
export function dueStatus(period: DevicePeriod, now: Date = new Date()): { label: string; overdue: boolean; minutesLeft: number } | null {
  if (!period.dueAt || !period.lateAfter) return null;
  const label = formatDueLabel(period.dueAt, period.timezone);
  const overdue = now.getTime() > new Date(period.lateAfter).getTime();
  const minutesLeft = Math.round((new Date(period.dueAt).getTime() - now.getTime()) / 60_000);
  return { label: overdue ? `Overdue since ${label}` : `Due ${label}`, overdue, minutesLeft };
}

/** "2d 4h left", "3h 10m left", "25m left". */
export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'due now';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/**
 * Whether foreground presence pings should be recorded now: inside the project's working hours on a
 * working day. Inspection-only projects only ping on check-in, capture and report.
 */
export function presenceWindowOpen(settings: CadenceSettings, at: Date = new Date()): boolean {
  if (settings.reportingCadence === 'INSPECTION_ONLY') return false;
  return isWithinWorkingHours(settings, at);
}
