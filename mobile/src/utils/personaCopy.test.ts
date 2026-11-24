import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTerminology } from '@insite/shared';
import { personaCopy } from './personaCopy';

describe('persona copy (D-R5.23)', () => {
  it('every persona reads the same visit wording; there are no persona branches', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    for (const persona of ['NONE', null, undefined] as const) {
      assert.deepEqual(personaCopy(persona), v);
    }
  });

  it('wording is about visits', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.equal(v.checkInButton, 'Check in');
    assert.equal(v.startFormButton, 'Start the visit form');
    assert.match(v.unscheduledVisitHelp, /Ad hoc/);
  });

  it('takes the tenant terms for the contractor, beneficiary and funder', () => {
    const terms = resolveTerminology({
      contractor: { singular: 'Builder' },
      beneficiary: { singular: 'School', plural: 'Schools' },
      funderParty: { singular: 'Funding authority' },
    });
    const v = personaCopy('INDEPENDENT_VERIFIER', terms);
    assert.equal(v.contractorLabel, 'Builder');
    assert.equal(v.beneficiaryLabel, 'School');
    assert.match(v.incidentSubtitle, /funding authority/);
    assert.equal(personaCopy(null).contractorLabel, 'Contractor');
  });

  it('copy never mentions AI, summary suggestions, chat, reporting periods or an identity check', () => {
    const all = Object.values(personaCopy('INDEPENDENT_VERIFIER')).join(' ').toLowerCase();
    for (const word of [' ai ', 'ai-', 'suggest', 'chat', 'thread', 'inbox', 'daily', 'weekly', 'period', 'identity', 'deliverables inbox']) {
      assert.ok(!` ${all} `.includes(word), `copy contains "${word}"`);
    }
  });

  it('every key has text', () => {
    for (const value of Object.values(personaCopy('INDEPENDENT_VERIFIER'))) assert.ok(value.trim().length > 0);
  });
});
