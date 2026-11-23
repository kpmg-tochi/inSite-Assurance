/**
 * Phase 12 unit tests (no database): credential policy resolution and field rules, registration
 * display, and config validation (redesign R1b: payment milestones removed).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialFieldRules,
  formatRegistration,
  formatRegistrationShort,
  ProjectTypeConfigSchema,
  registrationProfileFieldVisible,
  resolveCredentialPolicy,
  resolveCredentialPolicyWithSource,
} from '@insite/shared';

const snapshot = (credentials: unknown) => ({ config: { credentials } });

describe('Phase 12: credential policy resolution', () => {
  it('defaults to REQUIRED for a tenant that never set a policy (existing behaviour)', () => {
    assert.deepEqual(resolveCredentialPolicy({}), { certifier: 'REQUIRED', fieldAssurance: 'REQUIRED' });
    assert.deepEqual(resolveCredentialPolicy(null), { certifier: 'REQUIRED', fieldAssurance: 'REQUIRED' });
    assert.deepEqual(resolveCredentialPolicy('garbage'), { certifier: 'REQUIRED', fieldAssurance: 'REQUIRED' });
  });

  it('applies project type → tenant → platform default, per subject', () => {
    const tenant = { certifier: 'OPTIONAL' };
    assert.deepEqual(resolveCredentialPolicy(tenant), { certifier: 'OPTIONAL', fieldAssurance: 'REQUIRED' });
    assert.deepEqual(resolveCredentialPolicy(tenant, snapshot({ fieldAssurance: 'HIDDEN' })), {
      certifier: 'OPTIONAL',
      fieldAssurance: 'HIDDEN',
    });
    assert.deepEqual(resolveCredentialPolicy(tenant, snapshot({ certifier: 'REQUIRED' })), {
      certifier: 'REQUIRED',
      fieldAssurance: 'REQUIRED',
    });
    // null on the type means "use the tenant setting".
    assert.equal(resolveCredentialPolicy(tenant, snapshot({ certifier: null })).certifier, 'OPTIONAL');
    const sources = resolveCredentialPolicyWithSource(tenant, snapshot({ fieldAssurance: 'HIDDEN' }));
    assert.equal(sources.certifier.source, 'TENANT');
    assert.equal(sources.fieldAssurance.source, 'PROJECT_TYPE');
    assert.equal(resolveCredentialPolicyWithSource({}).certifier.source, 'PLATFORM_DEFAULT');
  });

  it('field rules: hidden, optional (never blocks) and required', () => {
    assert.deepEqual(
      [credentialFieldRules('HIDDEN').visible, credentialFieldRules('HIDDEN').required],
      [false, false]
    );
    assert.deepEqual(
      [credentialFieldRules('OPTIONAL').visible, credentialFieldRules('OPTIONAL').required],
      [true, false]
    );
    assert.deepEqual(
      [credentialFieldRules('REQUIRED').visible, credentialFieldRules('REQUIRED').required],
      [true, true]
    );
    assert.match(credentialFieldRules('OPTIONAL', 'fieldAssurance').label, /optional/);
  });

  it('profile forms hide the fields only when every subject is HIDDEN for the whole tenant', () => {
    const hidden = { certifier: 'HIDDEN', fieldAssurance: 'HIDDEN' };
    assert.equal(registrationProfileFieldVisible({}), true);
    assert.equal(registrationProfileFieldVisible(hidden), false);
    assert.equal(registrationProfileFieldVisible({ certifier: 'HIDDEN' }), true);
    assert.equal(registrationProfileFieldVisible(hidden, [{ credentials: { certifier: 'OPTIONAL' } }]), true);
    assert.equal(registrationProfileFieldVisible(hidden, [{ credentials: { certifier: 'HIDDEN' } }]), false);
  });

  it('prints a registration only when a number exists', () => {
    assert.equal(formatRegistration({ bodyCode: 'QSRBN', prefix: 'QSRBN Reg. No.', number: '3842' }), 'QSRBN Reg. No. 3842');
    assert.equal(formatRegistration({ bodyCode: 'COREN', number: 'R.1' }), 'COREN Reg. No. R.1');
    assert.equal(formatRegistration({ bodyCode: 'COREN', number: null }), null);
    assert.equal(formatRegistration({ number: '  ' }), null);
    assert.equal(formatRegistrationShort({ bodyCode: 'COREN', number: 'R.1' }), 'COREN #R.1');
    assert.equal(formatRegistrationShort({}), null);
  });
});

describe('Redesign R1b: project type payment defaults', () => {
  it('a type holds retention defaults only (payment milestones are gone)', () => {
    const ok = ProjectTypeConfigSchema.parse({});
    assert.deepEqual(ok.payments, { retentionPercentage: null, retentionDurationMonths: null });
    assert.deepEqual(ok.credentials, {});
    const set = ProjectTypeConfigSchema.parse({ payments: { retentionPercentage: 5, retentionDurationMonths: 12 } });
    assert.deepEqual(set.payments, { retentionPercentage: 5, retentionDurationMonths: 12 });
    // An old snapshot with the Phase 12 keys still parses; the old keys are dropped.
    const legacy = ProjectTypeConfigSchema.parse({ payments: { defaultBasis: 'FIXED_ON_COMPLETION', mechanism: 'IPC_CLAIM_REQUIRED' } });
    assert.deepEqual(legacy.payments, { retentionPercentage: null, retentionDurationMonths: null });
    assert.equal(ProjectTypeConfigSchema.safeParse({ payments: { retentionPercentage: 50 } }).success, false);
  });
});
