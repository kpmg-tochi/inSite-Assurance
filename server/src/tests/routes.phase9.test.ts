/**
 * Phase 9 route and job tests after redesign R2d: the baseline, earned-schedule variance,
 * dependencies and "Catch Project Up" revisions are gone. What remains: actual dates from counted
 * reports, planned windows that follow sprints, and the schedule-variance job storing a badge
 * computed from sprints (D-R2.15). Obligation item selection went with reporting obligations in R4f.
 *
 * SCH-901 gets sprints relative to today (Lagos). The seed gives LKK-402 an ended sprint with incomplete units
 * (behind) and ABJ-108 a finished sprint 1 (on track).
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { addDays, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');
let schedule: typeof import('../modules/schedule/schedule.service');
let scope: typeof import('../modules/scope/scope.service');

const PASSWORD = 'Password123!';
const WEEK = [1, 2, 3, 4, 5, 6];
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  items: {} as Record<string, string>,
  units: {} as Record<string, string>,
  session: '',
};
let today = '';
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

const MONITOR = 'monitor@insite.ng';
const ADMIN = 'admin@insite.ng';

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

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  schedule = await import('../modules/schedule/schedule.service');
  scope = await import('../modules/scope/scope.service');
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
      name: 'Schedule Test School',
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
  // Sprint 1 ended yesterday; sprint 2 runs for another 60 days.
  const s1 = await prisma.projectSprint.create({
    data: { projectId: project.id, number: 1, name: 'Substructure', startDate: addDays(today, -40), endDate: addDays(today, -1) },
  });
  const s2 = await prisma.projectSprint.create({
    data: { projectId: project.id, number: 2, name: 'Superstructure', startDate: today, endDate: addDays(today, 60) },
  });
  const classroom = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'CLASSROOM' } } });
  const unit = async (code: string, start: string, end: string) =>
    (await prisma.facilityUnit.create({ data: { projectId: project.id, facilityId: classroom.id, code, label: `Block ${code}`, startSprintId: start, endSprintId: end } })).id;
  ids.units.U1 = await unit('U01', s1.id, s1.id); // due by sprint 1
  ids.units.U2 = await unit('U02', s1.id, s2.id); // due by sprint 2
  ids.items.I1 = await createItem(project.id, '01.01', { facilityUnitId: ids.units.U1, cumulativeCertifiedPct: 100 });
  ids.items.I2 = await createItem(project.id, '01.02', { facilityUnitId: ids.units.U2 });
  ids.items.I3 = await createItem(project.id, '01.03', { facilityUnitId: ids.units.U2 });
  await prisma.$transaction((tx) => scope.deriveLineDatesFromSprints(tx, project.id));

  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } });
  const session = await createFieldSession(prisma, { projectId: project.id, roleId: role.id, name: 'Inspector Bisi', phoneNumber: '+2348030000901' });
  ids.session = session.sessionId;
  for (const email of [MONITOR]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.userProjectAssignment.create({ data: { userId: user.id, projectId: project.id } });
  }
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 9 after redesign R2d', () => {
  it('the schedule baseline and revision endpoints are gone', async () => {
    for (const path of ['/schedule', '/schedule/baseline', '/schedule/revisions']) {
      const res = await request(app).get(`/api/v1/projects/${ids.project}${path}`).set(await web(ADMIN));
      assert.equal(res.status, 404, path);
    }
  });

  it('line windows follow the sprints of their unit', async () => {
    const i1 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I1 } });
    assert.deepEqual([i1.plannedStartDate, i1.plannedEndDate], [addDays(today, -40), addDays(today, -1)]);
    const i2 = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I2 } });
    assert.deepEqual([i2.plannedStartDate, i2.plannedEndDate], [addDays(today, -40), addDays(today, 60)]);
  });

  describe('actual dates', () => {
    it('a confirmed field report marks the actual start of the item and the project', async () => {
      const confirmedAt = new Date().toISOString();
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(await field(ids.session))
        .send({
          clientReportId: crypto.randomUUID(),
          wbsItemId: ids.items.I2,
          workdayDate: today,
          reporterTimezone: 'Africa/Lagos',
          summaryText: 'Excavated and blinded the first half of the classroom foundations.',
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
      assert.equal(Number(i2.cumulativeCertifiedPct), 50, 'a counted report is the item progress (R1b)');
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(project.actualStartDate, today);
    });

    it('sets and clears the completion date with progress', async () => {
      await prisma.boqItem.update({ where: { id: ids.items.I3 }, data: { cumulativeCertifiedPct: 100 } });
      await prisma.$transaction((tx) => schedule.syncActualCompletionDates(tx, ids.project));
      assert.equal((await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I3 } })).actualCompletionDate, today);
      await prisma.boqItem.update({ where: { id: ids.items.I3 }, data: { cumulativeCertifiedPct: 0 } });
      await prisma.$transaction((tx) => schedule.syncActualCompletionDates(tx, ids.project));
      assert.equal((await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items.I3 } })).actualCompletionDate, null);
    });
  });

  describe('schedule badge from sprints (D-R2.15)', () => {
    const badge = async (now: Date) => (await schedule.refreshScheduleBadge(ids.project, now)).status;
    const day = (offset: number) => new Date(Date.now() + offset * 24 * 3600 * 1000);

    it('ON_TRACK while the units due by ended sprints are complete', async () => {
      // The report above refreshed progress from counted reports; I1 (unit U01, sprint 1) is set done here.
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { cumulativeCertifiedPct: 100 } });
      assert.equal(await badge(new Date()), 'ON_TRACK');
    });

    it('NOT_STARTED before sprint 1', async () => {
      assert.equal(await badge(day(-60)), 'NOT_STARTED');
    });

    it('BEHIND when a unit whose end sprint has ended still has a line below 100%', async () => {
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { cumulativeCertifiedPct: 90 } });
      // Redesign R4e (D-R4.32): an unverified sprint gets its verification period (7 days) first.
      const within = await schedule.refreshScheduleBadge(ids.project, new Date());
      assert.deepEqual([within.status, within.behindUnitCount], ['ON_TRACK', 0]);
      const r = await schedule.refreshScheduleBadge(ids.project, day(8));
      assert.deepEqual([r.status, r.behindUnitCount], ['BEHIND', 1]);
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { cumulativeCertifiedPct: 100 } });
    });

    it('COMPLETE when every line is at 100%, UNSCHEDULED without sprints', async () => {
      await prisma.boqItem.updateMany({ where: { projectId: ids.project }, data: { cumulativeCertifiedPct: 100 } });
      assert.equal(await badge(new Date()), 'COMPLETE');
      const other = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'EDO-410' } });
      assert.equal((await schedule.refreshScheduleBadge(other.id, new Date())).status, 'UNSCHEDULED');
      const stored = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(stored.scheduleStatus, 'COMPLETE');
      await prisma.boqItem.updateMany({ where: { projectId: ids.project }, data: { cumulativeCertifiedPct: 0 } });
      await prisma.boqItem.update({ where: { id: ids.items.I1 }, data: { cumulativeCertifiedPct: 100 } });
    });

    it('shows the seeded badges on the directory and the portfolio', async () => {
      await jobs.runJobOnce('schedule-variance', new Date());
      const list = await request(app).get('/api/v1/projects').set(await web(ADMIN));
      const lkk = list.body.data.find((p: { codePrefix: string }) => p.codePrefix === 'LKK-402');
      assert.equal(lkk.scheduleVariance.status, 'BEHIND');
      assert.equal(lkk.scheduleVariance.label, 'Behind');
      assert.equal(lkk.scheduleVariance.varianceWorkdays, undefined, 'no earned-schedule variance any more');
      const abj = list.body.data.find((p: { codePrefix: string }) => p.codePrefix === 'ABJ-108');
      assert.equal(abj.scheduleVariance.label, 'On track');
      const exec = await request(app).get('/api/v1/projects/portfolio/overview').set(await web(ADMIN));
      assert.equal(exec.status, 200);
      const execLkk = exec.body.data.projects.find((p: { codePrefix: string }) => p.codePrefix === 'LKK-402');
      assert.equal(execLkk.scheduleVariance.status, 'BEHIND');
    });
  });

  describe('schedule-variance job', () => {
    it('stores badges daily and alerts once when a project falls behind', async () => {
      const lkk = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'LKK-402' } });
      await prisma.project.update({ where: { id: lkk.id }, data: { scheduleStatus: null, scheduleVarianceComputedAt: null, scheduleBehindAlertedAt: null } });
      await prisma.webNotification.deleteMany({ where: { projectId: lkk.id, category: 'SCHEDULE_BEHIND' } });
      const now = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      await jobs.runJobOnce('schedule-variance', now);
      await jobs.runJobOnce('schedule-variance', now); // same day: one JobRun per project per day
      await jobs.runJobOnce('schedule-variance', new Date(now.getTime() + 24 * 3600 * 1000));
      const after = await prisma.project.findUniqueOrThrow({ where: { id: lkk.id } });
      assert.equal(after.scheduleStatus, 'BEHIND');
      assert.ok(after.scheduleBehindAlertedAt);
      const alerts = await prisma.webNotification.findMany({ where: { projectId: lkk.id, category: 'SCHEDULE_BEHIND' } });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].targetPermissionKey, 'schedule:view_variance');
      assert.equal(alerts[0].actionUrl, `/app/projects/${lkk.id}/scope`);
      const abj = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'ABJ-108' } });
      assert.equal(await prisma.webNotification.count({ where: { projectId: abj.id, category: 'SCHEDULE_BEHIND' } }), 0);
    });
  });
});
