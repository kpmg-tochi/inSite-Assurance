/**
 * Design round 2026-11-26: GET /projects/:id/overview/charts (the Overview dashboard's charts), on the
 * seeded programme tenant:
 * - the shape parses with the shared schema; visits always 9 months, findings always 3 severities;
 * - the current month's actual % equals the project's % complete; planned % never goes down;
 * - PRG-105 (one interim payment): paid % above 0 from the payment's month; money totals agree;
 * - a visit that raised unit progress (VISIT_UPDATED progressIncrease) shows in its month's actual %;
 * - sections follow permissions: null without them (M&E officer: no payments; a tenant viewer: none);
 * - a draft has no charts; a project the caller cannot see is refused.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import { ProjectOverviewChartsDtoSchema, zonedCalendarDate, type ProjectOverviewChartsDto } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let audit: typeof import('../modules/audit/audit.service');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const ADMIN = 'admin@ubec.test';
/** UBEC M&E Officer: scope, visits and findings, no payments; assigned to PRG-105, not PRG-241. */
const ME = 'me.officer@ubec.test';
const VIEWER = 'design.charts.viewer@insite.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

async function charts(email: string, code: string): Promise<ProjectOverviewChartsDto> {
  const res = await request(app).get(`/api/v1/projects/${ids[code]}/overview/charts`).set(await web(email));
  assert.equal(res.status, 200, `${code}: ${JSON.stringify(res.body)}`);
  return ProjectOverviewChartsDtoSchema.parse(res.body.data);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  audit = await import('../modules/audit/audit.service');
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  for (const p of await prisma.project.findMany({ where: { tenantId: tenant.id } })) ids[p.codePrefix] = p.id;

  // A web user who sees every project of the tenant and holds none of the section permissions.
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Charts tenant viewer',
      code: 'DESIGN_CHARTS_VIEWER',
      surface: 'WEB',
      rolePermissions: { create: [{ permission: { connect: { key: 'projects:view_all_tenant' } } }] },
    },
  });
  const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id } });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: VIEWER,
      passwordHash: await (await import('bcryptjs')).default.hash(PASSWORD, 8),
      fullName: 'Charts Viewer',
      roleId: role.id,
      organizationId: org.id,
    },
  });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Design round: Overview charts', () => {
  it('needs a web sign-in', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-105']}/overview/charts`);
    assert.equal(res.status, 401);
  });

  it('PRG-101 is a draft: no charts', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-101']}/overview/charts`).set(await web(ADMIN));
    assert.ok(res.status === 409 || res.status === 403, `got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('refuses a project the caller cannot see', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-241']}/overview/charts`).set(await web(ME));
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
  });

  it('PRG-105 (admin): every section, consistent with the project', async () => {
    const c = await charts(ADMIN, 'PRG-105');
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-105'] } });
    const today = zonedCalendarDate(new Date(), project.timezone);
    const currentMonth = today.slice(0, 7);
    assert.equal(c.today, today);

    // Visits: always the 9 months, six back to two ahead.
    assert.deepEqual(
      c.visitsByMonth!.map((v) => v.month),
      Array.from({ length: 9 }, (_, i) => addMonths(currentMonth, i - 6))
    );
    const visitTotal = c.visitsByMonth!.reduce((s, v) => s + v.accepted + v.awaitingReview + v.returned + v.missed + v.upcoming, 0);
    assert.ok(visitTotal > 0, 'PRG-105 has seeded visits');

    // Findings: always the three severities, in order.
    assert.deepEqual(
      c.findingsBySeverity!.map((f) => f.severity),
      ['MINOR', 'MAJOR', 'CRITICAL']
    );
    for (const f of c.findingsBySeverity!) assert.ok(f.openOverdue <= f.open);

    // Progress curve: the current point is the headline, planned never goes down, nothing after today.
    const curve = c.progressCurve!;
    const pct = Math.round(Number(project.certifiedProgressPct) * 10) / 10;
    assert.equal(curve.currentPct, pct);
    const current = curve.points.find((p) => p.month === currentMonth);
    assert.ok(current, 'the curve includes the current month');
    assert.equal(current.date, today);
    assert.equal(current.actualPct, pct);
    assert.ok(curve.points.length >= 1 && curve.points.length <= 36);
    const months = curve.points.map((p) => p.month);
    assert.deepEqual(months, [...months].sort());
    let last = -1;
    for (const p of curve.points) {
      if (p.plannedPct === null) continue;
      assert.ok(p.plannedPct >= last, `planned % goes down at ${p.month}`);
      last = p.plannedPct;
    }
    for (const p of curve.points.filter((x) => x.month > currentMonth)) {
      assert.equal(p.actualPct, null);
      assert.equal(p.paidPct, null);
    }

    // Payments: PRG-105 has one interim payment.
    const payments = await prisma.projectPayment.findMany({ where: { projectId: ids['PRG-105'], voidedAt: null, kind: { in: ['INTERIM', 'FINAL'] } } });
    assert.ok(payments.length >= 1);
    const firstPaidMonth = payments.map((p) => p.paidOn).sort()[0].slice(0, 7);
    assert.ok(curve.paidBasis !== null);
    const paidPoint = curve.points.find((p) => p.month === firstPaidMonth);
    assert.ok(paidPoint && paidPoint.paidPct !== null && paidPoint.paidPct > 0, `paid % at ${firstPaidMonth}: ${JSON.stringify(paidPoint)}`);
    const gross = payments.reduce((s, p) => s + Number(p.grossAmountNgn), 0);
    assert.equal(c.money!.paidGrossNgn, Math.round(gross * 100) / 100);
    assert.equal(Math.round(c.money!.byQuarter.reduce((s, q) => s + q.paidGrossNgn, 0) * 100) / 100, c.money!.paidGrossNgn);
    assert.equal(c.money!.paidNetNgn, Number(project.disbursedToDateNgn));
    const basis = curve.paidBasis === 'CONTRACT_SUM' ? Number(project.contractSumNgn) : Number(project.totalBudgetNgn);
    assert.equal(c.money!.remainingNgn, Math.round(Math.max(0, basis - gross) * 100) / 100);

    // Units: sorted by site number, then facility name, then unit code; work phases with unit counts.
    const units = await prisma.facilityUnit.count({ where: { projectId: ids['PRG-105'] } });
    assert.equal(c.units!.length, units);
    for (let i = 1; i < c.units!.length; i++) {
      const a = c.units![i - 1];
      const b = c.units![i];
      const sa = a.siteNumber ?? Infinity;
      const sb = b.siteNumber ?? Infinity;
      assert.ok(sa < sb || (sa === sb && a.facilityName.localeCompare(b.facilityName) <= 0), `unit order at ${b.unitCode}`);
    }
    const sprints = await prisma.projectSprint.count({ where: { projectId: ids['PRG-105'] } });
    assert.equal(c.workPhases!.length, sprints);
    assert.ok(c.workPhases!.some((w) => w.unitCount > 0));
  });

  it('replays a visit that raised unit progress into its month', async () => {
    const before = await charts(ADMIN, 'PRG-105');
    const currentMonth = before.today.slice(0, 7);
    const past = before.progressCurve!.points.filter((p) => p.month < currentMonth);
    assert.ok(past.length > 0, 'PRG-105 has months before this one');
    const target = past[0];
    const unit = before.units!.find((u) => u.amountNgn > 0)!;
    await audit.recordAuditEvent(prisma, {
      projectId: ids['PRG-105'],
      actorType: 'SYSTEM',
      actorId: 'visits',
      actorDisplayName: 'System (visits)',
      action: 'VISIT_UPDATED',
      summaryText: 'Test: a routine monitoring visit raised the progress of 1 facility unit(s).',
      payload: { progressIncrease: { asOf: target.date, units: [{ unitId: unit.unitId, from: null, to: 100 }] } },
    });
    const after = await charts(ADMIN, 'PRG-105');
    const point = after.progressCurve!.points.find((p) => p.month === target.month)!;
    assert.ok(point.actualPct !== null && point.actualPct > (target.actualPct ?? 0), JSON.stringify({ target, point }));
    // The current point still equals the headline.
    assert.equal(after.progressCurve!.points.find((p) => p.month === currentMonth)!.actualPct, after.progressCurve!.currentPct);
  });

  it('M&E officer (no payments permission): money and paid % are null', async () => {
    const c = await charts(ME, 'PRG-105');
    assert.equal(c.money, null);
    assert.equal(c.progressCurve!.paidBasis, null);
    assert.ok(c.progressCurve!.points.every((p) => p.paidPct === null));
    assert.ok(c.units && c.workPhases && c.visitsByMonth && c.findingsBySeverity);
  });

  it('a tenant viewer without section permissions gets every section null', async () => {
    const c = await charts(VIEWER, 'PRG-105');
    assert.equal(c.progressCurve, null);
    assert.equal(c.units, null);
    assert.equal(c.workPhases, null);
    assert.equal(c.visitsByMonth, null);
    assert.equal(c.findingsBySeverity, null);
    assert.equal(c.money, null);
  });
});
