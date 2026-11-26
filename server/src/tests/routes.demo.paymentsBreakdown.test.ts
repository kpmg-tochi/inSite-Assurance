/**
 * Client demo updates wave 4 (G.1 grouping, G.2 Breakdown): `GET /api/v1/payments/breakdown?by=…`
 * and the Breakdown sheet of `/api/v1/payments/export.xlsx`.
 *
 * Fixtures (programme tenant, set up here): PRG-105 (UBEC HQ, State KN, two sites in the Kano LGAs
 * Ajingi and Albasu) and PRG-221 (Lagos SUBEB, State LA, LGA Agege, no sites). Payments recorded
 * through the API, references "BRK-…": PRG-105 March ₦1m, August ₦3m (with an exception), August
 * ₦5m voided; PRG-221 May ₦4m, August ₦2m. lagos.admin@ (SUBEB Administrator, organisation tree)
 * sees Lagos SUBEB's projects only; lagos.me@ has no payments:view.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const LAGOS_ADMIN = 'lagos.admin@ubec.test';
const LAGOS_ME = 'lagos.me@ubec.test';
const ids: Record<string, string> = {};
const OURS = { search: 'BRK-' };
const round = (n: number) => Math.round(n * 100) / 100;

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

async function get(url: string, query: Record<string, string> = {}, email = ADMIN) {
  return request(app).get(url).query(query).set(await web(email));
}

async function record(projectId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/projects/${projectId}/payments`).set(await web(ADMIN)).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string };
}

interface BreakdownRow {
  key: string;
  label: string;
  context: string | null;
  sharedAcrossGroups: boolean;
  grossPaidNgn: number;
  retentionHeldNgn: number;
  retentionReleasedNgn: number;
  netPaidNgn: number;
  paymentCount: number;
  exceptionCount: number;
  projectCount: number;
}
interface Breakdown {
  by: string;
  from: string | null;
  to: string | null;
  rows: BreakdownRow[];
  totals: Omit<BreakdownRow, 'key' | 'label' | 'context' | 'sharedAcrossGroups'>;
  hasSharedGroups: boolean;
}

async function breakdown(query: Record<string, string>, email = ADMIN): Promise<Breakdown> {
  const res = await get('/api/v1/payments/breakdown', query, email);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as Breakdown;
}

const TOTAL_KEYS = ['grossPaidNgn', 'retentionHeldNgn', 'retentionReleasedNgn', 'netPaidNgn', 'paymentCount', 'exceptionCount', 'projectCount'] as const;

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  for (const code of ['PRG-105', 'PRG-221']) {
    ids[code] = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } })).id;
  }
  await prisma.project.update({ where: { id: ids['PRG-105'] }, data: { stateCode: 'KN', lgaCode: 'KN-AJINGI' } });
  await prisma.project.update({ where: { id: ids['PRG-221'] }, data: { stateCode: 'LA', lgaCode: 'LA-AGEGE' } });
  // PRG-105 spread over two LGAs (sites written directly: the sites section is tested elsewhere).
  await prisma.projectSite.deleteMany({ where: { projectId: ids['PRG-105'] } });
  await prisma.projectSite.deleteMany({ where: { projectId: ids['PRG-221'] } });
  await prisma.projectSite.createMany({
    data: [
      { projectId: ids['PRG-105'], siteNumber: 1, schoolName: 'LGEA Primary School, Ajingi', schoolLevel: 'PRIMARY', lgaCode: 'KN-AJINGI', latitude: 11.97, longitude: 9.04 },
      { projectId: ids['PRG-105'], siteNumber: 2, schoolName: 'LGEA Primary School, Albasu', schoolLevel: 'PRIMARY', lgaCode: 'KN-ALBASU', latitude: 11.67, longitude: 9.14 },
    ],
  });

  await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-03-10', grossAmountNgn: 1_000_000, reference: 'BRK-KN-MAR' });
  const aug = await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-08-15', grossAmountNgn: 3_000_000, reference: 'BRK-KN-AUG' });
  const wrong = await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-08-25', grossAmountNgn: 5_000_000, reference: 'BRK-KN-VOID' });
  const voided = await request(app)
    .post(`/api/v1/projects/${ids['PRG-105']}/payments/${wrong.id}/void`)
    .set(await web(ADMIN))
    .send({ reason: 'Entered twice' });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  await record(ids['PRG-221'], { kind: 'INTERIM', paidOn: '2026-05-12', grossAmountNgn: 4_000_000, reference: 'BRK-LA-MAY' });
  await record(ids['PRG-221'], { kind: 'INTERIM', paidOn: '2026-08-20', grossAmountNgn: 2_000_000, reference: 'BRK-LA-AUG' });
  await prisma.projectPayment.update({ where: { id: aug.id }, data: { exceptionsJson: ['PAID_ABOVE_CONTRACT_SUM'] } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('wave 4: payments breakdown', () => {
  it('refuses without payments:view and validates the grouping', async () => {
    assert.equal((await get('/api/v1/payments/breakdown', {}, LAGOS_ME)).status, 403);
    assert.equal((await request(app).get('/api/v1/payments/breakdown')).status, 401);
    assert.equal((await get('/api/v1/payments/breakdown', { by: 'site' })).status, 400);
    assert.equal((await get('/api/v1/payments/breakdown', { from: '2026-09-01', to: '2026-08-01' })).status, 400);
  });

  it('by State (the default): totals equal the summary’s for the same filters, voided not counted', async () => {
    const queries: Array<Record<string, string>> = [{}, OURS, { from: '2026-08-01', to: '2026-08-31' }, { zone: 'NW' }];
    for (const query of queries) {
      const b = await breakdown(query);
      assert.equal(b.by, 'state');
      const s = (await get('/api/v1/payments/summary', query)).body.data;
      for (const k of TOTAL_KEYS) assert.equal(b.totals[k], s[k], `${JSON.stringify(query)} ${k}`);
      // Each payment in exactly one State group: the rows add up to the totals.
      assert.equal(b.rows.reduce((t, r) => t + r.paymentCount, 0), b.totals.paymentCount);
      assert.equal(round(b.rows.reduce((t, r) => t + r.netPaidNgn, 0)), b.totals.netPaidNgn);
    }
    const ours = await breakdown(OURS);
    const kano = ours.rows.find((r) => r.key === 'KN')!;
    const lagos = ours.rows.find((r) => r.key === 'LA')!;
    assert.equal(kano.label, 'Kano');
    assert.equal(kano.context, 'North West');
    assert.equal(kano.grossPaidNgn, 4_000_000, 'the voided ₦5m is not counted');
    assert.equal(kano.paymentCount, 2);
    assert.equal(kano.exceptionCount, 1);
    assert.equal(kano.projectCount, 1);
    assert.equal(lagos.grossPaidNgn, 6_000_000);
    assert.equal(lagos.context, 'South West');
    assert.deepEqual(ours.rows.map((r) => r.key), ['LA', 'KN'], 'largest net paid first');
  });

  it('by month and quarter: keys in date order, the fiscal quarter labels', async () => {
    const months = await breakdown({ ...OURS, by: 'month' });
    assert.deepEqual(months.rows.map((r) => r.key), ['2026-03', '2026-05', '2026-08']);
    assert.deepEqual(months.rows.map((r) => r.label), ['Mar 2026', 'May 2026', 'Aug 2026']);
    assert.deepEqual(months.rows.map((r) => r.paymentCount), [1, 1, 2]);
    const quarters = await breakdown({ ...OURS, by: 'quarter' });
    assert.deepEqual(quarters.rows.map((r) => r.key), ['2026-Q1', '2026-Q2', '2026-Q3']);
    assert.equal(quarters.rows[2].label, 'Q3 FY2026');
    assert.equal(quarters.rows[2].grossPaidNgn, 5_000_000);
  });

  it('the period applies', async () => {
    const b = await breakdown({ ...OURS, by: 'month', from: '2026-04-01', to: '2026-06-30' });
    assert.equal(b.from, '2026-04-01');
    assert.equal(b.to, '2026-06-30');
    assert.deepEqual(b.rows.map((r) => r.key), ['2026-05']);
    assert.equal(b.totals.grossPaidNgn, 4_000_000);
  });

  it('a SUBEB administrator sees only its own projects', async () => {
    const b = await breakdown({ ...OURS, by: 'project' }, LAGOS_ADMIN);
    assert.deepEqual(b.rows.map((r) => r.key), [ids['PRG-221']]);
    assert.equal(b.totals.grossPaidNgn, 6_000_000);
    const everything = await breakdown({ by: 'project' }, LAGOS_ADMIN);
    const lagosAdmin = await prisma.user.findFirstOrThrow({ where: { email: LAGOS_ADMIN } });
    const own = new Set(
      (await prisma.project.findMany({ where: { owningOrganizationId: lagosAdmin.organizationId }, select: { id: true } })).map((p) => p.id)
    );
    assert.ok(everything.rows.every((r) => own.has(r.key)));
  });

  it('by LGA: a project with sites in two LGAs is counted under each and marked; the totals count it once', async () => {
    const b = await breakdown({ ...OURS, by: 'lga' });
    const ajingi = b.rows.find((r) => r.key === 'KN-AJINGI')!;
    const albasu = b.rows.find((r) => r.key === 'KN-ALBASU')!;
    const agege = b.rows.find((r) => r.key === 'LA-AGEGE')!;
    assert.ok(ajingi && albasu && agege);
    assert.equal(ajingi.label, 'Ajingi');
    assert.equal(ajingi.context, 'Kano');
    assert.equal(ajingi.sharedAcrossGroups, true);
    assert.equal(albasu.sharedAcrossGroups, true);
    assert.equal(agege.sharedAcrossGroups, false);
    assert.equal(ajingi.grossPaidNgn, 4_000_000);
    assert.equal(albasu.grossPaidNgn, 4_000_000);
    assert.equal(b.hasSharedGroups, true);
    assert.equal(b.totals.grossPaidNgn, 10_000_000);
    assert.equal(b.totals.paymentCount, 4);

    // Drill down: the LGA filter matches a project with a site there.
    const albasuOnly = await breakdown({ ...OURS, lgaCode: 'KN-ALBASU', by: 'project' });
    assert.deepEqual(albasuOnly.rows.map((r) => r.key), [ids['PRG-105']]);
    assert.equal(albasuOnly.totals.grossPaidNgn, 4_000_000);
  });

  it('by contractor and zone', async () => {
    const zones = await breakdown({ ...OURS, by: 'zone' });
    assert.deepEqual(zones.rows.map((r) => r.key).sort(), ['NW', 'SW']);
    const contractors = await breakdown({ ...OURS, by: 'contractor' });
    assert.equal(round(contractors.rows.reduce((t, r) => t + r.grossPaidNgn, 0)), contractors.totals.grossPaidNgn);
  });

  it('the export has a Breakdown sheet between Summary and Payments, grouped by `by`, with a totals row', async () => {
    for (const by of ['state', 'lga'] as const) {
      const res = await request(app)
        .get('/api/v1/payments/export.xlsx')
        .query({ ...OURS, ...(by === 'state' ? {} : { by }) })
        .set(await web(ADMIN))
        .buffer(true)
        .parse(binary);
      assert.equal(res.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      assert.deepEqual(
        wb.worksheets.map((w) => w.name),
        ['Summary', 'Breakdown', 'Payments']
      );
      const ws = wb.getWorksheet('Breakdown')!;
      const headers: string[] = [];
      ws.getRow(3).eachCell((c) => headers.push(String(c.value)));
      assert.equal(headers[0], by === 'state' ? 'State' : 'LGA');
      assert.equal(headers[1], by === 'state' ? 'Zone' : 'State');
      const totalsRow = ws.rowCount;
      assert.equal(ws.getCell(totalsRow, 1).value, 'Total (each payment once)');
      const col = (h: string) => headers.indexOf(h) + 1;
      assert.equal(ws.getCell(totalsRow, col('Gross paid')).value, 10_000_000);
      assert.equal(ws.getCell(totalsRow, col('Payments')).value, 4);
      assert.equal(ws.getCell(totalsRow, col('With exceptions')).value, 1);
      const labels: string[] = [];
      for (let r = 4; r < totalsRow; r++) labels.push(String(ws.getCell(r, 1).value));
      if (by === 'state') {
        assert.deepEqual(labels, ['Lagos', 'Kano']);
      } else {
        assert.ok(labels.includes('Ajingi *') && labels.includes('Albasu *') && labels.includes('Agege'), labels.join(','));
        assert.match(String(ws.getCell(2, 1).value), /counted in full under each/);
      }
    }
    assert.equal((await get('/api/v1/payments/export.xlsx', { by: 'site' })).status, 400);
  });
});

function binary(r: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
}
