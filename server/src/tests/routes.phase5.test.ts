/**
 * Phase 5 route-level tests: provisioned mobile accounts. Sign-in and each refusal, lazy and
 * idempotent session creation, visibility that follows assignments, role onboarding-mode switches,
 * the assurance gate, device and session revocation, and token-type separation.
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts).
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth, fieldToken as sessionToken } from './helpers/fieldAuth';
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

/** The key id the server derives from a public key (first 16 hex of its SHA-256). */
const keyIdOf = (key: Key) => crypto.createHash('sha256').update(Buffer.from(key.publicKey, 'base64')).digest('hex').slice(0, 16);

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
    it('has only verifier mobile roles, no contractor roles, and every session belongs to an account (R1d)', async () => {
      const roles = await prisma.role.findMany({
        where: { tenantId: ids.tenant, surface: { in: ['MOBILE', 'BOTH'] } },
        select: { code: true, fieldPersonaType: true },
      });
      const codes = roles.map((r) => r.code).sort();
      assert.ok(codes.includes('MONITOR_INSPECTOR') && codes.includes('INDEPENDENT_RESIDENT'));
      assert.ok(roles.every((r) => r.fieldPersonaType !== 'CONTRACTOR_EXECUTOR'));
      assert.equal(await prisma.role.count({ where: { tenantId: ids.tenant, code: { in: ['CONTRACTOR', 'CONTRACTOR_ENGINEER'] } } }), 0);
      const sessions = await prisma.fieldAgentSession.findMany({ select: { userId: true, mobileDeviceId: true } });
      assert.ok(sessions.length > 0);
      assert.ok(sessions.every((s) => s.userId && s.mobileDeviceId), 'seeded sessions are provisioned');
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
      assert.equal(s.userId, ids.monitorUser);
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

    it('has no join-code-era endpoints any more (R1d)', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-endpoints');
      const deviceKey = await request(app)
        .post('/api/v1/auth/device-key')
        .set(bearer(token))
        .send({ devicePublicKey: makeDeviceKey().publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(deviceKey.status, 404);
      const assurance = await request(app).post('/api/v1/auth/assurance-verification').set(bearer(token)).send({});
      assert.equal(assurance.status, 404);
      const join = await request(app).post('/api/v1/auth/join-project').send({});
      assert.equal(join.status, 404);
    });

    it('refuses a retired join-code session token (R1d)', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const { env } = await import('../config/env');
      const legacy = jwt.sign({ tokenType: 'FIELD_AGENT', sessionId: ids.lkkCow }, env.JWT_SECRET);
      const res = await notifications(legacy, ids.lkk);
      assert.equal(res.status, 401);
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
      assert.equal(session.body.data.origin, undefined);
      assert.equal(session.body.data.roleCode, 'MONITOR_INSPECTOR');
      const row = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: session.body.data.sessionId } });
      assert.equal(row.userId, ids.monitorUser);

      // A resident assigned to one project reads its baseline, and no other.
      const cow = bearer((await sessionToken(prisma, ids.lkkCow)));
      assert.equal((await request(app).get(`/api/v1/auth/mobile/projects/${ids.lkk}/baseline`).set(cow)).status, 200);
      assert.equal((await request(app).get(`/api/v1/auth/mobile/projects/${ids.abj}/baseline`).set(cow)).status, 403);
    });

    it('keeps one push token per account when two accounts share a phone', async () => {
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-push');
      const deviceToken = 'ExponentPushToken[shared-phone-1]';
      const asAccount = await request(app)
        .post('/api/v1/auth/push-token')
        .set(bearer(token))
        .send({ deviceToken, devicePlatform: 'ANDROID' });
      assert.equal(asAccount.status, 200, JSON.stringify(asAccount.body));
      const asResident = await request(app)
        .post('/api/v1/auth/push-token')
        .set(bearer((await sessionToken(prisma, ids.lkkCow))))
        .send({ deviceToken, devicePlatform: 'ANDROID' });
      assert.equal(asResident.status, 200);
      const rows = await prisma.pushToken.findMany({ where: { deviceToken } });
      assert.equal(rows.length, 2);
      const account = rows.find((r) => r.userId === ids.monitorUser);
      assert.ok(account?.mobileDeviceId, 'the account token is tied to the device row');
    });
  });

  describe('visibility and password change', () => {
    it('forces a password change, follows assignments, and loses access on the next request when unassigned', async () => {
      const admin = await webLogin('admin@insite.ng');
      const webRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'ORGANIZATION_ADMIN' } });

      // A web role without the all-projects permission plus a separate mobile role.
      const created = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(admin))
        .send({
          fullName: 'Field Inspector Two',
          email: 'inspector2@insite.ng',
          password: 'TempPass123',
          roleId: webRole.id,
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

    it('refuses a web-only role as the mobile role', async () => {
      const admin = await webLogin('admin@insite.ng');
      const lender = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'LENDER' } });
      const res = await request(app)
        .put(`/api/v1/rbac/users/${ids.monitorUser}/assignments`)
        .set(bearer(admin))
        .send({ projectIds: [ids.lkk, ids.abj], mobileRoleId: lender.id });
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
      assert.equal(row.origin, undefined);
      assert.equal(row.userEmail, 'monitor@insite.ng');
      assert.equal(row.userId, ids.monitorUser);

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

    /** R1d: a resident account on LKK-402 signed in on a device with `key`, and its session. */
    async function residentOnLkk(deviceId: string, key: Key) {
      const s = await createFieldSession(prisma, { projectId: ids.lkk, roleId: ids.residentRole, name: 'Rejoining Resident', key: { ...key, keyId: keyIdOf(key) }, deviceId });
      return { token: await sessionToken(prisma, s.sessionId), sessionId: s.sessionId };
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
      const first = await residentOnLkk(deviceId, key);
      const bytes = await pngBytes();
      const capturedAt = new Date(Date.now() - 3_600_000).toISOString();
      const original = await post(first.token, captureBody(key, bytes, await uploadPng(first.token, bytes), capturedAt));
      assert.equal(original.status, 201, JSON.stringify(original.body));
      const originalId = original.body.data.clientCaptureId as string;

      // The session ends; the person carries on under a new session (another account on the phone).
      const admin = await webLogin('admin@insite.ng');
      const revoke = await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/field-sessions/${first.sessionId}/status`)
        .set(bearer(admin))
        .send({ isActive: false });
      assert.equal(revoke.status, 200);
      const second = await residentOnLkk(deviceId, key);

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
      const session = await residentOnLkk('device-rejoin-2', key);
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
      const other = await residentOnLkk('device-rejoin-3', otherKey);
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
        where: { projectId: ids.lkk, agentFullName: { contains: 'M&E Officer' } },
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
      const cow = bearer((await sessionToken(prisma, ids.lkkCow)));
      const con = bearer((await sessionToken(prisma, contractor.id)));

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

  describe('mobile roles (R1d: every mobile role signs in with an account)', () => {
    it('the role editor refuses the contractor persona', async () => {
      const admin = await webLogin('admin@insite.ng');
      const res = await request(app)
        .put(`/api/v1/rbac/roles/${ids.residentRole}`)
        .set(bearer(admin))
        .send({ fieldPersonaType: 'CONTRACTOR_EXECUTOR' });
      assert.equal(res.status, 400);
      const impact = await request(app).get(`/api/v1/rbac/roles/${ids.residentRole}/onboarding-impact`).set(bearer(admin));
      assert.equal(impact.status, 404);
    });

    it('making the mobile role web-only removes mobile access on the next request', async () => {
      const admin = await webLogin('admin@insite.ng');
      const { token } = await signedIn('monitor@insite.ng', 'device-mon-mode');
      assert.equal((await notifications(token, ids.lkk)).status, 200);
      const res = await request(app)
        .put(`/api/v1/rbac/roles/${ids.monitorInspectorRole}`)
        .set(bearer(admin))
        .send({ surface: 'WEB', fieldPersonaType: 'NONE' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after = await notifications(token, ids.lkk);
      assert.equal(after.status, 403);
      assert.equal(after.body.error.code, 'NO_MOBILE_ACCESS');
      const login = await mobileLogin('monitor@insite.ng', 'device-mon-mode');
      assert.equal(login.status, 403);
      assert.equal(login.body.error.code, 'NO_MOBILE_ACCESS');
    });
  });
});
