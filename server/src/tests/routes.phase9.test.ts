/**
 * Phase 9 route and job tests: schedule baseline validation and locking, variance for fixtures,
 * "Catch Project Up" preview, apply and approval rules, the original baseline across revisions,
 * actual dates, brief item selection by planned window, the schedule-variance job and badges.
 *
 * SCH-901 is dated relative to today (Lagos), so variance is computed against the real clock;
 * expectations are rounded to half weeks, which absorbs a weekend "today". SCH-903 uses fixed 2025
 * dates for brief selection (2025-03-03 is a Monday).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { addWorkdays, windowEnd, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let jobs: typeof import('../jobs');
let briefs: typeof import('../modules/morning-briefs/morningBrief.service');
let reconciliation: typeof import('../modules/reconciliation/reconciliation.service');

const PASSWORD = 'Password123!';
const WEEK = [1, 2, 3, 4, 5, 6];
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  draft: '',
  briefProject: '',
  items: {} as Record<string, string>,
  briefItems: {} as Record<string, string>,
  joinCode: '',
  role: '',
  session: '',
  foreignItem: '',
};
let today = '';
let sitePoint = { latitude: 0, longitude: 0 };
const dates: Record<string, { start: string; end: string }> = {};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

const MONITOR = 'monitor@insite.ng'; // edit_baseline, view_variance, catch_up_refactor
const LENDER = 'lender@insite.ng'; // view_variance, approve_refactor
const ADMIN = 'admin@insite.ng'; // tenant super admin: every non-segregated permission

const url = (path = '') => `/api/v1/projects/${ids.project}/schedule${path}`;

async function createItem(projectId: string, wbsCode: string, extra: Record<string, unknown> = {}) {
  const item = await prisma.boqItem.create({
    data: {
      projectId,
      wbsCode,
      section: 'BILL 1',
      description: `Item ${wbsCode}`,
      unit: 'm3',
      totalQuantity: 100,
      rateNgn: 1000,
      budgetedCostNgn: 100000,
      ...extra,
    },
  });
  return item.id;
}

function baselineBody(overrides: { items?: unknown[]; dependencies?: unknown[]; plannedStartDate?: string; plannedEndDate?: string } = {}) {
  return {
    plannedStartDate: overrides.plannedStartDate ?? dates.project.start,
    plannedEndDate: overrides.plannedEndDate ?? dates.project.end,
    items:
      overrides.items ??
      ['I1', 'I2', 'I3'].map((k) => ({ boqItemId: ids.items[k], plannedStartDate: dates[k].start, plannedEndDate: dates[k].end })),
    dependencies:
      overrides.dependencies ?? [{ predecessorBoqItemId: ids.items.I2, successorBoqItemId: ids.items.I3, lagWorkdays: 0 }],
  };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  briefs = await import('../modules/morning-briefs/morningBrief.service');
  reconciliation = await import('../modules/reconciliation/reconciliation.service');
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'EDO-410' } });
  const geofence = edo.geofenceGeoJson as { center?: { latitude: number; longitude: number } };
  sitePoint = geofence.center ?? { latitude: 6.3176, longitude: 5.6145 };
  today = zonedCalendarDate(new Date(), 'Africa/Lagos');

  const project = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Schedule Test Road',
      codePrefix: 'SCH-901',
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date(),
      reportingCadence: 'WEEKLY',
      workWeekDays: WEEK,
      timezone: 'Africa/Lagos',
      geofenceMode: edo.geofenceMode,
      geofenceGeoJson: edo.geofenceGeoJson ?? undefined,
      geofenceToleranceMeters: edo.geofenceToleranceMeters,
    },
  });
  ids.project = project.id;
  // I1: 60 days, opened 30 working days ago, 50% certified -> on schedule.
  // I2: 12 days, opened 12 working days ago, nothing done -> two weeks behind.
  // I3: opens in 10 working days -> not started. I4: no dates yet.
  const i1Start = addWorkdays(today, -30, WEEK);
  const i2Start = addWorkdays(today, -12, WEEK);
  const i3Start = addWorkdays(today, 10, WEEK);
  dates.I1 = { start: i1Start, end: windowEnd(i1Start, 60, WEEK) };
  dates.I2 = { start: i2Start, end: windowEnd(i2Start, 12, WEEK) };
  dates.I3 = { start: i3Start, end: windowEnd(i3Start, 6, WEEK) };
  dates.project = { start: addWorkdays(today, -40, WEEK), end: addWorkdays(today, 80, WEEK) };
  ids.items.I1 = await createItem(project.id, '01.01', { cumulativeCertifiedPct: 50 });
  ids.items.I2 = await createItem(project.id, '01.02');
  ids.items.I3 = await createItem(project.id, '01.03');
  ids.items.I4 = await createItem(project.id, '01.04');

  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } });
  ids.role = role.id;
  const code = await prisma.projectJoinCode.create({ data: { projectId: project.id, roleId: role.id, code: 'SCH-901-COW-TEST01' } });
  ids.joinCode = code.id;
  const session = await prisma.fieldAgentSession.create({
    data: {
      projectId: project.id,
      origin: 'JOIN_CODE',
      joinCodeId: code.id,
      roleId: role.id,
      roleNameSnapshot: 'Independent Resident',
      fieldPersonaType: 'INDEPENDENT_VERIFIER',
      agentFullName: 'Inspector Bisi',
      agentPhoneNumber: '+2348030000901',
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  ids.session = session.id;
  for (const email of [MONITOR, LENDER]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.userProjectAssignment.create({ data: { userId: user.id, projectId: project.id } });
  }

  const draft = await prisma.project.create({
    data: { tenantId: tenant.id, name: 'Schedule Draft', codePrefix: 'SCH-902', status: 'DRAFT', workWeekDays: WEEK },
  });
  ids.draft = draft.id;
  ids.items.D1 = await createItem(draft.id, '09.01');
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: MONITOR } });
  await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: draft.id } });

  const lkk = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'LKK-402' } });
  ids.foreignItem = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: lkk.id } })).id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 9', () => {
  describe('baseline', () => {
    it('rejects items outside the project dates, early successors, cycles and foreign items', async () => {
      const h = await web(MONITOR);
      const outside = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(baselineBody({ plannedStartDate: dates.I2.start }));
      assert.equal(outside.status, 422, JSON.stringify(outside.body));
      assert.equal(outside.body.error.code, 'SCHEDULE_BASELINE_INVALID');
      assert.ok(outside.body.error.details.issues.some((i: { code: string }) => i.code === 'ITEM_OUTSIDE_PROJECT'));

      const early = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(baselineBody({ dependencies: [{ predecessorBoqItemId: ids.items.I2, successorBoqItemId: ids.items.I3, lagWorkdays: 30 }] }));
      assert.equal(early.status, 422);
      assert.ok(early.body.error.details.issues.some((i: { code: string }) => i.code === 'SUCCESSOR_STARTS_TOO_EARLY'));

      const cycle = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(
          baselineBody({
            dependencies: [
              { predecessorBoqItemId: ids.items.I1, successorBoqItemId: ids.items.I3, lagWorkdays: 0 },
              { predecessorBoqItemId: ids.items.I3, successorBoqItemId: ids.items.I1, lagWorkdays: 0 },
            ],
          })
        );
      assert.equal(cycle.status, 422);
      assert.ok(cycle.body.error.details.issues.some((i: { code: string }) => i.code === 'DEPENDENCY_CYCLE'));

      const foreign = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(baselineBody({ items: [{ boqItemId: ids.foreignItem, plannedStartDate: dates.I1.start, plannedEndDate: dates.I1.end }] }));
      assert.equal(foreign.status, 422);
      assert.equal(foreign.body.error.code, 'BOQ_ITEM_NOT_IN_PROJECT');

      assert.equal(await prisma.boqItem.count({ where: { projectId: ids.project, plannedStartDate: { not: null } } }), 0);
    });

    it('needs projects:edit_baseline', async () => {
      const res = await request(app).put(url('/baseline')).set(await web(LENDER)).send(baselineBody());
      assert.equal(res.status, 403);
    });

    it('saves a valid baseline, sets the original baseline and audits it', async () => {
      const res = await request(app).put(url('/baseline')).set(await web(MONITOR)).send(baselineBody());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      assert.equal(i1.plannedStartDate, dates.I1.start);
      assert.equal(i1.originalPlannedStartDate, dates.I1.start);
      assert.equal(i1.originalPlannedEndDate, dates.I1.end);
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(project.originalPlannedEndDate, dates.project.end);
      assert.equal(project.currentProjectedEndDate, dates.I1.end, 'the current plan ends with its latest item');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.project, action: 'SCHEDULE_BASELINE_SET' } });
      assert.equal((audit.payload as { firstBaseline: boolean }).firstBaseline, true);
      assert.equal(await prisma.boqItemDependency.count({ where: { projectId: ids.project } }), 1);
    });

    it('locks dated items on a live project but lets new items be dated', async () => {
      const h = await web(MONITOR);
      const moved = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(
          baselineBody({
            items: [{ boqItemId: ids.items.I1, plannedStartDate: dates.I1.start, plannedEndDate: addWorkdays(dates.I1.end, 3, WEEK) }],
          })
        );
      assert.equal(moved.status, 409);
      assert.equal(moved.body.error.code, 'SCHEDULE_BASELINE_LOCKED');
      const projectDates = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(baselineBody({ plannedEndDate: addWorkdays(dates.project.end, 5, WEEK), items: [] }));
      assert.equal(projectDates.status, 409);

      const i4Start = addWorkdays(today, 20, WEEK);
      dates.I4 = { start: i4Start, end: windowEnd(i4Start, 6, WEEK) };
      const added = await request(app)
        .put(url('/baseline'))
        .set(h)
        .send(baselineBody({ items: [{ boqItemId: ids.items.I4, plannedStartDate: dates.I4.start, plannedEndDate: dates.I4.end }] }));
      assert.equal(added.status, 200, JSON.stringify(added.body));
      const i4 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I4 } });
      assert.equal(i4.originalPlannedStartDate, dates.I4.start);
    });

    it('works on a draft (wizard) and marks the setup step saved', async () => {
      const draftStart = addWorkdays(today, 5, WEEK);
      const res = await request(app)
        .put(`/api/v1/projects/${ids.draft}/schedule/baseline`)
        .set(await web(MONITOR))
        .send({
          plannedStartDate: draftStart,
          plannedEndDate: addWorkdays(draftStart, 30, WEEK),
          items: [{ boqItemId: ids.items.D1, plannedStartDate: draftStart, plannedEndDate: addWorkdays(draftStart, 5, WEEK) }],
          dependencies: [],
        });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const draft = await prisma.project.findUniqueOrThrow({ where: { id: ids.draft } });
      assert.ok((draft.setupState as { steps: Record<string, { completedAt: string | null }> }).steps.schedule?.completedAt);
      // Draft saves move the original with the plan (it is fixed at activation).
      const later = addWorkdays(draftStart, 2, WEEK);
      const again = await request(app)
        .put(`/api/v1/projects/${ids.draft}/schedule/baseline`)
        .set(await web(MONITOR))
        .send({
          plannedStartDate: draftStart,
          plannedEndDate: addWorkdays(draftStart, 30, WEEK),
          items: [{ boqItemId: ids.items.D1, plannedStartDate: later, plannedEndDate: addWorkdays(later, 5, WEEK) }],
          dependencies: [],
        });
      assert.equal(again.status, 200);
      const d1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.D1 } });
      assert.equal(d1.originalPlannedStartDate, later);

      const preview = await request(app)
        .post(`/api/v1/projects/${ids.draft}/schedule/revisions/preview`)
        .set(await web(MONITOR))
        .send({ changes: [{ boqItemId: ids.items.D1, shiftWorkdays: 2 }] });
      assert.equal(preview.status, 409);
      assert.equal(preview.body.error.code, 'PROJECT_NOT_ACTIVE');
    });

    it('proposes dates without saving them', async () => {
      const res = await request(app)
        .post(url('/propose-dates'))
        .set(await web(MONITOR))
        .send({ plannedStartDate: dates.project.start, plannedEndDate: dates.project.end });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.items.length, 4);
      for (const i of res.body.data.items) {
        assert.ok(i.plannedStartDate >= dates.project.start && i.plannedEndDate <= dates.project.end);
      }
      const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      assert.equal(i1.plannedStartDate, dates.I1.start, 'nothing saved');
    });
  });

  describe('variance', () => {
    it('reports item and project variance with both progress measures', async () => {
      const res = await request(app).get(url()).set(await web(LENDER));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const data = res.body.data;
      const item = (k: string) => data.items.find((i: { id: string }) => i.id === ids.items[k]);
      assert.equal(item('I1').status, 'ON_TRACK');
      assert.equal(item('I1').varianceLabel, 'On schedule');
      assert.equal(item('I1').certifiedProgressPct, 50);
      assert.equal(item('I2').status, 'BEHIND');
      assert.equal(item('I2').varianceLabel, '2 weeks behind');
      assert.equal(item('I3').status, 'NOT_STARTED');
      assert.deepEqual(item('I3').predecessorIds, [ids.items.I2]);
      assert.equal(data.summary.hasBaseline, true);
      assert.equal(data.baselineLocked, true);
      assert.equal(typeof data.summary.reportedProgressPct, 'number');
      assert.ok(data.summary.forecastEndDate);
    });

    it('counts confirmed field reports as reported progress and marks the actual start', async () => {
      const confirmedAt = new Date().toISOString();
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(field(ids.session))
        .send({
          clientReportId: crypto.randomUUID(),
          wbsItemId: ids.items.I2,
          workdayDate: today,
          reporterTimezone: 'Africa/Lagos',
          summaryText: 'Excavated and blinded the first half of the culvert base.',
          reportedQuantity: 50,
          unitOfMeasure: 'm3',
          isHoldPointClaimed: false,
          clientCaptureIds: [],
          textNotes: [],
          submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: confirmedAt },
          confirmedAt,
          confirmedAsFinal: true,
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const i2 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I2 } });
      assert.equal(i2.actualStartDate, today);
      const schedule = await request(app).get(url()).set(await web(LENDER));
      const row = schedule.body.data.items.find((i: { id: string }) => i.id === ids.items.I2);
      assert.equal(row.reportedProgressPct, 50);
      assert.equal(row.certifiedProgressPct, 0);
      assert.equal(row.status, 'BEHIND', 'certified progress drives the badge');
      assert.equal(row.reportedVarianceLabel, '1 week behind');
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(project.actualStartDate, today);
    });

    it('sets and clears the completion date with certification', async () => {
      await prisma.boqItem.update({ where: { id: ids.items.I4 }, data: { cumulativeCertifiedPct: 100 } });
      await prisma.$transaction((tx) => reconciliation.refreshCertifiedProgress(tx, ids.project));
      assert.equal((await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I4 } })).actualCompletionDate, today);
      await prisma.boqItem.update({ where: { id: ids.items.I4 }, data: { cumulativeCertifiedPct: 0 } });
      await prisma.$transaction((tx) => reconciliation.refreshCertifiedProgress(tx, ids.project));
      assert.equal((await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I4 } })).actualCompletionDate, null);
    });

    it('shows the badge on the directory and the executive matrix', async () => {
      const list = await request(app).get('/api/v1/projects').set(await web(ADMIN));
      const sch = list.body.data.find((p: { id: string }) => p.id === ids.project);
      assert.ok(sch.scheduleVariance, 'directory badge');
      assert.equal(typeof sch.scheduleVariance.label, 'string');
      const lkk = list.body.data.find((p: { codePrefix: string }) => p.codePrefix === 'LKK-402');
      assert.equal(lkk.scheduleVariance.status, 'BEHIND');
      assert.equal(lkk.scheduleVariance.label, '4 weeks behind');
      const abj = list.body.data.find((p: { codePrefix: string }) => p.codePrefix === 'ABJ-108');
      assert.equal(abj.scheduleVariance.label, 'On schedule');
      const exec = await request(app).get('/api/v1/projects/portfolio/executive-summary').set(await web(ADMIN));
      assert.equal(exec.status, 200);
      const execLkk = exec.body.data.projects.find((p: { codePrefix: string }) => p.codePrefix === 'LKK-402');
      assert.equal(execLkk.scheduleVariance.label, '4 weeks behind');
    });
  });

  describe('catch project up', () => {
    let firstPreview: { adjustments: Array<{ boqItemId: string; newStartDate: string; newEndDate: string }>; newProjectedEndDate: string };

    it('applies at once when the projected end does not move', async () => {
      const h = await web(MONITOR);
      const preview = await request(app).post(url('/revisions/preview')).set(h).send({ changes: [{ boqItemId: ids.items.I2, shiftWorkdays: 3 }] });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.data.requiresApproval, false);
      const created = await request(app)
        .post(url('/revisions'))
        .set(h)
        .send({ changes: [{ boqItemId: ids.items.I2, shiftWorkdays: 3 }], reason: 'Formwork delivery slipped three days.' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.data.status, 'APPLIED');
      assert.equal(created.body.data.decidedByUserId, null);
      const i2 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I2 } });
      assert.equal(i2.plannedStartDate, addWorkdays(dates.I2.start, 3, WEEK));
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'SCHEDULE_REVISION_APPLIED' } }), 1);
    });

    it('waits for approval when the end moves; preview equals the applied result', async () => {
      const h = await web(MONITOR);
      const changes = [{ boqItemId: ids.items.I1, shiftWorkdays: 12 }];
      const preview = await request(app).post(url('/revisions/preview')).set(h).send({ changes });
      assert.equal(preview.status, 200);
      assert.equal(preview.body.data.requiresApproval, true);
      firstPreview = preview.body.data;
      const created = await request(app).post(url('/revisions')).set(h).send({ changes, reason: 'Rain delay on the main embankment.' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.data.status, 'PENDING_APPROVAL');
      assert.equal(created.body.data.canDecide, false, 'the initiator cannot decide');
      const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      assert.equal(i1.plannedStartDate, dates.I1.start, 'nothing moves before approval');
      assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'SCHEDULE_REVISION_PENDING' } }), 1);

      const second = await request(app)
        .post(url('/revisions'))
        .set(h)
        .send({ changes: [{ boqItemId: ids.items.I3, shiftWorkdays: 1 }], reason: 'Another small delay here.' });
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, 'SCHEDULE_REVISION_PENDING');

      const noPermission = await request(app).post(url(`/revisions/${created.body.data.id}/approve`)).set(h).send({});
      assert.equal(noPermission.status, 403);

      const approved = await request(app)
        .post(url(`/revisions/${created.body.data.id}/approve`))
        .set(await web(LENDER))
        .send({ notes: 'Accepted on the weather record.' });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.data.status, 'APPLIED');
      for (const a of firstPreview.adjustments) {
        const item = await prisma.boqItem.findUniqueOrThrow({ where: { id: a.boqItemId } });
        assert.equal(item.plannedStartDate, a.newStartDate);
        assert.equal(item.plannedEndDate, a.newEndDate);
      }
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(project.currentProjectedEndDate, firstPreview.newProjectedEndDate);
    });

    it('stops the initiator approving their own revision, and rejects without changing dates', async () => {
      const admin = await web(ADMIN);
      const before = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      const created = await request(app)
        .post(url('/revisions'))
        .set(admin)
        .send({ changes: [{ boqItemId: ids.items.I1, shiftWorkdays: 6 }], reason: 'Further delay to the embankment works.' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const self = await request(app).post(url(`/revisions/${created.body.data.id}/approve`)).set(admin).send({});
      assert.equal(self.status, 403);
      assert.equal(self.body.error.code, 'SCHEDULE_REVISION_SAME_PERSON');
      const rejected = await request(app)
        .post(url(`/revisions/${created.body.data.id}/reject`))
        .set(await web(LENDER))
        .send({ notes: 'Not supported by the site diary.' });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body.data.status, 'REJECTED');
      const afterRow = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      assert.equal(afterRow.plannedStartDate, before.plannedStartDate);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'SCHEDULE_REVISION_REJECTED' } }), 1);
    });

    it('refuses a stale revision', async () => {
      const created = await request(app)
        .post(url('/revisions'))
        .set(await web(MONITOR))
        .send({ changes: [{ boqItemId: ids.items.I1, shiftWorkdays: 6 }], reason: 'Embankment rework after testing.' });
      assert.equal(created.status, 201);
      const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { plannedStartDate: addWorkdays(i1.plannedStartDate!, 1, WEEK) } });
      const approve = await request(app).post(url(`/revisions/${created.body.data.id}/approve`)).set(await web(LENDER)).send({});
      assert.equal(approve.status, 409);
      assert.equal(approve.body.error.code, 'SCHEDULE_REVISION_STALE');
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { plannedStartDate: i1.plannedStartDate } });
      await request(app).post(url(`/revisions/${created.body.data.id}/reject`)).set(await web(LENDER)).send({});
    });

    it('keeps the original baseline through two applied revisions and lists the history', async () => {
      const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      const i2 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I2 } });
      assert.equal(i1.originalPlannedStartDate, dates.I1.start);
      assert.equal(i1.originalPlannedEndDate, dates.I1.end);
      assert.notEqual(i1.plannedStartDate, dates.I1.start);
      assert.equal(i2.originalPlannedStartDate, dates.I2.start);
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(project.originalPlannedEndDate, dates.project.end);
      const list = await request(app).get(url('/revisions')).set(await web(LENDER));
      assert.equal(list.status, 200);
      assert.deepEqual(
        list.body.data.map((r: { revisionNumber: number; status: string }) => `${r.revisionNumber}:${r.status}`),
        ['4:REJECTED', '3:REJECTED', '2:APPLIED', '1:APPLIED']
      );
      assert.equal(list.body.data[2].decidedByName !== null, true);
    });
  });

  describe('withdrawing a revision', () => {
    it('lets only the proposer withdraw a pending revision, changes no dates and frees the slot', async () => {
      const monitor = await web(MONITOR);
      const before = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      const created = await request(app)
        .post(url('/revisions'))
        .set(monitor)
        .send({ changes: [{ boqItemId: ids.items.I1, shiftWorkdays: 6 }], reason: 'Embankment settlement monitoring extended.' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.data.canWithdraw, true);
      const id = created.body.data.id as string;

      const byOther = await request(app).post(url(`/revisions/${id}/withdraw`)).set(await web(ADMIN)).send({});
      assert.equal(byOther.status, 403);
      assert.equal(byOther.body.error.code, 'SCHEDULE_REVISION_NOT_INITIATOR');
      const lenderView = await request(app).get(url('/revisions')).set(await web(LENDER));
      assert.equal(lenderView.body.data.find((r: { id: string }) => r.id === id).canWithdraw, false);

      const withdrawn = await request(app)
        .post(url(`/revisions/${id}/withdraw`))
        .set(monitor)
        .send({ notes: 'Settlement readings came back within limits.' });
      assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
      assert.equal(withdrawn.body.data.status, 'WITHDRAWN');
      assert.equal(withdrawn.body.data.canWithdraw, false);
      assert.equal(withdrawn.body.data.decidedByUserId, null);
      const after = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
      assert.equal(after.plannedStartDate, before.plannedStartDate);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'SCHEDULE_REVISION_WITHDRAWN' } }), 1);

      const again = await request(app).post(url(`/revisions/${id}/withdraw`)).set(monitor).send({});
      assert.equal(again.status, 409);
      const approve = await request(app).post(url(`/revisions/${id}/approve`)).set(await web(LENDER)).send({});
      assert.equal(approve.status, 409);

      // The pending slot is free again.
      const next = await request(app)
        .post(url('/revisions'))
        .set(monitor)
        .send({ changes: [{ boqItemId: ids.items.I1, shiftWorkdays: 6 }], reason: 'Embankment settlement monitoring extended.' });
      assert.equal(next.status, 201);
      await request(app).post(url(`/revisions/${next.body.data.id}/withdraw`)).set(monitor).send({});
    });
  });

  describe('briefs follow planned windows', () => {
    before(async () => {
      const project = await prisma.project.create({
        data: {
          tenantId: ids.tenant,
          name: 'Brief Selection Yard',
          codePrefix: 'SCH-903',
          stateLocation: 'Edo State',
          status: 'ACTIVE',
          activatedAt: new Date('2025-01-01T00:00:00Z'),
          reportingCadence: 'WEEKLY',
          workWeekDays: WEEK,
          timezone: 'Africa/Lagos',
        },
      });
      ids.briefProject = project.id;
      const make = (code: string, extra: Record<string, unknown>) => createItem(project.id, code, extra);
      ids.briefItems.inWindow = await make('05.01', { plannedStartDate: '2025-03-03', plannedEndDate: '2025-03-14' });
      ids.briefItems.overdue = await make('05.02', { plannedStartDate: '2025-02-10', plannedEndDate: '2025-02-20' });
      ids.briefItems.later = await make('05.03', { plannedStartDate: '2025-04-01', plannedEndDate: '2025-04-10' });
      ids.briefItems.blocked = await make('05.04', { plannedStartDate: '2025-03-20', plannedEndDate: '2025-03-29' });
      ids.briefItems.holdPoint = await make('05.05', { isHoldPoint: true });
      ids.briefItems.done = await make('05.06', { plannedStartDate: '2025-01-06', plannedEndDate: '2025-01-10', cumulativeCertifiedPct: 100 });
      ids.briefItems.override = await make('05.07', { planningTier: 'PLAN_A', plannedStartDate: '2025-06-02', plannedEndDate: '2025-06-06' });
      await prisma.boqItemDependency.create({
        data: { projectId: project.id, predecessorBoqItemId: ids.briefItems.inWindow, successorBoqItemId: ids.briefItems.blocked },
      });
    });

    it('chooses items in the period, overdue items and the manual override, plus unblocked fallbacks', async () => {
      const targets = await briefs.dispatchTargets(ids.briefProject, { periodStart: '2025-03-03', periodEnd: '2025-03-08' });
      const name = (id: string) => Object.entries(ids.briefItems).find(([, v]) => v === id)![0];
      assert.deepEqual(targets.filter((t) => t.isScheduled).map((t) => name(t.id)).sort(), ['inWindow', 'overdue', 'override']);
      assert.deepEqual(targets.filter((t) => !t.isScheduled).map((t) => name(t.id)), ['later']);

      const generated = await briefs.generateDispatchForProject(ids.briefProject, '2025-03-04', ['INDEPENDENT_VERIFIER']);
      const tiers = Object.fromEntries(generated.map((b) => [name(b.boqItemId), b.planningTier]));
      assert.deepEqual(tiers, { inWindow: 'PLAN_A', overdue: 'PLAN_A', override: 'PLAN_A', later: 'FALLBACK_BACKLOG' });
      const obligations = await prisma.reportingObligation.findMany({ where: { projectId: ids.briefProject } });
      assert.deepEqual(obligations.map((o) => name(o.boqItemId!)).sort(), ['inWindow', 'overdue', 'override']);
    });

    it('a fallback becomes eligible once its predecessor is done', async () => {
      await prisma.boqItem.update({ where: { id: ids.briefItems.inWindow }, data: { cumulativeCertifiedPct: 100 } });
      const targets = await briefs.dispatchTargets(ids.briefProject, { periodStart: '2025-03-10', periodEnd: '2025-03-15' });
      const fallbacks = targets.filter((t) => !t.isScheduled).map((t) => t.id);
      assert.ok(fallbacks.includes(ids.briefItems.blocked));
      assert.ok(!targets.some((t) => t.id === ids.briefItems.inWindow), 'done items are not briefed');
    });
  });

  describe('schedule-variance job', () => {
    it('stores badges daily and alerts once when a project falls two weeks behind', async () => {
      const lkk = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'LKK-402' } });
      await prisma.project.update({ where: { id: lkk.id }, data: { scheduleStatus: null, scheduleVarianceComputedAt: null } });
      const now = new Date();
      await jobs.runJobOnce('schedule-variance', now);
      await jobs.runJobOnce('schedule-variance', now); // same day: one JobRun per project per day
      await jobs.runJobOnce('schedule-variance', new Date(now.getTime() + 24 * 3600 * 1000));
      const after = await prisma.project.findUniqueOrThrow({ where: { id: lkk.id } });
      assert.equal(after.scheduleStatus, 'BEHIND');
      assert.ok(after.scheduleBehindAlertedAt);
      const alerts = await prisma.webNotification.findMany({ where: { projectId: lkk.id, category: 'SCHEDULE_BEHIND' } });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].targetPermissionKey, 'schedule:view_variance');
      const abj = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'ABJ-108' } });
      assert.equal(await prisma.webNotification.count({ where: { projectId: abj.id, category: 'SCHEDULE_BEHIND' } }), 0);
    });
  });
});
