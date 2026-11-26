/**
 * Client demo updates, wave 3 (no database): the contractor flag rule (F.4) and the budget-mismatch
 * red flag (E3).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetMismatch,
  CONTRACTOR_FLAG_ACTION_META,
  contractorFlagDue,
  contractorFlagSummary,
  DecideContractorFlagActionRequestSchema,
  RecordPaymentRequestSchema,
  type FlagRuleReport,
} from '@insite/shared';

const rule = { enabled: true, reportCount: 3, workmanshipAtOrBelow: 3, withinDays: 60 };
const r = (date: string, workmanship: number, n = date): FlagRuleReport => ({
  visitSubmissionId: `00000000-0000-4000-8000-${n.replace(/-/g, '').padStart(12, '0').slice(-12)}`,
  visitId: '00000000-0000-4000-8000-000000000001',
  date,
  workmanship,
  label: `Routine monitoring visit of ${date}`,
});

describe('contractor flag rule (F.4)', () => {
  it('is due with 3 reports at or below 3 in 60 days', () => {
    const out = contractorFlagDue([r('2026-11-20', 3), r('2026-10-30', 2), r('2026-10-01', 3), r('2026-11-10', 5)], rule, '2026-11-25');
    assert.equal(out.due, true);
    assert.deepEqual(out.evidence.map((e) => e.date), ['2026-11-20', '2026-10-30', '2026-10-01']);
  });

  it('ignores old, good and future reports, and a switched-off rule', () => {
    const reports = [r('2026-11-20', 3), r('2026-09-01', 2), r('2026-11-22', 4), r('2026-12-01', 1)];
    assert.equal(contractorFlagDue(reports, rule, '2026-11-25').due, false);
    assert.equal(contractorFlagDue([r('2026-11-20', 1), r('2026-11-19', 1), r('2026-11-18', 1)], { ...rule, enabled: false }, '2026-11-25').due, false);
    assert.equal(contractorFlagSummary(rule, 3), 'monitoring reports rated workmanship 3 or below in 60 days'.replace(/^/, '3 ') + ' (rule: 3)');
  });

  it('describes every action and validates decisions', () => {
    assert.equal(CONTRACTOR_FLAG_ACTION_META.PAYMENT_HOLD.initialStatus, 'IN_EFFECT');
    assert.equal(CONTRACTOR_FLAG_ACTION_META.DEDUCTION.initialStatus, 'SENT_TO_LEGAL_REVIEW');
    assert.equal(CONTRACTOR_FLAG_ACTION_META.NO_FURTHER_ACTION.closesFlag, true);
    assert.ok(!DecideContractorFlagActionRequestSchema.safeParse({ kind: 'ADDITIONAL_VISITS', reason: 'Low workmanship' }).success);
    assert.ok(DecideContractorFlagActionRequestSchema.safeParse({ kind: 'ADDITIONAL_VISITS', reason: 'Low workmanship', visitCount: 2 }).success);
    assert.ok(!DecideContractorFlagActionRequestSchema.safeParse({ kind: 'PAYMENT_HOLD', reason: 'no' }).success);
  });

  it('accepts an override reason on a payment recorded during a hold', () => {
    const base = { kind: 'INTERIM', paidOn: '2026-11-20', grossAmountNgn: 1_000_000, reference: 'PV/2026/101' };
    assert.ok(RecordPaymentRequestSchema.safeParse({ ...base, holdOverrideReason: 'Certified works before the hold' }).success);
    assert.ok(RecordPaymentRequestSchema.safeParse(base).success);
  });
});

describe('budget mismatch (E3)', () => {
  it('flags a budget outside the tolerance', () => {
    const m = budgetMismatch(84_000_000, 71_500_000, 10, 'MG_BEAP');
    assert.equal(m.differencePct, 17.5);
    assert.equal(m.flagged, true);
    assert.equal(m.summary, 'Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)');
  });

  it('passes within the tolerance and without a budget', () => {
    assert.equal(budgetMismatch(75_000_000, 71_500_000).flagged, false);
    assert.equal(budgetMismatch(60_000_000, 71_500_000).flagged, true);
    const none = budgetMismatch(null, 71_500_000);
    assert.equal(none.flagged, false);
    assert.equal(none.differencePct, null);
  });
});
