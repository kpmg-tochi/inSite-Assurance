/**
 * Client demo updates G: payments by period (project page) and across the programme
 * (`/api/v1/payments`, `/summary`, `/export.xlsx`).
 *
 * Fixtures (programme tenant, set up here): PRG-105 (UBEC HQ, state set to KN) and PRG-221 (Lagos
 * SUBEB, state set to LA) get payments recorded through the API: three on PRG-105 (March, August, and one voided
 * in August) and one on PRG-221 (August). The August one on PRG-105 is given an exception.
 * lagos.admin@ (SUBEB Administrator: payments:view, organisation tree) sees Lagos SUBEB's projects
 * only; lagos.me@ has no payments:view.
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
const AUGUST = { from: '2026-08-01', to: '2026-08-31' };

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

interface Row {
  id: string;
  projectId: string;
  reference: string;
  paidOn: string;
  kind: string;
  grossAmountNgn: number;
  retentionHeldNgn: number;
  netAmountNgn: number;
  exceptions: string[];
  voided: boolean;
  stateCode: string | null;
  zone: string | null;
  stateName: string | null;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  for (const code of ['PRG-105', 'PRG-221']) {
    ids[code] = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } })).id;
  }
  // State codes as the tests need them (whatever the seed wrote).
  await prisma.project.update({ where: { id: ids['PRG-105'] }, data: { stateCode: 'KN' } });
  await prisma.project.update({ where: { id: ids['PRG-221'] }, data: { stateCode: 'LA' } });

  await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-03-10', grossAmountNgn: 1_000_000, reference: 'DEMO-PAY-MARCH' });
  const aug = await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-08-15', grossAmountNgn: 3_000_000, reference: 'DEMO-PAY-AUG' });
  const wrong = await record(ids['PRG-105'], { kind: 'INTERIM', paidOn: '2026-08-25', grossAmountNgn: 5_000_000, reference: 'DEMO-PAY-VOID' });
  const voided = await request(app)
    .post(`/api/v1/projects/${ids['PRG-105']}/payments/${wrong.id}/void`)
    .set(await web(ADMIN))
    .send({ reason: 'Entered twice' });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  await record(ids['PRG-221'], { kind: 'INTERIM', paidOn: '2026-08-20', grossAmountNgn: 2_000_000, reference: 'DEMO-PAY-LAGOS' });
  // An exception on the August payment (the rule that raises one is tested elsewhere).
  await prisma.projectPayment.update({ where: { id: aug.id }, data: { exceptionsJson: ['PAID_ABOVE_CONTRACT_SUM'] } });
  ids.aug = aug.id;
  ids.void = wrong.id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('G.1 project payments: period filter on the server', () => {
  it('without a query: every payment and the totals to date, as before', async () => {
    const res = await get(`/api/v1/projects/${ids['PRG-105']}/payments`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const count = await prisma.projectPayment.count({ where: { projectId: ids['PRG-105'] } });
    assert.equal(res.body.data.payments.length, count);
    assert.equal(res.body.data.fiscalYearStartMonth, 1);
  });

  it('from/to returns only the payments in range; totals stay the project’s to date', async () => {
    const all = (await get(`/api/v1/projects/${ids['PRG-105']}/payments`)).body.data;
    const res = await get(`/api/v1/projects/${ids['PRG-105']}/payments`, AUGUST);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body.data;
    assert.deepEqual(s.payments.map((p: Row) => p.reference).sort(), ['DEMO-PAY-AUG', 'DEMO-PAY-VOID']);
    assert.ok(s.payments.every((p: Row) => p.paidOn >= AUGUST.from && p.paidOn <= AUGUST.to));
    for (const k of ['paidGrossNgn', 'paidNetNgn', 'retentionHeldNgn', 'retentionBalanceNgn', 'exceptionCount', 'contractSumNgn']) {
      assert.equal(s[k], all[k], k);
    }
    const others = await get(`/api/v1/projects/${ids['PRG-105']}/payments`, { ...AUGUST, exceptionsOnly: 'true', search: 'demo-pay' });
    assert.deepEqual(others.body.data.payments.map((p: Row) => p.reference), ['DEMO-PAY-AUG']);
    assert.equal((await get(`/api/v1/projects/${ids['PRG-105']}/payments`, { from: '2026-09-01', to: '2026-08-01' })).status, 400);
    assert.equal((await get(`/api/v1/projects/${ids['PRG-105']}/payments`, { from: '1 August' })).status, 400);
  });

  it('the project export takes the period too', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${ids['PRG-105']}/payments/export.xlsx`)
      .query({ from: '2026-03-01', to: '2026-03-31' })
      .set(await web(ADMIN))
      .buffer(true)
      .parse(binary);
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const refs = dataColumn(wb.getWorksheet('Payments')!, 'Reference');
    assert.deepEqual(refs, ['DEMO-PAY-MARCH']);
  });
});

function binary(r: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** The values of one column under the header row (row 3), totals row left out. */
function dataColumn(ws: ExcelJS.Worksheet, header: string): unknown[] {
  let col = 0;
  ws.getRow(3).eachCell((c, i) => {
    if (String(c.value) === header) col = i;
  });
  assert.ok(col > 0, `column ${header}`);
  const out: unknown[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const first = String(ws.getCell(r, 1).value ?? '');
    if (first.startsWith('Total')) continue;
    out.push(ws.getCell(r, col).value);
  }
  return out;
}

