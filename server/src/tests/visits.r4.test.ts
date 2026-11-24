/**
 * Redesign R4 unit tests: visit plan generators, working-day roll-forward, the officer tolerance
 * (incl. the sprint boundary), deadlines, sprint status and the verification badge, and the re-check
 * swap on a frozen form.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateVisitDates,
  isScheduleWorkday,
  ProjectTypeMonitoringConfigSchema,
  rescheduleWindow,
  sameFormApartFromRechecks,
  submissionDeadlineFor,
  VisitPlanContext,
  VisitPlanRuleSchema,
  VisitPlanRuleInput,
  withinRescheduleTolerance,
  withRechecks,
  deriveSprintStatus,
  sprintScheduleStatus,
  DEFAULT_VISIT_PLAN,
  VisitFormSnapshot,
} from '@insite/shared';

const MON_FRI = [1, 2, 3, 4, 5];
const rule = (r: VisitPlanRuleInput) => VisitPlanRuleSchema.parse(r);

// 2026-03-02 is a Monday.
const ctx = (over: Partial<VisitPlanContext> = {}): VisitPlanContext => ({
  activationDate: '2026-03-02',
  kickoffHeldDate: null,
  sprints: [
    { number: 1, startDate: '2026-03-02', endDate: '2026-03-29' },
    { number: 2, startDate: '2026-03-30', endDate: '2026-04-26' },
  ],
  mobilisationDueDate: '2026-03-27',
  plannedEndDate: null,
  workWeekDays: MON_FRI,
  completionNoticeDate: null,
  closedDate: null,
  postClosureMilestoneDueDate: null,
  ...over,
});

describe('Redesign R4a: visit plan generators', () => {
  it('every N weeks during construction, from the start to the last sprint end, on working days', () => {
    const dates = generateVisitDates(rule({ key: 'routine', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION', intervalWeeks: 2 }), ctx());
    assert.deepEqual(dates, ['2026-03-16', '2026-03-30', '2026-04-13']);
    assert.ok(dates.every((d) => isScheduleWorkday(d, MON_FRI)));
    // No sprints and no planned end: nothing to plan.
    assert.deepEqual(generateVisitDates(rule({ key: 'r', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION' }), ctx({ sprints: [] })), []);
    // No sprints but a planned end date.
    assert.equal(generateVisitDates(rule({ key: 'r', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION' }), ctx({ sprints: [], plannedEndDate: '2026-04-01' })).length, 2);
  });

  it('rolls a weekend date to the next working day', () => {
    // Activation on a Wednesday: +14 days is a Wednesday; start on Saturday rolls to Monday.
    const dates = generateVisitDates(rule({ key: 'r', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION', intervalWeeks: 1 }), ctx({ activationDate: '2026-03-07', sprints: [{ number: 1, startDate: '2026-03-07', endDate: '2026-03-31' }] }));
    assert.equal(dates[0], '2026-03-16'); // Saturday 14th → Monday 16th
  });

  it('every N weeks in chosen sprints; a short sprint gets one visit on its last working day', () => {
    const r = rule({ key: 's2', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_IN_SPRINTS', intervalWeeks: 2, sprintNumbers: [2] });
    assert.deepEqual(generateVisitDates(r, ctx()), ['2026-04-13']);
    const short = ctx({ sprints: [{ number: 1, startDate: '2026-03-02', endDate: '2026-03-08' }] });
    assert.deepEqual(generateVisitDates(rule({ key: 'x', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_IN_SPRINTS', intervalWeeks: 2 }), short), ['2026-03-06']);
  });

  it('until mobilised: up to the mobilisation due date', () => {
    const r = rule({ key: 'm', visitKind: 'MOBILISATION_CHECK', kind: 'EVERY_N_WEEKS_UNTIL_MOBILISED', intervalWeeks: 1 });
    assert.deepEqual(generateVisitDates(r, ctx()), ['2026-03-09', '2026-03-16', '2026-03-23']);
    // From the kick-off when it was held after activation.
    assert.deepEqual(generateVisitDates(r, ctx({ kickoffHeldDate: '2026-03-10' })), ['2026-03-17', '2026-03-24']);
  });

  it('quarterly: the quarter last month + offset working days, inside construction', () => {
    const r = rule({ key: 'q', visitKind: 'QUARTERLY_ME', kind: 'QUARTERLY', quarterAnchorMonth: 1, offsetWorkdays: 5 });
    const long = ctx({ sprints: [{ number: 1, startDate: '2026-02-01', endDate: '2026-12-31' }] });
    assert.deepEqual(generateVisitDates(r, long), ['2026-03-09', '2026-06-08', '2026-09-08', '2026-12-08']);
  });

  it('once after start, on the completion notice, after closing', () => {
    assert.deepEqual(generateVisitDates(rule({ key: 'b', visitKind: 'BASELINE', kind: 'ONCE_AFTER_START', offsetWorkdays: 5 }), ctx()), ['2026-03-09']);
    assert.deepEqual(generateVisitDates(rule({ key: 'b', visitKind: 'BASELINE', kind: 'ONCE_AFTER_START', offsetWorkdays: 5 }), ctx({ kickoffHeldDate: '2026-03-04' })), ['2026-03-11']);
    const f = rule({ key: 'f', visitKind: 'FINAL_EVALUATION', kind: 'ON_COMPLETION_NOTICE', offsetWorkdays: 5 });
    assert.deepEqual(generateVisitDates(f, ctx()), []);
    assert.deepEqual(generateVisitDates(f, ctx({ completionNoticeDate: '2026-05-01' })), ['2026-05-08']);
    const p = rule({ key: 'p', visitKind: 'POST_CLOSURE_EVALUATION', kind: 'AFTER_PROJECT_CLOSED', offsetDays: 90 });
    assert.deepEqual(generateVisitDates(p, ctx({ closedDate: '2026-06-01' })), ['2026-08-31']);
    assert.deepEqual(generateVisitDates(p, ctx({ closedDate: '2026-06-01', postClosureMilestoneDueDate: '2026-12-05' })), ['2026-12-07']);
  });

  it('the monitoring config parses old snapshots and refuses duplicate rule keys', () => {
    const empty = ProjectTypeMonitoringConfigSchema.parse({});
    assert.equal(empty.submissionDeadlineDays, 7);
    assert.equal(empty.visitPlan.length, 0);
    assert.ok(ProjectTypeMonitoringConfigSchema.safeParse({ visitPlan: DEFAULT_VISIT_PLAN }).success);
    assert.equal(ProjectTypeMonitoringConfigSchema.safeParse({ visitPlan: [DEFAULT_VISIT_PLAN[0], DEFAULT_VISIT_PLAN[0]] }).success, false);
  });
});

describe('Redesign R4b: officer tolerance', () => {
  const sprints = [
    { number: 1, startDate: '2026-03-02', endDate: '2026-03-13' },
    { number: 2, startDate: '2026-03-14', endDate: '2026-03-31' },
  ];
  it('allows ± tolerance working days of the original date inside its sprint', () => {
    assert.deepEqual(withinRescheduleTolerance('2026-03-04', '2026-03-06', 2, MON_FRI, sprints), { ok: true });
    assert.deepEqual(withinRescheduleTolerance('2026-03-04', '2026-03-02', 2, MON_FRI, sprints), { ok: true });
    assert.deepEqual(withinRescheduleTolerance('2026-03-04', '2026-03-09', 2, MON_FRI, sprints), { ok: false, reason: 'OUTSIDE_TOLERANCE' });
    // Friday + 1 working day = Monday (skips the weekend).
    assert.deepEqual(withinRescheduleTolerance('2026-03-06', '2026-03-09', 1, MON_FRI, []), { ok: true });
    assert.deepEqual(withinRescheduleTolerance('2026-03-06', '2026-03-07', 2, MON_FRI, []), { ok: false, reason: 'NOT_A_WORKDAY' });
  });
  it('refuses a move into another sprint even within the tolerance', () => {
    assert.deepEqual(withinRescheduleTolerance('2026-03-13', '2026-03-16', 2, MON_FRI, sprints), { ok: false, reason: 'OTHER_SPRINT' });
    assert.deepEqual(withinRescheduleTolerance('2026-03-13', '2026-03-16', 2, MON_FRI, []), { ok: true });
  });
  it('the move window stops at the sprint boundary', () => {
    assert.deepEqual(rescheduleWindow('2026-03-12', 2, MON_FRI, sprints), { from: '2026-03-10', to: '2026-03-13' });
    assert.deepEqual(rescheduleWindow('2026-03-12', 0, MON_FRI, sprints), { from: '2026-03-12', to: '2026-03-12' });
  });
  it('the submission deadline is the planned date plus calendar days', () => {
    assert.equal(submissionDeadlineFor('2026-03-27', 7), '2026-04-03');
  });
});

describe('Redesign R4e: sprint status and the badge', () => {
  const s = { startDate: '2026-03-01', endDate: '2026-03-31' };
  it('derives LATE and VERIFIED', () => {
    assert.equal(deriveSprintStatus(s, '2026-02-28', 7), 'UPCOMING');
    assert.equal(deriveSprintStatus(s, '2026-03-15', 7), 'ACTIVE');
    assert.equal(deriveSprintStatus(s, '2026-04-05', 7), 'ENDED');
    assert.equal(deriveSprintStatus(s, '2026-04-08', 7), 'LATE');
    assert.equal(deriveSprintStatus({ ...s, verificationOutcome: 'PARTLY_MET' }, '2026-04-20', 7), 'VERIFIED');
    // Callers that do not pass the period keep the R2 statuses.
    assert.equal(deriveSprintStatus(s, '2026-05-01'), 'ENDED');
  });
  it('the badge follows verification (D-R4.32)', () => {
    const base = { lineCount: 2, allLinesComplete: false, units: [{ endSprintNumber: 1, complete: false }] };
    const sprints = [{ number: 1, startDate: '2026-03-01', endDate: '2026-03-31' }, { number: 2, startDate: '2026-04-01', endDate: '2026-04-30' }];
    // Unverified, within the verification period: not behind yet.
    assert.equal(sprintScheduleStatus({ ...base, today: '2026-04-03', sprints, verificationDays: 7 }).status, 'ON_TRACK');
    // Past it with the unit incomplete: behind (R2 rule as fallback).
    assert.equal(sprintScheduleStatus({ ...base, today: '2026-04-10', sprints, verificationDays: 7 }).status, 'BEHIND');
    // Verified MET: not behind even with the unit incomplete.
    const met = sprints.map((x) => (x.number === 1 ? { ...x, verificationOutcome: 'MET' as const } : x));
    assert.equal(sprintScheduleStatus({ ...base, today: '2026-04-10', sprints: met, verificationDays: 7 }).status, 'ON_TRACK');
    // Partly met: behind even when the units are complete.
    const partly = sprints.map((x) => (x.number === 1 ? { ...x, verificationOutcome: 'PARTLY_MET' as const } : x));
    assert.equal(sprintScheduleStatus({ ...base, units: [], today: '2026-04-10', sprints: partly, verificationDays: 7 }).status, 'BEHIND');
    // Every sprint verified MET: complete.
    const all = sprints.map((x) => ({ ...x, verificationOutcome: 'MET' as const }));
    assert.equal(sprintScheduleStatus({ ...base, today: '2026-05-10', sprints: all }).status, 'COMPLETE');
  });
});

describe('Redesign R4d: re-check swap on a frozen form', () => {
  const snapshot = {
    schemaVersion: 1,
    builtAt: '2026-03-01T00:00:00.000Z',
    context: { projectId: '00000000-0000-0000-0000-000000000001', visitKind: 'ROUTINE', visitDate: '2026-03-05', sprint: null },
    sources: { template: { id: '00000000-0000-0000-0000-000000000002', code: 'ROUTINE', version: 1, name: 'Routine' }, sections: [], subForms: [] },
    blocks: [],
    warnings: [],
  } as unknown as VisitFormSnapshot;
  const recheck = {
    id: '00000000-0000-0000-0000-0000000000aa',
    kind: 'FINDING' as const,
    title: 'No helmets',
    description: null,
    severity: 'MINOR' as const,
    raisedDate: '2026-03-01',
    facilityId: null,
    unitId: null,
  };
  it('replaces only the re-check block', () => {
    const withOne = withRechecks(snapshot, [recheck]);
    assert.equal(withOne.blocks.length, 1);
    assert.equal(withOne.blocks[0].fields[0].path, `r:${recheck.id}`);
    assert.equal(withRechecks(withOne, []).blocks.length, 0);
    assert.ok(sameFormApartFromRechecks(snapshot, withOne));
    assert.ok(!sameFormApartFromRechecks(snapshot, { ...snapshot, context: { ...snapshot.context, visitDate: '2026-03-06' } }));
  });
});
