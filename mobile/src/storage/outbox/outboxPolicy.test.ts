/** Runs in Node. Outbox ordering, backoff, dead-lettering and auth pause. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterFailure,
  backoffMs,
  classifyFailure,
  failureMessage,
  dependencyState,
  dueRows,
  MAX_ATTEMPTS,
  shouldHoldOnNewSession,
  checkInDependsOn,
  siteLogEntryDependsOn,
  visitSubmissionDependsOn,
  REMOVED_OUTBOX_KINDS,
  SESSION_BOUND_KINDS,
  SUBMISSION_REFUSED_CODES,
  FORM_SNAPSHOT_STALE_MESSAGE,
  VISIT_ALREADY_SUBMITTED_MESSAGE,
  VISIT_CHANGED_RESPONSE_MESSAGE,
  UNSCHEDULED_FORM_STALE_MESSAGE,
  needsVerificationSubmissionDependsOn,
  isVerificationRefusal,
  verificationRefusalMessage,
  NEEDS_VERIFICATION_REFUSED_CODES,
  NEEDS_VERIFICATION_FORM_STALE_MESSAGE,
  NEEDS_VERIFICATION_NOT_OPEN_MESSAGE,
  NEEDS_VERIFICATION_NOT_ASSIGNED_MESSAGE,
  type OutboxKind,
  type OutboxRow,
  type OutboxStatus,
} from './outboxPolicy';

const NOW = new Date('2026-11-19T12:00:00.000Z');

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'r1',
    projectId: 'p',
    kind: 'VISIT_SUBMISSION',
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
  it('retries when a photo the visit report needs is not registered yet', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'CAPTURES_NOT_REGISTERED' }), 'RETRY');
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'OBJECT_NOT_UPLOADED' }), 'RETRY');
  });
  it('dead-letters refusals that retrying cannot fix', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'DEFECT_NOT_AWAITING_VERIFICATION' }), 'PERMANENT');
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
  it('a visit report waits for its photos, runs once they are done, and is blocked if one is dead', () => {
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

describe('Phase 5 Step 8: items from an ended session', () => {
  const current = 'join:new-session';
  const r = (kind: OutboxKind, status: OutboxStatus, sessionKey: string | null) => ({ kind, status, sessionKey });

  it('holds unsent evidence queued under another session, or before sessions were recorded', () => {
    assert.equal(shouldHoldOnNewSession(r('CAPTURE', 'PENDING', 'join:old'), current), true);
    assert.equal(shouldHoldOnNewSession(r('DEFECT_ACTION', 'PENDING', null), current), true);
    assert.equal(shouldHoldOnNewSession(r('VISIT_SUBMISSION', 'DEAD', 'join:old'), current), true);
    assert.equal(shouldHoldOnNewSession(r('VISIT_RESPONSE', 'PENDING', 'join:old'), current), true);
  });

  it('leaves sent rows, rows of the current session, and non-evidence kinds alone', () => {
    assert.equal(shouldHoldOnNewSession(r('CAPTURE', 'DONE', 'join:old'), current), false);
    assert.equal(shouldHoldOnNewSession(r('CAPTURE', 'PENDING', current), current), false);
    assert.equal(shouldHoldOnNewSession(r('INCIDENT', 'PENDING', 'join:old'), current), false);
  });

  it('a held row is never due and makes rows that depend on it wait, not fail', () => {
    assert.deepEqual(dueRows([row({ id: 'h', status: 'HELD' })], NOW), []);
    assert.equal(dependencyState(['h'], new Map([['h', 'HELD' as OutboxStatus]])), 'WAITING');
  });
});

describe('failure messages', () => {
  it('stores the server text, or a fallback when there is none', () => {
    assert.equal(failureMessage({ code: 'OTHER', message: 'Server said no' }), 'Server said no');
    assert.equal(failureMessage({}), 'Unknown error');
  });
});

describe('Redesign R5e (D-R5.10): the old app kinds are gone', () => {
  it('lists exactly the removed kinds, none of them session-bound', () => {
    assert.deepEqual([...REMOVED_OUTBOX_KINDS].sort(), ['CHAT_MESSAGE', 'FINDING_RESOLUTION', 'REPORT', 'REVALIDATION', 'SITE_INSPECTION']);
    for (const kind of REMOVED_OUTBOX_KINDS) assert.ok(!SESSION_BOUND_KINDS.has(kind as OutboxKind), kind);
    assert.deepEqual([...SESSION_BOUND_KINDS].sort(), [
      'CAPTURE',
      'DEFECT_ACTION',
      'SITE_LOG_ENTRY',
      'UNSCHEDULED_VISIT',
      'VISIT_CHECK_IN',
      'VISIT_RESPONSE',
      'VISIT_SUBMISSION',
    ]);
  });
});

describe('Redesign R5 (D-R5.9): visit-app kinds', () => {
  const VISIT_KINDS: OutboxKind[] = ['VISIT_RESPONSE', 'VISIT_CHECK_IN', 'VISIT_SUBMISSION', 'UNSCHEDULED_VISIT', 'SITE_LOG_ENTRY'];

  it('every new kind is session-bound (held, not sent, under another identity)', () => {
    for (const kind of VISIT_KINDS) {
      assert.ok(SESSION_BOUND_KINDS.has(kind), kind);
      assert.equal(shouldHoldOnNewSession({ kind, status: 'PENDING', sessionKey: 'join:old' }, 'account'), true, kind);
    }
  });

  /** Open rows on the phone: kind:entity → row id. */
  const open = new Map<string, string>([
    ['CAPTURE:c1', 'row-c1'],
    ['VISIT_CHECK_IN:ci1', 'row-ci1'],
    ['UNSCHEDULED_VISIT:v1', 'row-v1'],
    ['SITE_LOG_ENTRY:s1', 'row-s1'],
  ]);
  const lookup = (kind: OutboxKind, id: string) => open.get(`${kind}:${id}`) ?? null;

  it('a submission waits for its unscheduled visit, check-in, captures and site log entries still open', () => {
    const deps = visitSubmissionDependsOn({ captureIds: ['c1', 'c2-sent', 'c1'], checkInId: 'ci1', unscheduledVisitId: 'v1', siteLogEntryIds: ['s1', 's2-sent'] }, lookup);
    assert.deepEqual(deps, ['row-v1', 'row-ci1', 'row-c1', 'row-s1']);
    assert.deepEqual(visitSubmissionDependsOn({ captureIds: ['c2-sent'], checkInId: null, unscheduledVisitId: null, siteLogEntryIds: [] }, lookup), []);
  });

  it('a check-in waits for its unscheduled visit; a site log entry for its capture', () => {
    assert.deepEqual(checkInDependsOn({ unscheduledVisitId: 'v1' }, lookup), ['row-v1']);
    assert.deepEqual(checkInDependsOn({ unscheduledVisitId: null }, lookup), []);
    assert.deepEqual(siteLogEntryDependsOn({ captureId: 'c1' }, lookup), ['row-c1']);
    assert.deepEqual(siteLogEntryDependsOn({ captureId: null }, lookup), []);
  });

  it('the chain sends in order: unscheduled visit → check-in → captures → submission; a dead link blocks it', () => {
    const deps = visitSubmissionDependsOn({ captureIds: ['c1'], checkInId: 'ci1', unscheduledVisitId: 'v1', siteLogEntryIds: [] }, lookup);
    const status = new Map<string, OutboxStatus>([['row-v1', 'PENDING'], ['row-ci1', 'PENDING'], ['row-c1', 'PENDING']]);
    assert.equal(dependencyState(checkInDependsOn({ unscheduledVisitId: 'v1' }, lookup), status), 'WAITING');
    assert.equal(dependencyState(deps, status), 'WAITING');
    status.set('row-v1', 'DONE');
    assert.equal(dependencyState(['row-v1'], status), 'READY', 'the check-in can go');
    status.set('row-ci1', 'DONE');
    assert.equal(dependencyState(deps, status), 'WAITING', 'still waiting for the photo');
    status.set('row-c1', 'DONE');
    assert.equal(dependencyState(deps, status), 'READY');
    status.set('row-ci1', 'DEAD');
    assert.equal(dependencyState(deps, status), 'BLOCKED');
  });

  it('a site log entry still being sent is retried, not refused', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'SITE_LOG_NOT_REGISTERED' }), 'RETRY');
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'CAPTURES_NOT_REGISTERED' }), 'RETRY');
  });

  it('stale forms, a visit already submitted and a changed visit are permanent with fixed messages', () => {
    for (const code of ['FORM_SNAPSHOT_STALE', 'VISIT_ALREADY_SUBMITTED', 'VISIT_CHANGED', 'MOVE_OUTSIDE_WINDOW']) {
      assert.equal(classifyFailure({ kind: 'http', status: code === 'MOVE_OUTSIDE_WINDOW' ? 422 : 409, code }), 'PERMANENT', code);
    }
    assert.deepEqual([...SUBMISSION_REFUSED_CODES].sort(), ['FORM_SNAPSHOT_STALE', 'VISIT_ALREADY_SUBMITTED']);
    assert.equal(failureMessage({ code: 'FORM_SNAPSHOT_STALE', message: 'raw' }, 'VISIT_SUBMISSION'), FORM_SNAPSHOT_STALE_MESSAGE);
    assert.equal(failureMessage({ code: 'VISIT_ALREADY_SUBMITTED', message: 'raw' }, 'VISIT_SUBMISSION'), VISIT_ALREADY_SUBMITTED_MESSAGE);
    assert.equal(failureMessage({ code: 'FORM_SNAPSHOT_STALE', message: 'raw' }, 'UNSCHEDULED_VISIT'), UNSCHEDULED_FORM_STALE_MESSAGE);
    assert.equal(VISIT_CHANGED_RESPONSE_MESSAGE, 'This monitoring visit changed since you responded. Refresh and respond again.');
    assert.equal(failureMessage({ code: 'VISIT_CHANGED', message: 'raw' }, 'VISIT_RESPONSE'), VISIT_CHANGED_RESPONSE_MESSAGE);
    assert.equal(failureMessage({ code: 'VISIT_CHANGED', message: 'This visit is not open for submission' }, 'VISIT_SUBMISSION'), 'This visit is not open for submission');
    assert.equal(
      failureMessage({ code: 'MOVE_OUTSIDE_WINDOW', message: 'That date is outside the move window. Propose the date to the manager instead.' }, 'VISIT_RESPONSE'),
      'That date is outside the move window. Propose the date to the manager instead.',
      'the server explains the window'
    );
  });
});

