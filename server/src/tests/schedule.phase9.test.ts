/**
 * Phase 9 unit tests, after redesign R2d: the working-day and planned-window helpers that survive
 * (earned-schedule variance, dependencies, propagation and proposals were removed), and the
 * sprint-based schedule badge that replaced them (D-R2.15), and the calendar helpers moved out of the
 * deleted reporting-period maths in redesign R5f.
 * Calendar: 2025-03-03 is a Monday; 2025-03-08 a Saturday; 2025-03-09 a Sunday.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addWorkdays, daysBetween, isoWeekday, sprintScheduleStatus, windowEnd, windowOverlaps, zonedCalendarDate } from '@insite/shared';

const FIVE = [1, 2, 3, 4, 5];
const SIX = [1, 2, 3, 4, 5, 6];

describe('Phase 9 schedule helpers', () => {
  describe('addWorkdays', () => {
    const cases: Array<{ from: string; n: number; week: number[]; expected: string }> = [
      { from: '2025-03-03', n: 0, week: FIVE, expected: '2025-03-03' },
      { from: '2025-03-03', n: 1, week: FIVE, expected: '2025-03-04' },
      { from: '2025-03-07', n: 1, week: FIVE, expected: '2025-03-10' }, // Fri -> Mon
      { from: '2025-03-07', n: 1, week: SIX, expected: '2025-03-08' }, // Fri -> Sat on a six-day week
      { from: '2025-03-08', n: 1, week: SIX, expected: '2025-03-10' }, // Sat -> Mon
      { from: '2025-03-03', n: 10, week: FIVE, expected: '2025-03-17' },
      { from: '2025-03-03', n: 12, week: SIX, expected: '2025-03-17' },
      { from: '2025-03-10', n: -1, week: FIVE, expected: '2025-03-07' },
      { from: '2025-03-09', n: 1, week: FIVE, expected: '2025-03-10' }, // from a Sunday
    ];
    for (const c of cases) {
      it(`${c.from} + ${c.n} (${c.week.length}-day week) = ${c.expected}`, () => {
        assert.equal(addWorkdays(c.from, c.n, c.week), c.expected);
      });
    }
  });

  it('windowEnd starts on the next working day', () => {
    assert.equal(windowEnd('2025-03-08', 5, FIVE), '2025-03-14'); // Sat -> Mon..Fri
    assert.equal(windowEnd('2025-03-03', 1, SIX), '2025-03-03');
  });

  it('windowOverlaps is inclusive and needs both dates', () => {
    assert.equal(windowOverlaps('2025-03-01', '2025-03-10', '2025-03-10', '2025-03-15'), true);
    assert.equal(windowOverlaps('2025-03-16', '2025-03-20', '2025-03-10', '2025-03-15'), false);
    assert.equal(windowOverlaps(null, '2025-03-20', '2025-03-10', '2025-03-15'), false);
  });
});

describe('Redesign R5f: calendar helpers (utils/calendar)', () => {
  it('adds days across month and year ends, and counts days between dates', () => {
    assert.equal(addDays('2025-02-27', 2), '2025-03-01');
    assert.equal(addDays('2025-12-31', 1), '2026-01-01');
    assert.equal(addDays('2025-03-01', -1), '2025-02-28');
    assert.equal(daysBetween('2025-03-03', '2025-03-10'), 7);
    assert.equal(daysBetween('2025-03-10', '2025-03-03'), -7);
  });

  it('gives ISO weekdays (Monday 1, Sunday 7)', () => {
    assert.equal(isoWeekday('2025-03-03'), 1);
    assert.equal(isoWeekday('2025-03-08'), 6);
    assert.equal(isoWeekday('2025-03-09'), 7);
  });

  it('places an instant on its date in the zone, not UTC', () => {
    assert.equal(zonedCalendarDate('2025-03-03T23:30:00.000Z', 'Africa/Lagos'), '2025-03-04');
    assert.equal(zonedCalendarDate('2025-03-03T23:30:00.000Z', 'UTC'), '2025-03-03');
  });
});

describe('Redesign R2d: schedule badge from sprints', () => {
  const sprints = [
    { number: 1, startDate: '2025-03-03', endDate: '2025-03-31' },
    { number: 2, startDate: '2025-04-01', endDate: '2025-04-30' },
  ];
  const base = { sprints, lineCount: 3, allLinesComplete: false };

  it('is UNSCHEDULED without sprints and COMPLETE when every line is done', () => {
    assert.equal(sprintScheduleStatus({ ...base, today: '2025-03-10', sprints: [], units: [] }).status, 'UNSCHEDULED');
    assert.equal(sprintScheduleStatus({ ...base, today: '2025-05-10', units: [], allLinesComplete: true }).status, 'COMPLETE');
  });

  it('is NOT_STARTED before sprint 1', () => {
    assert.equal(sprintScheduleStatus({ ...base, today: '2025-03-02', units: [{ endSprintNumber: 1, complete: false }] }).status, 'NOT_STARTED');
  });

  it('is BEHIND when a unit due by an ended sprint is not complete', () => {
    const units = [
      { endSprintNumber: 1, complete: false },
      { endSprintNumber: 2, complete: false },
    ];
    assert.deepEqual(sprintScheduleStatus({ ...base, today: '2025-03-31', units }), { status: 'ON_TRACK', behindUnitCount: 0 }, 'the end day still counts');
    assert.deepEqual(sprintScheduleStatus({ ...base, today: '2025-04-01', units }), { status: 'BEHIND', behindUnitCount: 1 });
    assert.deepEqual(
      sprintScheduleStatus({ ...base, today: '2025-04-01', units: [{ endSprintNumber: 1, complete: true }, units[1]] }),
      { status: 'ON_TRACK', behindUnitCount: 0 }
    );
  });

  it('ignores units without an end sprint', () => {
    assert.equal(sprintScheduleStatus({ ...base, today: '2025-06-01', units: [{ endSprintNumber: null, complete: false }] }).status, 'ON_TRACK');
  });
});
