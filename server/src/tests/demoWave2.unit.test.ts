/**
 * Client demo updates, wave 2 (no database): site rules (C2), Google Maps links (D3 light), the
 * contractor reliability rating (F.3) and the RC number normaliser (F.1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractorReliability,
  deriveSiteStatus,
  facilityNoun,
  normaliseRcNumber,
  parseMapsLink,
  SaveProjectSitesRequestSchema,
  starGlyphs,
  weightedProgressPct,
  type ContractorRatingFacts,
} from '@insite/shared';

describe('sites (C2)', () => {
  it('weights progress by line amount', () => {
    assert.equal(weightedProgressPct([]), null);
    assert.equal(weightedProgressPct([{ amountNgn: 300, progressPct: 100 }, { amountNgn: 100, progressPct: 0 }]), 75);
    assert.equal(weightedProgressPct([{ amountNgn: 0, progressPct: 40 }, { amountNgn: 0, progressPct: 60 }]), 50);
  });

  it('derives the register status', () => {
    const base = { progressPct: 40, hasUnitBehind: false, started: true, handedOver: false };
    assert.equal(deriveSiteStatus(base), 'ONGOING');
    assert.equal(deriveSiteStatus({ ...base, hasUnitBehind: true }), 'BEHIND');
    assert.equal(deriveSiteStatus({ ...base, progressPct: 100, hasUnitBehind: true }), 'COMPLETED');
    assert.equal(deriveSiteStatus({ ...base, progressPct: 0, started: false }), 'NOT_STARTED');
    assert.equal(deriveSiteStatus({ ...base, handedOver: true }), 'HANDED_OVER');
    assert.equal(deriveSiteStatus({ ...base, progressPct: null, started: false }), 'NOT_STARTED');
  });

  it('needs both coordinates or neither', () => {
    const site = { schoolName: 'LGEA Primary School, Dala', schoolLevel: 'PRIMARY', lgaCode: 'KN-DALA' };
    assert.ok(SaveProjectSitesRequestSchema.safeParse({ sites: [site] }).success);
    assert.ok(SaveProjectSitesRequestSchema.safeParse({ sites: [{ ...site, latitude: 12, longitude: 8.5 }] }).success);
    assert.ok(!SaveProjectSitesRequestSchema.safeParse({ sites: [{ ...site, latitude: 12 }] }).success);
  });

  it('reads coordinates from pasted Google Maps links', () => {
    assert.deepEqual(parseMapsLink('9.0765, 7.3986'), { latitude: 9.0765, longitude: 7.3986 });
    assert.deepEqual(parseMapsLink('https://www.google.com/maps/@12.0022,8.5919,15z'), { latitude: 12.0022, longitude: 8.5919 });
    assert.deepEqual(parseMapsLink('https://maps.google.com/?q=6.5244,3.3792'), { latitude: 6.5244, longitude: 3.3792 });
    assert.deepEqual(
      parseMapsLink('https://www.google.com/maps/place/Dala/@12.0,8.5,14z/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d12.0153!4d8.4823'),
      { latitude: 12.0153, longitude: 8.4823 }
    );
    assert.deepEqual(parseMapsLink('https://www.google.com/maps/search/?api=1&query=11.8%2C9.3'), { latitude: 11.8, longitude: 9.3 });
    assert.equal(parseMapsLink('https://maps.app.goo.gl/abc123'), null);
    assert.equal(parseMapsLink('95, 200'), null);
    assert.equal(parseMapsLink(''), null);
  });
});

describe('facility names mid-sentence (appendix A title case)', () => {
  it('lower-cases title-case words and keeps acronyms', () => {
    const f = (name: string) => ({ name, pluralName: null, archetype: 'BUILDING_WORKS' as const });
    assert.equal(facilityNoun(f('Gate House'), 1), 'gate house');
    assert.equal(facilityNoun(f('ICT Lab / Room'), 1), 'ICT lab / room');
    assert.equal(facilityNoun({ name: 'Pupils Furniture', pluralName: null, archetype: 'SUPPLY_INSTALLATION' }, 3), 'pupils furniture');
    assert.equal(facilityNoun(f('ECCDE Centre'), 1), 'ECCDE centre');
  });
});

describe('contractor register (F.1, F.3)', () => {
  const report = (date: string, workmanship: number, projectId = 'p1') => ({ date, workmanship, projectId });
  const noFacts: ContractorRatingFacts = {
    reports: [],
    workPhases: { verifiedMetOnTime: 0, verified: 0 },
    mobilisation: { onTime: 0, total: 0 },
    findings: { majorOrCritical: 0, rectifiedAverageDays: null },
    closureRatings: [],
  };

  it('normalises CAC numbers', () => {
    assert.equal(normaliseRcNumber('rc1234567'), 'RC 1234567');
    assert.equal(normaliseRcNumber('BN-123456'), 'BN 123456');
    assert.equal(normaliseRcNumber(null), null);
  });

  it('is not rated below the minimum number of reports', () => {
    const r = contractorReliability({ ...noFacts, reports: [report('2026-11-01', 4)] }, '2026-11-25');
    assert.equal(r.rated, false);
    assert.equal(r.stars, null);
    assert.equal(r.summary, 'Not yet rated: 1 report');
  });

  it('rates from workmanship, spreading the weight of empty components', () => {
    const reports = ['2026-11-20', '2026-11-10', '2026-10-30', '2026-10-20', '2026-10-10'].map((d) => report(d, 4));
    const r = contractorReliability({ ...noFacts, reports }, '2026-11-25');
    assert.equal(r.rated, true);
    // Workmanship 4 (0.4) and findings 5 (0.2, none raised) share the weight in proportion once schedule
    // and closure are empty: 4 x 2/3 + 5 x 1/3 = 4.3, shown as 4.5 stars (nearest half).
    assert.equal(r.score, 4.3);
    assert.equal(r.stars, 4.5);
    assert.equal(r.components.find((c) => c.key === 'CLOSURE')!.weight, 0);
    assert.equal(r.summary, '★★★★½ 4.3 · 5 reports on 1 project');
  });

  it('counts recent reports more and ignores reports outside the window', () => {
    const facts = {
      ...noFacts,
      reports: [
        report('2026-11-20', 2),
        report('2026-11-15', 2),
        report('2026-11-10', 2),
        report('2025-06-01', 5),
        report('2025-05-01', 5),
        report('2023-01-01', 5),
      ],
    };
    const r = contractorReliability(facts, '2026-11-25', { minReports: 3 });
    assert.equal(r.reportCount, 5);
    const w = r.components.find((c) => c.key === 'WORKMANSHIP')!.score!;
    assert.ok(w < 3, `recent low reports dominate (${w})`);
  });

  it('uses schedule, findings and closure when present', () => {
    const reports = Array.from({ length: 6 }, (_, i) => report(`2026-1${i % 2}-0${i + 1}`, 3, i < 3 ? 'p1' : 'p2'));
    const r = contractorReliability(
      {
        reports,
        workPhases: { verifiedMetOnTime: 2, verified: 4 },
        mobilisation: { onTime: 0, total: 2 },
        findings: { majorOrCritical: 3, rectifiedAverageDays: 60 },
        closureRatings: [4, 5],
      },
      '2026-11-25'
    );
    assert.equal(r.rated, true);
    assert.equal(r.projectCount, 2);
    assert.equal(r.components.find((c) => c.key === 'SCHEDULE')!.score, 1.7);
    assert.equal(r.components.find((c) => c.key === 'FINDINGS')!.score, 3.3);
    assert.equal(r.components.find((c) => c.key === 'CLOSURE')!.score, 4.5);
    assert.equal(starGlyphs(3.5), '★★★½');
  });
});
