/**
 * Phase 5 route-level tests: provisioned mobile accounts. Sign-in and each refusal, lazy and
 * idempotent session creation, visibility that follows assignments, role onboarding-mode switches,
 * the assurance gate, device and session revocation, and token-type separation.
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs/promises';
import type { Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type Shared = typeof import('@insite/shared');

let app: Express;
let prisma: PrismaClientType;
let shared: Shared;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];

const PASSWORD = 'Password123!';
const ABJ_POINT = { latitude: 9.0489, longitude: 7.3497 };

const ids = {
  tenant: '',
  abj: '',
  lkk: '',
  lkkCow: '',
  monitorUser: '',
  monitorInspectorRole: '',
  residentRole: '',
};

type Key = { publicKey: string; sign: (message: string) => string };

function makeDeviceKey(): Key {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  return {
    publicKey: Buffer.from(x, 'base64url').toString('base64'),
    sign: (message) => crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function webLogin(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken as string;
}

function mobileLogin(email: string, deviceId: string, key: Key = makeDeviceKey(), password = PASSWORD) {
  return request(app).post('/api/v1/auth/mobile/login').send({
    email,
    password,
    deviceId,
    deviceModel: 'Pixel 8',
    deviceOs: 'Android 15',
    devicePublicKey: key.publicKey,
    devicePublicKeyAlg: 'ED25519',
  });
}

async function signedIn(email: string, deviceId: string, key: Key = makeDeviceKey()) {
  const res = await mobileLogin(email, deviceId, key);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.data.accessToken as string, body: res.body.data, key };
}

/** A project-scoped field route (requireFieldSession). */
const notifications = (token: string, projectId: string) =>
  request(app).get(`/api/v1/projects/${projectId}/notifications`).set(bearer(token));

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  shared = await import('@insite/shared');
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  ids.abj = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'ABJ-108' } })).id;
  ids.lkk = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'LKK-402' } })).id;
  ids.lkkCow = (
    await prisma.fieldAgentSession.findFirstOrThrow({
      where: { projectId: ids.lkk, agentFullName: { contains: 'Resident CoW' } },
    })
  ).id;
  ids.monitorUser = (await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } })).id;
  ids.monitorInspectorRole = (
    await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'MONITOR_INSPECTOR' } })
  ).id;
  ids.residentRole = (
    await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } })
  ).id;
});

