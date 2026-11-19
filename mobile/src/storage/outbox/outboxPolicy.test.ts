/** Runs in Node. Outbox ordering, backoff, dead-lettering and auth pause. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterFailure,
  backoffMs,
  classifyFailure,
  dependencyState,
  dueRows,
  MAX_ATTEMPTS,
  type OutboxRow,
  type OutboxStatus,
} from './outboxPolicy';

const NOW = new Date('2026-11-19T12:00:00.000Z');

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'r1',
    projectId: 'p',
    kind: 'REPORT',
    entityId: 'e',
    payload: {},
    dependsOn: [],
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: NOW.toISOString(),
    lastError: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('classifyFailure', () => {
  it('pauses on an ended session instead of counting an attempt', () => {
    assert.equal(classifyFailure({ kind: 'auth', status: 401 }), 'AUTH_PAUSE');
  });
  it('retries offline, timeouts, rate limits and server errors', () => {
    for (const e of [{ kind: 'network' as const }, { kind: 'http' as const, status: 503 }, { kind: 'http' as const, status: 429 }, { kind: 'http' as const, status: 408 }]) {
      assert.equal(classifyFailure(e), 'RETRY');
    }
  });
  it('retries when a capture the report needs is not registered yet', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'CAPTURES_NOT_REGISTERED' }), 'RETRY');
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'OBJECT_NOT_UPLOADED' }), 'RETRY');
  });
  it('dead-letters refusals that retrying cannot fix', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'REPORT_ALREADY_SUBMITTED' }), 'PERMANENT');
    assert.equal(classifyFailure({ kind: 'http', status: 400 }), 'PERMANENT');
    assert.equal(classifyFailure({ kind: 'local' }), 'PERMANENT');
  });
});

describe('afterFailure', () => {
  it('leaves the row untouched on auth pause', () => {
    const r = row({ attempts: 3 });
    assert.deepEqual(afterFailure(r, 'AUTH_PAUSE', NOW), {
      status: 'PENDING',
      attempts: 3,
      nextAttemptAt: r.nextAttemptAt,
    });
  });
  it('backs off exponentially and dead-letters after MAX_ATTEMPTS', () => {
    const noJitter = () => 0.5;
    const first = afterFailure(row(), 'RETRY', NOW, noJitter);
    assert.equal(first.status, 'PENDING');
    assert.equal(first.attempts, 1);
    assert.equal(new Date(first.nextAttemptAt).getTime() - NOW.getTime(), 15_000);
    const third = afterFailure(row({ attempts: 2 }), 'RETRY', NOW, noJitter);
    assert.equal(new Date(third.nextAttemptAt).getTime() - NOW.getTime(), 60_000);
    const last = afterFailure(row({ attempts: MAX_ATTEMPTS - 1 }), 'RETRY', NOW, noJitter);
    assert.equal(last.status, 'DEAD');
  });
  it('dead-letters a permanent failure immediately', () => {
    assert.equal(afterFailure(row(), 'PERMANENT', NOW).status, 'DEAD');
  });
  it('caps backoff at 30 minutes', () => {
    assert.ok(backoffMs(30, () => 0.5) <= 30 * 60_000);
  });
});

describe('ordering', () => {
  it('a report waits for its captures, runs once they are done, and is blocked if one is dead', () => {
    const status = new Map<string, OutboxStatus>([['cap1', 'PENDING'], ['cap2', 'DONE']]);
    assert.equal(dependencyState(['cap1', 'cap2'], status), 'WAITING');
    status.set('cap1', 'DONE');
    assert.equal(dependencyState(['cap1', 'cap2'], status), 'READY');
    status.set('cap1', 'DEAD');
    assert.equal(dependencyState(['cap1', 'cap2'], status), 'BLOCKED');
    assert.equal(dependencyState(['purged-after-done'], new Map()), 'READY');
  });
  it('only due pending rows run, oldest first', () => {
    const later = new Date(NOW.getTime() + 60_000).toISOString();
    const rows = [
      row({ id: 'b', createdAt: '2026-11-19T11:00:02.000Z' }),
      row({ id: 'a', createdAt: '2026-11-19T11:00:01.000Z' }),
      row({ id: 'future', nextAttemptAt: later }),
      row({ id: 'dead', status: 'DEAD' }),
    ];
    assert.deepEqual(dueRows(rows, NOW).map((r) => r.id), ['a', 'b']);
  });
});
