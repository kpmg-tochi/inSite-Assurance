/**
 * Phase 8 route and job tests: cadence-aware obligations, late and missed reports, and the job
 * runner's single-run guarantees. Redesign R1e removed briefs, telemetry, the participant roster,
 * attendance alerts and check-in; the last test checks their endpoints and jobs are gone.
 *
 * Uses a project created here ("CAD-801": weekly, Monday to Saturday, due 17:00 Lagos) so the
 * calendar is under test control. Jobs are run with an explicit `now`; report dates are in 2025
 * (past), so the server's "not in the future" check passes.
 * Calendar: 2025-03-03 is a Monday, 2025-03-08 a Saturday, 2025-03-09 a Sunday.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth, fieldToken as sessionToken } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');
let cadenceJobs: typeof import('../jobs/cadenceJobs');
let messaging: typeof import('../integrations/messaging');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  draft: '',
  items: [] as string[],
  cowRole: '',
  session: '',
};
let sitePoint = { latitude: 0, longitude: 0 };

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => fieldAuth(prisma, sessionId);

function reportBody(wbsItemId: string, workdayDate: string, confirmedAt: string) {
  return {
    clientReportId: crypto.randomUUID(),
    wbsItemId,
    workdayDate,
    reporterTimezone: 'Africa/Lagos',
    summaryText: 'Inspected the work in place and recorded quantities.',
    reportedQuantity: 1,
    unitOfMeasure: 'm3',
    isHoldPointClaimed: false,
    clientCaptureIds: [] as string[],
    textNotes: [],
    submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: confirmedAt },
    confirmedAt,
    confirmedAsFinal: true,
  };
}

/** A provisioned field account on the project (R1d: no join codes); `userId` reuses an account. */
async function makeSession(name: string, phone: string, userId?: string) {
  const s = await createFieldSession(prisma, { projectId: ids.project, roleId: ids.cowRole, name, phoneNumber: phone, userId });
  return s.sessionId;
}

async function sessionUserId(sessionId: string) {
  return (await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { userId: true } })).userId;
}

