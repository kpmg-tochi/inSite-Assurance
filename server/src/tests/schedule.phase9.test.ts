/**
 * Phase 9 unit tests: shared schedule maths (working days, expected progress, variance, project
 * roll-up, propagation through dependencies, validation, proposals, formatting).
 * Calendar: 2025-03-03 is a Monday; 2025-03-08 a Saturday; 2025-03-09 a Sunday.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addWorkdays,
  countWorkdaysInclusive,
  expectedPctAt,
  formatVariance,
  itemPeriodStatus,
  itemVariance,
  projectVariance,
  propagateShift,
  proposeItemDates,
  ScheduleCycleError,
  validateScheduleBaseline,
  workdaysBetween,
} from '@insite/shared';

const FIVE = [1, 2, 3, 4, 5];
const SIX = [1, 2, 3, 4, 5, 6];

describe('Phase 9 schedule maths', () => {
  describe('addWorkdays / workdaysBetween', () => {
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
        if (c.week.includes(new Date(`${c.from}T00:00:00Z`).getUTCDay() || 7)) {
          assert.equal(workdaysBetween(c.from, c.expected, c.week), c.n, 'inverse');
        }
      });
    }
    it('counts inclusive windows and long spans', () => {
      assert.equal(countWorkdaysInclusive('2025-03-03', '2025-03-09', FIVE), 5);
      assert.equal(countWorkdaysInclusive('2025-03-03', '2025-03-09', SIX), 6);
      assert.equal(countWorkdaysInclusive('2025-03-03', '2025-03-02', SIX), 0);
      assert.equal(workdaysBetween('2025-01-06', '2025-12-29', FIVE), 255);
      assert.equal(workdaysBetween('2025-12-29', '2025-01-06', FIVE), -255);
    });
  });

  describe('expectedPctAt', () => {
    // Two weeks Mon 03-03 to Fri 03-14: 10 working days on a five-day week.
    const item = { plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-14' };
    const cases: Array<[string, number[], number]> = [
      ['2025-03-02', FIVE, 0],
      ['2025-03-03', FIVE, 10],
      ['2025-03-07', FIVE, 50],
      ['2025-03-09', FIVE, 50], // weekend adds nothing
      ['2025-03-14', FIVE, 100],
      ['2025-04-01', FIVE, 100],
      ['2025-03-08', SIX, (6 / 11) * 100], // Saturday counts on a six-day week (11 days in window)
    ];
    for (const [date, week, pct] of cases) {
      it(`${date} -> ${pct.toFixed(1)}%`, () => assert.ok(Math.abs(expectedPctAt(item, date, week) - pct) < 1e-9));
    }
  });

  describe('itemVariance', () => {
    const item = { id: 'a', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-14' }; // 10 days
    const cases: Array<{ name: string; progress: number; today: string; status: string; variance: number | null; label: string }> = [
      { name: 'before start, nothing done', progress: 0, today: '2025-02-20', status: 'NOT_STARTED', variance: 0, label: 'On schedule' },
      { name: 'start day, nothing done yet', progress: 0, today: '2025-03-03', status: 'NOT_STARTED', variance: 0, label: 'On schedule' },
      { name: 'exactly on plan', progress: 50, today: '2025-03-10', status: 'ON_TRACK', variance: 0, label: 'On schedule' },
      { name: 'one week behind', progress: 0, today: '2025-03-10', status: 'BEHIND', variance: -5, label: '1 week behind' },
      { name: 'within half a week', progress: 40, today: '2025-03-10', status: 'ON_TRACK', variance: -1, label: 'On schedule' },
      { name: 'ahead before start', progress: 50, today: '2025-03-03', status: 'AHEAD', variance: 5, label: '1 week ahead' },
      { name: 'late after end', progress: 50, today: '2025-03-24', status: 'BEHIND', variance: -10, label: '2 weeks behind' },
      { name: 'complete', progress: 100, today: '2025-03-24', status: 'COMPLETE', variance: 0, label: 'On schedule' },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const v = itemVariance(item, c.progress, c.today, FIVE);
        assert.equal(v.status, c.status);
        assert.equal(v.varianceWorkdays, c.variance);
        assert.equal(formatVariance(v.varianceWorkdays, FIVE), c.label);
      });
    }
    it('completed early counts as ahead by the days saved', () => {
      const v = itemVariance({ ...item, actualCompletionDate: '2025-03-07' }, 100, '2025-03-24', FIVE);
      assert.equal(v.status, 'COMPLETE');
      assert.equal(v.varianceWorkdays, 5);
    });
    it('unscheduled items have no variance', () => {
      const v = itemVariance({ id: 'x', plannedStartDate: null, plannedEndDate: null }, 30, '2025-03-10', FIVE);
      assert.equal(v.status, 'UNSCHEDULED');
      assert.equal(v.varianceWorkdays, null);
      assert.equal(formatVariance(null), 'Not scheduled');
    });
  });

  describe('formatVariance', () => {
    const cases: Array<[number, number[], string]> = [
      [0, SIX, 'On schedule'],
      [1, SIX, 'On schedule'], // nearer zero than half a six-day week (3)
      [2, SIX, '0.5 weeks ahead'],
      [3, SIX, '0.5 weeks ahead'],
      [6, SIX, '1 week ahead'],
      [-24, SIX, '4 weeks behind'],
      [-9, SIX, '1.5 weeks behind'],
      [-10, FIVE, '2 weeks behind'],
    ];
    for (const [days, week, label] of cases) it(`${days} days (${week.length}-day week) = "${label}"`, () => assert.equal(formatVariance(days, week), label));
  });

  describe('projectVariance', () => {
    it('is budget-weighted and forecasts the end through dependencies', () => {
      const items = [
        // A: two weeks, done; B: two weeks from 03-17, 0% on 03-24 (one week behind); C after B.
        { id: 'A', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-14', weight: 100, progressPct: 100, actualCompletionDate: '2025-03-14' },
        { id: 'B', plannedStartDate: '2025-03-17', plannedEndDate: '2025-03-28', weight: 300, progressPct: 0 },
        { id: 'C', plannedStartDate: '2025-03-31', plannedEndDate: '2025-04-04', weight: 100, progressPct: 0 },
      ];
      const deps = [
        { predecessorId: 'A', successorId: 'B', lagWorkdays: 0 },
        { predecessorId: 'B', successorId: 'C', lagWorkdays: 0 },
      ];
      const v = projectVariance(items, '2025-03-24', FIVE, deps);
      // (100*0 + 300*-5 + 100*0) / 500 = -3
      assert.equal(v.varianceWorkdays, -3);
      assert.equal(v.status, 'BEHIND');
      assert.equal(v.plannedEndDate, '2025-04-04');
      // B: 10 days from 03-24 -> 04-04; C: 5 days from 04-07 -> 04-11.
      assert.equal(v.forecastEndDate, '2025-04-11');
      assert.equal(v.forecastSlipWorkdays, 5);
    });
    it('reports unscheduled when nothing has dates', () => {
      const v = projectVariance([{ id: 'A', plannedStartDate: null, plannedEndDate: null, progressPct: 0 }], '2025-03-24', FIVE);
      assert.equal(v.status, 'UNSCHEDULED');
      assert.equal(v.varianceWorkdays, null);
    });
  });

  describe('propagateShift', () => {
    const items = [
      { id: 'A', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-07' },
      { id: 'B', plannedStartDate: '2025-03-10', plannedEndDate: '2025-03-14' },
      { id: 'C', plannedStartDate: '2025-03-10', plannedEndDate: '2025-03-12' },
      { id: 'D', plannedStartDate: '2025-03-17', plannedEndDate: '2025-03-21' },
      { id: 'E', plannedStartDate: '2025-05-05', plannedEndDate: '2025-05-09' }, // far later, unaffected
      { id: 'U', plannedStartDate: null, plannedEndDate: null },
    ];
    // Diamond: A -> B -> D, A -> C -> D (C has two days' lag into D).
    const diamond = [
      { predecessorId: 'A', successorId: 'B', lagWorkdays: 0 },
      { predecessorId: 'A', successorId: 'C', lagWorkdays: 0 },
      { predecessorId: 'B', successorId: 'D', lagWorkdays: 0 },
      { predecessorId: 'C', successorId: 'D', lagWorkdays: 2 },
      { predecessorId: 'D', successorId: 'E', lagWorkdays: 0 },
    ];
    it('shifts a chain and keeps durations (diamond)', () => {
      const out = propagateShift(items, diamond, [{ boqItemId: 'A', shiftWorkdays: 5 }], FIVE);
      const byId = Object.fromEntries(out.map((a) => [a.boqItemId, a]));
      assert.deepEqual(Object.keys(byId).sort(), ['A', 'B', 'C', 'D']);
      assert.equal(byId.A.newStartDate, '2025-03-10');
      assert.equal(byId.A.newEndDate, '2025-03-14');
      assert.equal(byId.A.cause, 'REQUESTED');
      assert.equal(byId.B.newStartDate, '2025-03-17');
      assert.equal(byId.B.newEndDate, '2025-03-21');
      assert.equal(byId.C.newStartDate, '2025-03-17');
      assert.equal(byId.C.newEndDate, '2025-03-19');
      // D waits for B (03-21) and for C plus two days (03-19 + 2 -> 03-21): first allowed 03-24.
      assert.equal(byId.D.newStartDate, '2025-03-24');
      assert.equal(byId.D.newEndDate, '2025-03-28');
      assert.equal(byId.D.cause, 'DEPENDENCY');
      assert.equal(byId.D.shiftWorkdays, 5);
    });
    it('respects lag in a six-day week', () => {
      const out = propagateShift(
        [
          { id: 'P', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-08' },
          { id: 'S', plannedStartDate: '2025-03-10', plannedEndDate: '2025-03-11' },
        ],
        [{ predecessorId: 'P', successorId: 'S', lagWorkdays: 1 }],
        [{ boqItemId: 'P', newStartDate: '2025-03-04' }],
        SIX
      );
      const s = out.find((a) => a.boqItemId === 'S')!;
      // P now 03-04 to 03-10 (six days, Sunday skipped); S from 03-10 + 1 + 1 = 03-12.
      assert.equal(out.find((a) => a.boqItemId === 'P')!.newEndDate, '2025-03-10');
      assert.equal(s.newStartDate, '2025-03-12');
      assert.equal(s.newEndDate, '2025-03-13');
    });
    it('never pulls successors earlier and leaves slack alone', () => {
      const out = propagateShift(items, diamond, [{ boqItemId: 'A', shiftWorkdays: -1 }], FIVE);
      assert.deepEqual(out.map((a) => a.boqItemId), ['A']);
    });
    it('detects a cycle', () => {
      assert.throws(
        () =>
          propagateShift(
            items,
            [...diamond, { predecessorId: 'D', successorId: 'A', lagWorkdays: 0 }],
            [{ boqItemId: 'A', shiftWorkdays: 1 }],
            FIVE
          ),
        (e: unknown) => e instanceof ScheduleCycleError && e.itemIds.includes('A') && e.itemIds.includes('D')
      );
    });
  });

  describe('validateScheduleBaseline', () => {
    const base = {
      plannedStartDate: '2025-03-03',
      plannedEndDate: '2025-06-30',
      workWeekDays: FIVE,
    };
    it('accepts a valid baseline', () => {
      const issues = validateScheduleBaseline({
        ...base,
        items: [
          { id: 'A', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-07' },
          { id: 'B', plannedStartDate: '2025-03-10', plannedEndDate: '2025-03-14' },
        ],
        dependencies: [{ predecessorId: 'A', successorId: 'B', lagWorkdays: 0 }],
      });
      assert.deepEqual(issues, []);
    });
    it('reports every kind of problem', () => {
      const issues = validateScheduleBaseline({
        ...base,
        items: [
          { id: 'A', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-07' },
          { id: 'B', plannedStartDate: '2025-03-06', plannedEndDate: '2025-03-14' }, // too early after A
          { id: 'C', plannedStartDate: '2025-02-01', plannedEndDate: '2025-02-10' }, // before the project
          { id: 'D', plannedStartDate: '2025-03-10', plannedEndDate: null }, // incomplete
          { id: 'E', plannedStartDate: '2025-03-14', plannedEndDate: '2025-03-10' }, // reversed
        ],
        dependencies: [
          { predecessorId: 'A', successorId: 'B', lagWorkdays: 0 },
          { predecessorId: 'B', successorId: 'A', lagWorkdays: 0 },
          { predecessorId: 'C', successorId: 'C', lagWorkdays: 0 },
        ],
      });
      const codes = new Set(issues.map((i) => i.code));
      for (const code of [
        'SUCCESSOR_STARTS_TOO_EARLY',
        'ITEM_OUTSIDE_PROJECT',
        'ITEM_DATES_INCOMPLETE',
        'ITEM_END_BEFORE_START',
        'DEPENDENCY_SELF',
        'DEPENDENCY_CYCLE',
      ]) {
        assert.ok(codes.has(code as never), `expected ${code}`);
      }
    });
  });

  describe('proposeItemDates', () => {
    it('runs sections in order, sized by budget, and items by daily target', () => {
      const out = proposeItemDates(
        [
          { id: 'a1', section: 'S1', totalQuantity: 30, dailyTargetQuantity: 10, budgetedCostNgn: 100 },
          { id: 'a2', section: 'S1', totalQuantity: 30, dailyTargetQuantity: null, budgetedCostNgn: 100 },
          { id: 'b1', section: 'S2', totalQuantity: 30, dailyTargetQuantity: null, budgetedCostNgn: 200 },
        ],
        '2025-03-03',
        '2025-03-28', // 20 working days on a five-day week
        FIVE
      );
      const byId = Object.fromEntries(out.map((o) => [o.boqItemId, o]));
      assert.deepEqual(byId.a1, { boqItemId: 'a1', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-05' });
      assert.deepEqual(byId.a2, { boqItemId: 'a2', plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-14' });
      assert.deepEqual(byId.b1, { boqItemId: 'b1', plannedStartDate: '2025-03-17', plannedEndDate: '2025-03-28' });
      const issues = validateScheduleBaseline({
        plannedStartDate: '2025-03-03',
        plannedEndDate: '2025-03-28',
        workWeekDays: FIVE,
        items: out.map((o) => ({ id: o.boqItemId, ...o })),
        dependencies: [],
      });
      assert.deepEqual(issues, []);
    });
  });

  describe('itemPeriodStatus', () => {
    const cases: Array<[string | null, string | null, number, string]> = [
      ['2025-03-03', '2025-03-14', 0, 'DUE_THIS_PERIOD'],
      ['2025-03-17', '2025-03-21', 0, 'UPCOMING'],
      ['2025-02-17', '2025-02-21', 50, 'OVERDUE'],
      ['2025-02-17', '2025-02-21', 100, 'COMPLETE'],
      [null, null, 0, 'UNSCHEDULED'],
    ];
    for (const [s, e, p, expected] of cases) {
      it(`${s}..${e} at ${p}% -> ${expected}`, () =>
        assert.equal(itemPeriodStatus({ plannedStartDate: s, plannedEndDate: e, progressPct: p }, '2025-03-10', '2025-03-15'), expected));
    }
  });
});
