/**
 * Phase 8 route and job tests: the job runner's single-run guarantees. Redesign R1e removed briefs,
 * telemetry, the participant roster, attendance alerts and check-in; R4f removed reporting
 * obligations, the cadence overview, the reporting setup step and their jobs; R5f removed workday
 * reports and the reporting cadence (visits replace them). The last test checks their endpoints and
 * jobs are gone.
 *
 * Uses a project created here ("CAD-801", Monday to Saturday) so the calendar is under test control.
 * Calendar: 2025-03-03 is a Monday.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
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
  items: [] as string[],
  cowRole: '',
  session: '',
};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
/** A provisioned field account on the project (R1d: no join codes); `userId` reuses an account. */
async function makeSession(name: string, phone: string, userId?: string) {
  const s = await createFieldSession(prisma, { projectId: ids.project, roleId: ids.cowRole, name, phoneNumber: phone, userId });
  return s.sessionId;
}

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

  const project = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Cadence Test Bridge',
      codePrefix: 'CAD-801',
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date('2025-01-01T00:00:00Z'),
      workWeekDays: [1, 2, 3, 4, 5, 6],
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
      },
    });
    ids.items.push(item.id);
  }
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } });
  ids.cowRole = role.id;
  ids.session = await makeSession('Inspector Ada', '+2348030000001');
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: project.id } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 8', () => {
  describe('job runner', () => {
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
  });

  describe('redesign R1e, R4f and R5f', () => {
    it('has no brief, telemetry, roster, attendance, check-in, cadence, obligation or report endpoints, and no jobs for them', async () => {
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
        ['post', `${base}/workday-reports`, field],
        ['get', `${base}/workday-reports`, monitor],
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
