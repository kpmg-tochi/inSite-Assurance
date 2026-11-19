import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MobileBaselinePack } from '@insite/shared';
import { cadenceCopy, cadenceSettingsFromPack, dueStatus, formatCountdown, periodAt, presenceWindowOpen } from './projectCadence';
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

  it('has no due time and no presence window for inspection-only projects', () => {
    const s = cadenceSettingsFromPack(pack({ reportingCadence: 'INSPECTION_ONLY' }), 'UTC');
    assert.equal(dueStatus(periodAt(s, new Date('2026-11-18T10:00:00Z'))), null);
    assert.equal(presenceWindowOpen(s, new Date('2026-11-18T10:00:00Z')), false);
  });

  it('opens the presence window only in working hours on working days', () => {
    const s = cadenceSettingsFromPack(pack({}), 'UTC');
    assert.equal(presenceWindowOpen(s, new Date('2026-11-18T10:00:00Z')), true);
    assert.equal(presenceWindowOpen(s, new Date('2026-11-18T18:00:00Z')), false);
    assert.equal(presenceWindowOpen(s, new Date('2026-11-22T10:00:00Z')), false);
  });

  it('words follow the cadence; daily wording is unchanged', () => {
    assert.equal(cadenceCopy('WEEKLY').deliverablesHeading, "This week's deliverables");
    assert.equal(cadenceCopy('WEEKLY').reportNoun, 'Weekly report');
    assert.equal(personaCopy('CONTRACTOR_EXECUTOR', 'WEEKLY').endOfDayButton, 'Submit full report for this week');
    assert.equal(personaCopy('CONTRACTOR_EXECUTOR').endOfDayButton, 'Submit full report for today');
  });
});
