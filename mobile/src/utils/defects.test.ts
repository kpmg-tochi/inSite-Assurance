import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defectActionBody, showDefectsEntry } from './defects';
import { SESSION_BOUND_KINDS } from '../storage/outbox/outboxPolicy';

describe('defect work on mobile (Phase 10)', () => {
  it('shows the Defects entry only after construction and with the permission', () => {
    const perms = ['field:submit_report', 'retention:manage_defects'];
    assert.equal(showDefectsEntry('ACTIVE_CONSTRUCTION', perms), false);
    assert.equal(showDefectsEntry(undefined, perms), false, 'older packs have no phase');
    assert.equal(showDefectsEntry('HANDOVER_IN_PROGRESS', perms), true);
    assert.equal(showDefectsEntry('RETENTION_PERIOD', perms), true);
    assert.equal(showDefectsEntry('RETENTION_PERIOD', ['field:submit_report']), false);
  });

  it('builds the request bodies the server accepts', () => {
    const capture = '6f1c2d4e-0000-4000-8000-000000000001';
    assert.deepEqual(defectActionBody({ ticketId: 't', kind: 'rectify', notes: '', captureIds: [capture] }), { notes: '', captureIds: [capture] });
    assert.throws(() => defectActionBody({ ticketId: 't', kind: 'rectify', notes: 'ok', captureIds: [] }));
    assert.deepEqual(defectActionBody({ ticketId: 't', kind: 'verify', notes: '', captureIds: [], decision: 'CLOSE' }), {
      decision: 'CLOSE',
      notes: '',
      captureIds: [],
    });
    assert.throws(() => defectActionBody({ ticketId: 't', kind: 'verify', notes: 'no', captureIds: [], decision: 'REOPEN' }));
  });

  it("needs the verifier's photos to close when the monitoring side captures the evidence", () => {
    const capture = '6f1c2d4e-0000-4000-8000-000000000002';
    assert.throws(() => defectActionBody({ ticketId: 't', kind: 'verify', notes: '', captureIds: [], decision: 'CLOSE', photosRequired: true }));
    assert.deepEqual(defectActionBody({ ticketId: 't', kind: 'verify', notes: '', captureIds: [capture], decision: 'CLOSE', photosRequired: true }), {
      decision: 'CLOSE',
      notes: '',
      captureIds: [capture],
    });
    // Reopening never needs photos.
    assert.doesNotThrow(() => defectActionBody({ ticketId: 't', kind: 'verify', notes: 'Still leaking', captureIds: [], decision: 'REOPEN', photosRequired: true }));
  });

  it('defect updates are held after a rejoin like other evidence', () => {
    assert.equal(SESSION_BOUND_KINDS.has('DEFECT_ACTION'), true);
  });
});
