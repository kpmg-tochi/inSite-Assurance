import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { personaCopy } from './personaCopy';

describe('persona copy', () => {
  it('every persona reads with the officer (verifier) wording; contractors no longer sign in', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    for (const persona of ['CONTRACTOR_EXECUTOR', 'NONE', null, undefined] as const) {
      assert.deepEqual(personaCopy(persona), v);
    }
  });

  it('wording is about inspecting and verifying', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.equal(v.endOfDayButton, 'Record inspection summary & submit');
    assert.equal(v.reportSheetTitle, 'Submit your inspection report');
  });

  it('copy never tells the reader to execute work or mentions an identity check', () => {
    const all = Object.values(personaCopy('INDEPENDENT_VERIFIER')).join(' ').toLowerCase();
    for (const word of ['deliverable', 'execute', 'build', 'install', 'pour', 'complete the work', 'identity', 'brief']) {
      assert.ok(!all.includes(word), `copy contains "${word}"`);
    }
  });

  it('every key has text', () => {
    for (const value of Object.values(personaCopy('INDEPENDENT_VERIFIER'))) assert.ok(value.trim().length > 0);
  });
});
