/**
 * Redesign R6d route tests: payment record polish (D-R6.23). A payment can name one of the
 * project's sprints; a sprint of another project is refused; the DTO and the audit carry the
 * sprint; a sprint a payment names cannot be removed (SPRINT_IN_USE); the summary carries the
 * sprints and the release checks.
 *
 * Seeded fixtures: PRG-105 (programme tenant, live, sprints and units, one interim payment) and
 * PRG-102 (another live project with sprints).
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'programme.admin@insite.ng';
const ids: Record<string, string> = {};
type SprintRow = { id: string; number: number; name: string; startDate: string; endDate: string; deliverables: string };

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const paymentsUrl = (projectId: string, path = '') => `/api/v1/projects/${projectId}/payments${path}`;
const scopeUrl = (projectId: string, path = '') => `/api/v1/projects/${projectId}/scope${path}`;

async function record(projectId: string, body: Record<string, unknown>) {
  return request(app)
    .post(paymentsUrl(projectId))
    .set(await web(ADMIN))
    .send({ kind: 'INTERIM', paidOn: '2026-11-20', grossAmountNgn: 1_000_000, reference: `PV-${crypto.randomUUID().slice(0, 8)}`, ...body });
}

async function sprintsOf(projectId: string): Promise<SprintRow[]> {
  const res = await request(app).get(scopeUrl(projectId)).set(await web(ADMIN));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.sprints as SprintRow[];
}

const asInput = (s: SprintRow) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate, deliverables: s.deliverables });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.prg105 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  ids.prg102 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-102' } })).id;
});

describe('Redesign R6d: payments name a sprint', () => {
  it('the summary lists the project sprints in order, today and the release checks', async () => {
    const res = await request(app).get(paymentsUrl(ids.prg105)).set(await web(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    const sprints = await sprintsOf(ids.prg105);
    assert.ok(sprints.length > 0, 'PRG-105 is seeded with sprints');
    assert.deepEqual(
      d.sprints,
      sprints.map((s) => ({ id: s.id, number: s.number, name: s.name }))
    );
    assert.match(d.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof d.retentionPeriodEnded, 'boolean');
    assert.equal(typeof d.cocIssued, 'boolean');
    assert.equal(typeof d.openDefects, 'number');
    for (const p of d.payments) assert.ok('sprint' in p, 'every payment carries a sprint field');
  });

  it('refuses a sprint of another project (404 SPRINT_NOT_FOUND) and a malformed id (400)', async () => {
    const other = (await sprintsOf(ids.prg102))[0];
    assert.ok(other, 'PRG-102 is seeded with sprints');
    const before = await prisma.projectPayment.count({ where: { projectId: ids.prg105 } });
    const res = await record(ids.prg105, { sprintId: other.id });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'SPRINT_NOT_FOUND');
    const bad = await record(ids.prg105, { sprintId: 'not-a-uuid' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(await prisma.projectPayment.count({ where: { projectId: ids.prg105 } }), before, 'nothing written');
  });

  it('records a payment for a sprint: the DTO, the summary and the audit carry it; without one it is null', async () => {
    const sprint = (await sprintsOf(ids.prg105))[0];
    const res = await record(ids.prg105, { sprintId: sprint.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.sprint, { id: sprint.id, number: sprint.number, name: sprint.name });
    ids.paymentWithSprint = res.body.data.id;

    const plain = await record(ids.prg105, {});
    assert.equal(plain.status, 201, JSON.stringify(plain.body));
    assert.equal(plain.body.data.sprint, null);

    const summary = await request(app).get(paymentsUrl(ids.prg105)).set(await web(ADMIN));
    const row = summary.body.data.payments.find((p: { id: string }) => p.id === ids.paymentWithSprint);
    assert.deepEqual(row.sprint, { id: sprint.id, number: sprint.number, name: sprint.name });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { projectId: ids.prg105, action: 'PAYMENT_RECORDED', payload: { path: ['paymentId'], equals: ids.paymentWithSprint } },
    });
    const payload = audit.payload as Record<string, unknown>;
    assert.equal(payload.sprintId, sprint.id);
    assert.equal(payload.sprintNumber, sprint.number);
    assert.match(audit.summaryText, new RegExp(`for sprint ${sprint.number} `));
  });

  it('refuses to remove a sprint a payment names, voided or not (409 SPRINT_IN_USE)', async () => {
    // A sprint no unit uses, so only the payment holds it.
    const current = await sprintsOf(ids.prg105);
    const added = await request(app)
      .put(scopeUrl(ids.prg105, '/sprints'))
      .set(await web(ADMIN))
      .send({ sprints: [...current.map(asInput), { name: 'R6d spare sprint', startDate: '2099-01-04', endDate: '2099-01-29' }] });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const spare = (await sprintsOf(ids.prg105)).find((s) => s.name === 'R6d spare sprint')!;
    const paid = await record(ids.prg105, { sprintId: spare.id });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));

    const without = (await sprintsOf(ids.prg105)).filter((s) => s.id !== spare.id).map(asInput);
    const dropped = await request(app).put(scopeUrl(ids.prg105, '/sprints')).set(await web(ADMIN)).send({ sprints: without });
    assert.equal(dropped.status, 409, JSON.stringify(dropped.body));
    assert.equal(dropped.body.error.code, 'SPRINT_IN_USE');
    assert.match(dropped.body.error.message, /Payment/);

    const voided = await request(app)
      .post(paymentsUrl(ids.prg105, `/${paid.body.data.id}/void`))
      .set(await web(ADMIN))
      .send({ reason: 'Entered against the wrong sprint' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.deepEqual(voided.body.data.sprint, { id: spare.id, number: spare.number, name: spare.name });
    const stillDropped = await request(app).put(scopeUrl(ids.prg105, '/sprints')).set(await web(ADMIN)).send({ sprints: without });
    assert.equal(stillDropped.status, 409);
    assert.equal(stillDropped.body.error.code, 'SPRINT_IN_USE');
    assert.ok(await prisma.projectSprint.findUnique({ where: { id: spare.id } }), 'the sprint is kept');
  });
});
