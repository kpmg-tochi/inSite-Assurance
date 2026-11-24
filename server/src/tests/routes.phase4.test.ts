/**
 * Phase 4 route-level tests: capture registration, integrity screening with real image bytes,
 * device signatures, notification read state, honest transcription fallbacks and incident
 * idempotency. Redesign R5f removed workday reports, report queries, the summary assist and WBS
 * chat (and their tests).
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts). Uploads use
 * the local-disk storage mode (no S3), through the same presign -> PUT -> register flow as devices.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
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

const ids = {
  tenant: '',
  abj: '',
  lkk: '',
  abjCow: '',
  lkkCow: '',
  lkkContractor: '',
};

const ABJ_POINT = { latitude: 9.0489, longitude: 7.3497 };
const LKK_POINT = { latitude: 6.4502, longitude: 3.57 };
const FAR_AWAY = { latitude: 4.8156, longitude: 7.0498 }; // Port Harcourt

const fieldHeaders = (sessionId: string) => fieldAuth(prisma, sessionId);

// ---------------------------------------------------------------------------
// Image fixtures: real pixels, so the perceptual hash is computed from content.
// ---------------------------------------------------------------------------

let nextSeed = 1;

/**
 * A distinct picture per call: an 8x8 grid of seeded grey levels with a soft gradient, so two
 * fixtures never share a perceptual hash by accident, while a recompressed copy still does.
 */
async function renderImage(_kind?: string, size = 256): Promise<Buffer> {
  let state = (nextSeed++ * 2654435761) >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const grid = Array.from({ length: 64 }, () => Math.floor(rand() * 256));
  const raw = Buffer.alloc(size * size * 3);
  const cell = size / 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.min(255, grid[Math.floor(y / cell) * 8 + Math.floor(x / cell)] + Math.floor((x / size) * 20));
      const i = (y * size + x) * 3;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** The same picture, resized and recompressed as JPEG: different bytes, same content. */
async function recompress(png: Buffer): Promise<Buffer> {
  return sharp(png).resize(200, 200).jpeg({ quality: 70 }).toBuffer();
}

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

type Key = { publicKey: string; sign: (message: string) => string };

function makeDeviceKey(): Key {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  return {
    publicKey: Buffer.from(x, 'base64url').toString('base64'),
    sign: (message) => crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  };
}

async function upload(sessionId: string, projectId: string, bytes: Buffer, mediaType: string, mimeType: string) {
  const presign = await request(app)
    .post(`/api/v1/projects/${projectId}/evidence/presign`)
    .set(await fieldHeaders(sessionId))
    .send({ mediaType, fileName: 'capture.bin', mimeType, byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  assert.equal(presign.body.data.storageMode, 'LOCAL_DEV_SIMULATED');
  const url = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(url.pathname + url.search).set('Content-Type', mimeType).send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return presign.body.data.objectKey as string;
}

async function registerCapture(params: {
  sessionId: string;
  projectId: string;
  bytes: Buffer;
  mediaType?: string;
  mimeType?: string;
  location?: { latitude: number; longitude: number } | null;
  isMockLocation?: boolean;
  key?: Key;
  tamper?: boolean;
  clientCaptureId?: string;
  objectKey?: string;
}) {
  const mediaType = params.mediaType ?? 'SITE_PHOTO';
  const mimeType = params.mimeType ?? 'image/png';
  const objectKey = params.objectKey ?? (await upload(params.sessionId, params.projectId, params.bytes, mediaType, mimeType));
  const clientCaptureId = params.clientCaptureId ?? crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const location =
    params.location === null ? null : { ...(params.location ?? ABJ_POINT), accuracyMeters: 4.5 };
  const body = {
    clientCaptureId,
    mediaType,
    objectKey,
    mimeType,
    byteSize: params.bytes.length,
    sha256: sha256(params.bytes),
    capturedAt,
    location,
    isMockLocation: params.isMockLocation ?? false,
    signature: null as string | null,
  };
  if (params.key) {
    const message = shared.canonicalCaptureString({
      clientCaptureId,
      projectId: params.projectId,
      mediaType,
      sha256: body.sha256,
      byteSize: body.byteSize,
      capturedAt,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracyMeters: location?.accuracyMeters ?? null,
      isMockLocation: body.isMockLocation,
    });
    body.signature = params.key.sign(params.tamper ? `${message}x` : message);
  }
  const res = await request(app)
    .post(`/api/v1/projects/${params.projectId}/captures`)
    .set(await fieldHeaders(params.sessionId))
    .send(body);
  return { res, body };
}

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
  ids.abjCow = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.abj } })).id;
  ids.lkkCow = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.lkk, agentFullName: { contains: 'Resident CoW' } } })).id;
  // R1d: the second LKK-402 field session is an M&E officer (it holds the old contractor engineer's data).
  ids.lkkContractor = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.lkk, agentFullName: { contains: 'M&E Officer' } } })).id;
});

