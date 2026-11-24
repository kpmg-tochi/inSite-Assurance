import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MobileBaselinePack } from '@insite/shared';
import { cadenceCopy, cadenceSettingsFromPack, dueStatus, formatCountdown, periodAt } from './projectCadence';
import { personaCopy } from './personaCopy';

const pack = (cadence: Partial<NonNullable<MobileBaselinePack['cadence']>> | null) =>
  ({
    projectId: '00000000-0000-0000-0000-000000000001',
    reportingCadence: cadence?.reportingCadence ?? 'DAILY',
    timezone: 'Africa/Lagos',
    cadence: cadence
      ? {
          reportingCadence: 'WEEKLY',
          workdayStartTime: '08:00',
          workdayEndTime: '17:00',
          workWeekDays: [1, 2, 3, 4, 5, 6],
          periodStartDayOfWeek: 1,
          customIntervalDays: null,
          reportDueTime: null,
          reportGraceMinutes: 0,
          cadenceAnchorDate: null,
          timezone: 'Africa/Lagos',
          ...cadence,
        }
      : undefined,
  }) as unknown as MobileBaselinePack;

describe('Phase 8: mobile cadence', () => {
  it('computes the weekly period window and due state from the pack', () => {
    const s = cadenceSettingsFromPack(pack({}), 'UTC');
    const p = periodAt(s, new Date('2026-11-18T10:00:00Z'));
    assert.deepEqual({ start: p.start, end: p.end, dueAt: p.dueAt }, { start: '2026-11-16', end: '2026-11-22', dueAt: '2026-11-21T16:00:00.000Z' });
    assert.deepEqual(dueStatus(p, new Date('2026-11-18T10:00:00Z')), { label: 'Due Sat 17:00', overdue: false, minutesLeft: 4680 });
    assert.equal(dueStatus(p, new Date('2026-11-22T10:00:00Z'))!.overdue, true);
    assert.equal(formatCountdown(4680), '3d 6h left');
  });

  it('treats packs from before Phase 8 as daily', () => {
    const s = cadenceSettingsFromPack(pack(null), 'UTC');
    assert.equal(s.reportingCadence, 'DAILY');
    assert.equal(s.timezone, 'Africa/Lagos');
  });

  it('has no due time for inspection-only projects', () => {
    const s = cadenceSettingsFromPack(pack({ reportingCadence: 'INSPECTION_ONLY' }), 'UTC');
    assert.equal(dueStatus(periodAt(s, new Date('2026-11-18T10:00:00Z'))), null);
  });

  it('words follow the cadence; daily wording is unchanged', () => {
    assert.equal(cadenceCopy('WEEKLY').deliverablesHeading, "This week's deliverables");
    assert.equal(cadenceCopy('WEEKLY').reportNoun, 'Weekly report');
    assert.equal(personaCopy('INDEPENDENT_VERIFIER', 'WEEKLY').inboxSubtitle, 'Weekly Inspection & Verification');
    assert.equal(personaCopy('INDEPENDENT_VERIFIER').inboxSubtitle, 'Daily Inspection & Verification');
    assert.equal(personaCopy('INDEPENDENT_VERIFIER', 'INSPECTION_ONLY').inboxSubtitle, 'Inspection & Verification');
  });
});