const auditCount = (action: string) =>
  prisma.auditLog.count({ where: { projectId: ids.project, action: action as never } });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  cadenceJobs = await import('../jobs/cadenceJobs');
  messaging = await import('../integrations/messaging');
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'EDO-410' } });
  const geofence = edo.geofenceGeoJson as { center?: { latitude: number; longitude: number } };
  sitePoint = geofence.center ?? { latitude: 6.3176, longitude: 5.6145 };

  const project = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Cadence Test Bridge',
      codePrefix: 'CAD-801',
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date('2025-01-01T00:00:00Z'),
      reportingCadence: 'WEEKLY',
      workWeekDays: [1, 2, 3, 4, 5, 6],
      periodStartDayOfWeek: 1,
      workdayStartTime: '08:00',
      workdayEndTime: '17:00',
      timezone: 'Africa/Lagos',
      geofenceMode: edo.geofenceMode,
      geofenceGeoJson: edo.geofenceGeoJson ?? undefined,
      geofenceToleranceMeters: edo.geofenceToleranceMeters,
    },
  });
  ids.project = project.id;
  for (const n of [1, 2, 3]) {
    const item = await prisma.boqItem.create({
      data: {
        projectId: project.id,
        wbsCode: `01.0${n}`,
        section: 'BILL 1',
        description: `Bridge pier ${n} concrete`,
        unit: 'm3',
        totalQuantity: 100,
        rateNgn: 1000,
        budgetedCostNgn: 100000,
        planningTier: 'PLAN_A',
      },
    });
    ids.items.push(item.id);
  }
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } });
  ids.cowRole = role.id;
  ids.session = await makeSession('Inspector Ada', '+2348030000001');
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: project.id } });

  const draft = await prisma.project.create({
    data: { tenantId: tenant.id, name: 'Cadence Draft', codePrefix: 'CAD-802', status: 'DRAFT', reportingCadence: 'DAILY' },
  });
  ids.draft = draft.id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 8', () => {
  describe('cadence: obligations, late and missed reports', () => {
    const monday = new Date('2025-03-03T07:30:00Z'); // 08:30 Lagos


    it('creates one set of obligations per period even with two runners at once', async () => {
      // Before the period opens nothing is created.
      await jobs.runJobOnce('reporting-obligations', new Date('2025-03-03T06:00:00Z'));
      assert.equal(await prisma.reportingObligation.count({ where: { projectId: ids.project } }), 0);

      // Two "instances": both through the lock, and both bypassing it (the JobRun claim still holds).
      await Promise.all([
        jobs.runJobOnce('reporting-obligations', monday),
        jobs.runJobOnce('reporting-obligations', monday),
        cadenceJobs.runObligationDispatch({ now: monday }),
        cadenceJobs.runObligationDispatch({ now: monday }),
      ]);
      const obligations = await prisma.reportingObligation.findMany({ where: { projectId: ids.project } });
      assert.equal(obligations.length, 3, 'one verifier obligation per scheduled item');
      for (const o of obligations) {
        assert.equal(o.reporterScope, 'verifier');
        assert.equal(o.status, 'PENDING');
        assert.equal(o.periodStart, '2025-03-03');
        assert.equal(o.periodEnd, '2025-03-08');
        assert.equal(o.dueAt.toISOString(), '2025-03-08T16:00:00.000Z');
      }
      const runs = await prisma.jobRun.count({ where: { jobName: 'reporting-obligations', scopeKey: { startsWith: ids.project } } });
      assert.equal(runs, 1);

      // A later tick in the same period does nothing new.
      await jobs.runJobOnce('reporting-obligations', new Date('2025-03-05T10:00:00Z'));
      assert.equal(await prisma.reportingObligation.count({ where: { projectId: ids.project } }), 3);
    });

    it('returns the current period and its obligations on the overview', async () => {
      const res = await request(app).get(`/api/v1/projects/${ids.project}/cadence`).set(await web('monitor@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok('opensAt' in (res.body.data.currentPeriod ?? { opensAt: null }));
      assert.equal(res.body.data.counts.openAttendanceAlerts, undefined);
    });

    it('accepts an on-time report, flags a Sunday report late, and marks the missing one missed once', async () => {
      const onTime = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(await field(ids.session))
        .send(reportBody(ids.items[0], '2025-03-05', '2025-03-05T12:00:00.000Z'));
      assert.equal(onTime.status, 201, JSON.stringify(onTime.body));
      assert.equal(onTime.body.data.isLateSubmission, false);
      assert.equal(onTime.body.data.reportingPeriodStart, '2025-03-03');
      assert.equal(onTime.body.data.dueAt, '2025-03-08T16:00:00.000Z');

      // A second report on the same item in the same week is refused (one per period).
      const again = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(await field(ids.session))
        .send(reportBody(ids.items[0], '2025-03-07', '2025-03-07T12:00:00.000Z'));
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'REPORT_ALREADY_SUBMITTED');

      // After Saturday 17:00 the two unreported obligations are missed.
      const afterDue = new Date('2025-03-08T16:30:00Z');
      await jobs.runJobOnce('overdue-reports', afterDue);
      const status = async (i: number) =>
        (await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: ids.items[i] } })).status;
      assert.equal(await status(0), 'SUBMITTED');
      assert.equal(await status(1), 'MISSED');
      assert.equal(await status(2), 'MISSED');
      assert.equal(await auditCount('REPORT_MISSED'), 2);
      const webNotes = await prisma.webNotification.count({ where: { projectId: ids.project, category: 'REPORT_MISSED' } });
      assert.equal(webNotes, 1, 'one web notification per period and reporter scope');
      const mobileNotes = await prisma.mobileNotification.count({ where: { projectId: ids.project, type: 'REPORT_OVERDUE', fieldSessionId: ids.session } });
      assert.equal(mobileNotes, 1);

      // Running again (or on another instance) changes nothing.
      await Promise.all([jobs.runJobOnce('overdue-reports', afterDue), cadenceJobs.runOverdueReports({ now: afterDue })]);
      assert.equal(await auditCount('REPORT_MISSED'), 2);
      assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'REPORT_MISSED' } }), 1);

      // A Sunday report belongs to the same week: accepted, late, and the obligation becomes LATE.
      const sunday = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(await field(ids.session))
        .send(reportBody(ids.items[1], '2025-03-09', '2025-03-09T12:00:00.000Z'));
      assert.equal(sunday.status, 201, JSON.stringify(sunday.body));
      assert.equal(sunday.body.data.isLateSubmission, true);
      assert.equal(sunday.body.data.lateByMinutes, 20 * 60);
      assert.equal(sunday.body.data.reportingPeriodStart, '2025-03-03');
      assert.equal(await status(1), 'LATE');
      assert.equal(await auditCount('REPORT_SUBMITTED_LATE'), 1);
    });

    it('excuses a missed report only with a note, and lists due and overdue obligations', async () => {
      const monitor = await web('monitor@insite.ng');
      const missed = await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: ids.items[2] } });
      const url = `/api/v1/projects/${ids.project}/reporting-obligations/${missed.id}/excuse`;
      const noNote = await request(app).post(url).set(monitor).send({ notes: '' });
      assert.equal(noNote.status, 400);
      const ok = await request(app).post(url).set(monitor).send({ notes: 'Site closed for a public holiday.' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.data.status, 'EXCUSED');
      assert.equal(await auditCount('REPORTING_OBLIGATION_EXCUSED'), 1);

      const due = await request(app).get(`/api/v1/projects/${ids.project}/reporting-obligations?view=due`).set(monitor);
      assert.equal(due.status, 200);
      assert.deepEqual(due.body.data.map((o: { status: string }) => o.status).sort(), ['LATE']);
    });

    it('applies a cadence change on a live project from the next period', async () => {
      const admin = await web('admin@insite.ng');
      const res = await request(app)
        .put(`/api/v1/projects/${ids.project}/setup/reporting`)
        .set(admin)
        .send({ reportingCadence: 'DAILY', workdayStartTime: '08:00', workdayEndTime: '17:00' });
      assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
      const row = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(row.reportingCadence, 'WEEKLY', 'the running period keeps its shape');
      assert.ok(row.pendingCadenceEffectiveFrom, 'the change waits for the next period');
      // Undo: saving the current shape clears the pending change.
      const undo = await request(app)
        .put(`/api/v1/projects/${ids.project}/setup/reporting`)
        .set(admin)
        .send({ reportingCadence: 'WEEKLY', workdayStartTime: '08:00', workdayEndTime: '17:00' });
      assert.ok([200, 201].includes(undo.status), JSON.stringify(undo.body));
      const cleared = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(cleared.pendingCadenceEffectiveFrom, null);
    });
  });

  describe('redesign R1e', () => {
    it('has no brief, telemetry, roster, attendance or check-in endpoints, and no jobs for them', async () => {
      const monitor = await web('monitor@insite.ng');
      const base = `/api/v1/projects/${ids.project}`;
      const field = await fieldAuth(prisma, ids.session);
      for (const [method, url, auth] of [
        ['get', `${base}/morning-briefs`, field],
        ['post', `${base}/morning-briefs/dispatch`, monitor],
        ['post', `${base}/boq/${ids.items[0]}/morning-brief`, monitor],
        ['post', `${base}/telemetry`, field],
        ['get', `${base}/telemetry`, monitor],
        ['get', `${base}/participants`, monitor],
        ['get', `${base}/attendance-alerts`, monitor],
        ['get', `${base}/check-in/today`, field],
        ['get', '/api/v1/projects/portfolio/executive-summary', monitor],
      ] as const) {
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(auth).send({});
        assert.ok([404, 400].includes(res.status), `${method} ${url} answered ${res.status}`);
      }
      const names = jobs.registeredJobs().map((j) => j.name);
      for (const gone of ['brief-dispatch', 'attendance-check', 'mobilization-reminders']) assert.ok(!names.includes(gone), gone);
      assert.ok(names.includes('reporting-obligations'));
    });
  });
});
