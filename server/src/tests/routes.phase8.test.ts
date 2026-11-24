/**
 * Phase 8 route and job tests: cadence-aware report periods, late reports, and the job runner's
 * single-run guarantees. Redesign R1e removed briefs, telemetry, the participant roster, attendance
 * alerts and check-in; R4f removed reporting obligations, the cadence overview, the reporting setup
 * step and the reporting-obligations/overdue-reports jobs (visits replace them). The last test
 * checks their endpoints and jobs are gone.
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
  describe('cadence: report periods and late reports', () => {
    it('runs a job unit once per scope even with two runners at once', async () => {
      // Two "instances": both through the lock, and both bypassing it (the JobRun claim still holds).
      const monday = new Date('2025-03-03T07:30:00Z'); // 08:30 Lagos
      const { runScheduleVariance } = await import('../jobs/scheduleJobs');
      await Promise.all([
        jobs.runJobOnce('schedule-variance', monday),
        jobs.runJobOnce('schedule-variance', monday),
        runScheduleVariance({ now: monday }),
        runScheduleVariance({ now: monday }),
      ]);
      const runs = await prisma.jobRun.count({ where: { jobName: 'schedule-variance', scopeKey: `${ids.project}:2025-03-03` } });
      assert.equal(runs, 1);
    });

    it('accepts an on-time report, refuses a second one in the period, and flags a Sunday report late', async () => {
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

      // A Sunday report belongs to the same week: accepted and flagged late.
      const sunday = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(await field(ids.session))
        .send(reportBody(ids.items[1], '2025-03-09', '2025-03-09T12:00:00.000Z'));
      assert.equal(sunday.status, 201, JSON.stringify(sunday.body));
      assert.equal(sunday.body.data.isLateSubmission, true);
      assert.equal(sunday.body.data.lateByMinutes, 20 * 60);
      assert.equal(sunday.body.data.reportingPeriodStart, '2025-03-03');
      assert.equal(await auditCount('REPORT_SUBMITTED_LATE'), 1);
    });
  });

  describe('redesign R1e and R4f', () => {
    it('has no brief, telemetry, roster, attendance, check-in, cadence or obligation endpoints, and no jobs for them', async () => {
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
        ['get', `${base}/cadence`, monitor],
        ['get', `${base}/reporting-obligations`, monitor],
        ['post', `${base}/reporting-obligations/${crypto.randomUUID()}/excuse`, monitor],
        ['put', `${base}/setup/reporting`, monitor],
      ] as const) {
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(auth).send({});
        assert.ok([404, 400].includes(res.status), `${method} ${url} answered ${res.status}`);
      }
      const names = jobs.registeredJobs().map((j) => j.name);
      for (const gone of ['brief-dispatch', 'attendance-check', 'mobilization-reminders', 'reporting-obligations', 'overdue-reports']) {
        assert.ok(!names.includes(gone), gone);
      }
      assert.ok(names.includes('schedule-variance'));
    });
  });
});
