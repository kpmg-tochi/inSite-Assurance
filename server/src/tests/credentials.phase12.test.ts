/**
 * Phase 12 unit tests (no database): credential policy resolution and field rules, registration
 * display, payment milestone completion and amount maths, and config validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialFieldRules,
  evaluateMilestoneCompletion,
  fixedMilestoneDue,
  formatRegistration,
  formatRegistrationShort,
  paymentBasisMechanismConflict,
  ProjectTypeConfigSchema,
  registrationProfileFieldVisible,
  resolveCredentialPolicy,
  resolveCredentialPolicyWithSource,
  trancheReleaseTarget,
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

describe('Phase 12: payment milestone maths', () => {
  const items = [
    { boqItemId: 'a', wbsCode: '01', budgetedCostNgn: 100, verifiedCumulativePct: 100 },
    { boqItemId: 'b', wbsCode: '02', budgetedCostNgn: 300, verifiedCumulativePct: 60 },
  ];

  it('ALL_ITEMS_COMPLETE needs every item at the required percentage', () => {
    const r = evaluateMilestoneCompletion({ rule: 'ALL_ITEMS_COMPLETE', targetCompletionPct: 100, items });
    assert.equal(r.met, false);
    assert.deepEqual(r.itemsBelowRequired, ['02']);
    assert.equal(r.unmetReasons.length, 1);
    assert.equal(r.weightedProgressPct, 70);
    const lower = evaluateMilestoneCompletion({ rule: 'ALL_ITEMS_COMPLETE', requiredItemPct: 60, targetCompletionPct: 100, items });
    assert.equal(lower.met, true);
    // No rule means ALL_ITEMS_COMPLETE.
    assert.equal(evaluateMilestoneCompletion({ rule: null, targetCompletionPct: 0, items }).met, false);
  });

  it('WEIGHTED_PROGRESS_REACHED compares budget-weighted progress with the target', () => {
    assert.equal(evaluateMilestoneCompletion({ rule: 'WEIGHTED_PROGRESS_REACHED', targetCompletionPct: 70, items }).met, true);
    const r = evaluateMilestoneCompletion({ rule: 'WEIGHTED_PROGRESS_REACHED', targetCompletionPct: 75, items });
    assert.equal(r.met, false);
    assert.match(r.unmetReasons[0], /70%/);
  });

  it('a milestone with no items is never complete', () => {
    assert.equal(evaluateMilestoneCompletion({ rule: 'WEIGHTED_PROGRESS_REACHED', targetCompletionPct: 0, items: [] }).met, false);
  });

  it('the fixed amount due is the fixed (or allocated) amount less what was released', () => {
    assert.deepEqual(fixedMilestoneDue({ fixedReleaseAmountNgn: null, allocatedAmountNgn: 72_000_000, releasedAmountNgn: 0 }), {
      fixedReleaseAmountNgn: 72_000_000,
      alreadyReleasedNgn: 0,
      dueNgn: 72_000_000,
    });
    assert.equal(fixedMilestoneDue({ fixedReleaseAmountNgn: 50, allocatedAmountNgn: 80, releasedAmountNgn: 20 }).dueNgn, 30);
    assert.equal(fixedMilestoneDue({ fixedReleaseAmountNgn: 50, allocatedAmountNgn: 80, releasedAmountNgn: 60 }).dueNgn, 0);
    assert.equal(trancheReleaseTarget({ paymentBasis: 'FIXED_ON_COMPLETION', fixedReleaseAmountNgn: 50, allocatedAmountNgn: 80 }), 50);
    assert.equal(trancheReleaseTarget({ paymentBasis: 'MEASURED', fixedReleaseAmountNgn: 50, allocatedAmountNgn: 80 }), 80);
  });

  it('fixed basis with contractor IPC claims is refused (D-12.2)', () => {
    assert.ok(paymentBasisMechanismConflict('IPC_CLAIM_REQUIRED', 'FIXED_ON_COMPLETION'));
    assert.equal(paymentBasisMechanismConflict('MILESTONE_DIRECT_DISBURSEMENT', 'FIXED_ON_COMPLETION'), null);
    assert.equal(paymentBasisMechanismConflict('IPC_CLAIM_REQUIRED', 'MEASURED'), null);
    const bad = ProjectTypeConfigSchema.safeParse({ payments: { defaultBasis: 'FIXED_ON_COMPLETION', mechanism: 'IPC_CLAIM_REQUIRED' } });
    assert.equal(bad.success, false);
    const ok = ProjectTypeConfigSchema.parse({});
    assert.deepEqual(ok.payments, { defaultBasis: 'MEASURED', defaultCompletionRule: null, mechanism: null });
    assert.deepEqual(ok.credentials, {});
  });
});
