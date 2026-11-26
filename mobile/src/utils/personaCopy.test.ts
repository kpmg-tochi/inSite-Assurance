import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTerminology } from '@insite/shared';
import { PHOTO_SAFEGUARDING_HINT, personaCopy } from './personaCopy';

describe('persona copy (D-R5.23)', () => {
  it('every persona reads the same visit wording; there are no persona branches', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    for (const persona of ['NONE', null, undefined] as const) {
      assert.deepEqual(personaCopy(persona), v);
    }
  });

  it('wording is about monitoring visits (owner decision 1, 2026-11-26)', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.equal(v.checkInButton, 'Check in');
    assert.equal(v.startFormButton, 'Start monitoring visit');
    assert.equal(v.unscheduledVisitButton, 'Ad hoc monitoring visit');
    assert.match(v.unscheduledVisitHelp, /Ad hoc/);
  });

  it('uses the UBEC glossary: monitoring visits and monitoring reports, never "visit report"', () => {
    const v = personaCopy('INDEPENDENT_VERIFIER');
    assert.equal(v.homeSubtitle, 'Your monitoring visits');
    assert.match(v.outboxEmptyDescription, /monitoring report/);
    const all = Object.values(v).join(' ').toLowerCase();
    for (const word of ['visit report', 'sprint', 're-check']) assert.ok(!all.includes(word), `copy contains "${word}"`);
  });

  it('the camera safeguarding hint (C6)', () => {
    assert.equal(PHOTO_SAFEGUARDING_HINT, 'Photograph the works, not pupils');
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
