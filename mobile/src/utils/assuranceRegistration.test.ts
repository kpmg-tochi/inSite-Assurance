import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { credentialFieldRules } from '@insite/shared';
import { assuranceRegistrationError, assuranceRegistrationFields, assuranceRegistrationSetup } from './assuranceRegistration';

describe('identity assurance registration (Phase 12)', () => {
  it('credentialFieldRules: hidden, optional and required', () => {
    assert.deepEqual(
      (['HIDDEN', 'OPTIONAL', 'REQUIRED'] as const).map((r) => {
        const rules = credentialFieldRules(r, 'fieldAssurance');
        return [rules.visible, rules.required];
      }),
      [
        [false, false],
        [true, false],
        [true, true],
      ]
    );
  });

  it('a pack without the policy behaves as before: required, with the default bodies', () => {
    const setup = assuranceRegistrationSetup({});
    assert.equal(setup.requirement, 'REQUIRED');
    assert.equal(setup.rules.required, true);
    assert.ok(setup.bodies.some((b) => b.code === 'COREN'));
    assert.equal(assuranceRegistrationSetup(null).requirement, 'REQUIRED');
  });

  it('uses the policy and bodies the pack carries', () => {
    const setup = assuranceRegistrationSetup({
      fieldAssurance: { registration: 'OPTIONAL', registrationBodies: [{ code: 'NIQS', fullName: 'NIQS', displayPrefix: 'NIQS No.', exampleNumber: null }] },
    });
    assert.equal(setup.rules.required, false);
    assert.deepEqual(setup.bodies.map((b) => b.code), ['NIQS']);
  });

  it('required blocks an empty number; optional never blocks; hidden never asks', () => {
    const required = credentialFieldRules('REQUIRED', 'fieldAssurance');
    const optional = credentialFieldRules('OPTIONAL', 'fieldAssurance');
    const hidden = credentialFieldRules('HIDDEN', 'fieldAssurance');
    assert.ok(assuranceRegistrationError(required, { number: ' ', bodyCode: 'COREN' }));
    assert.equal(assuranceRegistrationError(required, { number: 'R.1', bodyCode: 'COREN' }), null);
    assert.equal(assuranceRegistrationError(optional, { number: '', bodyCode: null }), null);
    assert.ok(assuranceRegistrationError(optional, { number: 'R.1', bodyCode: null }), 'a number needs its body');
    assert.equal(assuranceRegistrationError(hidden, { number: '', bodyCode: null }), null);
  });

  it('sends nothing when hidden or empty, and never a display string', () => {
    const hidden = credentialFieldRules('HIDDEN', 'fieldAssurance');
    const optional = credentialFieldRules('OPTIONAL', 'fieldAssurance');
    assert.deepEqual(assuranceRegistrationFields(hidden, { number: 'R.1', bodyCode: 'COREN' }), {});
    assert.deepEqual(assuranceRegistrationFields(optional, { number: '', bodyCode: 'COREN' }), {});
    assert.deepEqual(assuranceRegistrationFields(optional, { number: ' R.1 ', bodyCode: 'COREN' }), {
      registrationNumber: 'R.1',
      registrationBodyCode: 'COREN',
    });
  });
});
