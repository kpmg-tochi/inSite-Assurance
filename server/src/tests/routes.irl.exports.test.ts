/**
 * UBEC IRL route tests: Excel exports of the visits (project and planner), findings, payments and
 * KPI screens. Each export returns .xlsx with the screen's rows (compared with the screen's own
 * endpoint), applies the screen's filters, refuses without the screen's permission and respects
 * project visibility.
 *
 * Seeded fixtures (programme tenant): PRG-211 (accepted and late visits, an escalated major finding),
 * PRG-105 (live, visits published, one interim payment), lagos.me@ (SUBEB M&E: assigned to PRG-221,
 * -241, -242 only; visits:view and findings:manage, no payments:view).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import request from 'supertest';
import { addDays, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const LAGOS_ME = 'lagos.me@ubec.test';
const INDEPENDENT_ME = 'independent.me@ubec.test';
const NO_EXPORTS = 'irl.exports.viewer@ubec.test';
const ids: Record<string, string> = {};
const zones: Record<string, string> = {};

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

interface Download {
  status: number;
  disposition: string;
  wb: ExcelJS.Workbook | null;
  body: unknown;
}

async function download(url: string, email = ADMIN, query: Record<string, string> = {}): Promise<Download> {
  const res = await request(app)
    .get(url)
    .query(query)
    .set(await web(email))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) return { status: res.status, disposition: '', wb: null, body: JSON.parse(String(res.body)) };
  assert.match(String(res.headers['content-type']), /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return { status: 200, disposition: String(res.headers['content-disposition']), wb, body: null };
}

const HEADER_ROW = 3;

function headersOf(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (c, col) => (out[col - 1] = String(c.value)));
  return out;
}

/** Rows under the header as { header: value }, the totals or "no rows" line included. */
function rowsOf(ws: ExcelJS.Worksheet): Array<Record<string, unknown>> {
  const headers = headersOf(ws);
  const out: Array<Record<string, unknown>> = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const v = ws.getCell(r, i + 1).value;
      row[h] = v === undefined ? null : v;
    });
    out.push(row);
  }
  return out;
}

const sheet = (d: Download, name: string) => {
  const ws = d.wb!.getWorksheet(name);
  assert.ok(ws, `sheet ${name}`);
  return ws!;
};

const visitsUrl = (projectId: string) => `/api/v1/projects/${projectId}/visits/export.xlsx`;
const findingsUrl = (projectId: string) => `/api/v1/projects/${projectId}/findings/export.xlsx`;
const paymentsUrl = (projectId: string) => `/api/v1/projects/${projectId}/payments/export.xlsx`;