describe('needs pipeline wave 5: verification submissions', () => {
  const open = new Map<string, string>([['CAPTURE:c1', 'row-c1'], ['CAPTURE:c2', 'row-c2']]);
  const lookup = (kind: OutboxKind, id: string) => open.get(`${kind}:${id}`) ?? null;

  it('waits for the unsent captures its answers name; sent ones are not waited for', () => {
    assert.deepEqual(needsVerificationSubmissionDependsOn({ captureIds: ['c1', 'c2', 'c3', 'c1'] }, lookup), ['row-c1', 'row-c2']);
    assert.deepEqual(needsVerificationSubmissionDependsOn({ captureIds: [] }, lookup), []);
    const status = new Map<string, OutboxStatus>([['row-c1', 'DONE'], ['row-c2', 'PENDING']]);
    assert.equal(dependencyState(['row-c1', 'row-c2'], status), 'WAITING');
    status.set('row-c2', 'DEAD');
    assert.equal(dependencyState(['row-c1', 'row-c2'], status), 'BLOCKED');
  });

  it('a capture still being registered is retried; stale form, not open and invalid are refusals', () => {
    assert.equal(classifyFailure({ kind: 'http', status: 409, code: 'CAPTURES_NOT_REGISTERED' }), 'RETRY');
    assert.equal(isVerificationRefusal({ kind: 'http', status: 409, code: 'CAPTURES_NOT_REGISTERED' }), false);
    for (const code of ['NEEDS_VERIFICATION_FORM_STALE', 'NEEDS_VERIFICATION_NOT_OPEN']) {
      assert.equal(classifyFailure({ kind: 'http', status: 409, code }), 'PERMANENT', code);
      assert.equal(isVerificationRefusal({ kind: 'http', status: 409, code }), true, code);
    }
    assert.equal(classifyFailure({ kind: 'http', status: 422, code: 'NEEDS_VERIFICATION_INVALID' }), 'PERMANENT');
    assert.equal(isVerificationRefusal({ kind: 'http', status: 422, code: 'NEEDS_VERIFICATION_INVALID' }), true);
    assert.deepEqual([...NEEDS_VERIFICATION_REFUSED_CODES].sort(), ['NEEDS_VERIFICATION_FORM_STALE', 'NEEDS_VERIFICATION_INVALID', 'NEEDS_VERIFICATION_NOT_OPEN']);
  });

  it('404 (not the officer any more) is a refusal; offline, auth and server errors are not', () => {
    assert.equal(isVerificationRefusal({ kind: 'http', status: 404, code: 'NOT_FOUND' }), true);
    assert.equal(isVerificationRefusal({ kind: 'network' }), false);
    assert.equal(isVerificationRefusal({ kind: 'auth', status: 401 }), false);
    assert.equal(isVerificationRefusal({ kind: 'http', status: 503 }), false);
  });

  it('refusals carry fixed messages; the server text explains an invalid submission', () => {
    assert.equal(verificationRefusalMessage({ kind: 'http', status: 409, code: 'NEEDS_VERIFICATION_FORM_STALE', message: 'raw' }), NEEDS_VERIFICATION_FORM_STALE_MESSAGE);
    assert.equal(verificationRefusalMessage({ kind: 'http', status: 409, code: 'NEEDS_VERIFICATION_NOT_OPEN', message: 'raw' }), NEEDS_VERIFICATION_NOT_OPEN_MESSAGE);
    assert.equal(verificationRefusalMessage({ kind: 'http', status: 404, code: 'NOT_FOUND', message: 'raw' }), NEEDS_VERIFICATION_NOT_ASSIGNED_MESSAGE);
    assert.equal(verificationRefusalMessage({ kind: 'http', status: 422, code: 'NEEDS_VERIFICATION_INVALID', message: 'Site 2 has no location' }), 'Site 2 has no location');
    assert.equal(failureMessage({ code: 'NEEDS_VERIFICATION_FORM_STALE', message: 'raw' }, 'NEEDS_VERIFICATION_SUBMISSION'), NEEDS_VERIFICATION_FORM_STALE_MESSAGE);
  });
});
