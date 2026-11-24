/**
 * Phase 14 unit tests (pure, no database), after redesign R5f deleted the checklist templates,
 * inspection answers and QUARTERLY reporting periods: the type config keys that remain and the
 * supervision workload maths.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWorkload, maxPairwiseDistanceKm, ProjectTypeConfigSchema } from '@insite/shared';

describe('Phase 14: type config', () => {
  it('a project type saved before Phase 14 parses with empty supervision; removed keys (streams, inspections) are stripped', () => {
    const config = ProjectTypeConfigSchema.parse({});
    const old = ProjectTypeConfigSchema.parse({
      reportingStreams: [{ key: 'x' }],
      reportingDefaults: {},
      inspections: { templateCodeByVisitType: { BASELINE: 'BASELINE_SURVEY' } },
    }) as Record<string, unknown>;
    assert.equal('reportingStreams' in old, false);
    assert.equal('reportingDefaults' in old, false);
    assert.equal('inspections' in old, false, 'R5f: the legacy inspections key is gone');
    assert.deepEqual(config.supervision, { supervisorRoleCodes: [], maxSitesPerSupervisor: null, maxSpreadKm: null });
  });
});

describe('Phase 14: supervision workload', () => {
  const lagos = { latitude: 6.5244, longitude: 3.3792 };
  const ikeja = { latitude: 6.6018, longitude: 3.3515 };
  const abuja = { latitude: 9.0765, longitude: 7.3986 };

  it('spread is the furthest pair, null with fewer than two sites', () => {
    assert.equal(maxPairwiseDistanceKm([lagos]), null);
    const near = maxPairwiseDistanceKm([lagos, ikeja])!;
    assert.ok(near > 8 && near < 10, `Lagos-Ikeja ${near} km`);
    const far = maxPairwiseDistanceKm([lagos, ikeja, abuja])!;
    assert.ok(far > 500 && far < 560, `Lagos-Abuja ${far} km`);
  });

  it('warns above the thresholds, never with no limits', () => {
    assert.deepEqual(evaluateWorkload(11, 40, { maxSitesPerSupervisor: 10, maxSpreadKm: 50 }), { overSiteLimit: true, overSpread: false });
    assert.deepEqual(evaluateWorkload(10, 60, { maxSitesPerSupervisor: 10, maxSpreadKm: 50 }), { overSiteLimit: false, overSpread: true });
    assert.deepEqual(evaluateWorkload(99, 999, { maxSitesPerSupervisor: null, maxSpreadKm: null }), { overSiteLimit: false, overSpread: false });
  });
});
