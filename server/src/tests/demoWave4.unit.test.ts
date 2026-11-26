/**
 * Client demo updates, wave 4 (no database): the payments breakdown (G.1/G.2) and the visit
 * calendar grids (D4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentsBreakdown,
  calendarRange,
  calendarTitle,
  monthGrid,
  NOT_RECORDED_KEY,
  paymentPeriodGroup,
  shiftCalendar,
  weekGrid,
  type BreakdownPayment,
  type BreakdownProject,
} from '@insite/shared';

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const P3 = '00000000-0000-4000-8000-000000000003';

const projects: BreakdownProject[] = [
  { id: P1, code: 'LOT 1 BATCH 1', name: 'Kano school', stateCode: 'KN', stateText: null, lgaCodes: ['KN-GWALE', 'KN-KUMBOTSO'], contractorId: 'c1', contractorName: 'Sahel Build' },
  { id: P2, code: 'LOT 2 BATCH 1', name: 'Lagos school', stateCode: 'LA', stateText: null, lgaCodes: ['LA-IKEJA'], contractorId: 'c2', contractorName: 'Coastal Works' },
  { id: P3, code: 'PRG-900', name: 'Old project', stateCode: null, stateText: null, lgaCodes: [], contractorId: null, contractorName: null },
];

const pay = (projectId: string, paidOn: string, gross: number, kind: BreakdownPayment['kind'] = 'INTERIM', hasException = false): BreakdownPayment => ({
  projectId,
  kind,
  paidOn,
  grossAmountNgn: gross,
  retentionHeldNgn: kind === 'RETENTION_RELEASE' ? 0 : gross * 0.05,
  netAmountNgn: kind === 'RETENTION_RELEASE' ? gross : gross * 0.95,
  hasException,
});

const payments = [
  pay(P1, '2026-02-10', 1000),
  pay(P1, '2026-04-02', 2000, 'INTERIM', true),
  pay(P2, '2026-04-20', 500),
  pay(P2, '2026-05-01', 100, 'RETENTION_RELEASE'),
  pay(P3, '2026-06-30', 300),
];

describe('payments breakdown (G.2)', () => {
  it('totals each payment once and separates retention releases', () => {
    const out = buildPaymentsBreakdown(payments, projects, 'state');
    assert.equal(out.totals.paymentCount, 5);
    assert.equal(out.totals.grossPaidNgn, 3800);
    assert.equal(out.totals.retentionReleasedNgn, 100);
    assert.equal(out.totals.retentionHeldNgn, 190);
    assert.equal(out.totals.netPaidNgn, 3710);
    assert.equal(out.totals.exceptionCount, 1);
    assert.equal(out.totals.projectCount, 3);
  });

  it('groups by State with the zone as context, largest first, "Not recorded" last', () => {
    const out = buildPaymentsBreakdown(payments, projects, 'state');
    assert.deepEqual(out.rows.map((r) => r.key), ['KN', 'LA', NOT_RECORDED_KEY]);
    assert.equal(out.rows[0].label, 'Kano');
    assert.ok(out.rows[0].context);
    assert.equal(out.rows[0].netPaidNgn, 2850);
    assert.equal(out.rows[2].label, 'Not recorded');
  });

  it('counts a multi-LGA project under each LGA and marks those rows', () => {
    const out = buildPaymentsBreakdown(payments, projects, 'lga');
    const kano = out.rows.filter((r) => r.key.startsWith('KN-'));
    assert.equal(kano.length, 2);
    assert.ok(kano.every((r) => r.sharedAcrossGroups && r.paymentCount === 2));
    assert.equal(out.rows.find((r) => r.key === 'LA-IKEJA')?.sharedAcrossGroups, false);
    assert.equal(out.hasSharedGroups, true);
    assert.equal(out.totals.paymentCount, 5);
  });

  it('groups by zone, contractor and project', () => {
    assert.deepEqual(buildPaymentsBreakdown(payments, projects, 'zone').rows.map((r) => r.key), ['NW', 'SW', NOT_RECORDED_KEY]);
    assert.deepEqual(buildPaymentsBreakdown(payments, projects, 'contractor').rows.map((r) => r.label), ['Sahel Build', 'Coastal Works', 'Not recorded']);
    assert.equal(buildPaymentsBreakdown(payments, projects, 'project').rows[0].label, 'LOT 1 BATCH 1 · Kano school');
  });

  it('groups by month and fiscal quarter in date order', () => {
    assert.deepEqual(buildPaymentsBreakdown(payments, projects, 'month').rows.map((r) => r.label), ['Feb 2026', 'Apr 2026', 'May 2026', 'Jun 2026']);
    assert.deepEqual(buildPaymentsBreakdown(payments, projects, 'quarter').rows.map((r) => r.label), ['Q1 FY2026', 'Q2 FY2026']);
    // Fiscal year from April: February 2026 is Q4 of FY2025.
    assert.deepEqual(paymentPeriodGroup('2026-02-10', 'quarter', 4), { key: '2025-Q4', label: 'Q4 FY2025' });
    assert.deepEqual(paymentPeriodGroup('2026-04-02', 'quarter', 4), { key: '2026-Q1', label: 'Q1 FY2026' });
  });
});

describe('visit calendar grids (D4)', () => {
  it('covers a month in Monday–Sunday weeks', () => {
    const weeks = monthGrid('2026-11-26');
    assert.equal(weeks[0][0].date, '2026-10-26');
    assert.equal(weeks[0][0].inMonth, false);
    assert.equal(weeks[0][6].date, '2026-11-01');
    assert.equal(weeks[weeks.length - 1][6].date, '2026-12-06');
    assert.ok(weeks.every((w) => w.length === 7));
    // February 2027 starts on a Monday and ends on a Sunday: exactly 4 weeks.
    assert.equal(monthGrid('2027-02-14').length, 4);
  });

  it('gives the week, the range, the next view and the title', () => {
    assert.deepEqual(weekGrid('2026-11-26').map((d) => d.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    assert.deepEqual(calendarRange('2026-11-26', 'week'), { from: '2026-11-23', to: '2026-11-29' });
    assert.deepEqual(calendarRange('2026-11-26', 'month'), { from: '2026-10-26', to: '2026-12-06' });
    assert.equal(shiftCalendar('2026-12-15', 'month', 1), '2027-01-01');
    assert.equal(shiftCalendar('2026-01-15', 'month', -1), '2025-12-01');
    assert.equal(shiftCalendar('2026-11-26', 'week', -1), '2026-11-16');
    assert.equal(calendarTitle('2026-11-26', 'month'), 'November 2026');
    assert.equal(calendarTitle('2026-11-26', 'week'), '23 – 29 Nov 2026');
    assert.equal(calendarTitle('2026-12-30', 'week'), '28 Dec 2026 – 3 Jan 2027');
  });
});