after(async () => {
  await prisma?.$disconnect();
  await fs.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

describe('Phase 4 field evidence pipeline', () => {
  describe('local storage and capture registration', () => {
    it('uploads through signed local URLs and refuses a tampered or mismatched upload', async () => {
      const bytes = await renderImage('scene');
      const presign = await request(app)
        .post(`/api/v1/projects/${ids.abj}/evidence/presign`)
        .set(await fieldHeaders(ids.abjCow))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'a.png', mimeType: 'image/png', byteSize: bytes.length });
      const url = new URL(presign.body.data.uploadUrl);

      const wrongType = await request(app).put(url.pathname + url.search).set('Content-Type', 'image/jpeg').send(bytes);
      assert.equal(wrongType.status, 400);
      const tampered = url.search.replace(/sig=[0-9a-f]{4}/, 'sig=0000');
      const badSig = await request(app).put(url.pathname + tampered).set('Content-Type', 'image/png').send(bytes);
      assert.equal(badSig.status, 403);
    });

    it('rejects registration before the object is uploaded', async () => {
      const bytes = await renderImage('checker');
      const presign = await request(app)
        .post(`/api/v1/projects/${ids.abj}/evidence/presign`)
        .set(await fieldHeaders(ids.abjCow))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'a.png', mimeType: 'image/png', byteSize: bytes.length });
      const { res } = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes,
        objectKey: presign.body.data.objectKey,
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'OBJECT_NOT_UPLOADED');
    });

    it('is idempotent on clientCaptureId and refuses the same ID from another session', async () => {
      const bytes = await renderImage('stripes');
      const objectKey = await upload(ids.abjCow, ids.abj, bytes, 'SITE_PHOTO', 'image/png');
      const clientCaptureId = crypto.randomUUID();
      const first = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes, objectKey, clientCaptureId });
      assert.equal(first.res.status, 201, JSON.stringify(first.res.body));
      const retry = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes, objectKey, clientCaptureId });
      assert.equal(retry.res.status, 200);
      assert.equal(retry.res.body.data.id, first.res.body.data.id);
      assert.equal(await prisma.fieldEvidenceLog.count({ where: { clientCaptureId } }), 1);

      const other = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/captures`)
        .set(await fieldHeaders(ids.lkkCow))
        .send({ ...first.body, objectKey: objectKey.replace(ids.abj, ids.lkk) });
      assert.equal(other.status, 409);
      assert.equal(other.body.error.code, 'CAPTURE_ID_CONFLICT');
    });

    it('computes the server hash and records no location as unknown, never as in-geofence', async () => {
      const bytes = await renderImage('checker', 192);
      const { res } = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes, location: null });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const c = res.body.data;
      assert.equal(c.serverSha256, sha256(bytes));
      assert.match(c.perceptualHash, /^[0-9a-f]{16}$/);
      assert.equal(c.locationAvailable, false);
      assert.equal(c.isWithinGeofence, null);
      assert.ok(c.integrityFlags.includes('LOCATION_UNAVAILABLE'));
      assert.equal(c.integrityPassed, true);
    });

    it('evaluates the geofence on the server and flags a mock location as critical', async () => {
      const far = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: await renderImage('scene', 210),
        location: FAR_AWAY,
      });
      assert.equal(far.res.body.data.isWithinGeofence, false);
      assert.ok(far.res.body.data.integrityFlags.includes('OUTSIDE_PROJECT_GEOFENCE'));

      const mock = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: await renderImage('stripes', 220),
        isMockLocation: true,
      });
      assert.equal(mock.res.body.data.integrityPassed, false);
      assert.equal(mock.res.body.data.status, 'FLAGGED_INTEGRITY');
      const audit = await prisma.auditLog.findFirst({
        where: { projectId: ids.abj, action: 'CAPTURE_FLAGGED_INTEGRITY' },
        orderBy: { seq: 'desc' },
      });
      assert.ok(audit);
    });
  });

  describe('duplicate and near-duplicate detection', () => {
    it('flags an exact byte duplicate across projects in the tenant', async () => {
      const bytes = await renderImage('scene', 240);
      const original = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes });
      assert.equal(original.res.body.data.integrityPassed, true, JSON.stringify(original.res.body.data.integrityFlags));
      const copy = await registerCapture({ sessionId: ids.lkkCow, projectId: ids.lkk, bytes, location: LKK_POINT });
      assert.ok(copy.res.body.data.integrityFlags.includes('DUPLICATE_PHOTO_SHA256_MATCH'));
      assert.equal(copy.res.body.data.integrityPassed, false);
    });

    it('flags a recompressed copy from another reporter, but not a different picture', async () => {
      const png = await renderImage('scene', 250);
      const original = await registerCapture({ sessionId: ids.lkkContractor, projectId: ids.lkk, bytes: png, location: LKK_POINT });
      assert.equal(original.res.body.data.integrityPassed, true);

      const jpeg = await recompress(png);
      assert.notEqual(sha256(jpeg), sha256(png));
      const recycled = await registerCapture({
        sessionId: ids.lkkCow,
        projectId: ids.lkk,
        bytes: jpeg,
        mimeType: 'image/jpeg',
        location: LKK_POINT,
      });
      assert.ok(
        recycled.res.body.data.integrityFlags.includes('RECYCLED_PHOTO_PHASH_SIMILARITY'),
        JSON.stringify(recycled.res.body.data.integrityFlags)
      );

      const different = await registerCapture({
        sessionId: ids.lkkCow,
        projectId: ids.lkk,
        bytes: await sharp(await renderImage('checker', 250)).jpeg({ quality: 70 }).toBuffer(),
        mimeType: 'image/jpeg',
        location: LKK_POINT,
      });
      const flags: string[] = different.res.body.data.integrityFlags;
      assert.ok(!flags.includes('RECYCLED_PHOTO_PHASH_SIMILARITY') && !flags.includes('DUPLICATE_PHOTO_SHA256_MATCH'));
    });

    it('treats a near-duplicate from the same reporter within hours as a burst, not reuse', async () => {
      const png = await renderImage('stripes', 230);
      await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes: png });
      const burst = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: await recompress(png),
        mimeType: 'image/jpeg',
      });
      assert.ok(burst.res.body.data.integrityFlags.includes('SIMILAR_TO_RECENT_OWN_CAPTURE'));
      assert.equal(burst.res.body.data.integrityPassed, true);
    });
  });

  describe('device signatures', () => {
    // R1d: the key comes with the account's device at sign-in (no separate device-key registration).
    let signer = '';
    let key: Key;
    before(async () => {
      const s = await createFieldSession(prisma, { projectId: ids.abj, roleCode: 'INDEPENDENT_RESIDENT', name: 'Signing Officer' });
      signer = s.sessionId;
      key = s.key;
    });

    it('has no device-key registration endpoint any more', async () => {
      const res = await request(app)
        .post('/api/v1/auth/device-key')
        .set(await fieldHeaders(signer))
        .send({ devicePublicKey: makeDeviceKey().publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(res.status, 404);
    });

    it('verifies a valid capture signature and fails a tampered one', async () => {
      const good = await registerCapture({ sessionId: signer, projectId: ids.abj, bytes: await renderImage('checker', 160), key });
      assert.equal(good.res.body.data.signatureVerified, true);
      assert.equal(good.res.body.data.integrityPassed, true);

      const bad = await registerCapture({
        sessionId: signer,
        projectId: ids.abj,
        bytes: await renderImage('checker', 170),
        key,
        tamper: true,
      });
      assert.equal(bad.res.body.data.signatureVerified, false);
      assert.ok(bad.res.body.data.integrityFlags.includes('SIGNATURE_INVALID'));
      assert.equal(bad.res.body.data.integrityPassed, false);
    });

    it('flags an unsigned capture from a device that has a key, without failing it', async () => {
      const unsigned = await registerCapture({ sessionId: signer, projectId: ids.abj, bytes: await renderImage('scene', 180) });
      assert.equal(unsigned.res.body.data.signatureVerified, null);
      assert.ok(unsigned.res.body.data.integrityFlags.includes('UNSIGNED'));
    });
  });

  describe('Phase 2 and 3 carry-overs', () => {
    it('keeps notification read state per field session', async () => {
      const other = { id: (await createFieldSession(prisma, { projectId: ids.abj, roleCode: 'INDEPENDENT_RESIDENT', name: 'Second Reader' })).sessionId };
      const broadcast = await prisma.mobileNotification.create({
        data: {
          projectId: ids.abj,
          fieldSessionId: null,
          type: 'DEFECT_UPDATE',
          actionType: 'NONE',
          title: 'Broadcast for read-state test',
          message: 'Everyone on the project sees this.',
        },
      });
      const mark = await request(app)
        .patch(`/api/v1/projects/${ids.abj}/notifications/${broadcast.id}/read`)
        .set(await fieldHeaders(ids.abjCow));
      assert.equal(mark.status, 200, JSON.stringify(mark.body));
      assert.equal(mark.body.data.isRead, true);

      const forReader = await request(app).get(`/api/v1/projects/${ids.abj}/notifications`).set(await fieldHeaders(ids.abjCow));
      const forOther = await request(app).get(`/api/v1/projects/${ids.abj}/notifications`).set(await fieldHeaders(other.id));
      const find = (res: request.Response) => res.body.data.find((n: { id: string }) => n.id === broadcast.id);
      assert.equal(find(forReader).isRead, true);
      assert.equal(find(forOther).isRead, false);
    });
  });

  describe('honest transcription fallback', () => {
    it('leaves a voice note PENDING, with no invented text, when no speech provider is configured', async () => {
      const audio = crypto.randomBytes(2048);
      const voice = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: audio,
        mediaType: 'VOICE_NOTE',
        mimeType: 'audio/mp4',
      });
      assert.equal(voice.res.status, 201, JSON.stringify(voice.res.body));
      assert.equal(voice.res.body.data.transcriptionStatus, 'PENDING');
      assert.equal(voice.res.body.data.transcript, null);
      assert.equal('wbsItemId' in voice.res.body.data, false, 'R5f: captures no longer name a BoQ line');
    });
  });

  describe('incident idempotency', () => {
    it('stores an incident once and refuses device file paths', async () => {
      const body = {
        clientIncidentId: crypto.randomUUID(),
        category: 'CRITICAL_DELAY',
        title: 'Crane down',
        description: 'Tower crane hydraulic failure, lifting halted.',
      };
      const url = `/api/v1/projects/${ids.abj}/incidents`;
      const first = await request(app).post(url).set(await fieldHeaders(ids.abjCow)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const retry = await request(app).post(url).set(await fieldHeaders(ids.abjCow)).send(body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.data.id, first.body.data.id);
      const filePath = await request(app)
        .post(url)
        .set(await fieldHeaders(ids.abjCow))
        .send({ ...body, clientIncidentId: crypto.randomUUID(), photoEvidenceUrls: ['file:///data/photo.jpg'] });
      assert.equal(filePath.status, 400);
    });
  });
});
