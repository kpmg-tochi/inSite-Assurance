import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentSessionId,
  currentSessionKey,
  getAccountToken,
  projectIdFromPath,
  setAuthRegistry,
} from './authRegistry';
import { clearSessionEnded, markSessionEnded, sessionEndedFor } from './sessionState';

const A = '11111111-1111-4111-8111-111111111111'; // provisioned (account) project
const B = '22222222-2222-4222-8222-222222222222'; // provisioned (account) project

describe('token routing (provisioned accounts only)', () => {
  beforeEach(() => {
    setAuthRegistry({
      accountToken: 'acct',
      projectSessions: [
        { projectId: A, sessionId: 'sess-a' },
        { projectId: B, sessionId: null },
      ],
      activeProjectId: A,
    });
    clearSessionEnded();
  });

  it('reads the project from project paths and the baseline path', () => {
    assert.equal(projectIdFromPath(`/projects/${A}/captures`), A);
    assert.equal(projectIdFromPath(`/auth/mobile/projects/${B}/baseline`), B);
    assert.equal(projectIdFromPath(`/projects/${B}?x=1`), B);
    assert.equal(projectIdFromPath('/auth/me'), null);
  });

  it('records items under the account and knows each provisioned session id', () => {
    assert.equal(getAccountToken(), 'acct');
    assert.equal(currentSessionKey(), 'account');
    assert.equal(currentSessionId(A), 'sess-a');
    assert.equal(currentSessionId(B), null);
  });

  it('has no token or session key once signed out', () => {
    setAuthRegistry({ accountToken: null, projectSessions: [], activeProjectId: null });
    assert.equal(getAccountToken(), null);
    assert.equal(currentSessionKey(), null);
    assert.equal(currentSessionId(A), null);
  });
});

describe('scoped session end', () => {
  beforeEach(() => {
    setAuthRegistry({ accountToken: 'acct', projectSessions: [], activeProjectId: A });
    clearSessionEnded();
  });

  it('an ended account holds every project', () => {
    markSessionEnded('account', 'DEVICE_REVOKED', 'device revoked');
    assert.ok(sessionEndedFor(A));
    assert.ok(sessionEndedFor(B));
    assert.ok(sessionEndedFor(null));
  });

  it('a revoked provisioned session holds one project; clearing it releases the project', () => {
    markSessionEnded(`project:${A}`, 'SESSION_REVOKED', 'revoked');
    assert.ok(sessionEndedFor(A));
    assert.equal(sessionEndedFor(B), null);
    clearSessionEnded(`project:${A}`);
    assert.equal(sessionEndedFor(A), null);
  });
});
