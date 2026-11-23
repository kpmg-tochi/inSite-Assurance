/**
 * Phase 12 route tests: configurable professional registration (tenant list of bodies, tenant
 * policy) on field identity assurance. Redesign R1b removed the certification paths (IPC, direct
 * milestone, retention) and payment milestones, so those tests are gone; registrations themselves
 * go in R1d.
 *
 * Fixtures: the main tenant (no policy: REQUIRED, today's behaviour) with LKK-402 (join-code
 * sessions); the programme tenant (seedPhase11 + seedPhase12) with policy OPTIONAL/OPTIONAL.
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
const UNREGISTERED = 'unregistered.monitor@insite.test';
const PROGRAMME_ADMIN = 'programme.admin@insite.ng';

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
      ['ARCON', 'CORBON', 'COREN', 'ICAN', 'OTHER', 'QSRBN']
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

