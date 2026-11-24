import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defectActionBody, RECTIFY_REMOVED_MESSAGE, showDefectsEntry, type DefectActionPayload } from './defects';
import { SESSION_BOUND_KINDS } from '../storage/outbox/outboxPolicy';

const capture = '6f1c2d4e-0000-4000-8000-000000000001';

describe('defect work on mobile (Phase 10, staff-only since R1d)', () => {
  it('shows the Defects entry only after construction and with the permission', () => {
    const perms = ['field:submit_report', 'retention:manage_defects'];
    assert.equal(showDefectsEntry('ACTIVE_CONSTRUCTION', perms), false);
    assert.equal(showDefectsEntry(undefined, perms), false, 'older packs have no phase');
    assert.equal(showDefectsEntry('HANDOVER_IN_PROGRESS', perms), true);
    assert.equal(showDefectsEntry('RETENTION_PERIOD', perms), true);
    assert.equal(showDefectsEntry('RETENTION_PERIOD', ['field:submit_report']), false);
  });

  it("closing needs the officer's site photos", () => {
    assert.throws(() => defectActionBody({ ticketId: 't', decision: 'CLOSE', notes: 'Looks fine', captureIds: [] }));
    assert.deepEqual(defectActionBody({ ticketId: 't', decision: 'CLOSE', notes: ' ', captureIds: [capture] }), {
      decision: 'CLOSE',
      notes: '',
      captureIds: [capture],
    });
  });

  it('reopening needs a reason and no photos', () => {
    assert.throws(() => defectActionBody({ ticketId: 't', decision: 'REOPEN', notes: 'no', captureIds: [] }));
    assert.deepEqual(defectActionBody({ ticketId: 't', decision: 'REOPEN', notes: 'Still leaking', captureIds: [] }), {
      decision: 'REOPEN',
      notes: 'Still leaking',
      captureIds: [],
    });
  });

  it('a "mark fixed" action queued before R1d is refused on the device, never sent', () => {
    const legacy = { ticketId: 't', kind: 'rectify', notes: 'Patched', captureIds: [capture] } as unknown as DefectActionPayload;
    assert.throws(() => defectActionBody(legacy), { message: RECTIFY_REMOVED_MESSAGE });
  });

  it('defect updates are held like other evidence when their session ended', () => {
    assert.equal(SESSION_BOUND_KINDS.has('DEFECT_ACTION'), true);
  });
});
