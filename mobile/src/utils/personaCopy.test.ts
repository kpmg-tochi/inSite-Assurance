import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyPersona, personaCopy } from './personaCopy';

describe('persona copy', () => {
  it('only CONTRACTOR_EXECUTOR reads as a contractor, as on the server', () => {
    assert.equal(copyPersona('CONTRACTOR_EXECUTOR'), 'CONTRACTOR_EXECUTOR');
    assert.equal(copyPersona('INDEPENDENT_VERIFIER'), 'INDEPENDENT_VERIFIER');
    assert.equal(copyPersona('NONE'), 'INDEPENDENT_VERIFIER');
    assert.equal(copyPersona(null), 'INDEPENDENT_VERIFIER');
    assert.equal(copyPersona(undefined), 'INDEPENDENT_VERIFIER');
  });

  it('contractor keeps the execution wording', () => {
    const c = personaCopy('CONTRACTOR_EXECUTOR');
    assert.equal(c.briefCardTitle, "Today's deliverable");
    assert.equal(c.pointersHeading, 'Report pointers:');
    assert.equal(c.endOfDayButton, 'Submit full report for today');
    assert.equal(c.inboxSubtitle, 'Daily Field WBS Breakdown');
  });

  it('verifier wording is about inspecting and verifying', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.equal(v.briefCardTitle, "Today's inspection brief");
    assert.equal(v.pointersHeading, 'What to verify and record:');
    assert.equal(v.endOfDayButton, 'Record inspection summary & submit');
    assert.equal(v.standardsHeading, 'Standards to check:');
  });

  it('verifier copy never tells the reader to execute work', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    const all = Object.values(v).join(' ').toLowerCase();
    for (const word of ['deliverable', 'execute', 'build', 'install', 'pour', 'complete the work']) {
      assert.ok(!all.includes(word), `verifier copy contains "${word}"`);
    }
  });

  it('every key has text for both personas', () => {
    const c = personaCopy('CONTRACTOR_EXECUTOR');
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.deepEqual(Object.keys(c).sort(), Object.keys(v).sort());
    for (const value of [...Object.values(c), ...Object.values(v)]) assert.ok(value.trim().length > 0);
  });
});
