/**
 * Phase 14 unit tests (pure, no database): QUARTERLY reporting periods, checklist answer rules,
 * checklist template validation and supervision workload maths.
 * Calendar notes: 2026-11-16 is a Monday, 2026-03-29 and 2026-05-31 are Sundays, 2027-01-31 is a
 * Sunday.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChecklistSectionsSchema,
  evaluateWorkload,
  getReportingPeriodForDate,
  inspectionSubmissionDeadline,
  isFailedAnswer,
  maxPairwiseDistanceKm,
  nextPeriodStart,
  periodNoun,
  ProjectTypeConfigSchema,
  validateInspectionAnswers,
  type CadenceSettings,
  type ChecklistSection,
} from '@insite/shared';

function settings(overrides: Partial<CadenceSettings> = {}): CadenceSettings {
  return {
    reportingCadence: 'QUARTERLY',
    workWeekDays: [1, 2, 3, 4, 5, 6],
    periodStartDayOfWeek: 1,
    customIntervalDays: null,
    workdayStartTime: '08:00',
    workdayEndTime: '17:00',
    reportDueTime: null,
    reportGraceMinutes: 0,
    cadenceAnchorDate: null,
    timezone: 'Africa/Lagos',
    ...overrides,
  };
}

type Case = {
  name: string;
  s: Partial<CadenceSettings>;
  date: string;
  expect: { periodStart: string; periodEnd: string; calendarEnd: string; firstWorkday: string; dueAt: string };
};

const QUARTERLY_CASES: Case[] = [
  {
    name: 'default anchor (January): Q4 is October to December, due on its last workday',
    s: {},
    date: '2026-11-20',
    expect: { periodStart: '2026-10-01', periodEnd: '2026-12-31', calendarEnd: '2026-12-31', firstWorkday: '2026-10-01', dueAt: '2026-12-31T16:00:00.000Z' },
  },
  {
    name: 'null anchor behaves as January',
    s: { cadenceQuarterAnchorMonth: null },
    date: '2026-01-01',
    expect: { periodStart: '2026-01-01', periodEnd: '2026-03-31', calendarEnd: '2026-03-31', firstWorkday: '2026-01-01', dueAt: '2026-03-31T16:00:00.000Z' },
  },
  {
    name: 'anchor February: the November quarter runs across the year end and ends on a Sunday',
    s: { cadenceQuarterAnchorMonth: 2 },
    date: '2027-01-15',
    expect: { periodStart: '2026-11-01', periodEnd: '2027-01-30', calendarEnd: '2027-01-31', firstWorkday: '2026-11-02', dueAt: '2027-01-30T16:00:00.000Z' },
  },
  {
    name: 'anchor February: the first day of the quarter belongs to it',
    s: { cadenceQuarterAnchorMonth: 2 },
    date: '2026-11-01',
    expect: { periodStart: '2026-11-01', periodEnd: '2027-01-30', calendarEnd: '2027-01-31', firstWorkday: '2026-11-02', dueAt: '2027-01-30T16:00:00.000Z' },
  },
  {
    name: 'anchor April (fiscal year): March is in the January quarter of the same year',
    s: { cadenceQuarterAnchorMonth: 4 },
    date: '2026-03-31',
    expect: { periodStart: '2026-01-01', periodEnd: '2026-03-31', calendarEnd: '2026-03-31', firstWorkday: '2026-01-01', dueAt: '2026-03-31T16:00:00.000Z' },
  },
  {
    name: 'anchor December: December to February crosses the year end',
    s: { cadenceQuarterAnchorMonth: 12 },
    date: '2027-02-10',
    expect: { periodStart: '2026-12-01', periodEnd: '2027-02-27', calendarEnd: '2027-02-28', firstWorkday: '2026-12-01', dueAt: '2027-02-27T16:00:00.000Z' },
  },
  {
    name: 'Monday to Friday week: a quarter ending on a Sunday is due the Friday before; first workday skips a Sunday start',
    s: { cadenceQuarterAnchorMonth: 3, workWeekDays: [1, 2, 3, 4, 5] },
    date: '2026-04-10',
    expect: { periodStart: '2026-03-01', periodEnd: '2026-05-29', calendarEnd: '2026-05-31', firstWorkday: '2026-03-02', dueAt: '2026-05-29T16:00:00.000Z' },
  },
  {
    name: 'due time and grace follow the settings',
    s: { reportDueTime: '12:00' },
    date: '2026-07-01',
    expect: { periodStart: '2026-07-01', periodEnd: '2026-09-30', calendarEnd: '2026-09-30', firstWorkday: '2026-07-01', dueAt: '2026-09-30T11:00:00.000Z' },
  },
];

describe('Phase 14: QUARTERLY reporting periods', () => {
  for (const c of QUARTERLY_CASES) {
    it(c.name, () => {
      const p = getReportingPeriodForDate(settings(c.s), c.date);
      assert.ok(p);
      assert.equal(p.periodStart, c.expect.periodStart);
      assert.equal(p.periodEnd, c.expect.periodEnd);
      assert.equal(p.calendarEnd, c.expect.calendarEnd);
      assert.equal(p.firstWorkday, c.expect.firstWorkday);
      assert.equal(p.dueAt, c.expect.dueAt);
    });
  }

  it('every day of a year belongs to exactly one quarter, and quarters tile the year', () => {
    for (const anchor of [1, 2, 4, 7, 12]) {
      const s = settings({ cadenceQuarterAnchorMonth: anchor });
      const starts = new Set<string>();
      let day = '2026-01-01';
      for (let i = 0; i < 366; i++) {
        const p = getReportingPeriodForDate(s, day)!;
        assert.ok(p.periodStart <= day && day <= p.calendarEnd, `${day} outside its quarter (anchor ${anchor})`);
        starts.add(p.periodStart);
        const next = new Date(`${day}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        day = next.toISOString().slice(0, 10);
      }
      assert.ok(starts.size === 4 || starts.size === 5, `anchor ${anchor}: ${starts.size} quarters`);
      for (const start of starts) assert.equal(Number(start.slice(5, 7)) % 3, anchor % 3, `quarter start ${start} not aligned to anchor ${anchor}`);
    }
  });

  it('next period starts the day after the quarter', () => {
    assert.equal(nextPeriodStart(settings(), '2026-11-20T10:00:00Z'), '2027-01-01');
    assert.equal(nextPeriodStart(settings({ cadenceQuarterAnchorMonth: 2 }), '2026-12-15T10:00:00Z'), '2027-02-01');
  });

  it('wording', () => {
    assert.equal(periodNoun('QUARTERLY').report, 'Quarterly report');
    assert.equal(periodNoun('QUARTERLY').current, "This quarter's");
  });
});

const SECTIONS: ChecklistSection[] = ChecklistSectionsSchema.parse([
  {
    key: 'progress',
    title: 'Progress against the work programme',
    items: [
      { key: 'on-programme', label: 'Works on programme', responseType: 'RATING_1_5', photoRequiredOnFail: true },
      { key: 'percent-complete', label: 'Estimated % complete', responseType: 'NUMBER', unit: '%' },
    ],
  },
  {
    key: 'hse',
    title: 'Health and safety',
    items: [
      { key: 'ppe', label: 'PPE worn', responseType: 'YES_NO' },
      { key: 'first-aid', label: 'First aid kit', responseType: 'PASS_FAIL_NA', photoRequired: true },
      { key: 'site-photo', label: 'General site photo', responseType: 'PHOTO_ONLY' },
      { key: 'notes', label: 'Other notes', responseType: 'TEXT', required: false },
    ],
  },
]);

const PHOTO = '11111111-1111-4111-8111-111111111111';
const PHOTO2 = '22222222-2222-4222-8222-222222222222';

function answers(over: Record<string, { value?: string | number | null; comment?: string; photos?: string[] }> = {}) {
  const base: Record<string, { value: string | number | null; comment?: string; photos?: string[] }> = {
    'on-programme': { value: 4 },
    'percent-complete': { value: 35 },
    ppe: { value: 'YES' },
    'first-aid': { value: 'PASS', photos: [PHOTO] },
    'site-photo': { value: null, photos: [PHOTO2] },
  };
  const merged = { ...base, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, { ...base[k], ...v }])) };
  return Object.entries(merged).map(([itemKey, a]) => ({ itemKey, value: a.value ?? null, comment: a.comment ?? null, clientCaptureIds: a.photos ?? [] }));
}

describe('Phase 14: validateInspectionAnswers', () => {
  it('a complete inspection is valid with no missing photos', () => {
    const r = validateInspectionAnswers(SECTIONS, answers());
    assert.deepEqual(r, { valid: true, errors: [], missingPhotoItemKeys: [], failedItemKeys: [] });
  });

  it('a required item without an answer is an error; an optional one is not', () => {
    const r = validateInspectionAnswers(SECTIONS, answers().filter((a) => a.itemKey !== 'ppe'));
    assert.equal(r.valid, false);
    assert.deepEqual(r.errors, [{ itemKey: 'ppe', message: 'Answer this item' }]);
  });

  it('values must fit the response type', () => {
    const r = validateInspectionAnswers(SECTIONS, answers({ 'on-programme': { value: 6 }, ppe: { value: 'MAYBE' }, 'percent-complete': { value: 'ten' }, 'site-photo': { value: 'x' } }));
    assert.deepEqual(
      r.errors.map((e) => e.itemKey).sort(),
      ['on-programme', 'percent-complete', 'ppe', 'site-photo']
    );
  });

  it('unknown and duplicated items are errors (answers are checked against the template version)', () => {
    const list = [...answers(), { itemKey: 'removed-in-v2', value: 3, comment: null, clientCaptureIds: [] }, { itemKey: 'ppe', value: 'YES', comment: null, clientCaptureIds: [] }];
    const r = validateInspectionAnswers(SECTIONS, list);
    assert.deepEqual(r.errors, [
      { itemKey: 'removed-in-v2', message: 'Not an item of this checklist version' },
      { itemKey: 'ppe', message: 'Answered more than once' },
    ]);
  });

  it('failed items (rating <= 2, FAIL, NO) are listed and need a comment', () => {
    const r = validateInspectionAnswers(SECTIONS, answers({ 'on-programme': { value: 2 }, ppe: { value: 'NO', comment: 'Two workers without helmets' } }));
    assert.deepEqual(r.failedItemKeys.sort(), ['on-programme', 'ppe']);
    assert.deepEqual(r.errors, [{ itemKey: 'on-programme', message: 'Say what is wrong' }]);
  });

  it('missing photos are reported, never errors: photo required, required on fail, photo-only', () => {
    const r = validateInspectionAnswers(
      SECTIONS,
      answers({ 'first-aid': { photos: [] }, 'site-photo': { photos: [] }, 'on-programme': { value: 1, comment: 'Six weeks behind' } })
    );
    assert.equal(r.valid, true);
    assert.deepEqual(r.missingPhotoItemKeys.sort(), ['first-aid', 'on-programme', 'site-photo']);
  });

  it('a passing item with photo-on-fail needs no photo', () => {
    assert.deepEqual(validateInspectionAnswers(SECTIONS, answers({ 'on-programme': { value: 3 } })).missingPhotoItemKeys, []);
  });

  it('isFailedAnswer per response type', () => {
    assert.equal(isFailedAnswer({ responseType: 'RATING_1_5' }, 2), true);
    assert.equal(isFailedAnswer({ responseType: 'RATING_1_5' }, 3), false);
    assert.equal(isFailedAnswer({ responseType: 'PASS_FAIL_NA' }, 'NA'), false);
    assert.equal(isFailedAnswer({ responseType: 'YES_NO' }, 'NO'), true);
    assert.equal(isFailedAnswer({ responseType: 'NUMBER' }, 0), false);
  });
});

describe('Phase 14: templates and type config', () => {
  it('item keys are unique across the whole template', () => {
    const r = ChecklistSectionsSchema.safeParse([
      { key: 'a', title: 'Section A', items: [{ key: 'x', label: 'Item x', responseType: 'TEXT' }] },
      { key: 'b', title: 'Section B', items: [{ key: 'x', label: 'Item x again', responseType: 'TEXT' }] },
    ]);
    assert.equal(r.success, false);
  });

  it('a project type saved before Phase 14 parses with empty inspections and supervision; R4f strips removed stream keys', () => {
    const config = ProjectTypeConfigSchema.parse({});
    const old = ProjectTypeConfigSchema.parse({ reportingStreams: [{ key: 'x' }], reportingDefaults: {} }) as Record<string, unknown>;
    assert.equal('reportingStreams' in old, false);
    assert.equal('reportingDefaults' in old, false);
    assert.deepEqual(config.inspections.templateCodeByVisitType, {});
    assert.deepEqual(config.supervision, { supervisorRoleCodes: [], maxSitesPerSupervisor: null, maxSpreadKm: null });
  });

  it('upload deadline: visit date plus the deadline days', () => {
    assert.equal(inspectionSubmissionDeadline('2026-12-28', 7), '2027-01-04');
    assert.equal(inspectionSubmissionDeadline('2026-12-28', null), null);
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
