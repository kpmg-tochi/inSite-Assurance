/**
 * Phase 10 unit tests: retention arithmetic, release caps, liability-period dates, the phase table
 * and the stakeholder text sanitiser / formatter (pure functions in @insite/shared).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarMonths,
  allocateRetention,
  calendarDaysUntil,
  isPhaseTransitionAllowed,
  parseHandoverRichText,
  retentionReleaseCap,
  retentionWithheldFor,
  sanitizeHandoverLine,
  sanitizeHandoverText,
  RecordHandoverResponseRequestSchema,
} from '@insite/shared';

describe('retention withheld per release', () => {
  it('is the approved amount times the percentage, rounded to kobo', () => {
    assert.equal(retentionWithheldFor(10_000_000, 5), 500_000);
    assert.equal(retentionWithheldFor(3_333_333.33, 5), 166_666.67);
    assert.equal(retentionWithheldFor(1_000_000.01, 5), 50_000);
  });
  it('is zero without a percentage or without money', () => {
    assert.equal(retentionWithheldFor(1_000_000, null), 0);
    assert.equal(retentionWithheldFor(1_000_000, 0), 0);
    assert.equal(retentionWithheldFor(0, 10), 0);
    assert.equal(retentionWithheldFor(-5, 10), 0);
  });
});

describe('retention split across contractors', () => {
  it('splits by weight and always adds up to the total', () => {
    const shares = allocateRetention(100_000, [
      { projectContractorId: 'a', weight: 600 },
      { projectContractorId: 'b', weight: 400 },
    ], 'main');
    assert.deepEqual(shares.map((s) => [s.projectContractorId, s.amountNgn]), [['a', 60_000], ['b', 40_000]]);
    const thirds = allocateRetention(100, [
      { projectContractorId: 'a', weight: 1 },
      { projectContractorId: 'b', weight: 1 },
      { projectContractorId: 'c', weight: 1 },
    ], 'main');
    assert.equal(Math.round(thirds.reduce((s, x) => s + x.amountNgn, 0) * 100) / 100, 100);
  });
  it('merges weights per contractor and falls back to the main contractor', () => {
    assert.deepEqual(allocateRetention(50, [{ projectContractorId: 'a', weight: 1 }, { projectContractorId: 'a', weight: 3 }], 'm'), [
      { projectContractorId: 'a', amountNgn: 50 },
    ]);
    assert.deepEqual(allocateRetention(50, [], 'm'), [{ projectContractorId: 'm', amountNgn: 50 }]);
    assert.deepEqual(allocateRetention(0, [], 'm'), []);
  });
});

describe('retention release caps', () => {
  it('practical completion releases at most the configured share of everything withheld', () => {
    assert.equal(retentionReleaseCap({ stage: 'COMPLETION', heldNgn: 1_000, releasedNgn: 0, pendingNgn: 0, releaseAtCompletionPct: 50 }), 500);
    // Half already released: nothing more at this stage.
    assert.equal(retentionReleaseCap({ stage: 'COMPLETION', heldNgn: 500, releasedNgn: 500, pendingNgn: 0, releaseAtCompletionPct: 50 }), 0);
    assert.equal(retentionReleaseCap({ stage: 'COMPLETION', heldNgn: 1_000, releasedNgn: 0, pendingNgn: 200, releaseAtCompletionPct: 50 }), 300);
    assert.equal(retentionReleaseCap({ stage: 'COMPLETION', heldNgn: 1_000, releasedNgn: 0, pendingNgn: 0, releaseAtCompletionPct: 0 }), 0);
  });
  it('the final release is everything still held and not pending', () => {
    assert.equal(retentionReleaseCap({ stage: 'FINAL', heldNgn: 750, releasedNgn: 250, pendingNgn: 0, releaseAtCompletionPct: 50 }), 750);
    assert.equal(retentionReleaseCap({ stage: 'FINAL', heldNgn: 750, releasedNgn: 250, pendingNgn: 750, releaseAtCompletionPct: 50 }), 0);
  });
});

describe('liability period dates', () => {
  it('adds calendar months, clamping to the month end', () => {
    assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addCalendarMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addCalendarMonths('2026-11-19', 12), '2027-11-19');
    assert.equal(addCalendarMonths('2026-11-19', 0), '2026-11-19');
  });
  it('counts days until the end', () => {
    assert.equal(calendarDaysUntil('2026-11-19', '2026-11-29'), 10);
    assert.equal(calendarDaysUntil('2026-11-19', '2026-11-18'), -1);
  });
});

describe('construction phase table', () => {
  it('allows only the forward moves and handover back to construction', () => {
    assert.equal(isPhaseTransitionAllowed('ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'), true);
    assert.equal(isPhaseTransitionAllowed('HANDOVER_IN_PROGRESS', 'ACTIVE_CONSTRUCTION'), true);
    assert.equal(isPhaseTransitionAllowed('HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD'), true);
    assert.equal(isPhaseTransitionAllowed('RETENTION_PERIOD', 'COMPLETED_CLOSED'), true);
    assert.equal(isPhaseTransitionAllowed('ACTIVE_CONSTRUCTION', 'RETENTION_PERIOD'), false);
    assert.equal(isPhaseTransitionAllowed('RETENTION_PERIOD', 'HANDOVER_IN_PROGRESS'), false);
    assert.equal(isPhaseTransitionAllowed('COMPLETED_CLOSED', 'RETENTION_PERIOD'), false);
  });
});

describe('stakeholder text', () => {
  it('removes markup so nothing can be rendered as HTML', () => {
    const out = sanitizeHandoverText('<script>alert(1)</script>Good <b>work</b> <img src=x onerror=alert(1)> done');
    assert.equal(out.includes('<'), false);
    assert.equal(out.includes('>'), false);
    assert.equal(/script|onerror/i.test(out.replace('alert(1)', '')), false);
    assert.equal(sanitizeHandoverText('<scr<b>ipt>x').includes('<'), false);
    assert.equal(sanitizeHandoverLine('  Chief\n  Adebayo  '), 'Chief Adebayo');
    assert.equal(sanitizeHandoverText('a < b and c > d'), 'a ‹ b and c › d');
  });
  it('formats paragraphs, lists, bold and italics from plain text', () => {
    const blocks = parseHandoverRichText('Overall **good**.\n\n- Tap 1 _slow_\n- Tap 2\n\n1. First\n2. Second');
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'paragraph');
    assert.deepEqual(blocks[0].type === 'paragraph' && blocks[0].lines[0].map((s) => [s.text, s.bold]), [['Overall ', false], ['good', true], ['.', false]]);
    assert.equal(blocks[1].type, 'bullets');
    assert.equal(blocks[1].type === 'bullets' && blocks[1].items[0][1].italic, true);
    assert.equal(blocks[2].type, 'numbers');
  });
});

describe('recorded handover response rules (R1d)', () => {
  it('needs a snag for "accepted with snags", a reason for a rejection, and the attestation', () => {
    const base = { stakeholderType: 'CLIENT_STAFF', submitterName: 'Ada', submitterRole: 'Head teacher', attest: true };
    assert.equal(RecordHandoverResponseRequestSchema.safeParse({ ...base, decision: 'ACCEPTED_WITH_SNAGS' }).success, false);
    assert.equal(RecordHandoverResponseRequestSchema.safeParse({ ...base, decision: 'REJECTED', feedbackText: 'no' }).success, false);
    assert.equal(RecordHandoverResponseRequestSchema.safeParse({ ...base, decision: 'ACCEPTED' }).success, true);
    assert.equal(RecordHandoverResponseRequestSchema.safeParse({ ...base, attest: false, decision: 'ACCEPTED' }).success, false);
  });
});