const VISIT_HEADERS = [
  'Planned date',
  'Original date',
  'Visit kind',
  'Work phase',
  'Status',
  'Confirmation',
  'Lead officer',
  'Other officers',
  'Checked in at',
  'Check-in location',
  'Submission due',
  'Submitted at',
  'Submitted late',
  'Review',
  'Reviewed at',
  'Reviewed by',
  'Outcome',
  'Findings raised',
];

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  for (const code of ['PRG-105', 'PRG-211', 'PRG-221']) {
    const p = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } });
    ids[code] = p.id;
    zones[code] = p.timezone;
  }
  ids.central = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CENTRAL' } })).id;
  const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id } });

  // A web user who can open PRG-105 but holds none of the screens' permissions.
  const viewer = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Project viewer (exports test)',
      code: 'IRL_EXPORTS_VIEWER',
      surface: 'WEB',
      rolePermissions: { create: [{ permission: { connect: { key: 'projects:view_assigned' } } }] },
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: NO_EXPORTS,
      passwordHash: await (await import('bcryptjs')).default.hash(PASSWORD, 8),
      fullName: 'No exports',
      roleId: viewer.id,
      organizationId: org.id,
    },
  });
  await prisma.userProjectAssignment.create({ data: { userId: user.id, projectId: ids['PRG-105'] } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('UBEC IRL exports: project visits', () => {
  it('returns the Visits tab as .xlsx: name, title band, headers and one row per visit', async () => {
    const d = await download(visitsUrl(ids['PRG-211']));
    assert.equal(d.status, 200);
    const today = zonedCalendarDate(new Date(), zones['PRG-211']);
    assert.match(d.disposition, new RegExp(`^attachment; filename="PRG-211 visits ${today}\\.xlsx"`));
    const ws = sheet(d, 'Visits');
    assert.match(String(ws.getCell(1, 1).value), /Visits · PRG-211/);
    assert.deepEqual(headersOf(ws), VISIT_HEADERS);
    assert.equal(ws.views[0]?.state, 'frozen');

    const list = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/visits`).set(await web(ADMIN));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const rows = rowsOf(ws);
    assert.ok(list.body.data.visits.length > 0, 'PRG-211 is seeded with visits');
    assert.equal(rows.length, list.body.data.visits.length);
    for (const r of rows) assert.ok(r['Planned date'] instanceof Date, 'dates are Excel dates');

    // The accepted visits show their review; findings raised add up to the project's visit findings.
    const accepted = rows.filter((r) => r.Status === 'Accepted');
    assert.ok(accepted.length > 0, 'PRG-211 has an accepted visit');
    for (const r of accepted) {
      assert.equal(r.Review, 'Accepted');
      assert.ok(r['Reviewed at'] instanceof Date);
      assert.ok(typeof r['Reviewed by'] === 'string' && r['Reviewed by'].length > 0);
      assert.ok(['Satisfactory', 'Minor issues', 'Major issues'].includes(String(r.Outcome)));
      assert.ok(r['Submitted at'] instanceof Date);
    }
    const raised = rows.reduce((s, r) => s + Number(r['Findings raised'] ?? 0), 0);
    assert.equal(raised, await prisma.finding.count({ where: { projectId: ids['PRG-211'], visitId: { not: null } } }));
    assert.ok(raised > 0, 'PRG-211 has a visit finding');
    assert.ok(rows.some((r) => r['Submitted late'] === 'Yes'), 'the late routine visit is flagged');
  });

  it('applies the screen filters (status list and kind) and refuses an unknown status', async () => {
    const accepted = await download(visitsUrl(ids['PRG-211']), ADMIN, { status: 'APPROVED' });
    const list = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/visits`).query({ status: 'APPROVED' }).set(await web(ADMIN));
    const rows = rowsOf(sheet(accepted, 'Visits'));
    assert.equal(rows.length, list.body.data.visits.length);
    assert.ok(rows.every((r) => r.Status === 'Accepted'));
    assert.match(String(sheet(accepted, 'Visits').getCell(2, 1).value), /Status: Accepted/);

    const open = await download(visitsUrl(ids['PRG-105']), ADMIN, { status: 'PROPOSED,PLANNED,IN_PROGRESS,SUBMITTED,RETURNED,MISSED', visitKind: 'ROUTINE' });
    const openRows = rowsOf(sheet(open, 'Visits'));
    assert.ok(openRows.length > 0, 'PRG-105 has open routine visits');
    assert.ok(openRows.every((r) => r['Visit kind'] === 'Routine' && r.Status !== 'Accepted' && r.Status !== 'Cancelled'), JSON.stringify(openRows.map((r) => [r['Visit kind'], r.Status])));

    const bad = await download(visitsUrl(ids['PRG-211']), ADMIN, { status: 'APPROVED,NOPE' });
    assert.equal(bad.status, 400);
  });

  it('respects visibility and permissions', async () => {
    const hidden = await download(visitsUrl(ids['PRG-105']), LAGOS_ME);
    assert.ok([403, 404].includes(hidden.status), `lagos.me@ is not assigned to PRG-105 (got ${hidden.status})`);
    const assigned = await download(visitsUrl(ids['PRG-221']), LAGOS_ME);
    assert.equal(assigned.status, 200);
    const refused = await download(visitsUrl(ids['PRG-105']), NO_EXPORTS);
    assert.equal(refused.status, 403);
  });
});

describe('UBEC IRL exports: planner visits', () => {
  const today = new Date().toISOString().slice(0, 10);
  const period = { from: addDays(today, -60), to: addDays(today, 30) };

  it('matches the planner for the same period and filters, with project columns', async () => {
    const d = await download('/api/v1/visits/export.xlsx', ADMIN, period);
    assert.equal(d.status, 200);
    assert.match(d.disposition, new RegExp(`^attachment; filename="UBEC visits ${period.from} to ${period.to}\\.xlsx"`));
    const ws = sheet(d, 'Visits');
    assert.deepEqual(headersOf(ws), ['Project code', 'Project', ...VISIT_HEADERS]);
    const planner = await request(app).get('/api/v1/visits').query(period).set(await web(ADMIN));
    assert.equal(planner.status, 200, JSON.stringify(planner.body));
    const rows = rowsOf(ws);
    assert.ok(planner.body.data.visits.length > 0);
    assert.equal(rows.length, planner.body.data.visits.length);
    assert.ok(rows.every((r) => r.Status !== 'Cancelled'));

    const one = await download('/api/v1/visits/export.xlsx', ADMIN, { ...period, projectId: ids['PRG-105'] });
    const oneRows = rowsOf(sheet(one, 'Visits'));
    assert.ok(oneRows.length > 0);
    assert.ok(oneRows.every((r) => r['Project code'] === 'PRG-105'));
    assert.match(String(sheet(one, 'Visits').getCell(2, 1).value), /Project: PRG-105/);
  });

  it('shows an assigned-only officer their projects only; refuses without visits:view', async () => {
    const d = await download('/api/v1/visits/export.xlsx', LAGOS_ME, period);
    assert.equal(d.status, 200);
    const rows = rowsOf(sheet(d, 'Visits')).filter((r) => r['Project code']);
    assert.ok(rows.length > 0, 'lagos.me@ has visits on PRG-221');
    assert.ok(rows.every((r) => ['PRG-221', 'PRG-241', 'PRG-242'].includes(String(r['Project code']))), JSON.stringify(rows.map((r) => r['Project code'])));
    // Naming another project in the filter does not widen visibility.
    const widened = await download('/api/v1/visits/export.xlsx', LAGOS_ME, { ...period, projectId: ids['PRG-105'] });
    const widenedRows = rowsOf(sheet(widened, 'Visits'));
    assert.equal(widenedRows.length, 1);
    assert.match(String(widenedRows[0]['Project code']), /^No visits/);

    const refused = await download('/api/v1/visits/export.xlsx', NO_EXPORTS, period);
    assert.equal(refused.status, 403);
    const bad = await download('/api/v1/visits/export.xlsx', ADMIN, { from: period.to, to: period.from });
    assert.equal(bad.status, 400);
  });
});

describe('UBEC IRL exports: findings', () => {
  it('returns the Findings tab with every finding and its columns', async () => {
    const d = await download(findingsUrl(ids['PRG-211']));
    assert.equal(d.status, 200);
    const today = zonedCalendarDate(new Date(), zones['PRG-211']);
    assert.match(d.disposition, new RegExp(`^attachment; filename="PRG-211 findings ${today}\\.xlsx"`));
    const ws = sheet(d, 'Findings');
    assert.deepEqual(headersOf(ws), [
      'Status',
      'Severity',
      'Facility',
      'Unit',
      'Question',
      'Description',
      'Raised on visit',
      'Visit date',
      'Raised at',
      'Raised by',
      'Follow-up checks',
      'Last follow-up check',
      'Escalated at',
      'Rectified / dismissed at',
      'Rectified / dismissed by',
      'Notes',
      'Contractor',
    ]);
    const list = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/findings`).set(await web(ADMIN));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const rows = rowsOf(ws);
    assert.ok(list.body.data.length > 0, 'PRG-211 has findings');
    assert.equal(rows.length, list.body.data.length);
    const escalated = list.body.data.find((f: { escalatedAt: string | null }) => f.escalatedAt);
    assert.ok(escalated, 'the seeded major finding is escalated');
    const row = rows.find((r) => r.Question === escalated.title && r['Escalated at'] instanceof Date);
    assert.ok(row, 'the escalated finding has its escalation time');
    assert.equal(row!.Severity, escalated.severity.charAt(0) + escalated.severity.slice(1).toLowerCase());
    assert.equal(row!['Follow-up checks'], escalated.recheckCount);
    assert.ok(row!['Visit date'] instanceof Date);
  });

  it('filters by status; a visits:view holder may export; refuses without permission or visibility', async () => {
    const open = await download(findingsUrl(ids['PRG-211']), ADMIN, { status: 'OPEN' });
    const rows = rowsOf(sheet(open, 'Findings'));
    const list = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/findings`).query({ status: 'OPEN' }).set(await web(ADMIN));
    assert.equal(rows.length, list.body.data.length);
    assert.ok(rows.every((r) => r.Status === 'Open'));

    const resolved = await download(findingsUrl(ids['PRG-211']), ADMIN, { status: 'RESOLVED' });
    const resolvedRows = rowsOf(sheet(resolved, 'Findings'));
    const resolvedList = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/findings`).query({ status: 'RESOLVED' }).set(await web(ADMIN));
    if (resolvedList.body.data.length === 0) assert.match(String(resolvedRows[0].Status), /^No findings/);
    else assert.equal(resolvedRows.length, resolvedList.body.data.length);

    assert.equal((await download(findingsUrl(ids['PRG-211']), ADMIN, { status: 'CLOSED' })).status, 400);
    assert.equal((await download(findingsUrl(ids['PRG-211']), INDEPENDENT_ME)).status, 200, 'independent.me@ is assigned to PRG-211 with visits:view');
    assert.equal((await download(findingsUrl(ids['PRG-105']), NO_EXPORTS)).status, 403);
    assert.ok([403, 404].includes((await download(findingsUrl(ids['PRG-211']), LAGOS_ME)).status));
  });
});

describe('UBEC IRL exports: payments', () => {
  it('returns the payment record with a totals row that leaves out voided entries', async () => {
    // A second payment, voided: shown (greyed) but not counted.
    const recorded = await request(app)
      .post(`/api/v1/projects/${ids['PRG-105']}/payments`)
      .set(await web(ADMIN))
      .send({ kind: 'INTERIM', paidOn: '2026-11-20', grossAmountNgn: 2_000_000, reference: 'IRL-EXPORT-VOID' });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    const voided = await request(app)
      .post(`/api/v1/projects/${ids['PRG-105']}/payments/${recorded.body.data.id}/void`)
      .set(await web(ADMIN))
      .send({ reason: 'Entered twice by mistake' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));

    const d = await download(paymentsUrl(ids['PRG-105']));
    assert.equal(d.status, 200);
    const today = zonedCalendarDate(new Date(), zones['PRG-105']);
    assert.match(d.disposition, new RegExp(`^attachment; filename="PRG-105 payments ${today}\\.xlsx"`));
    const ws = sheet(d, 'Payments');
    assert.deepEqual(headersOf(ws), [
      'Paid on',
      'Type',
      'Reference',
      'Description',
      'Work phase',
      'Gross amount',
      'Retention held',
      'Retention released',
      'Net paid',
      'Exceptions',
      'Retention note',
      'Source',
      'ERP reference',
      'Recorded by',
      'Recorded at',
      'Voided',
      'Voided at',
      'Voided by',
      'Void reason',
    ]);
    const summary = (await request(app).get(`/api/v1/projects/${ids['PRG-105']}/payments`).set(await web(ADMIN))).body.data;
    const rows = rowsOf(ws);
    const data = rows.slice(0, -1);
    const totals = rows.at(-1)!;
    assert.equal(data.length, summary.payments.length);
    assert.equal(totals['Paid on'], 'Total (voided excluded)');
    const voidRow = data.find((r) => r.Reference === 'IRL-EXPORT-VOID')!;
    assert.equal(voidRow.Voided, 'Yes');
    assert.equal(voidRow['Void reason'], 'Entered twice by mistake');
    assert.ok(voidRow['Paid on'] instanceof Date);
    const live = summary.payments.filter((p: { voided: boolean }) => !p.voided);
    const sum = (f: (p: { kind: string; grossAmountNgn: number; retentionHeldNgn: number; netAmountNgn: number }) => number) =>
      Math.round(live.reduce((s: number, p: Parameters<typeof f>[0]) => s + f(p), 0) * 100) / 100;
    assert.equal(totals['Gross amount'], summary.paidGrossNgn);
    assert.equal(totals['Net paid'], sum((p) => p.netAmountNgn));
    assert.equal(totals['Retention held'], sum((p) => (p.kind === 'RETENTION_RELEASE' ? 0 : p.retentionHeldNgn)));
    const interim = data.find((r) => r.Reference !== 'IRL-EXPORT-VOID')!;
    assert.equal(interim.Type, 'Interim payment');
    assert.equal(typeof interim['Gross amount'], 'number');
  });

  it('applies the record filters (search, type, exceptions only)', async () => {
    const searched = rowsOf(sheet(await download(paymentsUrl(ids['PRG-105']), ADMIN, { search: 'irl-export' }), 'Payments'));
    assert.equal(searched.length, 2, 'one payment and the totals row');
    assert.equal(searched[0].Reference, 'IRL-EXPORT-VOID');
    assert.equal(searched[1]['Net paid'], 0, 'the only match is voided');

    const finals = rowsOf(sheet(await download(paymentsUrl(ids['PRG-105']), ADMIN, { kind: 'FINAL' }), 'Payments'));
    assert.match(String(finals[0]['Paid on']), /^No payments/);
    assert.equal(finals.at(-1)!['Paid on'], 'Total (voided excluded)');

    const exceptions = rowsOf(sheet(await download(paymentsUrl(ids['PRG-105']), ADMIN, { exceptionsOnly: 'true' }), 'Payments')).slice(0, -1);
    assert.ok(exceptions.every((r) => r.Voided !== 'Yes' && (r.Exceptions === null || String(r.Exceptions).length > 0)));
    assert.ok(!exceptions.some((r) => r.Reference === 'IRL-EXPORT-VOID'));

    assert.equal((await download(paymentsUrl(ids['PRG-105']), ADMIN, { kind: 'REFUND' })).status, 400);
  });

  it('refuses without payments:view and outside visibility', async () => {
    assert.equal((await download(paymentsUrl(ids['PRG-221']), LAGOS_ME)).status, 403, 'lagos.me@ has no payments:view');
    assert.equal((await download(paymentsUrl(ids['PRG-105']), NO_EXPORTS)).status, 403);
  });
});

describe('UBEC IRL exports: programme KPIs', () => {
  const period = { from: '2026-09-01', to: '2026-11-25' };

  it('returns the programme sheet and one row per project and KPI, as the page and its CSV', async () => {
    const d = await download('/api/v1/kpis/export.xlsx', ADMIN, period);
    assert.equal(d.status, 200);
    assert.match(d.disposition, /^attachment; filename="UBEC KPIs 2026-09-01 to 2026-11-25\.xlsx"/);
    const dash = (await request(app).get('/api/v1/kpis').query(period).set(await web(ADMIN))).body.data;
    const programme = rowsOf(sheet(d, 'Programme'));
    assert.deepEqual(headersOf(sheet(d, 'Programme')), ['Stage', 'KPI', 'Value', 'Unit', 'Numerator', 'Denominator', 'Target', 'Status', 'Projects tracking']);
    assert.equal(programme.length, dash.kpis.length);
    assert.ok(programme.every((r) => ['Met', 'Near target', 'Missed', 'No target', 'No data in period', 'Not tracked'].includes(String(r.Status))));
    const byProject = rowsOf(sheet(d, 'By project'));
    assert.equal(byProject.length, dash.kpis.length * dash.projects.length);
    assert.match(String(sheet(d, 'Programme').getCell(2, 1).value), /2026-09-01 to 2026-11-25/);
  });

  it('applies the type filter; refuses without kpis:view', async () => {
    const filtered = await download('/api/v1/kpis/export.xlsx', ADMIN, { ...period, projectTypeId: ids.central });
    const dash = (await request(app).get('/api/v1/kpis').query({ ...period, projectTypeId: ids.central }).set(await web(ADMIN))).body.data;
    const byProject = rowsOf(sheet(filtered, 'By project'));
    assert.equal(byProject.length, dash.kpis.length * dash.projects.length);
    const codes = new Set(dash.projects.map((p: { codePrefix: string }) => p.codePrefix));
    assert.ok(byProject.every((r) => codes.has(String(r['Project code']))));
    assert.match(String(sheet(filtered, 'Programme').getCell(2, 1).value), /Type: /);

    assert.equal((await download('/api/v1/kpis/export.xlsx', NO_EXPORTS, period)).status, 403);
    assert.equal((await download('/api/v1/kpis/export.xlsx', ADMIN, { from: '2026-11-25', to: '2026-09-01' })).status, 400);
  });
});
