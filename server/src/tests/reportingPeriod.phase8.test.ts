/**
 * Phase 8 Step 1: reporting period maths (shared/src/utils/reportingPeriod.ts). Pure functions.
 * Calendar notes: 2026-11-16 is a Monday, 2026-11-22 a Sunday, 2026-05-31 a Sunday, and the UK
 * moves to BST on 2026-03-29.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCadence,
  getReportingPeriod,
  getReportingPeriodForDate,
  isWithinWorkingHours,
  listWorkdaysInPeriod,
  nextPeriodStart,
  type CadenceSettings,
} from '@insite/shared';

function settings(overrides: Partial<CadenceSettings> = {}): CadenceSettings {
  return {
    reportingCadence: 'WEEKLY',
    workWeekDays: [1, 2, 3, 4, 5, 6],
    periodStartDayOfWeek: 1,
    customIntervalDays: null,
    workdayStartTime: '08:00',
    workdayEndTime: '17:00',
    reportDueTime: null,
    reportGraceMinutes: 0,
    cadenceAnchorDate: null,
    timezone: 'Africa/Lagos',
    ...overrides,
  };
}

type Case = {
  name: string;
  s: Partial<CadenceSettings>;
  date: string;
  expect: { periodStart: string; periodEnd: string; calendarEnd: string; firstWorkday: string | null; dueAt: string; isWorkday: boolean };
};

const CASES: Case[] = [
  {
    name: 'daily: one workday, due 17:00 Lagos (16:00Z)',
    s: { reportingCadence: 'DAILY' },
    date: '2026-11-18',
    expect: { periodStart: '2026-11-18', periodEnd: '2026-11-18', calendarEnd: '2026-11-18', firstWorkday: '2026-11-18', dueAt: '2026-11-18T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'daily: Sunday is not a workday in a six-day week',
    s: { reportingCadence: 'DAILY' },
    date: '2026-11-22',
    expect: { periodStart: '2026-11-22', periodEnd: '2026-11-22', calendarEnd: '2026-11-22', firstWorkday: null, dueAt: '2026-11-22T16:00:00.000Z', isWorkday: false },
  },
  {
    name: 'weekly six-day week: Monday to Saturday, due Saturday',
    s: {},
    date: '2026-11-18',
    expect: { periodStart: '2026-11-16', periodEnd: '2026-11-21', calendarEnd: '2026-11-22', firstWorkday: '2026-11-16', dueAt: '2026-11-21T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'weekly: the Sunday after the due day belongs to the same week',
    s: {},
    date: '2026-11-22',
    expect: { periodStart: '2026-11-16', periodEnd: '2026-11-21', calendarEnd: '2026-11-22', firstWorkday: '2026-11-16', dueAt: '2026-11-21T16:00:00.000Z', isWorkday: false },
  },
  {
    name: 'weekly boundary: Monday starts the next week',
    s: {},
    date: '2026-11-23',
    expect: { periodStart: '2026-11-23', periodEnd: '2026-11-28', calendarEnd: '2026-11-29', firstWorkday: '2026-11-23', dueAt: '2026-11-28T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'weekly five-day week with its own due time',
    s: { workWeekDays: [1, 2, 3, 4, 5], reportDueTime: '15:30' },
    date: '2026-11-17',
    expect: { periodStart: '2026-11-16', periodEnd: '2026-11-20', calendarEnd: '2026-11-22', firstWorkday: '2026-11-16', dueAt: '2026-11-20T14:30:00.000Z', isWorkday: true },
  },
  {
    name: 'period that starts on a non-workday (week starts Sunday)',
    s: { periodStartDayOfWeek: 7 },
    date: '2026-11-18',
    expect: { periodStart: '2026-11-15', periodEnd: '2026-11-21', calendarEnd: '2026-11-21', firstWorkday: '2026-11-16', dueAt: '2026-11-21T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'bi-weekly from the anchor',
    s: { reportingCadence: 'BI_WEEKLY', cadenceAnchorDate: '2026-11-09' },
    date: '2026-11-18',
    expect: { periodStart: '2026-11-09', periodEnd: '2026-11-21', calendarEnd: '2026-11-22', firstWorkday: '2026-11-09', dueAt: '2026-11-21T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'bi-weekly before the anchor counts backwards',
    s: { reportingCadence: 'BI_WEEKLY', cadenceAnchorDate: '2026-11-09' },
    date: '2026-11-01',
    expect: { periodStart: '2026-10-26', periodEnd: '2026-11-07', calendarEnd: '2026-11-08', firstWorkday: '2026-10-26', dueAt: '2026-11-07T16:00:00.000Z', isWorkday: false },
  },
  {
    name: 'custom 10-day interval anchored on a Sunday',
    s: { reportingCadence: 'CUSTOM_INTERVAL', customIntervalDays: 10, cadenceAnchorDate: '2026-11-01' },
    date: '2026-11-05',
    expect: { periodStart: '2026-11-01', periodEnd: '2026-11-10', calendarEnd: '2026-11-10', firstWorkday: '2026-11-02', dueAt: '2026-11-10T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'monthly: month ending on a Sunday is due on the Saturday',
    s: { reportingCadence: 'MONTHLY' },
    date: '2026-05-15',
    expect: { periodStart: '2026-05-01', periodEnd: '2026-05-30', calendarEnd: '2026-05-31', firstWorkday: '2026-05-01', dueAt: '2026-05-30T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'monthly: February',
    s: { reportingCadence: 'MONTHLY' },
    date: '2026-02-03',
    expect: { periodStart: '2026-02-01', periodEnd: '2026-02-28', calendarEnd: '2026-02-28', firstWorkday: '2026-02-02', dueAt: '2026-02-28T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'monthly: December rolls into the next year correctly',
    s: { reportingCadence: 'MONTHLY' },
    date: '2026-12-10',
    expect: { periodStart: '2026-12-01', periodEnd: '2026-12-31', calendarEnd: '2026-12-31', firstWorkday: '2026-12-01', dueAt: '2026-12-31T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'London after the clocks change (BST): 17:00 is 16:00Z',
    s: { reportingCadence: 'DAILY', timezone: 'Europe/London' },
    date: '2026-03-30',
    expect: { periodStart: '2026-03-30', periodEnd: '2026-03-30', calendarEnd: '2026-03-30', firstWorkday: '2026-03-30', dueAt: '2026-03-30T16:00:00.000Z', isWorkday: true },
  },
  {
    name: 'London before the clocks change (GMT): 17:00 is 17:00Z',
    s: { reportingCadence: 'DAILY', timezone: 'Europe/London' },
    date: '2026-03-27',
    expect: { periodStart: '2026-03-27', periodEnd: '2026-03-27', calendarEnd: '2026-03-27', firstWorkday: '2026-03-27', dueAt: '2026-03-27T17:00:00.000Z', isWorkday: true },
  },
];

describe('Phase 8: reporting period maths', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const p = getReportingPeriodForDate(settings(c.s), c.date);
      assert.ok(p);
      assert.deepEqual(
        { periodStart: p.periodStart, periodEnd: p.periodEnd, calendarEnd: p.calendarEnd, firstWorkday: p.firstWorkday, dueAt: p.dueAt, isWorkday: p.isWorkday },
        c.expect
      );
    });
  }

  it('grace minutes move lateAfter, not dueAt', () => {
    const p = getReportingPeriodForDate(settings({ reportGraceMinutes: 90 }), '2026-11-18')!;
    assert.equal(p.dueAt, '2026-11-21T16:00:00.000Z');
    assert.equal(p.lateAfter, '2026-11-21T17:30:00.000Z');
  });

  it('briefs go out on the first workday at the workday start time', () => {
    const p = getReportingPeriodForDate(settings({ periodStartDayOfWeek: 7 }), '2026-11-18')!;
    assert.equal(p.briefAt, '2026-11-16T07:00:00.000Z');
  });

  it('inspection-only has no periods', () => {
    const s = settings({ reportingCadence: 'INSPECTION_ONLY' });
    assert.equal(getReportingPeriodForDate(s, '2026-11-18'), null);
    assert.deepEqual(listWorkdaysInPeriod(s, '2026-11-18'), []);
    assert.equal(nextPeriodStart(s, new Date('2026-11-18T12:00:00Z')), null);
  });

  it('an instant is placed by its date in the project zone, not UTC', () => {
    // 03:00Z on the 23rd is still Sunday 22nd 22:00 in New York: the previous week.
    const p = getReportingPeriod(settings({ timezone: 'America/New_York' }), new Date('2026-11-23T03:00:00Z'))!;
    assert.equal(p.periodStart, '2026-11-16');
    const lagos = getReportingPeriod(settings(), new Date('2026-11-22T23:30:00Z'))!; // 00:30 Monday in Lagos
    assert.equal(lagos.periodStart, '2026-11-23');
  });

  it('lists workdays and the next period start', () => {
    assert.deepEqual(listWorkdaysInPeriod(settings(), '2026-11-18'), [
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
    ]);
    assert.equal(nextPeriodStart(settings(), new Date('2026-11-18T12:00:00Z')), '2026-11-23');
    assert.equal(
      nextPeriodStart(settings({ reportingCadence: 'MONTHLY' }), new Date('2026-12-18T12:00:00Z')),
      '2027-01-01'
    );
  });

  it('working hours follow the work week and day', () => {
    const s = settings();
    assert.equal(isWithinWorkingHours(s, new Date('2026-11-18T09:00:00Z')), true); // Wed 10:00
    assert.equal(isWithinWorkingHours(s, new Date('2026-11-18T17:00:00Z')), false); // Wed 18:00
    assert.equal(isWithinWorkingHours(s, new Date('2026-11-22T09:00:00Z')), false); // Sunday
  });

  it('describes a weekly cadence in plain language', () => {
    assert.equal(describeCadence(settings(), '2026-11-18'), 'Briefs go out Monday 08:00. Reports are due Saturday 17:00.');
  });
});
