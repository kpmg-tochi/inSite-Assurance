/**
 * Phase 13 unit tests: contract milestone due-date maths (calendar vs working days, negative
 * offsets, chained milestones, missing anchors), live status, template validation, the
 * CONTRACT_DEFAULT chain rules, the CONTRACT_MILESTONE_DONE payment rule and kick-off quorum.
 *
 * Calendar: 2026-03-02 is a Monday; 2026-03-06 a Friday; 2026-03-09 a Monday.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMilestoneDueDates,
  contractMilestoneTemplateIssues,
  defaultContractDefaultChain,
  deriveMilestoneStatus,
  describeMilestoneAnchor,
  evaluateMilestoneCompletion,
  kickoffQuorumMet,
  MilestoneDateRow,
  milestoneDaysLeft,
  ProjectContractStepSchema,
  ProjectTypeConfigSchema,
  validateApprovalChain,
} from '@insite/shared';

const MON_FRI = [1, 2, 3, 4, 5];
const anchors = { CONTRACT_AWARD: '2026-02-20', CONTRACT_SIGNED: '2026-02-25', KICKOFF: '2026-03-02', ACTIVATION: null };

function row(over: Partial<MilestoneDateRow> & Pick<MilestoneDateRow, 'id' | 'key'>): MilestoneDateRow {
  return { projectContractorId: null, anchor: 'KICKOFF', anchorMilestoneKey: null, offsetValue: 0, offsetUnit: 'CALENDAR_DAYS', ...over };
}

describe('Phase 13: contract milestone dates', () => {
  it('table: calendar and working days, negative offsets, missing anchors', () => {
    const cases: Array<[Partial<MilestoneDateRow>, string | null]> = [
      [{ anchor: 'KICKOFF', offsetValue: 21 }, '2026-03-23'],
      [{ anchor: 'KICKOFF', offsetValue: -7 }, '2026-02-23'],
      [{ anchor: 'KICKOFF', offsetValue: 0 }, '2026-03-02'],
      [{ anchor: 'CONTRACT_AWARD', offsetValue: 3 }, '2026-02-23'],
      // Friday + 3 working days (Mon–Fri) = Wednesday.
      [{ anchor: 'KICKOFF', offsetValue: 3, offsetUnit: 'WORKING_DAYS' }, '2026-03-05'],
      [{ anchor: 'KICKOFF', offsetValue: 5, offsetUnit: 'WORKING_DAYS' }, '2026-03-09'],
      [{ anchor: 'KICKOFF', offsetValue: -1, offsetUnit: 'WORKING_DAYS' }, '2026-02-27'],
      [{ anchor: 'ACTIVATION', offsetValue: 10 }, null],
      [{ anchor: 'KICKOFF', offsetValue: 5, anchorDateOverride: '2026-04-01' }, '2026-04-06'],
    ];
    cases.forEach(([over, expected], i) => {
      const dates = computeMilestoneDueDates([row({ id: `r${i}`, key: `k${i}`, ...over })], anchors, MON_FRI);
      assert.equal(dates.get(`r${i}`), expected, JSON.stringify(over));
    });
  });

  it('chained milestones count from completion; a waived one from its due date; pending gives no date', () => {
    const base = row({ id: 'a', key: 'kickoff-held', anchor: 'KICKOFF', offsetValue: 0 });
    const chained = row({ id: 'b', key: 'minutes', anchor: 'MILESTONE', anchorMilestoneKey: 'kickoff-held', offsetValue: 3, offsetUnit: 'WORKING_DAYS' });
    assert.equal(computeMilestoneDueDates([base, chained], anchors, MON_FRI).get('b'), null);
    const done = { ...base, status: 'DONE' as const, completedDate: '2026-03-06' };
    assert.equal(computeMilestoneDueDates([done, chained], anchors, MON_FRI).get('b'), '2026-03-11');
    const waived = { ...base, status: 'WAIVED' as const };
    assert.equal(computeMilestoneDueDates([waived, chained], anchors, MON_FRI).get('b'), '2026-03-05');
    // Per-contractor rows chain to their own contractor's row first, else the project-level one.
    const own = row({ id: 'c', key: 'kickoff-held', projectContractorId: 'pc1', status: 'DONE', completedDate: '2026-03-10' });
    const pcChained = { ...chained, id: 'd', projectContractorId: 'pc1', offsetUnit: 'CALENDAR_DAYS' as const };
    assert.equal(computeMilestoneDueDates([done, own, pcChained], anchors, MON_FRI).get('d'), '2026-03-13');
  });

  it('a cycle leaves the dates empty instead of looping', () => {
    const a = row({ id: 'a', key: 'a', anchor: 'MILESTONE', anchorMilestoneKey: 'b', status: 'WAIVED' });
    const b = row({ id: 'b', key: 'b', anchor: 'MILESTONE', anchorMilestoneKey: 'a', status: 'WAIVED' });
    const dates = computeMilestoneDueDates([a, b], anchors, MON_FRI);
    assert.equal(dates.get('a'), null);
  });

  it('live status and days left', () => {
    assert.equal(deriveMilestoneStatus('PENDING', '2026-03-10', '2026-03-09'), 'PENDING');
    assert.equal(deriveMilestoneStatus('PENDING', '2026-03-10', '2026-03-10'), 'DUE');
    assert.equal(deriveMilestoneStatus('DUE', '2026-03-10', '2026-03-11'), 'OVERDUE');
    assert.equal(deriveMilestoneStatus('OVERDUE', '2026-03-20', '2026-03-11'), 'PENDING');
    assert.equal(deriveMilestoneStatus('DONE', '2026-03-10', '2026-03-11'), 'DONE');
    assert.equal(deriveMilestoneStatus('PENDING', null, '2026-03-11'), 'PENDING');
    assert.equal(milestoneDaysLeft('OVERDUE', '2026-03-10', '2026-03-12'), -2);
    assert.equal(milestoneDaysLeft('DONE', '2026-03-10', '2026-03-12'), null);
    assert.equal(describeMilestoneAnchor({ anchor: 'KICKOFF', anchorMilestoneKey: null, offsetValue: -7, offsetUnit: 'CALENDAR_DAYS' }), 'Kick-off − 7 days');
    assert.equal(
      describeMilestoneAnchor({ anchor: 'MILESTONE', anchorMilestoneKey: 'held', offsetValue: 3, offsetUnit: 'WORKING_DAYS' }, () => 'Kick-off held'),
      'After “Kick-off held” + 3 working days'
    );
  });

  it('template lists: duplicate keys, unknown and circular anchors are refused', () => {
    assert.equal(contractMilestoneTemplateIssues([{ key: 'a', anchor: 'KICKOFF', anchorMilestoneKey: null }]).length, 0);
    assert.equal(contractMilestoneTemplateIssues([{ key: 'a', anchor: 'KICKOFF', anchorMilestoneKey: null }, { key: 'a', anchor: 'KICKOFF', anchorMilestoneKey: null }]).length, 1);
    assert.equal(contractMilestoneTemplateIssues([{ key: 'a', anchor: 'MILESTONE', anchorMilestoneKey: 'zzz' }]).length, 1);
    const cyclic = [
      { key: 'a', anchor: 'MILESTONE' as const, anchorMilestoneKey: 'b' },
      { key: 'b', anchor: 'MILESTONE' as const, anchorMilestoneKey: 'a' },
    ];
    assert.ok(contractMilestoneTemplateIssues(cyclic).length >= 1);
    const parsed = ProjectTypeConfigSchema.safeParse({ contractMilestones: cyclic.map((c) => ({ ...c, label: c.key + ' label', offsetValue: 1 })) });
    assert.equal(parsed.success, false);
    // Every key keeps a default: a pre-Phase-13 type config still parses.
    const empty = ProjectTypeConfigSchema.parse({});
    assert.deepEqual(empty.contractMilestones, []);
    assert.equal(empty.kickoff.noticeLeadDays, 7);
    assert.equal(empty.defaultCases.autoOpenOnOverdueMobilisation, true);
  });

  it('contract step: award ≤ signed ≤ kick-off', () => {
    assert.equal(ProjectContractStepSchema.safeParse({ contractAwardDate: '2026-02-20', contractSignedDate: '2026-02-25', kickoffDate: '2026-03-02' }).success, true);
    assert.equal(ProjectContractStepSchema.safeParse({ contractAwardDate: '2026-02-26', contractSignedDate: '2026-02-25' }).success, false);
    assert.equal(ProjectContractStepSchema.safeParse({ contractSignedDate: '2026-03-05', kickoffDate: '2026-03-02' }).success, false);
  });

  it('CONTRACT_DEFAULT chain: the decision step is last, a system step, and unique', () => {
    assert.deepEqual(validateApprovalChain('CONTRACT_DEFAULT', defaultContractDefaultChain({ hasOwner: true })), []);
    assert.equal(defaultContractDefaultChain({ hasOwner: true })[1].organizationScope, 'PROJECT_OWNER');
    assert.equal(defaultContractDefaultChain({ hasOwner: false })[1].organizationScope, 'ANY');
    const review = defaultContractDefaultChain({ hasOwner: false })[0];
    assert.equal(validateApprovalChain('CONTRACT_DEFAULT', [review])[0].code, 'DECISION_STEP_REQUIRED');
    const [r, d] = defaultContractDefaultChain({ hasOwner: false });
    assert.ok(validateApprovalChain('CONTRACT_DEFAULT', [d, r]).some((i) => i.code === 'SYSTEM_STEP_POSITION'));
    assert.ok(validateApprovalChain('CONTRACT_DEFAULT', [r, { ...d, minAmountThresholdNgn: 5 }]).some((i) => i.code === 'THRESHOLD_NOT_ALLOWED'));
  });

  it('CONTRACT_MILESTONE_DONE payment rule ignores items and follows the milestone', () => {
    const base = { rule: 'CONTRACT_MILESTONE_DONE' as const, targetCompletionPct: 100, items: [] };
    assert.equal(evaluateMilestoneCompletion({ ...base, contractMilestone: { label: 'Contract signed', done: true } }).met, true);
    const pending = evaluateMilestoneCompletion({ ...base, contractMilestone: { label: 'Contract signed', done: false } });
    assert.equal(pending.met, false);
    assert.match(pending.unmetReasons[0], /Contract signed/);
    assert.equal(evaluateMilestoneCompletion({ ...base, contractMilestone: null }).met, false);
  });

  it('kick-off quorum: one attendee per required group', () => {
    assert.equal(kickoffQuorumMet(['OWNER', 'CONTRACTOR'], ['CONTRACTOR', 'OWNER', 'OTHER']), true);
    assert.equal(kickoffQuorumMet(['OWNER', 'CONTRACTOR'], ['OWNER']), false);
    assert.equal(kickoffQuorumMet([], []), true);
  });
});
