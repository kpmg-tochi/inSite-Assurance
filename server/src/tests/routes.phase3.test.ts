/**
 * Phase 3 route-level tests: disbursement integrity, reconciliation workflow, rating labels.
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts).
 * The AI provider is disabled in tests; the rater is stubbed where a test needs it.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';

type Prisma = typeof import('../config/prisma')['prisma'];
type Service = typeof import('../modules/reconciliation/reconciliation.service');

let app: Express;
let prisma: Prisma;
let service: Service;

const PASSWORD = 'Password123!';
const DAY = 86_400_000;

const ids = {
  tenantA: '',
  abj: '',
  abjTranche1: '',
  abjTranche2: '',
  pv: '',
  transformer: '',
  cpA2: '',
  ipc: '',
  pvLine: '',
  transformerLine: '',
  reportRev1: '',
  decision1: '',
};

const tokens: Record<string, string> = {};

async function login(email: string): Promise<string> {
  if (tokens[email]) return tokens[email];
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
  tokens[email] = res.body.data.accessToken as string;
  return tokens[email];
}

const as = async (email: string) => ({ Authorization: `Bearer ${await login(email)}` });
const base = () => `/api/v1/projects/${ids.abj}`;

async function getIpc(email = 'monitor@insite.ng') {
  const res = await request(app).get(`${base()}/ipcs/${ids.ipc}`).set(await as(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function latestAudit(action: string) {
  return prisma.auditLog.findFirstOrThrow({
    where: { projectId: ids.abj, action: action as never },
    orderBy: { seq: 'desc' },
  });
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  service = await import('../modules/reconciliation/reconciliation.service');
  const { seedDatabase } = await import('../db/seedDatabase');
  const { createApp } = await import('../app');
  await seedDatabase();
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenantA = tenant.id;
  const abj = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'ABJ-108' } });
  ids.abj = abj.id;
  ids.abjTranche1 = (await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: abj.id, trancheNumber: 1 } })).id;
  ids.abjTranche2 = (await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: abj.id, trancheNumber: 2 } })).id;
  ids.pv = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: abj.id, wbsCode: '02.01.1' } })).id;
  ids.transformer = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: abj.id, wbsCode: '02.02.1' } })).id;
  ids.cpA2 = (await prisma.conditionPrecedent.findFirstOrThrow({ where: { trancheId: ids.abjTranche2, referenceCode: 'CP-A2' } })).id;
});

after(async () => {
  service?.setReconciliationModelRater(null);
  await prisma?.$disconnect();
});

describe('Phase 3 disbursement integrity', () => {
  describe('roles (D-3.1)', () => {
    it('does not give Tenant Super Admin certify or approve', async () => {
      const role = await prisma.role.findFirstOrThrow({
        where: { tenantId: ids.tenantA, code: 'TENANT_SUPER_ADMIN' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const keys = role.rolePermissions.map((rp) => rp.permission.key);
      assert.ok(!keys.includes('ipc:certify_valuation'));
      assert.ok(!keys.includes('tranche:approve_disbursement'));
      assert.ok(keys.includes('roles:create_edit'));
    });

    it('lets a tenant admin assign the Monitor role without holding certify, but not to themselves', async () => {
      const adminHeaders = await as('admin@insite.ng');
      const monitorRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'MONITOR' } });
      const contractor = await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } });
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insite.ng' } });

      // A tenant user manager (not platform admin) assigning Monitor to someone else is allowed.
      const tenantAdminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'TENANT_SUPER_ADMIN' } });
      const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenantA } });
      await prisma.user.create({
        data: {
          tenantId: ids.tenantA,
          email: 'tenantadmin@insite.test',
          passwordHash: await bcrypt.hash(PASSWORD, 8),
          fullName: 'Tenant Admin',
          roleId: tenantAdminRole.id,
          organizationId: org.id,
        },
      });
      const tenantAdmin = await as('tenantadmin@insite.test');
      const target = await prisma.user.create({
        data: {
          tenantId: ids.tenantA,
          email: 'newmonitor@insite.test',
          passwordHash: await bcrypt.hash(PASSWORD, 8),
          fullName: 'New Monitor',
          roleId: (await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'CONTRACTOR' } })).id,
          organizationId: org.id,
        },
      });
      const ok = await request(app)
        .put(`/api/v1/rbac/users/${target.id}/assignments`)
        .set(tenantAdmin)
        .send({ roleId: monitorRole.id, projectIds: [] });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));

      const tenantAdminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'tenantadmin@insite.test' } });
      const self = await request(app)
        .put(`/api/v1/rbac/users/${tenantAdminUser.id}/assignments`)
        .set(tenantAdmin)
        .send({ roleId: monitorRole.id, projectIds: [] });
      assert.equal(self.status, 403, JSON.stringify(self.body));
      assert.equal(self.body.error.code, 'PERMISSION_ESCALATION');

      void adminHeaders;
      void contractor;
      void admin;
    });
  });

  describe('claim submission', () => {
    it('refuses a claim on a fully released tranche', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs`)
        .set(await as('contractor@insite.ng'))
        .send({
          trancheId: ids.abjTranche1,
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [{ boqItemId: ids.pv, claimedCumulativePct: 10 }],
        });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'TRANCHE_FULLY_RELEASED');
    });

    it('refuses a BOQ item from another tranche, out-of-bounds percentages, duplicates and future periods', async () => {
      const headers = await as('contractor@insite.ng');
      const plinth = await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.abj, wbsCode: '01.01.1' } });
      const body = (lineItems: unknown, extra: object = {}) => ({
        trancheId: ids.abjTranche2,
        periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
        periodEnd: new Date().toISOString(),
        lineItems,
        ...extra,
      });
      let res = await request(app).post(`${base()}/ipcs`).set(headers).send(body([{ boqItemId: plinth.id, claimedCumulativePct: 100 }]));
      assert.equal(res.body.error?.code, 'BOQ_ITEM_NOT_IN_TRANCHE');
      res = await request(app).post(`${base()}/ipcs`).set(headers).send(body([{ boqItemId: ids.pv, claimedCumulativePct: 0 }]));
      assert.equal(res.body.error?.code, 'CLAIM_OUT_OF_BOUNDS');
      res = await request(app)
        .post(`${base()}/ipcs`)
        .set(headers)
        .send(body([{ boqItemId: ids.pv, claimedCumulativePct: 10 }, { boqItemId: ids.pv, claimedCumulativePct: 20 }]));
      assert.equal(res.status, 400);
      res = await request(app)
        .post(`${base()}/ipcs`)
        .set(headers)
        .send(body([{ boqItemId: ids.pv, claimedCumulativePct: 10 }], { periodEnd: new Date(Date.now() + 2 * DAY).toISOString() }));
      assert.equal(res.body.error?.code, 'PERIOD_IN_FUTURE');
      assert.equal(await prisma.ipcClaim.count({ where: { projectId: ids.abj } }), 0);
    });

    it('assigns the IPC number, computes amounts and reconciles with the rules engine', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs`)
        .set(await as('contractor@insite.ng'))
        .send({
          trancheId: ids.abjTranche2,
          ipcNumber: 42, // ignored: numbering is server-side
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [
            { boqItemId: ids.pv, claimedCumulativePct: 40 },
            { boqItemId: ids.transformer, claimedCumulativePct: 50 },
          ],
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const ipc = res.body.data;
      ids.ipc = ipc.id;
      assert.equal(ipc.ipcNumber, 1);
      assert.equal(ipc.status, 'AI_RECONCILED');
      assert.equal(ipc.reconciliationPending, false);
      assert.equal(ipc.ratingEngine, 'RULES_ENGINE');
      assert.equal(ipc.totalClaimedAmountNgn, 800_000_000);
      ids.pvLine = ipc.lineItems.find((l: { boqItemId: string }) => l.boqItemId === ids.pv).id;
      ids.transformerLine = ipc.lineItems.find((l: { boqItemId: string }) => l.boqItemId === ids.transformer).id;
      for (const line of ipc.lineItems) {
        assert.equal(line.ratingEngine, 'RULES_ENGINE');
        assert.equal(line.aiEvidenceRating, 'SUPPORTED', JSON.stringify(line));
      }
      const audit = await latestAudit('AI_RECONCILIATION_COMPLETED');
      assert.equal(audit.actorId, 'RULES_ENGINE');
    });

    it('allows only one open IPC per tranche', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs`)
        .set(await as('contractor@insite.ng'))
        .send({
          trancheId: ids.abjTranche2,
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [{ boqItemId: ids.pv, claimedCumulativePct: 45 }],
        });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'TRANCHE_HAS_OPEN_IPC');
    });
  });

  describe('queries', () => {
    let queryId = '';

    it('refuses a response before any query is raised', async () => {
      const res = await request(app)
        .patch(`${base()}/ipcs/${ids.ipc}/queries/00000000-0000-4000-8000-000000000000/respond`)
        .set(await as('contractor@insite.ng'))
        .send({ contractorResponseText: 'Here you go' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'ILLEGAL_IPC_TRANSITION');
    });

    it('raises a query, blocks certification, and accepts one bounded response', async () => {
      const raised = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/queries`)
        .set(await as('monitor@insite.ng'))
        .send({ ipcLineItemId: ids.pvLine, queryReason: 'Provide string test sheets for rows B1-B14' });
      assert.equal(raised.status, 201, JSON.stringify(raised.body));
      queryId = raised.body.data.id;
      assert.equal((await getIpc()).status, 'QUERIED_BY_MONITOR');

      const certify = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify`)
        .set(await as('monitor@insite.ng'))
        .send({
          lineValuations: [
            { ipcLineItemId: ids.pvLine, monitorCertifiedCumulativePct: 30 },
            { ipcLineItemId: ids.transformerLine, monitorCertifiedCumulativePct: 50 },
          ],
          trancheRecommendation: 'SUPPORT_FULL_RELEASE',
          executiveCertificationSummary: 'Certified against site visit.',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(certify.status, 409);
      assert.equal(certify.body.error.code, 'QUERIES_OUTSTANDING');

      const contractor = await as('contractor@insite.ng');
      const tooLow = await request(app)
        .patch(`${base()}/ipcs/${ids.ipc}/queries/${queryId}/respond`)
        .set(contractor)
        .send({ contractorResponseText: 'Revising down', revisedClaimedCumulativePct: 0 });
      assert.equal(tooLow.body.error?.code, 'CLAIM_OUT_OF_BOUNDS');

      const ok = await request(app)
        .patch(`${base()}/ipcs/${ids.ipc}/queries/${queryId}/respond`)
        .set(contractor)
        .send({ contractorResponseText: 'Revised to 35% pending string tests', revisedClaimedCumulativePct: 35 });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const ipc = await getIpc();
      assert.equal(ipc.totalClaimedAmountNgn, 472_500_000 + 260_000_000);

      const again = await request(app)
        .patch(`${base()}/ipcs/${ids.ipc}/queries/${queryId}/respond`)
        .set(contractor)
        .send({ contractorResponseText: 'Second answer' });
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'QUERY_NOT_OPEN');
    });

    it('resolving the last query re-runs reconciliation and returns to AI_RECONCILED', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/queries/${queryId}/resolve`)
        .set(await as('monitor@insite.ng'))
        .send({ resolutionNote: 'Revised claim accepted for valuation' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.outstandingQueries, 0);
      assert.equal(res.body.data.ipc.status, 'AI_RECONCILED');
      const q = await prisma.monitorQuery.findUniqueOrThrow({ where: { id: queryId } });
      assert.equal(q.status, 'RESOLVED');
      assert.ok(q.resolvedByUserId);
      await latestAudit('MONITOR_QUERY_RESOLVED');
    });
  });

  describe('certification', () => {
    const body = (extra: object = {}) => ({
      lineValuations: [
        { ipcLineItemId: ids.pvLine, monitorCertifiedCumulativePct: 30 },
        { ipcLineItemId: ids.transformerLine, monitorCertifiedCumulativePct: 50 },
      ],
      trancheRecommendation: 'SUPPORT_WITH_HOLDBACK',
      recommendedReleaseAmountNgn: 500_000_000,
      executiveCertificationSummary: 'Certified against site visit on rows A and B.',
      certifierDigitalSignatureAck: true,
      ...extra,
    });

    it('refuses the platform super admin, who holds no certify permission', async () => {
      const res = await request(app).post(`${base()}/ipcs/${ids.ipc}/certify`).set(await as('admin@insite.ng')).send(body());
      assert.equal(res.status, 403, JSON.stringify(res.body));
    });

    it('refuses a certifier without a licence on their profile', async () => {
      const monitorRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'MONITOR' } });
      const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenantA, categories: { has: 'ADVISORY_MONITOR' } } });
      await prisma.user.create({
        data: {
          tenantId: ids.tenantA,
          email: 'unlicensed@insite.test',
          passwordHash: await bcrypt.hash(PASSWORD, 8),
          fullName: 'Unlicensed Monitor',
          roleId: monitorRole.id,
          organizationId: org.id,
        },
      });
      const res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify`)
        .set(await as('unlicensed@insite.test'))
        .send(body());
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'CERTIFIER_LICENCE_MISSING');
    });

    it('rejects client-supplied amounts and certifier identity', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify`)
        .set(await as('lto@insite.ng'))
        .send(body({ trancheRecommendation: 'SUPPORT_FULL_RELEASE' }));
      assert.equal(res.status, 400, 'a release amount is not accepted for full release');
    });

    it('refuses an incomplete valuation and percentages outside previous..claimed', async () => {
      const headers = await as('lto@insite.ng');
      let res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify?dryRun=true`)
        .set(headers)
        .send(body({ lineValuations: [{ ipcLineItemId: ids.pvLine, monitorCertifiedCumulativePct: 30 }] }));
      assert.equal(res.body.error?.code, 'INCOMPLETE_VALUATION');
      res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify?dryRun=true`)
        .set(headers)
        .send(
          body({
            lineValuations: [
              { ipcLineItemId: ids.pvLine, monitorCertifiedCumulativePct: 36 },
              { ipcLineItemId: ids.transformerLine, monitorCertifiedCumulativePct: 50 },
            ],
          })
        );
      assert.equal(res.body.error?.code, 'CERTIFIED_PCT_OUT_OF_BOUNDS');
      res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify?dryRun=true`)
        .set(headers)
        .send(body({ recommendedReleaseAmountNgn: 700_000_000 }));
      assert.equal(res.body.error?.code, 'RECOMMENDED_RELEASE_EXCEEDS_CERTIFIED');
    });

    it('dry run returns server-computed figures and saves nothing', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify?dryRun=true`)
        .set(await as('lto@insite.ng'))
        .send(body());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const c = res.body.data.computation;
      assert.equal(res.body.data.dryRun, true);
      assert.equal(c.totalCertifiedNgn, 405_000_000 + 260_000_000);
      assert.equal(c.recommendedReleaseAmountNgn, 500_000_000);
      assert.equal(c.recommendedHoldbackAmountNgn, 732_500_000 - 500_000_000);
      assert.equal(c.certifierLicenseNumber, 'R.33017');
      assert.equal(await prisma.valuationReport.count({ where: { ipcClaimId: ids.ipc } }), 0);
      assert.equal((await getIpc()).status, 'AI_RECONCILED');
    });

    it('certifies with snapshots from the profile and updates BOQ and project progress', async () => {
      const res = await request(app).post(`${base()}/ipcs/${ids.ipc}/certify`).set(await as('lto@insite.ng')).send(body());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const report = res.body.data.valuationReport;
      ids.reportRev1 = report.id;
      assert.equal(report.revisionNumber, 1);
      assert.equal(report.certifierFullName, 'Engr. Ifeoma Eze, FNSE');
      assert.equal(report.certifierLicenseType, 'COREN');
      assert.equal(report.totalCertifiedNgn, 665_000_000);

      assert.equal(Number((await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.pv } })).cumulativeCertifiedPct), 30);
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.abj } });
      // (187m x 100 + 1,350m x 30 + 520m x 50) / 2,057m
      assert.equal(Number(project.certifiedProgressPct), 41.42);
      assert.equal((await getIpc()).status, 'MONITOR_CERTIFIED');
    });

    it('re-certification before a decision creates a new revision and supersedes the old one', async () => {
      const res = await request(app).post(`${base()}/ipcs/${ids.ipc}/certify`).set(await as('lto@insite.ng')).send(body());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.valuationReport.revisionNumber, 2);
      const rev1 = await prisma.valuationReport.findUniqueOrThrow({ where: { id: ids.reportRev1 } });
      assert.ok(rev1.supersededAt);
      ids.reportRev1 = res.body.data.valuationReport.id;
    });
  });

  describe('lender decision', () => {
    const decide = async (email: string, payload: object) =>
      request(app)
        .post(`${base()}/tranches/${ids.abjTranche2}/decision`)
        .set(await as(email))
        .send({ valuationReportId: ids.reportRev1, ...payload });

    it('refuses the certifier (same-user block)', async () => {
      const res = await decide('lto@insite.ng', { decision: 'APPROVE_FULL' });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'SEGREGATION_OF_DUTIES');
      const ipc = await getIpc('lto@insite.ng');
      assert.equal(ipc.actions.decide.allowed, false);
    });

    it('refuses a superseded revision', async () => {
      const old = await prisma.valuationReport.findFirstOrThrow({ where: { ipcClaimId: ids.ipc, revisionNumber: 1 } });
      const res = await request(app)
        .post(`${base()}/tranches/${ids.abjTranche2}/decision`)
        .set(await as('lender@insite.ng'))
        .send({ valuationReportId: old.id, decision: 'HOLD' });
      assert.equal(res.body.error?.code, 'VALUATION_SUPERSEDED');
    });

    it('blocks release while a mandatory CP is pending (D-3.2)', async () => {
      const res = await decide('lender@insite.ng', { decision: 'APPROVE_FULL' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CONDITIONS_PRECEDENT_UNMET');
      assert.match(res.body.error.message, /CP-A2/);
    });

    it('waives the CP with a reason, recorded in the ledger', async () => {
      const short = await request(app)
        .post(`${base()}/tranches/${ids.abjTranche2}/conditions/${ids.cpA2}/waive`)
        .set(await as('lender@insite.ng'))
        .send({ reason: 'ok' });
      assert.equal(short.status, 400);
      const monitorTry = await request(app)
        .post(`${base()}/tranches/${ids.abjTranche2}/conditions/${ids.cpA2}/waive`)
        .set(await as('monitor@insite.ng'))
        .send({ reason: 'Monitor cannot waive conditions precedent' });
      assert.equal(monitorTry.status, 403);
      const res = await request(app)
        .post(`${base()}/tranches/${ids.abjTranche2}/conditions/${ids.cpA2}/waive`)
        .set(await as('lender@insite.ng'))
        .send({ reason: 'Credit committee waived pending DisCo signature (CC/2026/114)' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const cp = res.body.data.conditionsPrecedent.find((c: { id: string }) => c.id === ids.cpA2);
      assert.equal(cp.status, 'WAIVED');
      assert.ok(cp.waiverReason);
      const audit = await latestAudit('CP_WAIVED');
      assert.match(audit.summaryText, /CP-A2/);
    });

    it('bounds the approved amount', async () => {
      let res = await decide('lender@insite.ng', { decision: 'APPROVE_WITH_HOLDBACK', approvedDisbursementAmountNgn: 600_000_000 });
      assert.equal(res.body.error?.code, 'APPROVED_EXCEEDS_RECOMMENDED');
      res = await decide('lender@insite.ng', { decision: 'APPROVE_FULL', approvedDisbursementAmountNgn: 1 });
      assert.equal(res.status, 400, 'APPROVE_FULL carries no amount');
      res = await decide('lender@insite.ng', { decision: 'APPROVE_WITH_HOLDBACK' });
      assert.equal(res.status, 400, 'holdback needs an amount');
    });

    it('APPROVE_FULL releases exactly the recommended amount and snapshots CPs', async () => {
      const res = await decide('lender@insite.ng', { decision: 'APPROVE_FULL', creditCommitteeReference: 'CC/2026/114' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      ids.decision1 = res.body.data.id;
      assert.equal(res.body.data.approvedDisbursementAmountNgn, 500_000_000);
      assert.equal(res.body.data.heldBackAmountNgn, 232_500_000);
      assert.ok(res.body.data.cpSnapshot.some((c: { referenceCode: string; status: string }) => c.referenceCode === 'CP-A2' && c.status === 'WAIVED'));

      const tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.abjTranche2 } });
      assert.equal(Number(tranche.releasedAmountNgn), 500_000_000);
      assert.equal(tranche.isReleased, false);
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.abj } });
      assert.equal(Number(project.disbursedToDateNgn), 2_600_000_000);
      assert.equal((await getIpc()).status, 'LENDER_DECIDED');
    });

    it('refuses every further step on a decided IPC (no double counting)', async () => {
      const second = await decide('lender@insite.ng', { decision: 'APPROVE_FULL' });
      assert.equal(second.status, 409);
      const recert = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/certify`)
        .set(await as('lto@insite.ng'))
        .send({
          lineValuations: [
            { ipcLineItemId: ids.pvLine, monitorCertifiedCumulativePct: 30 },
            { ipcLineItemId: ids.transformerLine, monitorCertifiedCumulativePct: 50 },
          ],
          trancheRecommendation: 'HOLD',
          executiveCertificationSummary: 'Trying to recertify after decision.',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(recert.status, 409);
      assert.equal(recert.body.error.code, 'ILLEGAL_IPC_TRANSITION');
      const query = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/queries`)
        .set(await as('monitor@insite.ng'))
        .send({ ipcLineItemId: ids.pvLine, queryReason: 'Late query after decision' });
      assert.equal(query.status, 409);
      const withdraw = await request(app)
        .post(`${base()}/ipcs/${ids.ipc}/withdraw`)
        .set(await as('contractor@insite.ng'))
        .send({ reason: 'Changed my mind' });
      assert.equal(withdraw.status, 409);
      const tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.abjTranche2 } });
      assert.equal(Number(tranche.releasedAmountNgn), 500_000_000);
    });

    it('reverses with a linked negative record, then accepts a corrected decision', async () => {
      const res = await request(app)
        .post(`${base()}/tranche-decisions/${ids.decision1}/reverse`)
        .set(await as('lender@insite.ng'))
        .send({ reason: 'Wrong facility account; reissue under holdback' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.approvedDisbursementAmountNgn, -500_000_000);
      assert.equal(res.body.data.reversesDecisionId, ids.decision1);

      let tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.abjTranche2 } });
      assert.equal(Number(tranche.releasedAmountNgn), 0);
      let project = await prisma.project.findUniqueOrThrow({ where: { id: ids.abj } });
      assert.equal(Number(project.disbursedToDateNgn), 2_100_000_000);
      assert.equal((await getIpc()).status, 'MONITOR_CERTIFIED');
      await latestAudit('TRANCHE_DECISION_REVERSED');

      const again = await request(app)
        .post(`${base()}/tranche-decisions/${ids.decision1}/reverse`)
        .set(await as('lender@insite.ng'))
        .send({ reason: 'Reversing twice should fail' });
      assert.equal(again.body.error?.code, 'DECISION_ALREADY_REVERSED');

      const corrected = await decide('lender@insite.ng', {
        decision: 'APPROVE_WITH_HOLDBACK',
        approvedDisbursementAmountNgn: 400_000_000,
      });
      assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
      tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.abjTranche2 } });
      assert.equal(Number(tranche.releasedAmountNgn), 400_000_000);
      project = await prisma.project.findUniqueOrThrow({ where: { id: ids.abj } });
      assert.equal(Number(project.disbursedToDateNgn), 2_500_000_000);

      const ipc = await getIpc();
      assert.equal(ipc.activeDecision.approvedDisbursementAmountNgn, 400_000_000);
      assert.equal(ipc.valuationReport.decisions.length, 3);
    });
  });

  describe('reconciliation provenance and rating labels', () => {
    let ipc2 = '';

    it('returns 201 with reconciliationPending when reconciliation fails after the claim is saved', async () => {
      // A rater that edits the claim mid-run makes the write-back refuse (claim changed).
      service.setReconciliationModelRater(async () => {
        await prisma.ipcClaim.updateMany({
          where: { projectId: ids.abj, status: 'SUBMITTED' },
          data: { contractorCoverNote: 'touched' },
        });
        return null;
      });
      const res = await request(app)
        .post(`${base()}/ipcs`)
        .set(await as('contractor@insite.ng'))
        .send({
          trancheId: ids.abjTranche2,
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [
            { boqItemId: ids.pv, claimedCumulativePct: 45 },
            { boqItemId: ids.transformer, claimedCumulativePct: 100 },
          ],
        });
      service.setReconciliationModelRater(null);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.ipcNumber, 2);
      assert.equal(res.body.data.status, 'SUBMITTED');
      assert.equal(res.body.data.reconciliationPending, true);
      ipc2 = res.body.data.id;
    });

    it('records RULES_ENGINE in lines and the ledger when the provider fails', async () => {
      service.setReconciliationModelRater(async () => {
        throw new Error('provider down');
      });
      const res = await request(app)
        .post(`${base()}/ipcs/${ipc2}/reconcile`)
        .set(await as('monitor@insite.ng'));
      service.setReconciliationModelRater(null);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'AI_RECONCILED');
      assert.equal(res.body.data.ratingEngine, 'RULES_ENGINE');
      assert.match(res.body.data.ratingEngineDetail, /provider error/i);
      for (const line of res.body.data.lineItems) assert.equal(line.ratingEngine, 'RULES_ENGINE');
      const audit = await latestAudit('AI_RECONCILIATION_COMPLETED');
      assert.equal(audit.actorId, 'RULES_ENGINE');
    });

    it('records the model engine and deployment when the provider answers', async () => {
      service.setReconciliationModelRater(async (input) => ({
        lineEvaluations: input.lines.map((l) => ({
          boqItemId: l.boqItemId,
          evidenceStrengthRating: 'SUPPORTED' as const,
          aiRationale: 'All good',
          visitPlannerFlag: false,
          visitPlannerReason: null,
          corroboratingEvidenceLogIds: [],
        })),
        executiveSummaryNote: 'Model summary',
        deploymentName: 'gpt-test',
      }));
      const res = await request(app)
        .post(`${base()}/ipcs/${ipc2}/reconcile`)
        .set(await as('monitor@insite.ng'));
      service.setReconciliationModelRater(null);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.ratingEngine, 'AZURE_OPENAI');
      assert.equal(res.body.data.ratingEngineDetail, 'gpt-test');
      for (const line of res.body.data.lineItems) assert.equal(line.ratingEngine, 'AZURE_OPENAI');
      // Rule caps on a model answer are covered case by case in reconciliation.phase3.test.ts.
      const audit = await latestAudit('AI_RECONCILIATION_COMPLETED');
      assert.equal(audit.actorId, 'AZURE_OPENAI:gpt-test');
    });

    it('updates tenant rating labels, which change display but not stored values', async () => {
      const admin = await as('admin@insite.ng');
      const bad = await request(app)
        .put('/api/v1/rbac/tenant/settings/rating-labels')
        .set(admin)
        .send({ labels: { SUPPORTED: { label: 'x'.repeat(41) } } });
      assert.equal(bad.status, 400);

      const put = await request(app)
        .put('/api/v1/rbac/tenant/settings/rating-labels')
        .set(admin)
        .send({ labels: { SUPPORTED: { label: 'Verified', description: 'Independent evidence covers the claim.' } } });
      assert.equal(put.status, 200, JSON.stringify(put.body));
      assert.equal(put.body.data.resolved.SUPPORTED.label, 'Verified');
      assert.equal(put.body.data.resolved.CONTRADICTED.label, 'Contradicted');

      const lender = await request(app)
        .put('/api/v1/rbac/tenant/settings/rating-labels')
        .set(await as('lender@insite.ng'))
        .send({ labels: {} });
      assert.equal(lender.status, 403);

      const me = await request(app).get('/api/v1/auth/me').set(await as('monitor@insite.ng'));
      assert.equal(me.body.data.user.ratingLabels.SUPPORTED.label, 'Verified');

      const ledger = await prisma.auditLog.findFirstOrThrow({
        where: { tenantId: ids.tenantA, projectId: null, action: 'TENANT_SETTINGS_UPDATED' },
      });
      assert.match(ledger.summaryText, /rating labels/);

      // Rules-engine summaries print the tenant label; stored ratings stay canonical.
      const res = await request(app).post(`${base()}/ipcs/${ipc2}/reconcile`).set(await as('monitor@insite.ng'));
      assert.equal(res.status, 200);
      assert.match(res.body.data.aiExecutiveSummary, /Verified/);
      const stored = await prisma.ipcLineItem.findMany({ where: { ipcClaimId: ipc2 } });
      assert.ok(stored.every((l) => ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED'].includes(l.aiEvidenceRating)));
      assert.ok(stored.some((l) => l.aiEvidenceRating === 'SUPPORTED'));
    });

    it('withdraws an open IPC and frees the tranche', async () => {
      const res = await request(app)
        .post(`${base()}/ipcs/${ipc2}/withdraw`)
        .set(await as('contractor@insite.ng'))
        .send({ reason: 'Resubmitting with the commissioning certificate' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'REJECTED_WITHDRAWN');
      await latestAudit('IPC_WITHDRAWN');
    });

    it('exports a PDF for a certified IPC', async () => {
      const res = await request(app)
        .get(`${base()}/ipcs/${ids.ipc}/valuation-report.pdf`)
        .set(await as('lender@insite.ng'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      assert.equal(res.status, 200);
      assert.equal((res.body as Buffer).subarray(0, 4).toString(), '%PDF');
    });
  });
});
