/** Runs in Node. Redesign R5e: the Outbox screen's labels, states, safe actions and grouping. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OutboxKind, OutboxStatus } from '../storage/outbox/outboxPolicy';
import {
  groupOutboxItems,
  OUTBOX_KIND_LABELS,
  outboxItemActions,
  outboxItemLabel,
  outboxItemState,
  type OutboxItem,
} from './outboxView';

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'row-1',
    projectId: 'p1',
    kind: 'CAPTURE',
    entityId: 'e1',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: '2026-11-24T08:00:00.000Z',
    dependsOn: [],
    mediaType: 'SITE_PHOTO',
    draftStatus: null,
    visitId: null,
    ...overrides,
  };
}

describe('Outbox labels', () => {
  it('names every kind in visit wording, and tells photos from voice notes', () => {
    assert.equal(outboxItemLabel(item()), 'Photo');
    assert.equal(outboxItemLabel(item({ mediaType: 'VOICE_NOTE' })), 'Voice note');
    assert.equal(outboxItemLabel(item({ kind: 'VISIT_SUBMISSION', mediaType: null })), 'Monitoring report');
    assert.equal(outboxItemLabel(item({ kind: 'VISIT_CHECK_IN' })), 'Check-in');
    assert.equal(outboxItemLabel(item({ kind: 'UNSCHEDULED_VISIT' })), 'Ad hoc monitoring visit');
    for (const label of Object.values(OUTBOX_KIND_LABELS)) {
      assert.ok(!/report.*(daily|workday)|chat|inspection|ai\b/i.test(label), label);
    }
  });
});

describe('Outbox states', () => {
  it('waiting, waiting behind its photos, trying again, failed, refused and held', () => {
    // Rows sent and purged are missing from the map: they count as done.
    const statuses = new Map<string, OutboxStatus>([['cap', 'PENDING']]);
    assert.equal(outboxItemState(item(), statuses), 'WAITING');
    assert.equal(outboxItemState(item({ kind: 'VISIT_SUBMISSION', dependsOn: ['cap'] }), statuses), 'WAITING_FOR_OTHERS');
    assert.equal(outboxItemState(item({ kind: 'VISIT_SUBMISSION', dependsOn: ['done-and-purged'] }), statuses), 'WAITING');
    assert.equal(outboxItemState(item({ attempts: 2 }), statuses), 'RETRYING');
    assert.equal(outboxItemState(item({ status: 'DEAD' }), statuses), 'FAILED');
    assert.equal(outboxItemState(item({ kind: 'VISIT_SUBMISSION', status: 'DEAD', draftStatus: 'REFUSED' }), statuses), 'REFUSED');
    assert.equal(outboxItemState(item({ kind: 'VISIT_SUBMISSION', status: 'DEAD', draftStatus: 'QUEUED' }), statuses), 'FAILED');
    assert.equal(outboxItemState(item({ status: 'HELD' }), statuses), 'HELD');
  });
});

describe('Outbox actions', () => {
  it('waiting rows have no actions; failed rows can be retried', () => {
    assert.deepEqual(outboxItemActions(item()), { retry: false, resendHeld: false, remove: null });
    for (const kind of ['CAPTURE', 'VISIT_CHECK_IN', 'UNSCHEDULED_VISIT', 'SITE_LOG_ENTRY'] as OutboxKind[]) {
      assert.deepEqual(outboxItemActions(item({ kind, status: 'DEAD' })), { retry: true, resendHeld: false, remove: null }, `${kind}: a report may still need it`);
    }
  });

  it('a refused visit report is deleted, never retried; a failed one is retried', () => {
    assert.deepEqual(outboxItemActions(item({ kind: 'VISIT_SUBMISSION', status: 'DEAD', draftStatus: 'REFUSED' })), {
      retry: false,
      resendHeld: false,
      remove: 'DELETE_REFUSED_REPORT',
    });
    assert.deepEqual(outboxItemActions(item({ kind: 'VISIT_SUBMISSION', status: 'DEAD', draftStatus: 'QUEUED' })), { retry: true, resendHeld: false, remove: null });
  });

  it('failed responses, defect updates and incidents can be retried or removed', () => {
    assert.equal(outboxItemActions(item({ kind: 'VISIT_RESPONSE', status: 'DEAD', visitId: 'v1' })).remove, 'DISCARD_RESPONSE');
    assert.equal(outboxItemActions(item({ kind: 'VISIT_RESPONSE', status: 'DEAD', visitId: null })).remove, null);
    assert.equal(outboxItemActions(item({ kind: 'DEFECT_ACTION', status: 'DEAD' })).remove, 'DISCARD_DEFECT_UPDATE');
    assert.equal(outboxItemActions(item({ kind: 'INCIDENT', status: 'DEAD' })).remove, 'DISCARD_INCIDENT');
    assert.equal(outboxItemActions(item({ kind: 'INCIDENT', status: 'DEAD' })).retry, true);
  });

  it('held photos can be sent again or removed; other held rows only where safe', () => {
    assert.deepEqual(outboxItemActions(item({ status: 'HELD' })), { retry: false, resendHeld: true, remove: 'REMOVE_HELD_CAPTURE' });
    assert.deepEqual(outboxItemActions(item({ kind: 'DEFECT_ACTION', status: 'HELD' })), { retry: false, resendHeld: false, remove: 'DISCARD_DEFECT_UPDATE' });
    assert.deepEqual(outboxItemActions(item({ kind: 'VISIT_SUBMISSION', status: 'HELD' })), { retry: false, resendHeld: false, remove: null });
  });
});

describe('Outbox grouping', () => {
  it('groups per project, problems first, oldest first, unknown projects last', () => {
    const names = new Map([
      ['p1', 'Kaduna School'],
      ['p2', 'Abuja School'],
    ]);
    const groups = groupOutboxItems(
      [
        item({ id: 'a', projectId: 'p1', createdAt: '2026-11-24T08:00:00.000Z' }),
        item({ id: 'b', projectId: 'p1', status: 'DEAD', createdAt: '2026-11-24T09:00:00.000Z' }),
        item({ id: 'c', projectId: 'p2', status: 'HELD' }),
        item({ id: 'd', projectId: 'gone' }),
        item({ id: 'e', projectId: 'p1', createdAt: '2026-11-24T07:00:00.000Z', kind: 'VISIT_SUBMISSION', dependsOn: ['a'] }),
      ],
      (id) => names.get(id) ?? null
    );
    assert.deepEqual(groups.map((g) => g.projectName), ['Abuja School', 'Kaduna School', 'Project no longer on this phone']);
    const kaduna = groups[1];
    assert.deepEqual(kaduna.rows.map((r) => r.item.id), ['b', 'e', 'a']);
    assert.deepEqual(kaduna.counts, { waiting: 2, failed: 1, held: 0 });
    assert.equal(kaduna.rows[1].stateText, 'Waiting for the items it needs');
    assert.deepEqual(groups[0].counts, { waiting: 0, failed: 0, held: 1 });
  });
});
