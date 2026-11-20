/**
 * Phase 12 route tests: configurable professional registration (tenant list of bodies, tenant
 * policy, project type override) on every certification path and on field identity assurance, and
 * fixed-amount payment milestones on direct milestone release.
 *
 * Fixtures: the main tenant (no policy: REQUIRED, today's behaviour) with ABJ-108 (IPC claims),
 * KWR-502 (retention held) and LKK-402 (join-code sessions); the programme tenant (seedPhase11 +
 * seedPhase12) with policy OPTIONAL/OPTIONAL and Central project PRG-102 carrying three fixed
 * payment milestones. Items have no counted evidence, so tests set `cumulativeCertifiedPct`
 * directly to stand for earlier verifications.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];

const PASSWORD = 'Password123!';
const ADMIN = 'admin@insite.ng';
const LENDER = 'lender@insite.ng';
const LTO = 'lto@insite.ng'; // certify + approve, COREN R.33017 on the profile
const UNREGISTERED = 'unregistered.monitor@insite.test';
const PROGRAMME_ADMIN = 'programme.admin@insite.ng';
const PROGRAMME_MONITOR = 'programme.monitor@insite.ng'; // no registration on the profile
const PROGRAMME_FUNDER = 'programme.funder@insite.ng';

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

const ids: Record<string, string> = {};

async function setPolicy(email: string, certifier: string | null, fieldAssurance: string | null) {
  const res = await request(app).put('/api/v1/credentials/policy').set(await web(email)).send({ certifier, fieldAssurance });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  const { createApp } = await import('../app');
  app = createApp();

  const project = async (code: string) => (await prisma.project.findFirstOrThrow({ where: { codePrefix: code } })).id;
  for (const code of ['ABJ-108', 'KWR-502', 'LKK-402', 'PRG-101', 'PRG-102']) ids[code] = await project(code);
  const abj = await prisma.project.findUniqueOrThrow({ where: { id: ids['ABJ-108'] } });
  ids.tenantA = abj.tenantId;

  // A monitor with no registration on the main tenant.
  const monitorRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'MONITOR' } });
  const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenantA, categories: { has: 'ADVISORY_MONITOR' } } });
  await prisma.user.create({
    data: {
      tenantId: ids.tenantA,
      email: UNREGISTERED,
      passwordHash: await bcrypt.hash(PASSWORD, 8),
      fullName: 'Unregistered Monitor',
      roleId: monitorRole.id,
      organizationId: org.id,
    },
  });

  // An IPC ready for certification on ABJ-108 (one line), created directly.
  const item = await prisma.boqItem.findFirstOrThrow({ where: { projectId: abj.id, wbsCode: '02.01.1' } });
  const prev = Number(item.cumulativeCertifiedPct);
  const claimed = Math.min(100, prev + 10);
  const contractorUser = await prisma.user.findFirstOrThrow({ where: { email: 'contractor@insite.ng' } });
  const ipc = await prisma.ipcClaim.create({
    data: {
      projectId: abj.id,
      trancheId: item.trancheId!,
      ipcNumber: 90,
      periodStart: new Date(Date.now() - 14 * 86_400_000),
      periodEnd: new Date(),
      totalClaimedAmountNgn: ((claimed - prev) / 100) * Number(item.budgetedCostNgn),
      status: 'AI_RECONCILED',
      submittedByUserId: contractorUser.id,
      lineItems: {
        create: [
          {
            boqItemId: item.id,
            previousCertifiedPct: prev,
            contractorClaimedPct: claimed,
            contractorClaimedNgn: ((claimed - prev) / 100) * Number(item.budgetedCostNgn),
          },
        ],
      },
    },
    include: { lineItems: true },
  });
  ids.ipc = ipc.id;
  ids.ipcLine = ipc.lineItems[0].id;
  ids.ipcPct = String(claimed);
});

after(async () => {
  await prisma?.$disconnect();
});

// ---------------------------------------------------------------------------
describe('Phase 12: registration bodies and tenant policy', () => {
  it('every tenant starts with the six default bodies and no policy (REQUIRED)', async () => {
    const res = await request(app).get('/api/v1/credentials/settings').set(await web(UNREGISTERED));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.policy, {});
    assert.deepEqual(res.body.data.resolved, { certifier: 'REQUIRED', fieldAssurance: 'REQUIRED' });
    assert.equal(res.body.data.profileFieldVisible, true);
    assert.deepEqual(
      res.body.data.registrationBodies.map((b: { code: string }) => b.code).sort(),
      ['ARCON', 'COREN', 'CORBON', 'ICAN', 'OTHER', 'QSRBN']
    );
    const programme = await request(app).get('/api/v1/credentials/settings').set(await web(PROGRAMME_ADMIN));
    assert.deepEqual(programme.body.data.resolved, { certifier: 'OPTIONAL', fieldAssurance: 'OPTIONAL' });
  });

  it('only tenant:manage_settings changes the policy and the bodies; changes are audited', async () => {
    const denied = await request(app)
      .put('/api/v1/credentials/policy')
      .set(await web(UNREGISTERED))
      .send({ certifier: 'HIDDEN', fieldAssurance: null });
    assert.equal(denied.status, 403);

    const admin = await web(ADMIN);
    const created = await request(app)
      .post('/api/v1/credentials/registration-bodies')
      .set(admin)
      .send({ code: 'niqs', fullName: 'Nigerian Institute of Quantity Surveyors', displayPrefix: 'NIQS No.' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.code, 'NIQS');
    const dup = await request(app)
      .post('/api/v1/credentials/registration-bodies')
      .set(admin)
      .send({ code: 'NIQS', fullName: 'Duplicate body', displayPrefix: 'No.' });
    assert.equal(dup.status, 409);

    // A body nobody names is deleted; one on a profile (lto@: COREN) is archived instead.
    const unused = await request(app).delete(`/api/v1/credentials/registration-bodies/${created.body.data.id}`).set(admin);
    assert.deepEqual(unused.body.data, { deleted: true, archived: false });
    const coren = await prisma.professionalRegistrationBody.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'COREN' } });
    const used = await request(app).delete(`/api/v1/credentials/registration-bodies/${coren.id}`).set(admin);
    assert.deepEqual(used.body.data, { deleted: false, archived: true });
    const renamed = await request(app)
      .put(`/api/v1/credentials/registration-bodies/${coren.id}`)
      .set(admin)
      .send({ code: 'COREN2', fullName: coren.fullName, displayPrefix: coren.displayPrefix });
    assert.equal(renamed.status, 409, 'a code on profiles cannot change');
    const restored = await request(app)
      .put(`/api/v1/credentials/registration-bodies/${coren.id}`)
      .set(admin)
      .send({ code: 'COREN', fullName: coren.fullName, displayPrefix: coren.displayPrefix, isArchived: false });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    await setPolicy(ADMIN, 'OPTIONAL', null);
    await setPolicy(ADMIN, null, null);
    assert.ok((await prisma.auditLog.count({ where: { tenantId: ids.tenantA, action: 'CREDENTIAL_POLICY_UPDATED' } })) >= 2);
    assert.ok((await prisma.auditLog.count({ where: { tenantId: ids.tenantA, action: 'REGISTRATION_BODY_SAVED' } })) >= 4);
  });

  it('user forms accept only active body codes of the tenant', async () => {
    const admin = await web(ADMIN);
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'MONITOR' } });
    const body = (code: string) => ({
      fullName: 'Registered Monitor',
      email: `reg.${code.toLowerCase()}@insite.test`,
      password: 'Password123!',
      roleId: role.id,
      organizationName: 'Phase 12 Monitoring Ltd',
      organizationCategory: 'ADVISORY_MONITOR',
      professionalRegistrationBodyCode: code,
      professionalRegistrationNumber: '1234',
    });
    const unknown = await request(app).post('/api/v1/rbac/users').set(admin).send(body('XYZ'));
    assert.equal(unknown.status, 422, JSON.stringify(unknown.body));
    assert.equal(unknown.body.error.code, 'REGISTRATION_BODY_UNKNOWN');
    const ok = await request(app).post('/api/v1/rbac/users').set(admin).send(body('QSRBN'));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.professionalRegistrationBodyCode, 'QSRBN');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 12: IPC certification follows the certifier policy', () => {
  const certify = async (email: string) =>
    request(app)
      .post(`/api/v1/projects/${ids['ABJ-108']}/ipcs/${ids.ipc}/certify?dryRun=true`)
      .set(await web(email))
      .send({
        lineValuations: [{ ipcLineItemId: ids.ipcLine, monitorCertifiedCumulativePct: Number(ids.ipcPct) }],
        trancheRecommendation: 'HOLD',
        executiveCertificationSummary: 'Certified against the latest site visit.',
        certifierDigitalSignatureAck: true,
      });

  it('REQUIRED (no policy set): refuses a certifier without a registration and explains why', async () => {
    const res = await certify(UNREGISTERED);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'CERTIFIER_LICENCE_MISSING');
    const detail = await request(app).get(`/api/v1/projects/${ids['ABJ-108']}/ipcs/${ids.ipc}`).set(await web(UNREGISTERED));
    assert.equal(detail.body.data.actions.certify.allowed, false);
    assert.match(detail.body.data.actions.certify.reason, /registration/);
    const registered = await certify(LTO);
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.body.data.computation.certifierLicenseType, 'COREN');
    assert.equal(registered.body.data.computation.certifierLicenseNumber, 'R.33017');
    assert.equal(registered.body.data.computation.certifierRegistrationPrefix, 'COREN Reg. No.');
  });

  it('OPTIONAL: certifies without a registration (snapshot null) and keeps one when present', async () => {
    await setPolicy(ADMIN, 'OPTIONAL', null);
    const without = await certify(UNREGISTERED);
    assert.equal(without.status, 200, JSON.stringify(without.body));
    const c = without.body.data.computation;
    assert.deepEqual(
      [c.certifierLicenseType, c.certifierLicenseNumber, c.certifierRegistrationBodyName, c.certifierRegistrationPrefix],
      [null, null, null, null]
    );
    const detail = await request(app).get(`/api/v1/projects/${ids['ABJ-108']}/ipcs/${ids.ipc}`).set(await web(UNREGISTERED));
    assert.equal(detail.body.data.actions.certify.allowed, true, JSON.stringify(detail.body.data.actions.certify));
    const withReg = await certify(LTO);
    assert.equal(withReg.body.data.computation.certifierLicenseNumber, 'R.33017');
  });

  it('HIDDEN: nothing about registration is copied, even from a registered certifier', async () => {
    await setPolicy(ADMIN, 'HIDDEN', null);
    const res = await certify(LTO);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.computation.certifierLicenseNumber, null);
    assert.equal(res.body.data.computation.certifierLicenseType, null);
    await setPolicy(ADMIN, null, null);
  });

  it('segregation is unchanged: with registration off, a role without certify still cannot certify', async () => {
    await setPolicy(ADMIN, 'HIDDEN', null);
    const res = await certify(LENDER);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    await setPolicy(ADMIN, null, null);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 12: retention certification follows the certifier policy', () => {
  it('REQUIRED refuses an unregistered certifier; HIDDEN certifies with no registration recorded', async () => {
    const base = `/api/v1/projects/${ids['KWR-502']}/retention`;
    const main = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids['KWR-502'], isMainContractor: true } });
    const req = await request(app).post(`${base}/release-request`).set(await web(LENDER)).send({ projectContractorId: main.id, stage: 'COMPLETION' });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    const body = { executiveCertificationSummary: 'Practical completion reached; half of retention due.', certifierDigitalSignatureAck: true };

    const refused = await request(app).post(`${base}/release-requests/${req.body.data.id}/certify`).set(await web(UNREGISTERED)).send(body);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'CERTIFIER_LICENCE_MISSING');
    const summary = await request(app).get(base).set(await web(UNREGISTERED));
    const pending = summary.body.data.requests.find((r: { id: string }) => r.id === req.body.data.id);
    assert.equal(pending.actions.certify.allowed, false);

    await setPolicy(ADMIN, 'HIDDEN', null);
    const certified = await request(app).post(`${base}/release-requests/${req.body.data.id}/certify`).set(await web(LTO)).send(body);
    assert.equal(certified.status, 200, JSON.stringify(certified.body));
    assert.equal(certified.body.data.valuation.certifierLicenseNumber, null);
    assert.equal(certified.body.data.valuation.certifierRegistrationPrefix, null);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { projectId: ids['KWR-502'], action: 'VALUATION_REPORT_CERTIFIED' },
      orderBy: { seq: 'desc' },
    });
    assert.ok(!audit.actorDisplayName.includes('#'), audit.actorDisplayName);
    const pdf = await request(app)
      .get(`/api/v1/projects/${ids['KWR-502']}/valuations/${certified.body.data.valuation.id}/valuation-report.pdf`)
      .set(await web(LTO));
    assert.equal(pdf.status, 200);
    await setPolicy(ADMIN, null, null);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 12: field identity assurance follows the fieldAssurance policy', () => {
  async function pendingSession(name: string) {
    const base = await prisma.fieldAgentSession.findFirstOrThrow({
      where: { projectId: ids['LKK-402'], joinCodeId: { not: null } },
      select: { projectId: true, joinCodeId: true, roleId: true, roleNameSnapshot: true, fieldPersonaType: true, assuranceWeight: true },
    });
    return prisma.fieldAgentSession.create({
      data: { ...base, agentFullName: name, agentPhoneNumber: '+23480' + String(Date.now()).slice(-8), deviceId: crypto.randomUUID(), assuranceStatus: 'PENDING_APPROVAL' },
    });
  }
  function submission(extra: Record<string, unknown> = {}) {
    const key = (n: string) => `tenants/${ids.tenantA}/projects/${ids['LKK-402']}/identity_selfie/${n}.jpg`;
    const now = new Date().toISOString();
    return {
      projectId: ids['LKK-402'],
      idDocumentType: 'NIN',
      idDocumentUrl: key('id'),
      selfieFrontUrl: key('front'),
      selfieLeftUrl: key('left'),
      selfieRightUrl: key('right'),
      selfieSet: { captureMethod: 'GUIDED_SELFIE', frontCapturedAt: now, leftCapturedAt: now, rightCapturedAt: now },
      experienceSummary: 'Ten years of culvert works.',
      ...extra,
    };
  }

  it('REQUIRED (default) refuses a submission without a number; the old field name still works', async () => {
    const s = await pendingSession('Required Tester');
    const missing = await request(app).post('/api/v1/auth/assurance-verification').set(field(s.id)).send(submission());
    assert.equal(missing.status, 422, JSON.stringify(missing.body));
    assert.equal(missing.body.error.code, 'REGISTRATION_NUMBER_REQUIRED');
    const old = await request(app)
      .post('/api/v1/auth/assurance-verification')
      .set(field(s.id))
      .send(submission({ corenLicenseNumber: 'R.1234' }));
    assert.equal(old.status, 200, JSON.stringify(old.body));
    const unknownBody = await request(app)
      .post('/api/v1/auth/assurance-verification')
      .set(field(s.id))
      .send(submission({ registrationNumber: 'R.1234', registrationBodyCode: 'NOPE' }));
    assert.equal(unknownBody.status, 422);
    const ok = await request(app)
      .post('/api/v1/auth/assurance-verification')
      .set(field(s.id))
      .send(submission({ registrationNumber: 'R.1234', registrationBodyCode: 'coren' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const stored = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: s.id } });
    assert.deepEqual([stored.registrationNumber, stored.registrationBodyCode], ['R.1234', 'COREN']);
  });

  it('OPTIONAL accepts no number; HIDDEN drops whatever is sent; the pack carries the policy', async () => {
    await setPolicy(ADMIN, null, 'OPTIONAL');
    const s1 = await pendingSession('Optional Tester');
    const optional = await request(app).post('/api/v1/auth/assurance-verification').set(field(s1.id)).send(submission());
    assert.equal(optional.status, 200, JSON.stringify(optional.body));

    await setPolicy(ADMIN, null, 'HIDDEN');
    const s2 = await pendingSession('Hidden Tester');
    const hidden = await request(app)
      .post('/api/v1/auth/assurance-verification')
      .set(field(s2.id))
      .send(submission({ registrationNumber: 'R.999', registrationBodyCode: 'COREN' }));
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    const stored = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: s2.id } });
    assert.deepEqual([stored.registrationNumber, stored.registrationBodyCode], [null, null]);

    const pack = await request(app).get(`/api/v1/auth/mobile/projects/${ids['LKK-402']}/baseline`).set(field(s2.id));
    assert.equal(pack.status, 200, JSON.stringify(pack.body));
    assert.equal(pack.body.data.fieldAssurance.registration, 'HIDDEN');
    assert.ok(pack.body.data.fieldAssurance.registrationBodies.length >= 6);

    const queue = await request(app).get(`/api/v1/projects/${ids['LKK-402']}/contractor-verifications`).set(await web('monitor@insite.ng'));
    if (queue.status === 200) {
      const row = queue.body.data.find((v: { id: string }) => v.id === s2.id);
      if (row) assert.equal(row.registrationNumber, null);
    }
    await setPolicy(ADMIN, null, null);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 12: fixed-amount payment milestones (programme Central project)', () => {
  const t = (n: number) => prisma.facilityTranche.findFirstOrThrow({ where: { projectId: ids['PRG-102'], trancheNumber: n } });
  const items = async (trancheId: string) => prisma.boqItem.findMany({ where: { trancheId }, orderBy: { wbsCode: 'asc' } });
  const verify = async (trancheId: string, pcts: number[], extra: Record<string, unknown> = {}) => {
    const rows = await items(trancheId);
    return request(app)
      .post(`/api/v1/projects/${ids['PRG-102']}/milestones/direct-verify`)
      .set(await web(PROGRAMME_MONITOR))
      .send({
        trancheId,
        verificationSummary: 'Milestone inspected on site against approved reports.',
        lineVerifications: rows.map((r, i) => ({ boqItemId: r.id, verifiedCumulativePct: pcts[i] })),
        trancheRecommendation: 'SUPPORT_FULL_RELEASE',
        certifierDigitalSignatureAck: true,
        ...extra,
      });
  };

  it('the project policy comes from the project type (OPTIONAL) and the seed has three fixed milestones', async () => {
    const policy = await request(app).get(`/api/v1/projects/${ids['PRG-102']}/credential-policy`).set(await web(PROGRAMME_MONITOR));
    assert.equal(policy.status, 200, JSON.stringify(policy.body));
    assert.deepEqual(policy.body.data.certifier, { requirement: 'OPTIONAL', source: 'PROJECT_TYPE' });
    const tranches = await prisma.facilityTranche.findMany({ where: { projectId: ids['PRG-102'] }, orderBy: { trancheNumber: 'asc' } });
    assert.equal(tranches.length, 3);
    assert.ok(tranches.every((x) => x.paymentBasis === 'FIXED_ON_COMPLETION' && x.completionRule === 'ALL_ITEMS_COMPLETE'));
    const budget = Number((await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } })).totalBudgetNgn);
    assert.deepEqual(tranches.map((x) => Number(x.allocatedAmountNgn)), [budget * 0.3, budget * 0.4, budget * 0.3]);
  });

  it('suggestion shows the criteria; release is refused while the milestone is incomplete', async () => {
    const t1 = await t(1);
    const rows = await items(t1.id);
    await prisma.boqItem.update({ where: { id: rows[0].id }, data: { cumulativeCertifiedPct: 100 } });
    await prisma.boqItem.update({ where: { id: rows[1].id }, data: { cumulativeCertifiedPct: 100 } });
    await prisma.boqItem.update({ where: { id: rows[2].id }, data: { cumulativeCertifiedPct: 60 } });
    const s = await request(app)
      .get(`/api/v1/projects/${ids['PRG-102']}/milestones/direct-verify/suggestion?trancheId=${t1.id}`)
      .set(await web(PROGRAMME_MONITOR));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.data.paymentBasis, 'FIXED_ON_COMPLETION');
    assert.equal(s.body.data.completionMet, false);
    assert.equal(s.body.data.unmetReasons.length, 1);
    assert.equal(s.body.data.fixedReleaseAmountNgn, Number(t1.allocatedAmountNgn));
    assert.equal(s.body.data.alreadyReleasedNgn, 0);

    const refused = await verify(t1.id, [100, 100, 60]);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'MILESTONE_COMPLETION_NOT_MET');
    assert.equal(refused.body.error.details.unmetReasons.length, 1);
  });

  it('holdback needs an amount below the fixed amount and a reason', async () => {
    const t1 = await t(1);
    const rows = await items(t1.id);
    await prisma.boqItem.update({ where: { id: rows[2].id }, data: { cumulativeCertifiedPct: 100 } });
    const fixed = Number(t1.allocatedAmountNgn);
    const noReason = await verify(t1.id, [100, 100, 100], { trancheRecommendation: 'SUPPORT_WITH_HOLDBACK', holdbackReleaseAmountNgn: fixed / 2 });
    assert.equal(noReason.status, 422, JSON.stringify(noReason.body));
    assert.equal(noReason.body.error.code, 'HOLDBACK_REASON_REQUIRED');
    const notBelow = await verify(t1.id, [100, 100, 100], {
      trancheRecommendation: 'SUPPORT_WITH_HOLDBACK',
      holdbackReleaseAmountNgn: fixed,
      holdbackReason: 'Snag list outstanding.',
    });
    assert.equal(notBelow.body.error.code, 'HOLDBACK_NOT_BELOW_FIXED_AMOUNT');
    const dry = await verify(t1.id, [100, 100, 100], {
      trancheRecommendation: 'SUPPORT_WITH_HOLDBACK',
      holdbackReleaseAmountNgn: fixed / 2,
      holdbackReason: 'Snag list outstanding.',
      dryRun: true,
    });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.data.computation.recommendedReleaseAmountNgn, fixed / 2);
    assert.equal(dry.body.data.computation.recommendedHoldbackAmountNgn, fixed / 2);
    assert.equal(dry.body.data.computation.holdbackReason, 'Snag list outstanding.');
  });

  it('releases exactly the fixed amount once complete, net of retention; no registration is printed', async () => {
    const t1 = await t(1);
    const fixed = Number(t1.allocatedAmountNgn);
    const verified = await verify(t1.id, [100, 100, 100]);
    assert.equal(verified.status, 201, JSON.stringify(verified.body));
    const v = verified.body.data.valuation;
    assert.equal(v.totalCertifiedNgn, fixed);
    assert.equal(v.recommendedReleaseAmountNgn, fixed);
    assert.equal(v.paymentTerms.paymentBasis, 'FIXED_ON_COMPLETION');
    assert.equal(v.paymentTerms.completionMet, true);
    assert.deepEqual([v.certifierLicenseType, v.certifierLicenseNumber, v.certifierRegistrationPrefix], [null, null, null]);

    const decided = await request(app)
      .post(`/api/v1/projects/${ids['PRG-102']}/tranches/${t1.id}/decision`)
      .set(await web(PROGRAMME_FUNDER))
      .send({ valuationReportId: v.id, decision: 'APPROVE_FULL' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.data.approvedDisbursementAmountNgn, fixed);
    assert.equal(decided.body.data.retentionWithheldNgn, fixed * 0.05);
    assert.equal(decided.body.data.netReleasedNgn, fixed * 0.95);
    const after1 = await t(1);
    assert.equal(Number(after1.releasedAmountNgn), fixed);
    assert.equal(after1.isReleased, true);

    const pdf = await request(app)
      .get(`/api/v1/projects/${ids['PRG-102']}/valuations/${v.id}/valuation-report.pdf`)
      .set(await web(PROGRAMME_MONITOR));
    assert.equal(pdf.status, 200);
  });

  it('a project type override to REQUIRED blocks the unregistered verifier', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } });
    const snapshot = project.projectTypeSnapshotJson as { config: Record<string, unknown> };
    await prisma.project.update({
      where: { id: project.id },
      data: { projectTypeSnapshotJson: { ...snapshot, config: { ...snapshot.config, credentials: { certifier: 'REQUIRED' } } } },
    });
    const t2 = await t(2);
    for (const r of await items(t2.id)) await prisma.boqItem.update({ where: { id: r.id }, data: { cumulativeCertifiedPct: 100 } });
    const res = await verify(t2.id, [100, 100, 100]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'CERTIFIER_LICENCE_MISSING');
    await prisma.project.update({ where: { id: project.id }, data: { projectTypeSnapshotJson: snapshot as never } });
  });

  it('fixed basis is refused with contractor IPC claims (D-12.2)', async () => {
    const admin = await web(PROGRAMME_ADMIN);
    // Draft PRG-101: a new milestone takes the type's default basis (fixed).
    const saved = await request(app)
      .put(`/api/v1/projects/${ids['PRG-101']}/setup/facility`)
      .set(admin)
      .send({ tranches: [{ trancheNumber: 1, name: 'Payment milestone 1', allocatedAmountNgn: 50_000_000, targetCompletionPct: 100 }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const tranche = await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: ids['PRG-101'] } });
    assert.equal(tranche.paymentBasis, 'FIXED_ON_COMPLETION');

    const processRes = await request(app).get(`/api/v1/projects/${ids['PRG-101']}/process`).set(admin);
    const toIpc = await request(app)
      .put(`/api/v1/projects/${ids['PRG-101']}/process`)
      .set(admin)
      .send({ config: { ...processRes.body.data.config, disbursementMechanism: 'IPC_CLAIM_REQUIRED' } });
    assert.equal(toIpc.status, 409, JSON.stringify(toIpc.body));
    assert.equal(toIpc.body.error.code, 'FIXED_BASIS_WITH_IPC');

    const tooMuch = await request(app)
      .put(`/api/v1/projects/${ids['PRG-101']}/setup/facility`)
      .set(admin)
      .send({
        tranches: [
          { id: tranche.id, trancheNumber: 1, name: 'Payment milestone 1', allocatedAmountNgn: 50_000_000, targetCompletionPct: 100, fixedReleaseAmountNgn: 60_000_000 },
        ],
      });
    assert.equal(tooMuch.status, 422, JSON.stringify(tooMuch.body));
    assert.equal(tooMuch.body.error.code, 'FIXED_AMOUNT_EXCEEDS_ALLOCATION');

    // A project type whose template uses IPC claims cannot default to the fixed basis.
    const type = await prisma.projectType.findFirstOrThrow({ where: { code: 'CENTRAL', tenant: { slug: 'programme-authority' } } });
    const templates = await prisma.workflowTemplate.findMany({ where: { tenantId: type.tenantId } });
    const ipcTemplate = templates.find(
      (x) => (x.configJson as { process?: { disbursementMechanism?: string } }).process?.disbursementMechanism === 'IPC_CLAIM_REQUIRED'
    );
    assert.ok(ipcTemplate, 'a starter template with IPC claims exists');
    const typeRes = await request(app)
      .put(`/api/v1/project-types/${type.id}`)
      .set(admin)
      .send({
        code: type.code,
        name: type.name,
        workflowTemplateId: ipcTemplate!.id,
        config: { ...(type.configJson as object), payments: { defaultBasis: 'FIXED_ON_COMPLETION', defaultCompletionRule: null, mechanism: null } },
      });
    assert.equal(typeRes.status, 422, JSON.stringify(typeRes.body));
    assert.equal(typeRes.body.error.code, 'TEMPLATE_CONFLICTS_WITH_PROJECT_TYPE');
  });

  it('other tenants are unchanged: tranches stay measured', async () => {
    const tranches = await prisma.facilityTranche.findMany({ where: { project: { tenantId: ids.tenantA } } });
    assert.ok(tranches.length > 0);
    assert.ok(tranches.every((x) => x.paymentBasis === 'MEASURED'));
  });
});
