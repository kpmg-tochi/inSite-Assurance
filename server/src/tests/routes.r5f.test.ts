/**
 * Redesign R5f route tests: the old field app's server side is gone (workday reports, report
 * queries, WBS chat, the mobile BoQ read, Phase 14 site inspections, checklist templates, the
 * inspection field pack, the /inspection-findings alias and the notification resolve), and line
 * progress without a unit source keeps its stored value (owner decision: legacy LKK-402 and ABJ-108).
 *
 * LKK-402 lines (seedDatabase): 01.02.1 90%, 02.01.1 45%, 02.01.2 35%, 03.01.1 10%, 04.09.1 0%; their
 * units (seedR2) have no visit progress.
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
const ids = { lkk: '', line: '', session: '' };
let monitor: Record<string, string> = {};

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.lkk = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } })).id;
  ids.line = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk }, orderBy: { wbsCode: 'asc' } })).id;
  ids.session = (await createFieldSession(prisma, { projectId: ids.lkk, roleCode: 'INDEPENDENT_RESIDENT', name: 'R5f Officer' })).sessionId;
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'monitor@insite.ng', password: 'Password123!' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  monitor = { Authorization: `Bearer ${login.body.data.accessToken}` };
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Redesign R5f', () => {
  it('the old app routes answer 404 for web users', async () => {
    const base = `/api/v1/projects/${ids.lkk}`;
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ['get', `${base}/workday-reports`],
      ['get', `${base}/workday-reports/${id}`],
      ['post', `${base}/workday-reports/${id}/review`],
      ['post', `${base}/workday-reports/${id}/queries`],
      ['post', `${base}/report-queries/${id}/resolve`],
      ['get', `${base}/boq`],
      ['get', `${base}/boq/${ids.line}/chat`],
      ['post', `${base}/boq/${ids.line}/chat`],
      ['get', `${base}/inspections`],
      ['get', `${base}/inspections/template?visitType=ROUTINE`],
      ['post', `${base}/inspections/${id}/review`],
      ['get', `${base}/inspection-findings`],
      ['post', `${base}/inspection-findings/${id}/resolve`],
      ['get', '/api/v1/inspection-templates'],
    ] as const) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(monitor).send({});
      assert.equal(res.status, 404, `${method} ${url} answered ${res.status}`);
    }
    // What stays: findings, legacy BoQ revisions, supervision.
    assert.equal((await request(app).get(`${base}/findings`).set(monitor)).status, 200);
    assert.equal((await request(app).get(`${base}/boq/revisions`).set(monitor)).status, 200);
  });

  it('the old app routes answer 404 for field sessions', async () => {
    const auth = await fieldAuth(prisma, ids.session);
    const base = `/api/v1/projects/${ids.lkk}`;
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ['post', `${base}/workday-reports`],
      ['post', `${base}/workday-reports/suggest`],
      ['post', `${base}/workday-reports/${id}/revalidate`],
      ['get', `${base}/boq`],
      ['get', `${base}/boq/${ids.line}/chat`],
      ['get', `${base}/inspections/field-pack`],
      ['post', `${base}/inspections`],
      ['post', `${base}/inspection-findings/${id}/resolve`],
      ['post', `${base}/findings/${id}/resolve`],
      ['post', `${base}/notifications/${id}/resolve`],
    ] as const) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(auth).send({});
      assert.ok([403, 404].includes(res.status), `${method} ${url} answered ${res.status}`);
      if (!url.includes('/findings/')) assert.equal(res.status, 404, `${method} ${url} answered ${res.status}`);
    }
  });

  it('a line without unit progress keeps its stored progress when progress is refreshed; unit progress still wins', async () => {
    const { refreshProjectProgress } = await import('../modules/progress/progress.service');
    const lines = async () =>
      new Map(
        (await prisma.boqItem.findMany({ where: { projectId: ids.lkk }, select: { wbsCode: true, cumulativeCertifiedPct: true } })).map((l) => [
          l.wbsCode,
          Number(l.cumulativeCertifiedPct),
        ])
      );
    const before = await lines();
    assert.equal(before.get('01.02.1'), 90);
    assert.equal(before.get('02.01.1'), 45);
    const pct = await prisma.$transaction((tx) => refreshProjectProgress(tx, ids.lkk));
    assert.deepEqual(await lines(), before, 'no report source any more: stored values stay');
    assert.ok(pct > 0, `project progress ${pct}`);

    // A unit observed by an accepted visit still sets its lines.
    const earthworks = await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk, wbsCode: '01.02.1' }, select: { facilityUnitId: true } });
    assert.ok(earthworks.facilityUnitId);
    await prisma.facilityUnit.update({ where: { id: earthworks.facilityUnitId! }, data: { progressPct: 100 } });
    await prisma.$transaction((tx) => refreshProjectProgress(tx, ids.lkk));
    const after = await lines();
    assert.equal(after.get('01.02.1'), 100);
    assert.equal(after.get('02.01.1'), 45);
    assert.equal(after.get('03.01.1'), 10);
  });
});