describe('G.2 portfolio payments: list', () => {
  it('lists the period’s payments newest first, voided only on request, paged', async () => {
    const res = await get('/api/v1/payments', { ...AUGUST, search: 'DEMO-PAY' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = res.body.data;
    assert.equal(list.total, 2);
    assert.deepEqual(list.rows.map((r: Row) => r.reference), ['DEMO-PAY-LAGOS', 'DEMO-PAY-AUG']);
    const lagos = list.rows[0] as Row;
    assert.equal(lagos.stateCode, 'LA');
    assert.equal(lagos.zone, 'SW');
    assert.equal(lagos.stateName, 'Lagos');

    const withVoid = (await get('/api/v1/payments', { ...AUGUST, search: 'DEMO-PAY', includeVoided: 'true' })).body.data;
    assert.equal(withVoid.total, 3);
    assert.equal(withVoid.rows.find((r: Row) => r.reference === 'DEMO-PAY-VOID').voided, true);

    const paged = (await get('/api/v1/payments', { ...AUGUST, search: 'DEMO-PAY', pageSize: '1', page: '2' })).body.data;
    assert.equal(paged.total, 2);
    assert.deepEqual(paged.rows.map((r: Row) => r.reference), ['DEMO-PAY-AUG']);

    const all = (await get('/api/v1/payments', { search: 'DEMO-PAY' })).body.data;
    assert.equal(all.total, 3, 'all time: March, August and Lagos');
  });

  it('a SUBEB administrator sees only its own projects’ payments', async () => {
    const res = await get('/api/v1/payments', { search: 'DEMO-PAY' }, LAGOS_ADMIN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.rows.map((r: Row) => r.reference), ['DEMO-PAY-LAGOS']);
    const everything = (await get('/api/v1/payments', { pageSize: '200' }, LAGOS_ADMIN)).body.data.rows as Row[];
    const lagosAdmin = await prisma.user.findFirstOrThrow({ where: { email: LAGOS_ADMIN } });
    const own = new Set(
      (await prisma.project.findMany({ where: { owningOrganizationId: lagosAdmin.organizationId }, select: { id: true } })).map((p) => p.id)
    );
    assert.ok(everything.length > 0);
    assert.ok(everything.every((r) => own.has(r.projectId)));
    assert.ok(!everything.some((r) => r.projectId === ids['PRG-105']));
  });

  it('filters by zone and state on the project’s state code, and by exceptions', async () => {
    const sw = (await get('/api/v1/payments', { zone: 'SW', search: 'DEMO-PAY' })).body.data.rows as Row[];
    assert.deepEqual(sw.map((r) => r.reference), ['DEMO-PAY-LAGOS']);
    const kano = (await get('/api/v1/payments', { stateCode: 'KN' })).body.data.rows as Row[];
    assert.ok(kano.length >= 2);
    assert.ok(kano.every((r) => r.stateCode === 'KN'));
    assert.ok(kano.some((r) => r.projectId === ids['PRG-105']));
    assert.equal((await get('/api/v1/payments', { zone: 'NE' })).body.data.total, 0);
    assert.equal((await get('/api/v1/payments', { zone: 'XX' })).status, 400);

    const exceptions = (await get('/api/v1/payments', { exceptionsOnly: 'true', pageSize: '200' })).body.data.rows as Row[];
    assert.ok(exceptions.some((r) => r.id === ids.aug));
    assert.ok(exceptions.every((r) => r.exceptions.length > 0 && !r.voided));
  });
});

describe('G.2 portfolio payments: summary and export', () => {
  it('sums the period without voided payments; money against progress is to date over the filtered projects', async () => {
    const res = await get('/api/v1/payments/summary', { ...AUGUST, search: 'DEMO-PAY' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body.data;
    const rows = (await get('/api/v1/payments', { ...AUGUST, search: 'DEMO-PAY' })).body.data.rows as Row[];
    assert.equal(s.from, AUGUST.from);
    assert.equal(s.to, AUGUST.to);
    assert.equal(s.fiscalYearStartMonth, 1);
    assert.match(s.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(s.grossPaidNgn, 5_000_000, 'the voided ₦5m is not counted');
    assert.equal(s.paymentCount, 2);
    assert.equal(s.projectCount, 2);
    assert.equal(s.exceptionCount, 1);
    const round = (n: number) => Math.round(n * 100) / 100;
    assert.equal(s.retentionHeldNgn, round(rows.reduce((t, r) => t + r.retentionHeldNgn, 0)));
    assert.equal(s.netPaidNgn, round(rows.reduce((t, r) => t + r.netAmountNgn, 0)));
    assert.equal(s.retentionReleasedNgn, 0);

    const kano = (await get('/api/v1/payments/summary', { stateCode: 'KN' })).body.data;
    const kanoProjects = await prisma.project.findMany({
      where: { tenant: { slug: 'programme-authority' }, stateCode: 'KN', status: { in: ['ACTIVE', 'ARCHIVED'] } },
    });
    assert.ok(kanoProjects.some((p) => p.id === ids['PRG-105']));
    const m = kano.moneyVsProgress;
    assert.equal(m.projectCount, kanoProjects.length);
    assert.equal(m.paidToDateNgn, round(kanoProjects.reduce((t, p) => t + Number(p.disbursedToDateNgn), 0)));
    const withSum = kanoProjects.filter((p) => p.contractSumNgn !== null && Number(p.contractSumNgn) > 0);
    const sum = withSum.reduce((t, p) => t + Number(p.contractSumNgn), 0);
    assert.equal(m.contractSumNgn, round(sum));
    if (sum > 0) {
      const weighted = withSum.reduce((t, p) => t + Number(p.contractSumNgn) * Number(p.certifiedProgressPct), 0) / sum;
      assert.equal(m.progressPct, Math.round(weighted * 10) / 10);
      assert.equal(m.paidPct, Math.round((m.paidToDateNgn / sum) * 1000) / 10);
    } else {
      assert.equal(m.paidPct, null);
    }

    const lagos = (await get('/api/v1/payments/summary', { ...AUGUST, search: 'DEMO-PAY' }, LAGOS_ADMIN)).body.data;
    assert.equal(lagos.grossPaidNgn, 2_000_000);
    assert.equal(lagos.paymentCount, 1);
    assert.equal((await get('/api/v1/payments/summary', { from: '2026-09-01', to: '2026-08-01' })).status, 400);
  });

  it('exports Summary and Payments as .xlsx with the screen’s filters', async () => {
    const res = await request(app)
      .get('/api/v1/payments/export.xlsx')
      .query({ ...AUGUST, search: 'DEMO-PAY', includeVoided: 'true' })
      .set(await web(ADMIN))
      .buffer(true)
      .parse(binary);
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /spreadsheetml\.sheet/);
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(String(res.headers['content-disposition']))?.[1];
    assert.equal(decodeURIComponent(encoded ?? ''), 'UBEC payments 2026-08-01–2026-08-31.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    assert.ok(wb.getWorksheet('Summary'));
    const ws = wb.getWorksheet('Payments')!;
    assert.deepEqual(dataColumn(ws, 'Reference'), ['DEMO-PAY-VOID', 'DEMO-PAY-LAGOS', 'DEMO-PAY-AUG']);
    const totalsRow = ws.rowCount;
    assert.equal(ws.getCell(totalsRow, 1).value, 'Total (voided excluded)');
    let grossCol = 0;
    ws.getRow(3).eachCell((c, i) => {
      if (c.value === 'Gross amount') grossCol = i;
    });
    assert.equal(ws.getCell(totalsRow, grossCol).value, 5_000_000);
  });

  it('refuses without payments:view', async () => {
    assert.equal((await get('/api/v1/payments', {}, LAGOS_ME)).status, 403);
    assert.equal((await get('/api/v1/payments/summary', {}, LAGOS_ME)).status, 403);
    assert.equal((await get('/api/v1/payments/export.xlsx', {}, LAGOS_ME)).status, 403);
    assert.equal((await request(app).get('/api/v1/payments')).status, 401);
  });
});
