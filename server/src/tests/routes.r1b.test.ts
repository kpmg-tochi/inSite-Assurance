/**
 * Redesign R1b route tests: the payment record (payments are made outside the platform and
 * recorded; retention is held against them; rule breaches are flagged, never blocked) and project
 * progress driven by counted reports.
 *
 * Fixtures are created here on the main tenant: R1B-100 (active, 5% retention, a project type
 * snapshot whose closure gates include FINAL_PAYMENT, liability period still running) and R1B-101
 * (archived). LKK-402 supplies a seeded field session.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { addCalendarMonths, ProjectTypeConfigSchema, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let progress: typeof import('../modules/progress/progress.service');

const PASSWORD = 'Password123!';
const LENDER = 'lender@insite.ng'; // Funder / Finance Officer: payments:record
const MONITOR = 'monitor@insite.ng'; // payments:view
const CONTRACTOR = 'contractor@insite.ng'; // neither
const ids: Record<string, string> = {};
let today = '';

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const url = (path = '', projectId = ids.project) => `/api/v1/projects/${projectId}/payments${path}`;

async function record(body: Record<string, unknown>, projectId = ids.project) {
  return request(app)
    .post(url('', projectId))
    .set(await web(LENDER))
    .send({ paidOn: today, reference: `PV-${crypto.randomUUID().slice(0, 8)}`, ...body });
}

async function money(projectId = ids.project) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  return { paid: Number(p.disbursedToDateNgn), held: Number(p.retentionHeldNgn), released: Number(p.retentionReleasedNgn) };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  progress = await import('../modules/progress/progress.service');
  const { createApp } = await import('../app');
  app = createApp();
  today = zonedCalendarDate(new Date(), 'Africa/Lagos');

  const lkk = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } });
  ids.lkk = lkk.id;
  ids.tenant = lkk.tenantId;
  const config = ProjectTypeConfigSchema.parse({ closure: { requireCocFor: ['FINAL_PAYMENT'] } });
  const snapshot = { projectTypeId: crypto.randomUUID(), code: 'R1B', name: 'R1B type', version: 1, config };
  const users = await prisma.user.findMany({ where: { email: { in: [LENDER, MONITOR, CONTRACTOR] } } });
  const make = async (code: string, status: 'ACTIVE' | 'ARCHIVED') => {
    const p = await prisma.project.create({
      data: {
        tenantId: ids.tenant,
        name: `Payment test ${code}`,
        codePrefix: code,
        stateLocation: 'Lagos State',
        status,
        activatedAt: new Date(),
        archivedAt: status === 'ARCHIVED' ? new Date() : null,
        timezone: 'Africa/Lagos',
        totalBudgetNgn: 1_000_000,
        contractSumNgn: 1_000_000,
        retentionPercentage: 5,
        retentionDurationMonths: 12,
        practicalCompletionDate: today,
        retentionStartDate: today,
        retentionEndDate: addCalendarMonths(today, 12),
        monitorOrganizationId: lkk.monitorOrganizationId,
        lenderOrganizationId: lkk.lenderOrganizationId,
        projectTypeSnapshotJson: snapshot as never,
        processConfig: { create: { enableRetentionModule: true, enableHandoverModule: true } },
      },
    });
    for (const u of users) await prisma.userProjectAssignment.create({ data: { userId: u.id, projectId: p.id } });
    return p.id;
  };
  ids.project = await make('R1B-100', 'ACTIVE');
  ids.archived = await make('R1B-101', 'ARCHIVED');
  ids.lkkSession = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: lkk.id, isActive: true } })).id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Redesign R1b: payment record', () => {
  it('an interim payment holds retention at the project percentage and moves the totals', async () => {
    const res = await record({ kind: 'INTERIM', grossAmountNgn: 200_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.retentionHeldNgn, 10_000);
    assert.equal(res.body.data.netAmountNgn, 190_000);
    assert.deepEqual(res.body.data.exceptions, []);
    assert.equal(res.body.data.source, 'MANUAL');
    ids.interim = res.body.data.id;
    assert.deepEqual(await money(), { paid: 190_000, held: 10_000, released: 0 });
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'PAYMENT_RECORDED' } }));
  });

  it('a different retention amount needs a reason, and the reason is stored', async () => {
    const noReason = await record({ kind: 'INTERIM', grossAmountNgn: 100_000, retentionHeldNgn: 0 });
    assert.equal(noReason.status, 422, JSON.stringify(noReason.body));
    assert.equal(noReason.body.error.code, 'RETENTION_OVERRIDE_REASON_REQUIRED');
    const withReason = await record({ kind: 'INTERIM', grossAmountNgn: 100_000, retentionHeldNgn: 0, retentionOverrideReason: 'Advance recovery, no retention by contract' });
    assert.equal(withReason.status, 201, JSON.stringify(withReason.body));
    assert.equal(withReason.body.data.retentionHeldNgn, 0);
    assert.equal(withReason.body.data.retentionOverrideReason, 'Advance recovery, no retention by contract');
    assert.deepEqual(await money(), { paid: 290_000, held: 10_000, released: 0 });
  });

  it('a retention release cannot exceed the balance held', async () => {
    const res = await record({ kind: 'RETENTION_RELEASE', grossAmountNgn: 10_001 });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'RELEASE_ABOVE_BALANCE');
  });

  it('a release before the period end and before the certificate is recorded, flagged and notified', async () => {
    const res = await record({ kind: 'RETENTION_RELEASE', grossAmountNgn: 4_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.exceptions.sort(), ['RETENTION_RELEASE_BEFORE_COC', 'RETENTION_RELEASE_BEFORE_PERIOD_END']);
    assert.equal(res.body.data.retentionHeldNgn, 0);
    assert.equal(res.body.data.netAmountNgn, 4_000);
    ids.release = res.body.data.id;
    assert.deepEqual(await money(), { paid: 294_000, held: 6_000, released: 4_000 });
    const note = await prisma.webNotification.findFirst({ where: { projectId: ids.project, category: 'PAYMENT_EXCEPTION' } });
    assert.ok(note);
    assert.equal(note!.targetPermissionKey, 'payments:view');
  });

  it('a final payment before the certificate is flagged FINAL_BEFORE_COC', async () => {
    const res = await record({ kind: 'FINAL', grossAmountNgn: 50_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.exceptions, ['FINAL_BEFORE_COC']);
    ids.final = res.body.data.id;
  });

  it('flags payments above the contract sum', async () => {
    const res = await record({ kind: 'INTERIM', grossAmountNgn: 700_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.exceptions, ['PAID_ABOVE_CONTRACT_SUM']);
    const voided = await request(app).post(url(`/${res.body.data.id}/void`)).set(await web(LENDER)).send({ reason: 'Entered against the wrong contract' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
  });

  it('void reverses the totals once; voiding an interim whose retention was released is refused', async () => {
    const before = await money();
    const h = await web(LENDER);
    const voided = await request(app).post(url(`/${ids.final}/void`)).set(h).send({ reason: 'Duplicate of PV 1142' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.data.voided, true);
    assert.equal(voided.body.data.voidReason, 'Duplicate of PV 1142');
    const afterVoid = await money();
    assert.equal(afterVoid.paid, before.paid - 47_500);
    assert.equal(afterVoid.held, before.held - 2_500);
    const again = await request(app).post(url(`/${ids.final}/void`)).set(h).send({ reason: 'Duplicate of PV 1142' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'PAYMENT_ALREADY_VOID');
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'PAYMENT_VOIDED' } }));

    // 10,000 was held on the first interim and 4,000 of it released: the balance is 6,000 < 10,000.
    const underflow = await request(app).post(url(`/${ids.interim}/void`)).set(h).send({ reason: 'Recorded twice by mistake' });
    assert.equal(underflow.status, 409, JSON.stringify(underflow.body));
    assert.equal(underflow.body.error.code, 'VOID_WOULD_UNDERFLOW_RETENTION');
    // Voiding the release first restores the balance; then the interim can go.
    assert.equal((await request(app).post(url(`/${ids.release}/void`)).set(h).send({ reason: 'Release not approved yet' })).status, 200);
    assert.equal((await request(app).post(url(`/${ids.interim}/void`)).set(h).send({ reason: 'Recorded twice by mistake' })).status, 200);
    assert.deepEqual(await money(), { paid: 100_000, held: 0, released: 0 });
  });

  it('the summary lists payments with totals; reading needs payments:view or payments:record', async () => {
    const res = await request(app).get(url()).set(await web(MONITOR));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.canRecord, false);
    assert.equal(res.body.data.paidNetNgn, 100_000);
    assert.equal(res.body.data.retentionBalanceNgn, 0);
    assert.equal(res.body.data.cocIssued, false);
    assert.equal(res.body.data.payments.length, 5);
    assert.equal((await request(app).get(url()).set(await web(LENDER))).body.data.canRecord, true);

    const contractor = await request(app).get(url()).set(await web(CONTRACTOR));
    assert.equal(contractor.status, 403, JSON.stringify(contractor.body));
    const monitorWrite = await request(app).post(url()).set(await web(MONITOR)).send({ kind: 'INTERIM', paidOn: today, grossAmountNgn: 1, reference: 'X' });
    assert.equal(monitorWrite.status, 403);
    const fieldRead = await request(app)
      .get(url('', ids.lkk))
      .set({ Authorization: `Bearer ${signFieldAgentToken({ sessionId: ids.lkkSession })}` });
    assert.ok([401, 403].includes(fieldRead.status), String(fieldRead.status));
  });

  it('refuses payments on a project that is not active, and voids of another project payment', async () => {
    const archived = await record({ kind: 'INTERIM', grossAmountNgn: 1_000 }, ids.archived);
    assert.equal(archived.status, 409, JSON.stringify(archived.body));
    const lkkPayment = await prisma.projectPayment.findFirstOrThrow({ where: { projectId: ids.lkk } });
    const foreign = await request(app).post(url(`/${lkkPayment.id}/void`)).set(await web(LENDER)).send({ reason: 'Not this project at all' });
    assert.equal(foreign.status, 404);
  });
});

describe('Redesign R1b: progress from counted reports', () => {
  it('a counted report moves the item and the budget-weighted project progress', async () => {
    const base = await prisma.workdayReport.findFirstOrThrow({ where: { projectId: ids.lkk, status: 'CONFIRMED' } });
    const items = await Promise.all(
      [1, 2].map((n) =>
        prisma.boqItem.create({
          data: { projectId: ids.lkk, wbsCode: `R1B.0${n}`, section: 'R1B', description: `Item ${n}`, unit: 'm', totalQuantity: 200, rateNgn: 1, budgetedCostNgn: 200 },
        })
      )
    );
    await prisma.workdayReport.create({
      data: {
        clientReportId: crypto.randomUUID(),
        projectId: ids.lkk,
        reporterSessionId: base.reporterSessionId,
        wbsItemId: items[0].id,
        workdayDate: base.workdayDate,
        reporterTimezone: base.reporterTimezone,
        status: 'CONFIRMED',
        summaryText: 'Laid 50 m.',
        reportedQuantity: 50,
        unitOfMeasure: 'm',
        reportingPeriodStart: base.reportingPeriodStart,
        reportingPeriodEnd: base.reportingPeriodEnd,
        dueAt: base.dueAt,
        reporterPersonaType: base.reporterPersonaType,
      },
    });
    // A pending report on the second item does not count.
    await prisma.workdayReport.create({
      data: {
        clientReportId: crypto.randomUUID(),
        projectId: ids.lkk,
        reporterSessionId: base.reporterSessionId,
        wbsItemId: items[1].id,
        workdayDate: base.workdayDate,
        reporterTimezone: base.reporterTimezone,
        status: 'PENDING_APPROVAL',
        summaryText: 'Laid 200 m.',
        reportedQuantity: 200,
        unitOfMeasure: 'm',
        reportingPeriodStart: base.reportingPeriodStart,
        reportingPeriodEnd: base.reportingPeriodEnd,
        dueAt: base.dueAt,
        reporterPersonaType: base.reporterPersonaType,
      },
    });
    const pct = await prisma.$transaction((tx) => progress.refreshProjectProgress(tx, ids.lkk));
    const [a, b] = await Promise.all(items.map((i) => prisma.boqItem.findUniqueOrThrow({ where: { id: i.id } })));
    assert.equal(Number(a.cumulativeCertifiedPct), 25);
    assert.equal(Number(b.cumulativeCertifiedPct), 0);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.lkk } });
    assert.equal(Number(project.certifiedProgressPct), pct);
    assert.ok(pct >= 0 && pct <= 100);
  });
});
