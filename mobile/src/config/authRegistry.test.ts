import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectIdFromPath,
  scopeForProject,
  sessionKeyForProject,
  setAuthRegistry,
  tokenForActiveProject,
  tokenForProject,
} from './authRegistry';
import { clearSessionEnded, markSessionEnded, sessionEndedFor } from './sessionState';

const A = '11111111-1111-4111-8111-111111111111'; // provisioned (account) project
const B = '22222222-2222-4222-8222-222222222222'; // provisioned (account) project
const J = '33333333-3333-4333-8333-333333333333'; // joined with a code

describe('Phase 5 token routing', () => {
  beforeEach(() => {
    setAuthRegistry({ accountToken: 'acct', joinTokens: [{ projectId: J, token: 'join-j' }], activeProjectId: A });
    clearSessionEnded();
  });

  it('reads the project from project paths and the baseline path', () => {
    assert.equal(projectIdFromPath(`/projects/${A}/captures`), A);
    assert.equal(projectIdFromPath(`/auth/mobile/projects/${J}/baseline`), J);
    assert.equal(projectIdFromPath(`/projects/${B}?x=1`), B);
    assert.equal(projectIdFromPath('/auth/me'), null);
  });

  it('uses the join token for a joined project and the account token otherwise', () => {
    assert.equal(tokenForProject(J), 'join-j');
    assert.equal(tokenForProject(A), 'acct');
    assert.equal(tokenForProject(B), 'acct');
    assert.equal(tokenForActiveProject(), 'acct');
    assert.equal(scopeForProject(J), `project:${J}`);
    assert.equal(scopeForProject(A), 'account');
  });

  it('records the session an item is queued under', () => {
    setAuthRegistry({
      accountToken: 'acct',
      joinTokens: [{ projectId: J, token: 'join-j', sessionId: 'sess-1' }],
      activeProjectId: A,
    });
    assert.equal(sessionKeyForProject(J), 'join:sess-1');
    assert.equal(sessionKeyForProject(A), 'account');
  });

  it('has no token for a project once its join session is gone and there is no account', () => {
    setAuthRegistry({ accountToken: null, joinTokens: [], activeProjectId: null });
    assert.equal(tokenForProject(J), null);
  });
});

describe('Phase 5 scoped session end', () => {
  beforeEach(() => {
    setAuthRegistry({ accountToken: 'acct', joinTokens: [{ projectId: J, token: 'join-j' }], activeProjectId: A });
    clearSessionEnded();
  });

  it('an ended join session holds only its own project', () => {
    markSessionEnded(`project:${J}`, 'SESSION_REVOKED', 'revoked');
    assert.ok(sessionEndedFor(J));
    assert.equal(sessionEndedFor(A), null);
    assert.equal(sessionEndedFor(B), null);
  });

  it('an ended account holds every provisioned project but not the joined one', () => {
    markSessionEnded('account', 'DEVICE_REVOKED', 'device revoked');
    assert.ok(sessionEndedFor(A));
    assert.ok(sessionEndedFor(B));
    assert.equal(sessionEndedFor(J), null);
  });

  it('a revoked provisioned session holds one project; clearing it releases the project', () => {
    markSessionEnded(`project:${A}`, 'SESSION_REVOKED', 'revoked');
    assert.ok(sessionEndedFor(A));
    assert.equal(sessionEndedFor(B), null);
    clearSessionEnded(`project:${A}`);
    assert.equal(sessionEndedFor(A), null);
  });
});
