/**
 * Redesign R7 route tests: mobile-only roles have no web sign-in.
 *
 * resident.supervisor@ubec.test (Resident Supervisor, INDEPENDENT_RESIDENT, surface MOBILE) is refused
 * at web sign-in and on a web token minted before the rule; me.officer@ubec.test (UBEC M&E Officer,
 * surface BOTH) signs in on the web and on the field app with the same password.
 */
import { resetTestDatabase } from './helpers/testDb';
import { makeTestDeviceKey } from './helpers/fieldAuth';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
type PrismaClientType = typeof import('../config/prisma')['prisma'];
let prisma: PrismaClientType;
let signWebUserToken: typeof import('../middleware/auth.middleware')['signWebUserToken'];

const PASSWORD = 'Password123!';
const RESIDENT = 'resident.supervisor@ubec.test';
const ME_OFFICER = 'me.officer@ubec.test';
const MESSAGE = 'This account is for the field app. Sign in on the mobile app instead.';

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signWebUserToken } = await import('../middleware/auth.middleware'));
  const { createApp } = await import('../app');
  app = createApp();
});

function mobileLogin(email: string, deviceId: string) {
  const key = makeTestDeviceKey();
  return request(app).post('/api/v1/auth/mobile/login').send({
    email,
    password: PASSWORD,
    deviceId,
    deviceModel: 'Pixel 8',
    deviceOs: 'Android 15',
    devicePublicKey: key.publicKey,
    devicePublicKeyAlg: 'ED25519',
  });
}

describe('Redesign R7: mobile-only roles have no web sign-in', () => {
  it('refuses the Resident Supervisor at web sign-in with 403 WEB_ACCESS_NOT_ALLOWED', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: RESIDENT, password: PASSWORD });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'WEB_ACCESS_NOT_ALLOWED');
    assert.equal(res.body.error.message, MESSAGE);
    assert.equal(res.body.data, undefined, 'no token is issued');
  });

  it('a wrong password is still INVALID_CREDENTIALS (the surface is not revealed)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: RESIDENT, password: 'not-the-password' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('the Resident Supervisor still signs in on the field app', async () => {
    const res = await mobileLogin(RESIDENT, 'r7b-resident-device');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.accessToken);
  });

  it('an M&E officer (surface BOTH) signs in on the web and the field app with the same password', async () => {
    const webRes = await request(app).post('/api/v1/auth/login').send({ email: ME_OFFICER, password: PASSWORD });
    assert.equal(webRes.status, 200, JSON.stringify(webRes.body));
    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${webRes.body.data.accessToken}` });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.actorType, 'WEB_USER');

    const mobileRes = await mobileLogin(ME_OFFICER, 'r7b-me-device');
    assert.equal(mobileRes.status, 200, JSON.stringify(mobileRes.body));
    assert.ok(mobileRes.body.data.accessToken);

    // The web token survives the mobile sign-in (no token-version bump).
    const meAgain = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${webRes.body.data.accessToken}` });
    assert.equal(meAgain.status, 200, JSON.stringify(meAgain.body));
  });

  it('a web token issued to the Resident Supervisor before the rule is refused on web endpoints', async () => {
    const resident = await prisma.user.findUniqueOrThrow({ where: { email: RESIDENT } });
    const token = signWebUserToken({ userId: resident.id, tenantId: resident.tenantId, tokenVersion: resident.tokenVersion });
    const auth = { Authorization: `Bearer ${token}` };
    for (const path of ['/api/v1/auth/me', '/api/v1/projects']) {
      const res = await request(app).get(path).set(auth);
      assert.equal(res.status, 403, `${path}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error.code, 'WEB_ACCESS_NOT_ALLOWED', path);
    }
    const change = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: 'Another-Password-123!' });
    assert.equal(change.status, 403, JSON.stringify(change.body));
    assert.equal(change.body.error.code, 'WEB_ACCESS_NOT_ALLOWED');
  });
});
