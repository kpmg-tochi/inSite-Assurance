/**
 * Phase 16 route tests: programme KPIs on the seeded demo programme (seedPhase16).
 * - every catalogue KPI is tracked for the programme admin over the last 60 days;
 * - visibility follows the projects (a subsidiary sees its projects only) and the permission;
 * - filters by project type, region and owner; targets per type (differing targets are flagged,
 *   with a per-type breakdown); a target saved on the type applies at once; hidden KPIs drop out;
 * - "not tracked" is never reported as 0 (no cell for the project);
 * - the project KPI endpoint and its guard;
 * - the kpi-snapshot job: one JobRun per tenant-day, current-month rows, trends.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import { addDays, KPI_CATALOGUE, zonedCalendarDate, type KpiDashboardDto } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const period = { from: addDays(today, -60), to: today };
const ids = { tenant: '', central: '', coFunded: '', north: '', south: '', regionSouth: '', prg105: '', prg211: '', prg242: '' };

const NO_KPIS = 'no.kpis@insite.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

async function dashboard(email: string, query: Record<string, string> = {}): Promise<KpiDashboardDto> {
  const res = await request(app)
    .get('/api/v1/kpis')
    .query({ ...period, ...query })
    .set(await web(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as KpiDashboardDto;
}
const kpi = (d: KpiDashboardDto, key: string) => d.kpis.find((k) => k.key === key)!;
const row = (d: KpiDashboardDto, code: string) => d.projects.find((p) => p.codePrefix === code)!;

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  const types = await prisma.projectType.findMany({ where: { tenantId: tenant.id } });
  ids.central = types.find((t) => t.code === 'CENTRAL')!.id;
  ids.coFunded = types.find((t) => t.code === 'CO_FUNDED')!.id;
  const orgs = await prisma.organization.findMany({ where: { tenantId: tenant.id } });
  ids.north = orgs.find((o) => o.name === 'Kano State Universal Basic Education Board (SUBEB)')!.id;
  ids.south = orgs.find((o) => o.name === 'Lagos State Universal Basic Education Board (SUBEB)')!.id;
  ids.regionSouth = (await prisma.region.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'S' } })).id;
  const project = (code: string) => prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } });
  ids.prg105 = (await project('PRG-105')).id;
  ids.prg211 = (await project('PRG-211')).id;
  ids.prg242 = (await project('PRG-242')).id;

  // R1d: contractors have no login. A web user assigned to PRG-105 without kpis:view stands in.
  const viewer = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Project viewer',
      code: 'P16_PROJECT_VIEWER',
      surface: 'WEB',
      rolePermissions: { create: [{ permission: { connect: { key: 'projects:view_assigned' } } }] },
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: NO_KPIS,
      passwordHash: await (await import('bcryptjs')).default.hash(PASSWORD, 8),
      fullName: 'No KPIs',
      roleId: viewer.id,
      organizationId: ids.south,
    },
  });
  await prisma.userProjectAssignment.create({ data: { userId: user.id, projectId: ids.prg105 } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 16: programme KPI dashboard', () => {
  it('needs kpis:view', async () => {
    const res = await request(app).get('/api/v1/kpis').set(await web(NO_KPIS));
    assert.equal(res.status, 403);
  });

  it('tracks every catalogue KPI on the seeded programme, with targets', async () => {
    const d = await dashboard('admin@ubec.test');
    assert.deepEqual(d.period, period);
    assert.equal(d.projectCount, 9); // live and archived (incl. the demo closure twin PRG-106); drafts are left out
    assert.ok(!d.projects.some((p) => p.codePrefix === 'PRG-101' || p.codePrefix === 'PRG-201'));
    assert.deepEqual(
      d.kpis.map((k) => k.key),
      KPI_CATALOGUE.map((k) => k.key)
    );
    const untracked = d.kpis.filter((k) => k.status === 'NOT_TRACKED').map((k) => k.key);
    assert.deepEqual(untracked, []);
    // Seeded facts behind a few of them.
    // Redesign R1b: financial utilisation reads the recorded payments (disbursedToDateNgn).
    const utilisation = kpi(d, 'financial_utilisation');
    assert.ok(utilisation.numerator > 0, 'PRG-105 has a recorded interim payment');
    // R7: lessons are documented in the closeout report: PRG-242 has filed it, PRG-241's is still pending.
    assert.equal(kpi(d, 'lessons_documented').value, 50);
    assert.equal(kpi(d, 'audited_post_closure').numerator, 1); // PRG-242 signed off, PRG-241 pending
    assert.equal(kpi(d, 'audited_post_closure').denominator, 2);
    assert.equal(row(d, 'PRG-242').values.verified_on_time.value, 0); // completed after the planned end
    assert.equal(row(d, 'PRG-242').status, 'ARCHIVED');
  });

  it('flags differing targets and breaks the KPI down per project type', async () => {
    const d = await dashboard('admin@ubec.test');
    const mob = kpi(d, 'contractors_mobilised_on_time');
    assert.equal(mob.targetVaries, true);
    assert.equal(mob.target, null);
    const byType = new Map(mob.byProjectType.map((b) => [b.projectTypeId, b]));
    assert.equal(byType.get(ids.central)?.target, 90);
    assert.equal(byType.get(ids.coFunded)?.target, 85);
    // PRG-221 is overdue: the Co-Funded figure counts it as a miss.
    assert.equal(byType.get(ids.coFunded)?.status, 'MISSED');
  });

  it('filters by project type, region and owner', async () => {
    const co = await dashboard('admin@ubec.test', { projectTypeId: ids.coFunded });
    assert.deepEqual(co.projects.map((p) => p.codePrefix).sort(), ['PRG-211', 'PRG-221', 'PRG-241', 'PRG-242']);
    assert.equal(kpi(co, 'contractors_mobilised_on_time').target, 85);
    assert.equal(kpi(co, 'contractors_mobilised_on_time').targetVaries, false);

    const southRegion = await dashboard('admin@ubec.test', { regionId: ids.regionSouth });
    assert.deepEqual(southRegion.projects.map((p) => p.codePrefix).sort(), ['PRG-104', 'PRG-221', 'PRG-241', 'PRG-242']);
    const southOwned = await dashboard('admin@ubec.test', { owningOrganizationId: ids.south });
    assert.deepEqual(southOwned.projects.map((p) => p.codePrefix).sort(), ['PRG-221', 'PRG-241', 'PRG-242']);
  });

  it('follows project visibility: a subsidiary admin sees only its own projects', async () => {
    const north = await dashboard('kano.admin@ubec.test');
    assert.deepEqual(north.projects.map((p) => p.codePrefix), ['PRG-211']);
    const south = await dashboard('lagos.admin@ubec.test');
    assert.deepEqual(south.projects.map((p) => p.codePrefix).sort(), ['PRG-221', 'PRG-241', 'PRG-242']);
    const ubec = await dashboard('admin@ubec.test');
    assert.equal(ubec.projectCount, 9);
  });

  it('never reports an untracked KPI as 0: the project has no cell for it', async () => {
    const d = await dashboard('admin@ubec.test');
    const prg211 = row(d, 'PRG-211');
    assert.equal('lessons_documented' in prg211.values, false); // not closed
    assert.ok('visits_conducted' in prg211.values);
  });

  it('applies a target saved on the project type at once, and hides KPIs the type hides', async () => {
    const admin = await web('admin@ubec.test');
    const list = await request(app).get('/api/v1/project-types').set(admin);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const type = (list.body.data as import('@insite/shared').ProjectTypeDto[]).find((t) => t.id === ids.coFunded)!;
    const save = await request(app)
      .put(`/api/v1/project-types/${ids.coFunded}`)
      .set(admin)
      .send({
        code: type.code,
        name: type.name,
        description: type.description,
        colour: type.colour,
        workflowTemplateId: type.workflowTemplateId,
        isDefault: type.isDefault,
        isActive: type.isActive,
        config: {
          ...type.config,
          kpiTargets: { ...type.config.kpiTargets, contractors_mobilised_on_time: { target: 70, shown: true }, lessons_documented: { target: 100, shown: false } },
        },
      });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    assert.deepEqual(save.body.data.config.kpiTargets.contractors_mobilised_on_time, { target: 70, shown: true });

    const co = await dashboard('admin@ubec.test', { projectTypeId: ids.coFunded });
    assert.equal(kpi(co, 'contractors_mobilised_on_time').target, 70);
    assert.equal(kpi(co, 'lessons_documented'), undefined); // hidden on every type in view
    assert.equal('lessons_documented' in row(co, 'PRG-242').values, false);
    // Still shown for Central (and so on the unfiltered page, from Central projects only).
    const all = await dashboard('admin@ubec.test');
    assert.equal(kpi(all, 'lessons_documented').status, 'NOT_TRACKED'); // no closed Central project
  });

  it('rejects a period that ends before it starts', async () => {
    const res = await request(app)
      .get('/api/v1/kpis')
      .query({ from: today, to: addDays(today, -1) })
      .set(await web('admin@ubec.test'));
    assert.equal(res.status, 400);
  });
});

describe('Phase 16: project KPIs', () => {
  it("returns the project's KPIs for the period", async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${ids.prg105}/kpis`)
      .query(period)
      .set(await web('me.officer@ubec.test'));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const byKey = new Map((res.body.data.kpis as Array<{ key: string; value: number | null; status: string }>).map((k) => [k.key, k]));
    const paid = await prisma.project.findUniqueOrThrow({ where: { id: ids.prg105 } });
    assert.equal(Number(paid.disbursedToDateNgn), 59_850_000, 'NGN 63m recorded, 5% retention held');
    assert.equal(byKey.get('financial_utilisation')?.value, Math.round((59_850_000 / 210_000_000) * 1000) / 10);
    // Redesign R4 seed: PRG-105's sprint 1 was verified partly met, so the project is behind.
    assert.equal(byKey.get('projects_on_schedule')?.status, 'MISSED');
    assert.equal(byKey.get('lessons_documented')?.status, 'NOT_TRACKED');
  });

  it('is guarded like the project (another organisation tree) and by the permission', async () => {
    const north = await request(app).get(`/api/v1/projects/${ids.prg242}/kpis`).set(await web('kano.admin@ubec.test'));
    assert.equal(north.status, 403); // the project guard, as for every project route
    const assignedWithoutPermission = await request(app).get(`/api/v1/projects/${ids.prg105}/kpis`).set(await web(NO_KPIS));
    assert.equal(assignedWithoutPermission.status, 403);
  });
});

describe('Phase 16: kpi-snapshot job', () => {
  it('runs once per tenant-day and stores the current month', async () => {
    const now = new Date();
    await prisma.kpiSnapshot.deleteMany({ where: { tenantId: ids.tenant, periodStart: `${today.slice(0, 7)}-01` } });
    assert.equal(await jobs.runJobOnce('kpi-snapshot', now), true);
    const runs = await prisma.jobRun.findMany({ where: { jobName: 'kpi-snapshot', scopeKey: `${ids.tenant}:${today}` } });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'DONE', runs[0].detail ?? '');
    const rows = await prisma.kpiSnapshot.count({ where: { projectId: ids.prg105, periodStart: `${today.slice(0, 7)}-01` } });
    assert.ok(rows > 0);
    // A second tick the same day does nothing.
    const before = await prisma.kpiSnapshot.findFirstOrThrow({ where: { projectId: ids.prg105 }, orderBy: { computedAt: 'desc' } });
    await jobs.runJobOnce('kpi-snapshot', new Date(now.getTime() + 60_000));
    const latest = await prisma.kpiSnapshot.findFirstOrThrow({ where: { projectId: ids.prg105 }, orderBy: { computedAt: 'desc' } });
    assert.equal(latest.computedAt.getTime(), before.computedAt.getTime());
  });

  it('feeds monthly trends, including backfilled earlier months', async () => {
    const d = await dashboard('admin@ubec.test');
    const kickoff = kpi(d, 'kickoff_notice_on_time');
    assert.ok(kickoff.trend.length >= 2, JSON.stringify(kickoff.trend));
    assert.ok(kickoff.trend.every((t, i, a) => i === 0 || a[i - 1].periodStart < t.periodStart));
  });
});

describe('Phase 16: KPIs follow the tenant time zone', () => {
  // 12:00 UTC on 30 November: still 30 November in Lagos, already 1 December in Kiritimati (UTC+14).
  const instant = new Date('2026-11-30T12:00:00.000Z');

  async function withZone(zone: string, fn: () => Promise<void>) {
    await prisma.tenant.update({ where: { id: ids.tenant }, data: { timezone: zone } });
    try {
      await fn();
    } finally {
      await prisma.tenant.update({ where: { id: ids.tenant }, data: { timezone: 'Africa/Lagos' } });
    }
  }

  it("defaults the period to the tenant's month, and says which zone", async () => {
    const { payloadFor } = await import('../db/seedPhase13');
    const { getKpiDashboard, getProjectKpis } = await import('../modules/kpis/kpis.service');
    const admin = await payloadFor('admin@ubec.test');
    const lagos = await getKpiDashboard(admin, {}, instant);
    assert.deepEqual(lagos.period, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(lagos.timeZone, 'Africa/Lagos');
    await withZone('Pacific/Kiritimati', async () => {
      const ahead = await getKpiDashboard(admin, {}, instant);
      assert.deepEqual(ahead.period, { from: '2026-12-01', to: '2026-12-01' });
      assert.equal(ahead.timeZone, 'Pacific/Kiritimati');
      const card = await getProjectKpis(ids.prg105, {}, instant);
      assert.deepEqual(card.period, ahead.period);
    });
  });

  it("runs the snapshot job on the tenant's day and stores the tenant's month", async () => {
    await withZone('Pacific/Kiritimati', async () => {
      await jobs.runJobOnce('kpi-snapshot', instant);
      const run = await prisma.jobRun.findUnique({ where: { jobName_scopeKey: { jobName: 'kpi-snapshot', scopeKey: `${ids.tenant}:2026-12-01` } } });
      assert.equal(run?.status, 'DONE', run?.detail ?? 'no run');
      const december = await prisma.kpiSnapshot.count({ where: { projectId: ids.prg105, periodStart: '2026-12-01' } });
      assert.ok(december > 0);
    });
  });

  it('falls back to Lagos for a zone the runtime does not know', async () => {
    const { safeZone } = await import('../modules/kpis/kpis.service');
    assert.equal(safeZone('Mars/Olympus_Mons'), 'Africa/Lagos');
    assert.equal(safeZone('Europe/London'), 'Europe/London');
    assert.equal(safeZone(null), 'Africa/Lagos');
  });
});
