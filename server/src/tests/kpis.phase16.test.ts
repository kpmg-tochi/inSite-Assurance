/**
 * Phase 16 unit tests: the KPI catalogue and engine. One fixture per KPI covering "not tracked"
 * (inputs not configured), counted and met cases, and the period rules; plus value, status and
 * target resolution maths from shared.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KPI_BY_KEY,
  KPI_CATALOGUE,
  KpiKeyEnum,
  kpiStatus,
  kpiValue,
  ProjectTypeConfigSchema,
  ProjectTypeKpiTargetsSchema,
  resolveKpiTargets,
  type ProjectTypeConfigInput,
} from '@insite/shared';
import { computeProjectKpis, KPI_FUNCTIONS, KpiMilestoneFact, KpiProjectFacts, milestonesOnTime, sumCounts, KpiVisitFact } from '../modules/kpis/kpiEngine';
import { monthEnd, recentMonthStarts } from '../modules/kpis/kpiFacts';

const TODAY = '2026-11-20';
const NOV = { from: '2026-11-01', to: '2026-11-30' };

function facts(over: Partial<KpiProjectFacts> = {}, config: ProjectTypeConfigInput | null = null): KpiProjectFacts {
  return {
    projectId: '00000000-0000-0000-0000-000000000001',
    status: 'ACTIVE',
    constructionPhase: 'ACTIVE_CONSTRUCTION',
    today: TODAY,
    typeConfig: config ? ProjectTypeConfigSchema.parse(config) : null,
    requireReportApproval: false,
    budgetNgn: 0,
    disbursedNgn: 0,
    scheduleStatus: null,
    plannedEndDate: null,
    kickoff: null,
    milestones: [],
    hasSupervisor: false,
    hasVisitLead: false,
    documentTypeCodes: new Set(),
    hasApprovedBaseline: false,
    visits: [],
    hasVisits: false,
    sprints: [],
    approvals: { totalDays: 0, count: 0 },
    certificate: null,
    finalEvaluationFinding: null,
    closureItemStatus: new Map(),
    publishedLessonCount: 0,
    ...over,
  };
}

const ms = (over: Partial<KpiMilestoneFact>): KpiMilestoneFact => ({
  completionMode: 'MANUAL',
  anchor: 'KICKOFF',
  requiredDocumentTypeCodes: [],
  dueDate: '2026-11-10',
  status: 'PENDING',
  completedDate: null,
  ...over,
});

const run = (key: string, f: KpiProjectFacts, period = NOV) => KPI_FUNCTIONS[KpiKeyEnum.parse(key)](f, period);

describe('Phase 16: KPI catalogue', () => {
  it('defines every key once, with an engine function', () => {
    assert.equal(KPI_CATALOGUE.length, KpiKeyEnum.options.length);
    assert.equal(new Set(KPI_CATALOGUE.map((k) => k.key)).size, KPI_CATALOGUE.length);
    for (const def of KPI_CATALOGUE) assert.equal(typeof KPI_FUNCTIONS[def.key], 'function', def.key);
  });

  it('resolves targets: type settings win, missing keys take the default and are shown', () => {
    const resolved = resolveKpiTargets(
      ProjectTypeKpiTargetsSchema.parse({ reports_on_time: { target: 70 }, lessons_documented: { shown: false }, retired_kpi: { target: 1 } })
    );
    assert.deepEqual(resolved.reports_on_time, { target: 70, shown: true });
    assert.deepEqual(resolved.lessons_documented, { target: null, shown: false });
    assert.deepEqual(resolved.visits_conducted, { target: 90, shown: true });
    assert.equal('retired_kpi' in resolved, false);
  });

  it('keeps old project type configs valid (kpiTargets defaults to {})', () => {
    assert.deepEqual(ProjectTypeConfigSchema.parse({}).kpiTargets, {});
  });

  it('computes values and statuses', () => {
    const pct = KPI_BY_KEY.reports_on_time;
    const days = KPI_BY_KEY.approval_turnaround_days;
    assert.equal(kpiValue(pct, 2, 3), 66.7);
    assert.equal(kpiValue(pct, 0, 0), null);
    assert.equal(kpiValue(days, 30, 4), 7.5);
    assert.equal(kpiStatus(pct, false, null, 85), 'NOT_TRACKED');
    assert.equal(kpiStatus(pct, true, null, 85), 'NO_DATA');
    assert.equal(kpiStatus(pct, true, 50, null), 'NO_TARGET');
    assert.equal(kpiStatus(pct, true, 85, 85), 'MET');
    assert.equal(kpiStatus(pct, true, 80, 85), 'NEAR');
    assert.equal(kpiStatus(pct, true, 60, 85), 'MISSED');
    assert.equal(kpiStatus(days, true, 14, 14), 'MET');
    assert.equal(kpiStatus(days, true, 15, 14), 'NEAR');
    assert.equal(kpiStatus(days, true, 20, 14), 'MISSED');
  });

  it('sums counts weighted by the underlying numbers', () => {
    const s = sumCounts([{ numerator: 1, denominator: 1 }, null, { numerator: 0, denominator: 3 }]);
    assert.deepEqual(s, { numerator: 1, denominator: 4, tracked: 2 });
  });

  it('month helpers', () => {
    assert.deepEqual(recentMonthStarts('2026-02-14', 3), ['2025-12-01', '2026-01-01', '2026-02-01']);
    assert.equal(monthEnd('2026-02-01'), '2026-02-28');
    assert.equal(monthEnd('2026-12-01'), '2026-12-31');
  });
});

describe('Phase 16: milestone on-time rule', () => {
  const match = () => true;
  it('is not tracked without a matching milestone; waived ones do not count', () => {
    assert.equal(milestonesOnTime(facts(), NOV, match), null);
    assert.equal(milestonesOnTime(facts({ milestones: [ms({ status: 'WAIVED' })] }), NOV, match), null);
  });
  it('counts due milestones in the period; done on or before the due date is met', () => {
    const f = facts({
      milestones: [
        ms({ status: 'DONE', completedDate: '2026-11-10' }), // met on the day
        ms({ status: 'DONE', completedDate: '2026-11-12' }), // late
        ms({ status: 'OVERDUE' }), // missed
        ms({ dueDate: '2026-11-25' }), // not due yet: left out
        ms({ dueDate: '2026-11-25', status: 'DONE', completedDate: '2026-11-18' }), // early: counted and met
        ms({ dueDate: '2026-10-10', status: 'DONE', completedDate: '2026-10-01' }), // other period
      ],
    });
    assert.deepEqual(milestonesOnTime(f, NOV, match), { numerator: 2, denominator: 4 });
  });
});

describe('Phase 16: KPI functions', () => {
  it('kick-off agenda, attendance and minutes', () => {
    assert.equal(run('kickoff_agenda_prepared', facts()), null);
    const held = { date: '2026-11-05', hasMeeting: true, hasAgenda: true, heldDate: '2026-11-05', minutesSigned: false, invited: 8, attended: 6 };
    assert.deepEqual(run('kickoff_agenda_prepared', facts({ kickoff: held })), { numerator: 1, denominator: 1 });
    // A planned kick-off next week without an agenda yet is not a miss.
    const planned = { ...held, date: '2026-11-27', heldDate: null, hasAgenda: false };
    assert.deepEqual(run('kickoff_agenda_prepared', facts({ kickoff: planned })), { numerator: 0, denominator: 0 });
    assert.deepEqual(run('kickoff_attendance_rate', facts({ kickoff: held })), { numerator: 6, denominator: 8 });
    assert.deepEqual(run('kickoff_attendance_rate', facts({ kickoff: planned })), { numerator: 0, denominator: 0 });
    // Only a kick-off date (no meeting recorded): attendance and minutes are not tracked.
    assert.equal(run('kickoff_attendance_rate', facts({ kickoff: { ...planned, hasMeeting: false } })), null);
    // Minutes: 15 days after the meeting and unsigned is a miss; 3 days after is not counted yet.
    assert.deepEqual(run('kickoff_minutes_signed', facts({ kickoff: held })), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('kickoff_minutes_signed', facts({ kickoff: { ...held, heldDate: '2026-11-17' } })), { numerator: 0, denominator: 0 });
    assert.deepEqual(run('kickoff_minutes_signed', facts({ kickoff: { ...held, heldDate: '2026-11-17', minutesSigned: true } })), {
      numerator: 1,
      denominator: 1,
    });
  });

  it('kick-off notice, introduction letters, mobilisation and handover use their own milestones', () => {
    const f = facts({
      milestones: [
        ms({ completionMode: 'AUTO_KICKOFF_NOTICE_SENT', status: 'DONE', completedDate: '2026-11-09' }),
        ms({ requiredDocumentTypeCodes: ['LETTER_OF_INTRODUCTION'], status: 'OVERDUE' }),
        ms({ completionMode: 'AUTO_CONTRACTOR_ON_SITE', status: 'DONE', completedDate: '2026-11-15' }),
      ],
    });
    assert.deepEqual(run('kickoff_notice_on_time', f), { numerator: 1, denominator: 1 });
    assert.deepEqual(run('introduction_letters_on_time', f), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('contractors_mobilised_on_time', f), { numerator: 0, denominator: 1 });
    assert.equal(run('handed_over_on_time', f), null);
    const h = facts({ milestones: [ms({ anchor: 'COC_ISSUED', completionMode: 'AUTO_HANDOVER_ACCEPTED', status: 'DONE', completedDate: '2026-11-08' })] });
    assert.deepEqual(run('handed_over_on_time', h), { numerator: 1, denominator: 1 });
  });

  it('supervisors and mobilisation documents follow the project type', () => {
    assert.equal(run('supervisors_assigned', facts({ hasSupervisor: true })), null); // no type
    const cfg = { supervision: { supervisorRoleCodes: ['MONITOR'] }, documentRequirements: { beforeMobilisation: ['MOB_AGREEMENT', 'SITE_FORM'] } };
    assert.deepEqual(run('supervisors_assigned', facts({ hasSupervisor: true }, cfg)), { numerator: 1, denominator: 1 });
    assert.equal(run('supervisors_assigned', facts({ constructionPhase: 'COMPLETED_CLOSED' }, cfg)), null);
    assert.deepEqual(run('mobilisation_documents_complete', facts({ documentTypeCodes: new Set(['MOB_AGREEMENT']) }, cfg)), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('mobilisation_documents_complete', facts({ documentTypeCodes: new Set(['MOB_AGREEMENT', 'SITE_FORM']) }, cfg)), {
      numerator: 1,
      denominator: 1,
    });
    assert.equal(run('mobilisation_documents_complete', facts({}, {})), null);
  });

  it('redesign R4e: the monitoring framework KPI is gone; baseline, visits and reports follow visits', () => {
    assert.ok(!KpiKeyEnum.options.includes('monitoring_framework_established' as never));
    const plan = { monitoring: { visitPlan: [{ key: 'baseline', visitKind: 'BASELINE' as const, kind: 'ONCE_AFTER_START' as const }] } };
    assert.equal(run('baseline_uploaded', facts()), null);
    assert.deepEqual(run('baseline_uploaded', facts({}, plan)), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('baseline_uploaded', facts({ hasApprovedBaseline: true }, plan)), { numerator: 1, denominator: 1 });

    const v = (over: Partial<KpiVisitFact>): KpiVisitFact => ({
      visitKind: 'ROUTINE',
      status: 'APPROVED',
      origin: 'PLAN',
      plannedDate: '2026-11-05',
      submissionDeadline: '2026-11-12',
      submitted: true,
      submittedOnTime: true,
      ...over,
    });
    assert.equal(run('visits_conducted', facts()), null);
    const visits = [
      v({}),
      v({ status: 'SUBMITTED', submittedOnTime: false }),
      v({ status: 'MISSED', submitted: false, submittedOnTime: false }),
      v({ status: 'PLANNED', submitted: false, submittedOnTime: false, plannedDate: '2026-11-25', submissionDeadline: '2026-12-02' }),
      // Unscheduled visits are reported apart, never added to the numerator (D-R4.33).
      v({ origin: 'UNSCHEDULED' }),
      v({ plannedDate: '2026-10-20', submissionDeadline: '2026-10-27' }),
    ];
    assert.deepEqual(run('visits_conducted', facts({ hasVisits: true, visits })), { numerator: 2, denominator: 3 });

    // Deadlines in November that have passed (or were met): 3 planned + the unscheduled one.
    assert.equal(run('reports_on_time', facts()), null);
    assert.deepEqual(run('reports_on_time', facts({ hasVisits: true, visits })), { numerator: 2, denominator: 4 });
    assert.deepEqual(run('reports_on_time', facts({ hasVisits: true })), { numerator: 0, denominator: 0 });
  });

  it('redesign R4e: sprints verified on time', () => {
    assert.equal(run('sprints_verified_on_time', facts()), null);
    const sprints = [
      { endDate: '2026-10-28', firstVerifiedDate: '2026-11-03' }, // due 11-04: on time
      { endDate: '2026-11-01', firstVerifiedDate: '2026-11-12' }, // due 11-08: late
      { endDate: '2026-11-05', firstVerifiedDate: null }, // due 11-12: overdue
      { endDate: '2026-11-18', firstVerifiedDate: null }, // due 11-25: not due yet
      { endDate: '2026-12-10', firstVerifiedDate: null }, // due in December
    ];
    assert.deepEqual(run('sprints_verified_on_time', facts({ sprints })), { numerator: 1, denominator: 3 });
  });

  it('redesign R4e: a lead officer on a published visit counts as supervised', () => {
    const plan = { monitoring: { visitPlan: [{ key: 'routine', visitKind: 'ROUTINE' as const, kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION' as const }] } };
    assert.deepEqual(run('supervisors_assigned', facts({}, plan)), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('supervisors_assigned', facts({ hasVisitLead: true }, plan)), { numerator: 1, denominator: 1 });
  });

  it('approval turnaround', () => {
    assert.equal(run('approval_turnaround_days', facts()), null);
    assert.deepEqual(run('approval_turnaround_days', facts({ requireReportApproval: true })), { numerator: 0, denominator: 0 });
    assert.deepEqual(run('approval_turnaround_days', facts({ approvals: { totalDays: 9, count: 3 } })), { numerator: 9, denominator: 3 });
  });

  it('financial utilisation needs a budget', () => {
    assert.equal(run('financial_utilisation', facts()), null);
    assert.deepEqual(run('financial_utilisation', facts({ budgetNgn: 200, disbursedNgn: 50 })), { numerator: 50, denominator: 200 });
  });

  it('verified on time and to specification', () => {
    assert.equal(run('verified_on_time', facts({ certificate: { issuedDate: '2026-11-03', completionDate: '2026-11-02' } })), null);
    const base = { plannedEndDate: '2026-11-05', certificate: { issuedDate: '2026-11-03', completionDate: '2026-11-02' } };
    assert.deepEqual(run('verified_on_time', facts(base)), { numerator: 1, denominator: 1 });
    assert.deepEqual(run('verified_on_time', facts({ ...base, finalEvaluationFinding: 'MAJOR_ISSUES' })), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('verified_on_time', facts({ ...base, plannedEndDate: '2026-11-01' })), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('verified_on_time', facts({ plannedEndDate: '2026-11-05' })), { numerator: 0, denominator: 0 });
  });

  it('closure documentation, lessons and audit', () => {
    const closure = {
      closure: {
        beforeClose: [{ key: 'coc', label: 'CoC filed', kind: 'DOCUMENT_TYPE' as const, documentTypeCode: 'COMPLETION_CERTIFICATE' }],
        beforeArchive: [{ key: 'audit', label: 'Audit sign-off', kind: 'AUDIT_SIGNOFF' as const }],
      },
    };
    assert.equal(run('closure_documentation_complete', facts({}, closure)), null); // still under construction
    assert.deepEqual(run('closure_documentation_complete', facts({ constructionPhase: 'RETENTION_PERIOD' }, closure)), { numerator: 0, denominator: 1 });
    assert.deepEqual(
      run('closure_documentation_complete', facts({ constructionPhase: 'COMPLETED_CLOSED', documentTypeCodes: new Set(['COMPLETION_CERTIFICATE']) }, closure)),
      { numerator: 1, denominator: 1 }
    );

    assert.equal(run('lessons_documented', facts()), null);
    assert.deepEqual(run('lessons_documented', facts({ constructionPhase: 'COMPLETED_CLOSED', publishedLessonCount: 2 })), { numerator: 1, denominator: 1 });

    assert.equal(run('audited_post_closure', facts({ constructionPhase: 'COMPLETED_CLOSED' })), null); // no audit item
    assert.deepEqual(run('audited_post_closure', facts({ constructionPhase: 'COMPLETED_CLOSED' }, closure)), { numerator: 0, denominator: 1 });
    assert.deepEqual(
      run('audited_post_closure', facts({ status: 'ARCHIVED', constructionPhase: 'COMPLETED_CLOSED', closureItemStatus: new Map([['audit', 'DONE']]) }, closure)),
      { numerator: 1, denominator: 1 }
    );
  });

  it('schedule: behind counts against, unscheduled is not tracked', () => {
    assert.equal(run('projects_on_schedule', facts({ scheduleStatus: 'UNSCHEDULED' })), null);
    assert.deepEqual(run('projects_on_schedule', facts({ scheduleStatus: 'BEHIND' })), { numerator: 0, denominator: 1 });
    assert.deepEqual(run('projects_on_schedule', facts({ scheduleStatus: 'AHEAD' })), { numerator: 1, denominator: 1 });
  });

  it('a project without any configuration tracks only what applies to every project', () => {
    const counts = computeProjectKpis(facts(), NOV);
    const tracked = Object.entries(counts).filter(([, c]) => c !== null).map(([k]) => k);
    assert.deepEqual(tracked, []);
  });
});