after(async () => {
  await prisma?.$disconnect();
  await fs.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

describe('Phase 5 provisioned mobile accounts', { concurrency: false }, () => {
  describe('seed', () => {
    it('marks Monitor Inspector as provisioned with no join codes, and keeps the others on codes', async () => {
      const roles = await prisma.role.findMany({
        where: { tenantId: ids.tenant, surface: { in: ['MOBILE', 'BOTH'] } },
        select: { code: true, onboardingMode: true, requiresIdentityAssurance: true },
      });
      const byCode = Object.fromEntries(roles.map((r) => [r.code, r]));
      assert.equal(byCode.MONITOR_INSPECTOR.onboardingMode, 'PROVISIONED_ACCOUNT');
      assert.equal(byCode.MONITOR_INSPECTOR.requiresIdentityAssurance, false);
      assert.equal(byCode.INDEPENDENT_RESIDENT.onboardingMode, 'JOIN_CODE');
      assert.equal(byCode.CONTRACTOR_ENGINEER.onboardingMode, 'JOIN_CODE');
      const codes = await prisma.projectJoinCode.count({ where: { roleId: ids.monitorInspectorRole } });
      assert.equal(codes, 0);
    });
  });

  describe('sign-in', () => {
    it('signs in a provisioned user and lists both projects with the mobile role', async () => {
      const { body } = await signedIn('monitor@insite.ng', 'device-mon-1');
      assert.equal(body.account.email, 'monitor@insite.ng');
      assert.equal(body.account.mobileRole.code, 'MONITOR_INSPECTOR');
      assert.equal(body.account.mustChangePassword, false);
      // Every ACTIVE assigned project; the seeded draft ENU-501 (also assigned) is not live on mobile.
      assert.deepEqual(
        body.projects.map((p: { codePrefix: string }) => p.codePrefix).sort(),
        // EDO-410 (Phase 7), KWR-502 and OGN-501 (Phase 10) are seeded projects visible through
        // projects:view_all_tenant.
        ['ABJ-108', 'EDO-410', 'KAN-210', 'KWR-502', 'LKK-402', 'OGN-305', 'OGN-501']
      );
      for (const p of body.projects) {
        assert.equal(p.roleName, body.account.mobileRole.name);
        assert.equal(p.fieldPersonaType, 'INDEPENDENT_VERIFIER');
        assert.equal(p.assuranceWeight, 1);
      }
      assert.ok(shared.MobileLoginResponseSchema.safeParse(body).success, 'response matches the shared contract');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'MOBILE_USER_SIGNED_IN', actorId: ids.monitorUser },
      });
      assert.ok(audit, 'sign-in is audited');
    });

    it('refuses a wrong password, a user without mobile access, and a bad device key', async () => {
      const wrong = await mobileLogin('monitor@insite.ng', 'device-mon-x', makeDeviceKey(), 'nope-nope');
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

      const lender = await mobileLogin('lender@insite.ng', 'device-lender');
      assert.equal(lender.status, 403);
      assert.equal(lender.body.error.code, 'NO_MOBILE_ACCESS');

      const badKey = await request(app).post('/api/v1/auth/mobile/login').send({
        email: 'monitor@insite.ng',
        password: PASSWORD,
        deviceId: 'device-mon-badkey',
        devicePublicKey: Buffer.alloc(31, 1).toString('base64') + 'AAAAAAAAAAAA',
        devicePublicKeyAlg: 'ED25519',
      });
      assert.equal(badKey.status, 400);
    });

    it('refuses an inactive account', async () => {
      const admin = await webLogin('admin@insite.ng');
      const created = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(admin))
        .send({
          fullName: 'Inactive Inspector',
          email: 'inactive.inspector@insite.ng',
          password: 'TempPass123',
          roleId: ids.monitorInspectorRole,
          organizationName: 'KPMG Infrastructure & Project Monitoring Advisory',
          projectIds: [ids.lkk],
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const deactivated = await request(app)
        .put(`/api/v1/rbac/users/${created.body.data.id}/assignments`)
        .set(bearer(admin))
        .send({ isActive: false, projectIds: [ids.lkk] });
      assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
      const res = await mobileLogin('inactive.inspector@insite.ng', 'device-inactive', makeDeviceKey(), 'TempPass123');
      assert.equal(res.status, 401);
    });
  });

  describe('sessions', () => {
    it('creates one session per project and device, even under 10 parallel first requests', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-parallel');
      const results = await Promise.all(Array.from({ length: 10 }, () => notifications(token, ids.abj)));
      for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

      const sessions = await prisma.fieldAgentSession.findMany({
        where: { userId: ids.monitorUser, projectId: ids.abj, deviceId: 'device-mon-parallel' },
      });
      assert.equal(sessions.length, 1);
      const s = sessions[0];
      assert.equal(s.origin, 'PROVISIONED_ACCOUNT');
      assert.equal(s.joinCodeId, null);
      assert.equal(s.assuranceStatus, 'APPROVED');
      assert.equal(s.roleId, ids.monitorInspectorRole);
      assert.ok(s.devicePublicKey, 'the device key is copied onto the session');

      // A second project on the same device gets its own session.
      assert.equal((await notifications(token, ids.lkk)).status, 200);
      assert.equal(
        await prisma.fieldAgentSession.count({ where: { userId: ids.monitorUser, deviceId: 'device-mon-parallel' } }),
        2
      );
    });

    it('registers a signed capture under the provisioned session without an assurance step', async () => {
      const { token, key } = await signedIn('monitor@insite.ng', 'device-mon-capture');
      const raw = crypto.randomBytes(64 * 64 * 3);
      const bytes = await sharp(raw, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
      const presign = await request(app)
        .post(`/api/v1/projects/${ids.abj}/evidence/presign`)
        .set(bearer(token))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'capture.bin', mimeType: 'image/png', byteSize: bytes.length });
      assert.equal(presign.status, 200, JSON.stringify(presign.body));
      const url = new URL(presign.body.data.uploadUrl);
      const put = await request(app).put(url.pathname + url.search).set('Content-Type', 'image/png').send(bytes);
      assert.equal(put.status, 200);

      const clientCaptureId = crypto.randomUUID();
      const capturedAt = new Date().toISOString();
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const location = { ...ABJ_POINT, accuracyMeters: 4 };
      const signature = key.sign(
        shared.canonicalCaptureString({
          clientCaptureId,
          projectId: ids.abj,
          mediaType: 'SITE_PHOTO',
          sha256,
          byteSize: bytes.length,
          capturedAt,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters,
          isMockLocation: false,
        })
      );
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/captures`)
        .set(bearer(token))
        .send({
          clientCaptureId,
          wbsItemId: null,
          mediaType: 'SITE_PHOTO',
          objectKey: presign.body.data.objectKey,
          mimeType: 'image/png',
          byteSize: bytes.length,
          sha256,
          capturedAt,
          location,
          isMockLocation: false,
          signature,
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const session = await prisma.fieldAgentSession.findFirstOrThrow({
        where: { userId: ids.monitorUser, projectId: ids.abj, deviceId: 'device-mon-capture' },
      });
      const log = await prisma.auditLog.findFirst({ where: { action: 'CAPTURE_REGISTERED', actorId: session.id } });
      assert.ok(log, 'the capture is attributed to the provisioned session');
      assert.equal(res.body.data.signatureVerified, true, 'signed with the key registered at sign-in');
    });

    it('refuses the join-code-only endpoints for a provisioned account', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-endpoints');
      const deviceKey = await request(app)
        .post('/api/v1/auth/device-key')
        .set(bearer(token))
        .send({ devicePublicKey: makeDeviceKey().publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(deviceKey.status, 403);
      const assurance = await request(app).post('/api/v1/auth/assurance-verification').set(bearer(token)).send({});
      assert.ok([400, 403].includes(assurance.status), `got ${assurance.status}`);
    });

    it('serves /auth/me and the baseline pack', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-me');
      const me = await request(app).get('/api/v1/auth/me').set(bearer(token));
      assert.equal(me.status, 200, JSON.stringify(me.body));
      assert.equal(me.body.data.actorType, 'MOBILE_USER');
      assert.equal(me.body.data.projects.length, 7); // + EDO-410 (Phase 7), KWR-502 and OGN-501 (Phase 10)

      const baseline = await request(app).get(`/api/v1/auth/mobile/projects/${ids.lkk}/baseline`).set(bearer(token));
      assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
      assert.ok(shared.MobileBaselinePackSchema.safeParse(baseline.body.data).success);
      assert.ok(baseline.body.data.boqItems.length > 0);

      const session = await request(app).get(`/api/v1/auth/mobile/projects/${ids.lkk}/session`).set(bearer(token));
      assert.equal(session.status, 200, JSON.stringify(session.body));
      assert.equal(session.body.data.origin, 'PROVISIONED_ACCOUNT');
      assert.equal(session.body.data.roleCode, 'MONITOR_INSPECTOR');
      const row = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: session.body.data.sessionId } });
      assert.equal(row.userId, ids.monitorUser);

      // A join-code session may read its own project's baseline, and no other.
      const cow = bearer(signFieldAgentToken({ sessionId: ids.lkkCow }));
      assert.equal((await request(app).get(`/api/v1/auth/mobile/projects/${ids.lkk}/baseline`).set(cow)).status, 200);
      assert.equal((await request(app).get(`/api/v1/auth/mobile/projects/${ids.abj}/baseline`).set(cow)).status, 403);
    });

    it('keeps an account push token and a join-session push token for the same phone', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-push');
      const deviceToken = 'ExponentPushToken[shared-phone-1]';
      const asAccount = await request(app)
        .post('/api/v1/auth/push-token')
        .set(bearer(token))
        .send({ deviceToken, devicePlatform: 'ANDROID' });
      assert.equal(asAccount.status, 200, JSON.stringify(asAccount.body));
      const asJoin = await request(app)
        .post('/api/v1/auth/push-token')
        .set(bearer(signFieldAgentToken({ sessionId: ids.lkkCow })))
        .send({ deviceToken, devicePlatform: 'ANDROID' });
      assert.equal(asJoin.status, 200);
      const rows = await prisma.pushToken.findMany({ where: { deviceToken } });
      assert.equal(rows.length, 2);
      const account = rows.find((r) => r.userId === ids.monitorUser);
      assert.ok(account?.mobileDeviceId, 'the account token is tied to the device row');
    });
  });

  describe('visibility and password change', () => {
    it('forces a password change, follows assignments, and loses access on the next request when unassigned', async () => {
      const admin = await webLogin('admin@insite.ng');
      const contractorRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'CONTRACTOR' } });

      // A web contractor role (no all-projects permission) plus a separate provisioned mobile role.
      const created = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(admin))
        .send({
          fullName: 'Field Inspector Two',
          email: 'inspector2@insite.ng',
          password: 'TempPass123',
          roleId: contractorRole.id,
          mobileRoleId: ids.monitorInspectorRole,
          phoneNumber: '+234 803 000 1111',
          organizationName: 'KPMG Infrastructure & Project Monitoring Advisory',
          projectIds: [ids.lkk],
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.data.hasMobileAccess, true);
      assert.equal(created.body.data.mobileRoleId, ids.monitorInspectorRole);
      const userId = created.body.data.id as string;

      const key = makeDeviceKey();
      const first = await mobileLogin('inspector2@insite.ng', 'device-insp2', key, 'TempPass123');
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.data.account.mustChangePassword, true);
      const temp = first.body.data.accessToken as string;
      const blocked = await notifications(temp, ids.lkk);
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

      const changed = await request(app)
        .post('/api/v1/auth/mobile/change-password')
        .set(bearer(temp))
        .send({ currentPassword: 'TempPass123', newPassword: 'NewPassw0rd99' });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      const token = changed.body.data.accessToken as string;
      assert.equal((await notifications(temp, ids.lkk)).status, 401, 'the temporary token is revoked');

      const projects = await request(app).get('/api/v1/auth/mobile/projects').set(bearer(token));
      assert.equal(projects.status, 200);
      assert.deepEqual(projects.body.data.map((p: { id: string }) => p.id), [ids.lkk]);
      assert.equal((await notifications(token, ids.lkk)).status, 200);
      const other = await notifications(token, ids.abj);
      assert.equal(other.status, 403);
      assert.equal(other.body.error.code, 'FORBIDDEN_PROJECT_ASSIGNMENT');

      const session = await prisma.fieldAgentSession.findFirstOrThrow({ where: { userId, projectId: ids.lkk } });
      assert.equal(session.agentPhoneNumber, '+234 803 000 1111');

      // Unassign: refused on the very next request.
      const unassign = await request(app)
        .put(`/api/v1/rbac/users/${userId}/assignments`)
        .set(bearer(admin))
        .send({ projectIds: [] });
      assert.equal(unassign.status, 200, JSON.stringify(unassign.body));
      const after = await notifications(token, ids.lkk);
      assert.equal(after.status, 403);

      // Removing the mobile role removes mobile access.
      await request(app)
        .put(`/api/v1/rbac/users/${userId}/assignments`)
        .set(bearer(admin))
        .send({ projectIds: [ids.lkk], mobileRoleId: null });
      const noAccess = await notifications(token, ids.lkk);
      assert.equal(noAccess.status, 403);
      assert.equal(noAccess.body.error.code, 'NO_MOBILE_ACCESS');
    });

    it('refuses a mobile role that is not pre-provisioned', async () => {
      const admin = await webLogin('admin@insite.ng');
      const res = await request(app)
        .put(`/api/v1/rbac/users/${ids.monitorUser}/assignments`)
        .set(bearer(admin))
        .send({ projectIds: [ids.lkk, ids.abj], mobileRoleId: ids.residentRole });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'ROLE_NOT_PROVISIONED');
    });
  });

  describe('token separation', () => {
    it('refuses web tokens on mobile-account routes and mobile tokens on web routes', async () => {
      const web = await webLogin('monitor@insite.ng');
      assert.equal((await request(app).get('/api/v1/auth/mobile/projects').set(bearer(web))).status, 403);
      assert.equal((await request(app).get(`/api/v1/projects/${ids.lkk}/notifications`).set(bearer(web))).status, 403);

      const { token } = await signedIn('monitor@insite.ng', 'device-mon-sep');
      assert.equal((await request(app).get('/api/v1/rbac/roles').set(bearer(token))).status, 403);
      assert.equal((await request(app).get('/api/v1/projects').set(bearer(token))).status, 403);
      assert.equal(
        (await request(app).get(`/api/v1/projects/${ids.lkk}/web-notifications`).set(bearer(token))).status,
        403
      );
    });
  });

  describe('revocation', () => {
    it('revokes one project session without touching the other project', async () => {
      const admin = await webLogin('admin@insite.ng');
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-revoke-one');
      assert.equal((await notifications(token, ids.lkk)).status, 200);
      assert.equal((await notifications(token, ids.abj)).status, 200);
      const lkkSession = await prisma.fieldAgentSession.findFirstOrThrow({
        where: { userId: ids.monitorUser, projectId: ids.lkk, deviceId: 'device-mon-revoke-one' },
      });

      const roster = await request(app).get(`/api/v1/projects/${ids.lkk}/field-sessions`).set(bearer(admin));
      assert.equal(roster.status, 200);
      const row = roster.body.data.find((r: { id: string }) => r.id === lkkSession.id);
      assert.equal(row.origin, 'PROVISIONED_ACCOUNT');
      assert.equal(row.userEmail, 'monitor@insite.ng');
      assert.equal(row.joinCodeUsed, null);

      const revoke = await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/field-sessions/${lkkSession.id}/status`)
        .set(bearer(admin))
        .send({ isActive: false, reason: 'test' });
      assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
      const lkk = await notifications(token, ids.lkk);
      assert.equal(lkk.status, 403);
      assert.equal(lkk.body.error.code, 'SESSION_REVOKED');
      assert.equal((await notifications(token, ids.abj)).status, 200);
    });

    it('revokes a device: every project is blocked and sign-in from it is refused', async () => {
      const admin = await webLogin('admin@insite.ng');
      const { token, body } = await signedIn('monitor@insite.ng', 'device-mon-revoke-all');
      assert.equal((await notifications(token, ids.lkk)).status, 200);

      const devices = await request(app).get('/api/v1/rbac/mobile-devices').set(bearer(admin));
      assert.equal(devices.status, 200);
      assert.ok(devices.body.data.some((d: { id: string }) => d.id === body.account.mobileDeviceId));

      const revoke = await request(app)
        .post(`/api/v1/rbac/mobile-devices/${body.account.mobileDeviceId}/revoke`)
        .set(bearer(admin))
        .send({ reason: 'lost phone' });
      assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
      assert.ok(revoke.body.data.revokedAt);

      for (const projectId of [ids.lkk, ids.abj]) {
        const res = await notifications(token, projectId);
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, 'DEVICE_REVOKED');
      }
      const again = await mobileLogin('monitor@insite.ng', 'device-mon-revoke-all');
      assert.equal(again.status, 403);
      assert.equal(again.body.error.code, 'DEVICE_REVOKED');
      assert.ok(await prisma.auditLog.findFirst({ where: { action: 'MOBILE_DEVICE_REVOKED' } }));

      // Other devices of the same user keep working.
      const other = await signedIn('monitor@insite.ng', 'device-mon-other');
      assert.equal((await notifications(other.token, ids.lkk)).status, 200);
    });
  });

  describe('items re-submitted after a session ends (Step 8)', () => {
    const LKK_POINT = { latitude: 6.4502, longitude: 3.57, accuracyMeters: 5 };

    async function joinLkk(deviceId: string, key: Key) {
      const admin = await webLogin('admin@insite.ng');
      // One active code per role: rotate to get a fresh one (Phase 6).
      const current = await prisma.projectJoinCode.findFirstOrThrow({
        where: { projectId: ids.lkk, roleId: ids.residentRole, isActive: true },
      });
      const code = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes/${current.id}/rotate`)
        .set(bearer(admin))
        .send({});
      assert.equal(code.status, 201, JSON.stringify(code.body));
      const join = await request(app).post('/api/v1/auth/join-project').send({
        joinCode: code.body.data.code,
        agentFullName: 'Rejoining Resident',
        agentPhoneNumber: '+2348012345678',
        deviceId,
        devicePublicKey: key.publicKey,
        devicePublicKeyAlg: 'ED25519',
      });
      assert.equal(join.status, 201, JSON.stringify(join.body));
      return { token: join.body.data.accessToken as string, sessionId: join.body.data.sessionProfile.sessionId as string };
    }

    async function pngBytes() {
      const raw = crypto.randomBytes(64 * 64 * 3);
      return sharp(raw, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    }

    async function uploadPng(token: string, bytes: Buffer) {
      const presign = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/evidence/presign`)
        .set(bearer(token))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'c.png', mimeType: 'image/png', byteSize: bytes.length });
      assert.equal(presign.status, 200, JSON.stringify(presign.body));
      const url = new URL(presign.body.data.uploadUrl);
      const put = await request(app).put(url.pathname + url.search).set('Content-Type', 'image/png').send(bytes);
      assert.equal(put.status, 200);
      return presign.body.data.objectKey as string;
    }

    function captureBody(
      key: Key,
      bytes: Buffer,
      objectKey: string,
      capturedAt: string,
      extra: Record<string, unknown> = {}
    ) {
      const clientCaptureId = crypto.randomUUID();
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const signature = key.sign(
        shared.canonicalCaptureString({
          clientCaptureId,
          projectId: ids.lkk,
          mediaType: 'SITE_PHOTO',
          sha256,
          byteSize: bytes.length,
          capturedAt,
          latitude: LKK_POINT.latitude,
          longitude: LKK_POINT.longitude,
          accuracyMeters: LKK_POINT.accuracyMeters,
          isMockLocation: false,
        })
      );
      return {
        clientCaptureId,
        wbsItemId: null,
        mediaType: 'SITE_PHOTO',
        objectKey,
        mimeType: 'image/png',
        byteSize: bytes.length,
        sha256,
        capturedAt,
        location: LKK_POINT,
        isMockLocation: false,
        signature,
        ...extra,
      };
    }

    const post = (token: string, body: unknown) =>
      request(app).post(`/api/v1/projects/${ids.lkk}/captures`).set(bearer(token)).send(body as object);

    it('accepts an update once, under the new session, flagged and linked; the original keeps its session', async () => {
      const key = makeDeviceKey();
      const deviceId = 'device-rejoin-1';
      const first = await joinLkk(deviceId, key);
      const bytes = await pngBytes();
      const capturedAt = new Date(Date.now() - 3_600_000).toISOString();
      const original = await post(first.token, captureBody(key, bytes, await uploadPng(first.token, bytes), capturedAt));
      assert.equal(original.status, 201, JSON.stringify(original.body));
      const originalId = original.body.data.clientCaptureId as string;

      // The session ends; the same phone rejoins with a new code.
      const admin = await webLogin('admin@insite.ng');
      const revoke = await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/field-sessions/${first.sessionId}/status`)
        .set(bearer(admin))
        .send({ isActive: false });
      assert.equal(revoke.status, 200);
      const second = await joinLkk(deviceId, key);

      const body = captureBody(key, bytes, await uploadPng(second.token, bytes), capturedAt, {
        resubmittedFromClientCaptureId: originalId,
      });
      const updated = await post(second.token, body);
      assert.equal(updated.status, 201, JSON.stringify(updated.body));
      const dto = updated.body.data;
      assert.equal(dto.fieldSessionId, second.sessionId);
      assert.equal(dto.resubmittedFromClientCaptureId, originalId);
      assert.ok(dto.integrityFlags.includes('RESUBMITTED_AFTER_SESSION_END'));
      assert.ok(!dto.integrityFlags.includes('DUPLICATE_PHOTO_SHA256_MATCH'), 'the original is not counted as reuse');
      assert.equal(dto.integrityPassed, true);
      assert.equal(dto.signatureVerified, true, 'signed again for the new capture ID');
      assert.equal(dto.capturedAt, capturedAt, 'the original capture time is kept');

      // Accepted once: a retry returns the same capture.
      const retry = await post(second.token, body);
      assert.ok([200, 201].includes(retry.status), JSON.stringify(retry.body));
      assert.equal(retry.body.data.id, dto.id);
      assert.equal(await prisma.fieldEvidenceLog.count({ where: { resubmittedFromClientCaptureId: originalId } }), 1);

      const orig = await prisma.fieldEvidenceLog.findUniqueOrThrow({ where: { clientCaptureId: originalId } });
      assert.equal(orig.fieldSessionId, first.sessionId, 'never merged into the old session');
    });

    it('accepts an original that never reached the server, and refuses an invalid link', async () => {
      const key = makeDeviceKey();
      const session = await joinLkk('device-rejoin-2', key);
      const bytes = await pngBytes();
      const capturedAt = new Date().toISOString();

      const neverSent = crypto.randomUUID();
      const ok = await post(
        session.token,
        captureBody(key, bytes, await uploadPng(session.token, bytes), capturedAt, {
          resubmittedFromClientCaptureId: neverSent,
        })
      );
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(ok.body.data.resubmittedFromClientCaptureId, neverSent);

      // A capture of a session that is still active cannot be re-submitted by another session.
      const otherKey = makeDeviceKey();
      const other = await joinLkk('device-rejoin-3', otherKey);
      const bytes2 = await pngBytes();
      const bad = await post(
        other.token,
        captureBody(otherKey, bytes2, await uploadPng(other.token, bytes2), capturedAt, {
          resubmittedFromClientCaptureId: ok.body.data.clientCaptureId,
        })
      );
      assert.equal(bad.status, 422, JSON.stringify(bad.body));
      assert.equal(bad.body.error.code, 'INVALID_RESUBMISSION');
    });
  });

  describe('project-wide notifications that need an action (Step 8)', () => {
    it('one session completes a broadcast query; the other sees it answered, not unread', async () => {
      const { createMobileNotification } = await import('../modules/notifications/notifications.service');
      const contractor = await prisma.fieldAgentSession.findFirstOrThrow({
        where: { projectId: ids.lkk, agentFullName: { contains: 'Contractor Site Engr' } },
      });
      const monitorQueryId = crypto.randomUUID();
      const broadcast = await createMobileNotification(prisma, {
        projectId: ids.lkk,
        type: 'REPORT_QUERY',
        actionType: 'OPEN_WBS_CHAT',
        requiresAction: true,
        title: 'Clarification Requested',
        message: 'Send the cube test certificates.',
        metadata: { monitorQueryId },
      });
      const cow = bearer(signFieldAgentToken({ sessionId: ids.lkkCow }));
      const con = bearer(signFieldAgentToken({ sessionId: contractor.id }));

      const resolved = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/notifications/${broadcast.id}/resolve`)
        .set(con);
      assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
      assert.ok(resolved.body.data.actionedAt);

      const list = await request(app).get(`/api/v1/projects/${ids.lkk}/notifications`).set(cow);
      assert.equal(list.status, 200);
      const seen = list.body.data.find((n: { id: string }) => n.id === broadcast.id);
      assert.ok(seen.actionedAt, 'actioned for everyone');
      assert.equal(seen.isRead, true, 'no longer counts as unread for the other session');
      assert.equal(seen.actionedByName, contractor.agentFullName);
    });

    it('maps a monitor query response to every notification it completes', async () => {
      const { createMobileNotification } = await import('../modules/notifications/notifications.service');
      const { markNotificationsActioned } = await import('../modules/notifications/notificationActions');
      const monitorQueryId = crypto.randomUUID();
      const n = await createMobileNotification(prisma, {
        projectId: ids.lkk,
        type: 'REPORT_QUERY',
        actionType: 'OPEN_WBS_CHAT',
        requiresAction: true,
        title: 'Clarification Requested',
        message: 'x',
        metadata: { monitorQueryId },
      });
      const count = await markNotificationsActioned(
        prisma,
        ids.lkk,
        { kind: 'MONITOR_QUERY_ANSWERED', monitorQueryId },
        { userId: ids.monitorUser, name: 'QS Tunde' }
      );
      assert.equal(count, 1);
      const row = await prisma.mobileNotification.findUniqueOrThrow({ where: { id: n.id } });
      assert.equal(row.actionedByUserId, ids.monitorUser);
      // A second completion changes nothing (first answer wins).
      assert.equal(
        await markNotificationsActioned(prisma, ids.lkk, { kind: 'MONITOR_QUERY_ANSWERED', monitorQueryId }, { name: 'x' }),
        0
      );
    });
  });

  describe('role onboarding mode', () => {
    it('switching a role to provisioned deactivates its codes; join sessions keep working; switching back reissues', async () => {
      const admin = await webLogin('admin@insite.ng');
      const before = await prisma.projectJoinCode.count({ where: { roleId: ids.residentRole, isActive: true } });
      assert.ok(before > 0);

      const impact = await request(app).get(`/api/v1/rbac/roles/${ids.residentRole}/onboarding-impact`).set(bearer(admin));
      assert.equal(impact.status, 200);
      assert.equal(impact.body.data.activeJoinCodeCount, before);
      assert.ok(impact.body.data.projects.length > 0);

      const assuranceTrue = await request(app)
        .put(`/api/v1/rbac/roles/${ids.residentRole}`)
        .set(bearer(admin))
        .send({ onboardingMode: 'PROVISIONED_ACCOUNT', requiresIdentityAssurance: true });
      assert.equal(assuranceTrue.status, 400, 'provisioned roles cannot require identity assurance');

      const toProvisioned = await request(app)
        .put(`/api/v1/rbac/roles/${ids.residentRole}`)
        .set(bearer(admin))
        .send({ onboardingMode: 'PROVISIONED_ACCOUNT' });
      assert.equal(toProvisioned.status, 200, JSON.stringify(toProvisioned.body));
      assert.equal(toProvisioned.body.data.onboardingMode, 'PROVISIONED_ACCOUNT');
      assert.equal(toProvisioned.body.data.requiresIdentityAssurance, false);
      assert.equal(await prisma.projectJoinCode.count({ where: { roleId: ids.residentRole, isActive: true } }), 0);
      assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ROLE_ONBOARDING_MODE_CHANGED' } }));

      // Existing join-code sessions for the role keep working until revoked.
      assert.equal((await notifications(signFieldAgentToken({ sessionId: ids.lkkCow }), ids.lkk)).status, 200);

      const issue = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes`)
        .set(bearer(admin))
        .send({ roleId: ids.residentRole });
      assert.equal(issue.status, 409);
      assert.equal(issue.body.error.code, 'ROLE_IS_PROVISIONED');

      const back = await request(app)
        .put(`/api/v1/rbac/roles/${ids.residentRole}`)
        .set(bearer(admin))
        .send({ onboardingMode: 'JOIN_CODE' });
      assert.equal(back.status, 200);
      // Codes are reissued on live projects only (drafts get theirs at activation).
      const projectCount = await prisma.project.count({ where: { tenantId: ids.tenant, status: 'ACTIVE' } });
      assert.equal(await prisma.projectJoinCode.count({ where: { roleId: ids.residentRole, isActive: true } }), projectCount);
    });

    it('a web-only role cannot be provisioned', async () => {
      const admin = await webLogin('admin@insite.ng');
      const lender = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'LENDER' } });
      const res = await request(app)
        .put(`/api/v1/rbac/roles/${lender.id}`)
        .set(bearer(admin))
        .send({ onboardingMode: 'PROVISIONED_ACCOUNT' });
      assert.equal(res.status, 400);
    });

    it('switching the mobile role back to join codes removes mobile access on the next request', async () => {
      const admin = await webLogin('admin@insite.ng');
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-mode');
      assert.equal((await notifications(token, ids.lkk)).status, 200);
      const res = await request(app)
        .put(`/api/v1/rbac/roles/${ids.monitorInspectorRole}`)
        .set(bearer(admin))
        .send({ onboardingMode: 'JOIN_CODE' });
      assert.equal(res.status, 200);
      const after = await notifications(token, ids.lkk);
      assert.equal(after.status, 403);
      assert.equal(after.body.error.code, 'NO_MOBILE_ACCESS');
      const login = await mobileLogin('monitor@insite.ng', 'device-mon-mode');
      assert.equal(login.status, 403);
      assert.equal(login.body.error.code, 'NO_MOBILE_ACCESS');
    });
  });
});
