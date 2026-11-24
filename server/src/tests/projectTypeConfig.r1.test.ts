/**
 * Redesign R1 unit tests (no database): project type config after the lender product (R1b) and
 * professional registration (R1d) were removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectTypeConfigSchema } from '@insite/shared';

describe('Redesign R1b: project type payment defaults', () => {
  it('a type holds retention defaults only (payment milestones are gone)', () => {
    const ok = ProjectTypeConfigSchema.parse({});
    assert.deepEqual(ok.payments, { retentionPercentage: null, retentionDurationMonths: null });
    const set = ProjectTypeConfigSchema.parse({ payments: { retentionPercentage: 5, retentionDurationMonths: 12 } });
    assert.deepEqual(set.payments, { retentionPercentage: 5, retentionDurationMonths: 12 });
    // An old snapshot with the Phase 12 keys still parses; the old keys are dropped.
    const legacy = ProjectTypeConfigSchema.parse({ payments: { defaultBasis: 'FIXED_ON_COMPLETION', mechanism: 'IPC_CLAIM_REQUIRED' } });
    assert.deepEqual(legacy.payments, { retentionPercentage: null, retentionDurationMonths: null });
    assert.equal(ProjectTypeConfigSchema.safeParse({ payments: { retentionPercentage: 50 } }).success, false);
  });
});

describe('Redesign R1d: registration policy removed', () => {
  it('an old snapshot with a credentials key still parses and the key is dropped', () => {
    const legacy = ProjectTypeConfigSchema.parse({ credentials: { certifier: 'REQUIRED', fieldAssurance: 'HIDDEN' } }) as Record<string, unknown>;
    assert.equal('credentials' in legacy, false);
  });
});
