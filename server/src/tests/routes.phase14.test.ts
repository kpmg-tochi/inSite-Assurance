/**
 * Phase 14 route tests, after redesign R4f and R5f: reporting streams, obligations and the cadence
 * overview went in R4f (visits replace them); site inspections, checklist templates, the mobile
 * inspection pack and inspection findings went in R5f (routes.r5f checks those routes are gone).
 * What remains of Phase 14 is the supervision workload, now dated by the supervisor's last visit.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 14', () => {
  describe('redesign R4f', () => {
    it('reporting streams, obligations and the cadence overview are gone', async () => {
      const monitor = await web('monitor@insite.ng');
      const edo = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'EDO-410' } });
      const base = `/api/v1/projects/${edo.id}`;
      for (const [method, url] of [
        ['get', `${base}/reporting-streams`],
        ['put', `${base}/reporting-streams`],
        ['get', `${base}/reporting-obligations`],
        ['get', `${base}/cadence`],
        ['get', `${base}/inspections/overview`],
      ] as const) {
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(monitor).send({ streams: [] });
        assert.equal(res.status, 404, `${method} ${url} answered ${res.status}`);
      }
      const names = jobs.registeredJobs().map((j) => j.name);
      for (const gone of ['reporting-obligations', 'overdue-reports']) assert.ok(!names.includes(gone), gone);
    });
  });

  describe('supervision workload', () => {
    it('reports active projects and spread, warns above the type thresholds (seeded supervisor)', async () => {
      const res = await request(app).get('/api/v1/supervision').set(await web('programme.admin@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const rows = res.body.data as Array<{
        fullName: string;
        activeProjectCount: number;
        overSiteLimit: boolean;
        overSpread: boolean;
        spreadKm: number;
        projects: Array<{ codePrefix: string; lastVisitDate: string | null }>;
      }>;
      const officer = rows.find((s) => s.fullName.startsWith('Ngozi Eze'));
      assert.ok(officer, 'the seeded M&E officer is a supervisor');
      // PRG-102, PRG-211, PRG-221 and (Phase 15) PRG-103 in its liability period; closed PRG-241 does not count.
      assert.equal(officer.activeProjectCount, 4);
      assert.equal(officer.overSiteLimit, true);
      assert.equal(officer.overSpread, true);
      assert.ok(officer.spreadKm > 500);
      assert.ok(officer.projects.every((p) => p.lastVisitDate === null), 'Ngozi has submitted no visit');

      // R5f: the last visit is the supervisor's last submitted visit (seedR4: resident.supervisor@ on PRG-211).
      const resident = rows.find((s) => s.projects.some((p) => p.codePrefix === 'PRG-211' && p.lastVisitDate !== null));
      assert.ok(resident, 'the seeded visit officer shows a last visit on PRG-211');
    });
  });
});
