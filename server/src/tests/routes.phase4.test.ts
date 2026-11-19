/**
 * Phase 4 route-level tests: capture registration, integrity screening with real image bytes,
 * device signatures, idempotent reports, the assurance gate, staged release, honest AI fallbacks,
 * telemetry and chat idempotency, and the evidence provider feeding reconciliation.
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts). Uploads use
 * the local-disk storage mode (no S3), through the same presign -> PUT -> register flow as devices.
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
let aiCheck: typeof import('../modules/workday-reports/aiOmissionCheck');
let provider: typeof import('../modules/evidence/evidenceProvider');
let engine: typeof import('../modules/reconciliation/reconciliationEngine');

const PASSWORD = 'Password123!';
const scheduled: string[] = [];

const ids = {
  tenant: '',
  abj: '',
  lkk: '',
  abjCow: '',
  lkkCow: '',
  lkkContractor: '',
  lkkPending: '',
  pvModules: '',
  culvertConcrete: '',
  stoneBase: '',
  culvertReinforcement: '',
  rebarReport: '',
  rebarQuery: '',
};

const ABJ_POINT = { latitude: 9.0489, longitude: 7.3497 };
const LKK_POINT = { latitude: 6.4502, longitude: 3.57 };
const FAR_AWAY = { latitude: 4.8156, longitude: 7.0498 }; // Port Harcourt

const fieldHeaders = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

async function webHeaders(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}

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
    .set(fieldHeaders(sessionId))
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
  wbsItemId?: string | null;
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
    wbsItemId: params.wbsItemId ?? null,
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
    .set(fieldHeaders(params.sessionId))
    .send(body);
  return { res, body };
}

let periodOffset = 0;
/** Each report gets its own period unless a test sets one: one report per reporter, item and period. */
function nextPeriod(): string {
  periodOffset += 1;
  return shared.calendarDateInTimeZone(new Date(Date.UTC(2025, 0, 1) + periodOffset * 86_400_000), 'UTC');
}

/**
 * A valid report body. Each gets its own reporting day unless the test sets one; `confirmedAt` is
 * midday of that day, so it matches the project time zone (Africa/Lagos) as the server requires.
 */
function reportBody(overrides: Record<string, unknown> = {}) {
  const workdayDate = (overrides.workdayDate as string | undefined) ?? nextPeriod();
  return {
    clientReportId: crypto.randomUUID(),
    wbsItemId: ids.pvModules,
    workdayDate,
    reporterTimezone: 'Africa/Lagos',
    summaryText: 'Installed PV modules on row C.',
    reportedQuantity: 100,
    unitOfMeasure: 'kWp',
    isHoldPointClaimed: false,
    clientCaptureIds: [] as string[],
    textNotes: [],
    submissionGeotag: { ...ABJ_POINT, accuracyMeters: 5, isMocked: false, capturedAt: `${workdayDate}T11:59:00.000Z` },
    confirmedAt: `${workdayDate}T12:00:00.000Z`,
    confirmedAsFinal: true,
    ...overrides,
  };
}

const todayInLagos = () => shared.calendarDateInTimeZone(new Date(), 'Africa/Lagos');

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  shared = await import('@insite/shared');
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  aiCheck = await import('../modules/workday-reports/aiOmissionCheck');
  provider = await import('../modules/evidence/evidenceProvider');
  engine = await import('../modules/reconciliation/reconciliationEngine');
  const { seedDatabase } = await import('../db/seedDatabase');
  const { createApp } = await import('../app');
  await seedDatabase();
  app = createApp();
  aiCheck.setAiOmissionCheckScheduler((id) => scheduled.push(id));

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  ids.abj = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'ABJ-108' } })).id;
  ids.lkk = (await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'LKK-402' } })).id;
  ids.abjCow = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.abj } })).id;
  ids.lkkCow = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.lkk, agentFullName: { contains: 'Resident CoW' } } })).id;
  ids.lkkContractor = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.lkk, agentFullName: { contains: 'Contractor Site Engr' } } })).id;
  ids.lkkPending = (await prisma.fieldAgentSession.findFirstOrThrow({ where: { projectId: ids.lkk, assuranceStatus: 'PENDING_APPROVAL' } })).id;
  ids.pvModules = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.abj, wbsCode: '02.01.1' } })).id;
  ids.culvertConcrete = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk, unit: 'm3' } })).id;
  ids.stoneBase = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk, unit: 'm2' } })).id;
  ids.culvertReinforcement = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk, unit: 'tons' } })).id;
  const rebarQuery = await prisma.reportQuery.findFirstOrThrow({
    where: { projectId: ids.lkk, boqItemId: ids.culvertReinforcement, status: 'OPEN' },
  });
  ids.rebarQuery = rebarQuery.id;
  ids.rebarReport = rebarQuery.workdayReportId!;
});

after(async () => {
  aiCheck?.setAiOmissionCheckScheduler(null);
  await prisma?.$disconnect();
  await fs.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

describe('Phase 4 field evidence pipeline', () => {
  describe('local storage and capture registration', () => {
    it('uploads through signed local URLs and refuses a tampered or mismatched upload', async () => {
      const bytes = await renderImage('scene');
      const presign = await request(app)
        .post(`/api/v1/projects/${ids.abj}/evidence/presign`)
        .set(fieldHeaders(ids.abjCow))
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
        .set(fieldHeaders(ids.abjCow))
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
        .set(fieldHeaders(ids.lkkCow))
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
    const key = makeDeviceKey();

    it('registers a device key once and refuses a different key later', async () => {
      const first = await request(app)
        .post('/api/v1/auth/device-key')
        .set(fieldHeaders(ids.abjCow))
        .send({ devicePublicKey: key.publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const same = await request(app)
        .post('/api/v1/auth/device-key')
        .set(fieldHeaders(ids.abjCow))
        .send({ devicePublicKey: key.publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(same.status, 200);
      const swap = await request(app)
        .post('/api/v1/auth/device-key')
        .set(fieldHeaders(ids.abjCow))
        .send({ devicePublicKey: makeDeviceKey().publicKey, devicePublicKeyAlg: 'ED25519' });
      assert.equal(swap.status, 409);
    });

    it('verifies a valid capture signature and fails a tampered one', async () => {
      const good = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes: await renderImage('checker', 160), key });
      assert.equal(good.res.body.data.signatureVerified, true);
      assert.equal(good.res.body.data.integrityPassed, true);

      const bad = await registerCapture({
        sessionId: ids.abjCow,
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
      const unsigned = await registerCapture({ sessionId: ids.abjCow, projectId: ids.abj, bytes: await renderImage('scene', 180) });
      assert.equal(unsigned.res.body.data.signatureVerified, null);
      assert.ok(unsigned.res.body.data.integrityFlags.includes('UNSIGNED'));
    });
  });

  describe('workday reports', () => {
    it('is idempotent under a client retry and links captures exactly once', async () => {
      const capture = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: await renderImage('scene', 200),
        wbsItemId: ids.pvModules,
      });
      const body = reportBody({ clientCaptureIds: [capture.body.clientCaptureId] });
      const first = await request(app).post(`/api/v1/projects/${ids.abj}/workday-reports`).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.data.status, 'CONFIRMED');
      assert.equal(first.body.data.aiCheckStatus, 'PENDING');
      assert.equal(first.body.data.captures.length, 1);
      assert.ok(scheduled.includes(first.body.data.id), 'omission check is scheduled after the response');

      const retry = await request(app).post(`/api/v1/projects/${ids.abj}/workday-reports`).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.data.id, first.body.data.id);
      assert.equal(retry.body.data.idempotentReplay, true);
      assert.equal(await prisma.workdayReport.count({ where: { clientReportId: body.clientReportId } }), 1);

      const reuse = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ clientCaptureIds: [capture.body.clientCaptureId] }));
      assert.equal(reuse.status, 409);
      assert.equal(reuse.body.error.code, 'CAPTURE_ALREADY_LINKED');
    });

    it('returns a retryable 409 naming captures that are not registered yet', async () => {
      const missing = crypto.randomUUID();
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ clientCaptureIds: [missing] }));
      assert.equal(res.status, 409);
      assert.deepEqual(res.body.error.details.missingClientCaptureIds, [missing]);
    });

    it('requires a location on every report and badges a low-accuracy fix', async () => {
      const { submissionGeotag: _omit, ...noLocation } = reportBody();
      const missing = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(noLocation);
      assert.equal(missing.status, 400);

      const day = nextPeriod();
      const poor = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(
          reportBody({
            workdayDate: day,
            submissionGeotag: { ...ABJ_POINT, accuracyMeters: 80, isMocked: false, capturedAt: `${day}T11:00:00.000Z` },
          })
        );
      assert.equal(poor.status, 201, JSON.stringify(poor.body));
      assert.ok(poor.body.data.integrityFlags.includes('LOW_GPS_ACCURACY'));
      assert.ok(poor.body.data.integrityFlags.includes('UNSIGNED'));
      assert.ok(!poor.body.data.integrityFlags.includes('OUTSIDE_PROJECT_GEOFENCE'));
    });

    it('checks the reporting day against the project time zone', async () => {
      // 23:30 UTC on 1 Mar is 00:30 on 2 Mar in Lagos (UTC+1): the reporting day is 2 Mar.
      const wrong = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: '2025-03-01', confirmedAt: '2025-03-01T23:30:00.000Z' }));
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.error.code, 'WORKDAY_DATE_MISMATCH');
      assert.equal(wrong.body.error.details.expectedWorkdayDate, '2025-03-02');

      const right = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: '2025-03-02', confirmedAt: '2025-03-01T23:30:00.000Z' }));
      assert.equal(right.status, 201, JSON.stringify(right.body));

      const future = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: '2099-01-01', confirmedAt: '2099-01-01T12:00:00.000Z' }));
      assert.equal(future.status, 400);
      assert.equal(future.body.error.code, 'CONFIRMED_AT_IN_FUTURE');
    });

    it('rejects a hold-point claim on an item that is not a hold point', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ isHoldPointClaimed: true }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'HOLD_POINT_NOT_APPLICABLE');
    });

    it('runs the omission check after the response with the rules engine when no AI is configured', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody());
      assert.equal(res.body.data.aiCheckStatus, 'PENDING');
      const status = await aiCheck.runAiOmissionCheck(res.body.data.id);
      assert.equal(status, 'DONE');
      const row = await prisma.workdayReport.findUniqueOrThrow({ where: { id: res.body.data.id } });
      assert.equal(row.aiCheckEngine, 'RULES');
      assert.ok(row.aiReasoning?.startsWith('Rules check'));
    });

    it('stages a report from an unapproved reporter without an AI check, and releases it on approval', async () => {
      const capture = await registerCapture({
        sessionId: ids.lkkPending,
        projectId: ids.lkk,
        bytes: await renderImage('checker', 140),
        location: LKK_POINT,
        wbsItemId: ids.stoneBase,
      });
      assert.equal(capture.res.status, 201, JSON.stringify(capture.res.body));
      const before = scheduled.length;
      const staged = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports`)
        .set(fieldHeaders(ids.lkkPending))
        .send(
          reportBody({
            wbsItemId: ids.stoneBase,
            unitOfMeasure: 'm2',
            clientCaptureIds: [capture.body.clientCaptureId],
            submissionGeotag: { ...LKK_POINT, accuracyMeters: 5, isMocked: false, capturedAt: new Date().toISOString() },
          })
        );
      assert.equal(staged.status, 201, JSON.stringify(staged.body));
      assert.equal(staged.body.data.status, 'STAGED_UNVERIFIED');
      assert.equal(staged.body.data.aiCheckStatus, 'SKIPPED');
      assert.equal(scheduled.length, before);

      const notEvidence = await provider.getEvidenceForBoqItems(ids.lkk, [ids.stoneBase], new Date());
      assert.ok(!notEvidence.some((e) => e.id === staged.body.data.id), 'staged reports are not evidence');

      const review = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/contractor-verifications/${ids.lkkPending}/review`)
        .set(await webHeaders('monitor@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(review.status, 200, JSON.stringify(review.body));
      assert.equal(review.body.data.releasedReportCount, 1);

      const released = await prisma.workdayReport.findUniqueOrThrow({ where: { id: staged.body.data.id } });
      assert.equal(released.status, 'CONFIRMED');
      assert.ok(released.releasedAt);
      assert.equal(released.aiCheckStatus, 'PENDING');
      assert.ok(scheduled.includes(released.id));
      const evidence = await provider.getEvidenceForBoqItems(ids.lkk, [ids.stoneBase], new Date());
      assert.ok(evidence.some((e) => e.id === released.id));
    });

    it('keeps a rejected session signed in so the device can read the reason', async () => {
      const session = await prisma.fieldAgentSession.create({
        data: {
          ...(await prisma.fieldAgentSession.findUniqueOrThrow({
            where: { id: ids.lkkPending },
            select: { projectId: true, joinCodeId: true, roleId: true, roleNameSnapshot: true, fieldPersonaType: true, assuranceWeight: true },
          })),
          agentFullName: 'Rejected Tester',
          agentPhoneNumber: '+2348000000000',
          deviceId: 'TEST-REJECT',
          assuranceStatus: 'PENDING_APPROVAL',
        },
      });
      const review = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/contractor-verifications/${session.id}/review`)
        .set(await webHeaders('monitor@insite.ng'))
        .send({ decision: 'REJECT', remarks: 'ID photo is blurred' });
      assert.equal(review.status, 200);
      const me = await request(app).get('/api/v1/auth/me').set(fieldHeaders(session.id));
      assert.equal(me.status, 200, JSON.stringify(me.body));
      assert.equal(me.body.data.fieldSession.assuranceStatus, 'REJECTED');
      assert.equal(me.body.data.fieldSession.rejectionReason, 'ID photo is blurred');
    });

    it('stores a guided selfie set for manual review and never records a liveness result (D-4.2)', async () => {
      const base = await prisma.fieldAgentSession.findUniqueOrThrow({
        where: { id: ids.lkkPending },
        select: { projectId: true, joinCodeId: true, roleId: true, roleNameSnapshot: true, fieldPersonaType: true, assuranceWeight: true },
      });
      const session = await prisma.fieldAgentSession.create({
        data: { ...base, agentFullName: 'Selfie Tester', agentPhoneNumber: '+2348000000001', deviceId: 'TEST-SELFIE', assuranceStatus: 'PENDING_APPROVAL' },
      });
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.lkk }, select: { tenantId: true } });
      const key = (name: string) => `tenants/${project.tenantId}/projects/${ids.lkk}/identity_selfie/${name}.jpg`;
      const now = new Date().toISOString();
      const body = {
        projectId: ids.lkk,
        idDocumentType: 'NIN',
        idDocumentUrl: key('id'),
        selfieFrontUrl: key('front'),
        selfieLeftUrl: key('left'),
        selfieRightUrl: key('right'),
        selfieSet: { captureMethod: 'GUIDED_SELFIE', frontCapturedAt: now, leftCapturedAt: now, rightCapturedAt: now },
        corenLicenseNumber: 'COREN R.1234',
        experienceSummary: 'Ten years of culvert works.',
      };
      const res = await request(app).post('/api/v1/auth/assurance-verification').set(fieldHeaders(session.id)).send(body);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: session.id } });
      assert.equal(stored.livenessPassed, false);
      assert.equal(stored.livenessScore, null);
      assert.equal((stored.livenessMetadata as { captureMethod?: string }).captureMethod, 'GUIDED_SELFIE');

      const { selfieSet: _s, ...oldShape } = body;
      const old = await request(app)
        .post('/api/v1/auth/assurance-verification')
        .set(fieldHeaders(session.id))
        .send({ ...oldShape, livenessVerification: { isLive: true } });
      assert.equal(old.status, 400);
    });

    it('revalidates idempotently and marks the targeted query resubmitted', async () => {
      const body = {
        clientReportId: crypto.randomUUID(),
        reportQueryId: ids.rebarQuery,
        reporterTimezone: 'Africa/Lagos',
        delaysOrBlockers: 'Mill certificate arrives tomorrow.',
        clientCaptureIds: [],
        textNotes: [],
        submissionGeotag: { ...LKK_POINT, accuracyMeters: 4, isMocked: false, capturedAt: new Date().toISOString() },
        confirmedAt: new Date().toISOString(),
        confirmedAsFinal: true,
      };
      const first = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${ids.rebarReport}/revalidate`)
        .set(fieldHeaders(ids.lkkContractor))
        .send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.data.parentReportId, ids.rebarReport);
      assert.equal(first.body.data.revisionNumber, 2);
      const retry = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${ids.rebarReport}/revalidate`)
        .set(fieldHeaders(ids.lkkContractor))
        .send(body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.data.id, first.body.data.id);
      const query = await prisma.reportQuery.findUniqueOrThrow({ where: { id: ids.rebarQuery } });
      assert.equal(query.status, 'RESUBMITTED');

      const otherReporter = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${ids.rebarReport}/revalidate`)
        .set(fieldHeaders(ids.lkkCow))
        .send({ ...body, clientReportId: crypto.randomUUID() });
      assert.equal(otherReporter.status, 404);

      // The answered query is closed: no further revision without a new query.
      const noQuery = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${first.body.data.id}/revalidate`)
        .set(fieldHeaders(ids.lkkContractor))
        .send({ ...body, reportQueryId: undefined, clientReportId: crypto.randomUUID() });
      assert.equal(noQuery.status, 409);
      assert.equal(noQuery.body.error.code, 'NO_OPEN_QUERY');

      // The original can no longer be revised; only the latest revision can.
      const superseded = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${ids.rebarReport}/revalidate`)
        .set(fieldHeaders(ids.lkkContractor))
        .send({ ...body, reportQueryId: undefined, clientReportId: crypto.randomUUID() });
      assert.equal(superseded.status, 409);
      assert.equal(superseded.body.error.code, 'REPORT_SUPERSEDED');
    });

    it('accepts one report per reporter, WBS item and period, confirmed as final', async () => {
      const period = nextPeriod();
      const unconfirmed = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: period, confirmedAsFinal: false }));
      assert.equal(unconfirmed.status, 400);

      const first = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: period }));
      assert.equal(first.status, 201, JSON.stringify(first.body));

      const second = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(reportBody({ workdayDate: period, summaryText: 'Forgot to mention the cable trays.' }));
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, 'REPORT_ALREADY_SUBMITTED');
      assert.equal(second.body.error.details.workdayReportId, first.body.data.id);

      // No query has been raised, so it cannot be revised either.
      const revise = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports/${first.body.data.id}/revalidate`)
        .set(fieldHeaders(ids.abjCow))
        .send({
          clientReportId: crypto.randomUUID(),
          reporterTimezone: 'Africa/Lagos',
          submissionGeotag: { ...ABJ_POINT, accuracyMeters: 4, isMocked: false, capturedAt: new Date().toISOString() },
          confirmedAt: new Date().toISOString(),
          confirmedAsFinal: true,
        });
      assert.equal(revise.status, 409);
      assert.equal(revise.body.error.code, 'NO_OPEN_QUERY');

      // The database refuses a second original report for the period even if the check is bypassed.
      await assert.rejects(
        prisma.workdayReport.create({
          data: {
            clientReportId: crypto.randomUUID(),
            projectId: ids.abj,
            reporterSessionId: ids.abjCow,
            wbsItemId: ids.pvModules,
            workdayDate: period,
            reporterTimezone: 'Africa/Lagos',
            summaryText: 'Direct insert',
            unitOfMeasure: 'kWp',
          },
        })
      );
    });
  });

  describe('Phase 2 and 3 carry-overs', () => {
    it('lets a monitor resolve a report query, after which the report cannot be revised', async () => {
      const latest = await prisma.workdayReport.findFirstOrThrow({ where: { parentReportId: ids.rebarReport } });
      const url = `/api/v1/projects/${ids.lkk}/report-queries/${ids.rebarQuery}/resolve`;

      const asField = await request(app).post(url).set(fieldHeaders(ids.lkkContractor)).send({});
      assert.ok(asField.status === 401 || asField.status === 403, `field agent got ${asField.status}`);
      const asContractor = await request(app).post(url).set(await webHeaders('contractor@insite.ng')).send({});
      assert.equal(asContractor.status, 403);

      const monitor = await webHeaders('monitor@insite.ng');
      const resolved = await request(app).post(url).set(monitor).send({ resolutionNote: 'Mill certificate received.' });
      assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
      assert.equal(resolved.body.data.status, 'RESOLVED');
      assert.ok(resolved.body.data.resolvedAt);
      const again = await request(app).post(url).set(monitor).send({});
      assert.equal(again.status, 409);

      const revise = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/workday-reports/${latest.id}/revalidate`)
        .set(fieldHeaders(ids.lkkContractor))
        .send({
          clientReportId: crypto.randomUUID(),
          reporterTimezone: 'Africa/Lagos',
          submissionGeotag: { ...LKK_POINT, accuracyMeters: 4, isMocked: false, capturedAt: new Date().toISOString() },
          confirmedAt: new Date().toISOString(),
          confirmedAsFinal: true,
        });
      assert.equal(revise.status, 409);
      assert.equal(revise.body.error.code, 'NO_OPEN_QUERY');

      const notices = await request(app)
        .get(`/api/v1/projects/${ids.lkk}/notifications`)
        .set(fieldHeaders(ids.lkkContractor));
      assert.equal(notices.status, 200);
      const resolvedNotice = notices.body.data.find((n: { title: string }) => n.title.startsWith('Query resolved'));
      assert.ok(resolvedNotice, 'the reporter is told the query was resolved');
      const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.lkk, action: 'REPORT_QUERY_RESOLVED' } });
      assert.ok(audit);
    });

    it('keeps notification read state per field session', async () => {
      const base = await prisma.fieldAgentSession.findUniqueOrThrow({
        where: { id: ids.abjCow },
        select: { projectId: true, joinCodeId: true, roleId: true, roleNameSnapshot: true, fieldPersonaType: true, assuranceWeight: true },
      });
      const other = await prisma.fieldAgentSession.create({
        data: { ...base, agentFullName: 'Second Reader', agentPhoneNumber: '+2348000000002', deviceId: 'TEST-READER' },
      });
      const broadcast = await prisma.mobileNotification.create({
        data: {
          projectId: ids.abj,
          fieldSessionId: null,
          type: 'MORNING_DELIVERABLE_READY',
          actionType: 'NONE',
          title: 'Broadcast for read-state test',
          message: 'Everyone on the project sees this.',
        },
      });
      const mark = await request(app)
        .patch(`/api/v1/projects/${ids.abj}/notifications/${broadcast.id}/read`)
        .set(fieldHeaders(ids.abjCow));
      assert.equal(mark.status, 200, JSON.stringify(mark.body));
      assert.equal(mark.body.data.isRead, true);

      const forReader = await request(app).get(`/api/v1/projects/${ids.abj}/notifications`).set(fieldHeaders(ids.abjCow));
      const forOther = await request(app).get(`/api/v1/projects/${ids.abj}/notifications`).set(fieldHeaders(other.id));
      const find = (res: request.Response) => res.body.data.find((n: { id: string }) => n.id === broadcast.id);
      assert.equal(find(forReader).isRead, true);
      assert.equal(find(forOther).isRead, false);
    });
  });

  describe('honest AI fallbacks', () => {
    it('returns PENDING transcripts and no invented text when no speech provider is configured', async () => {
      const audio = crypto.randomBytes(2048);
      const voice = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: audio,
        mediaType: 'VOICE_NOTE',
        mimeType: 'audio/mp4',
        wbsItemId: ids.pvModules,
      });
      assert.equal(voice.res.body.data.transcriptionStatus, 'PENDING');
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports/suggest`)
        .set(fieldHeaders(ids.abjCow))
        .send({ wbsItemId: ids.pvModules, clientCaptureIds: [voice.body.clientCaptureId] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.transcripts[0].transcriptionStatus, 'PENDING');
      assert.equal(res.body.data.transcripts[0].transcript, null);
      assert.equal(res.body.data.suggestion, null);
      assert.ok(res.body.data.unavailableReason);
    });

    it('suggests from typed notes with the rules engine, without linking a BOQ item or describing photos', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports/suggest`)
        .set(fieldHeaders(ids.abjCow))
        .send({ wbsItemId: ids.pvModules, textNotes: ['Installed 40 m of cable tray, rain delay after 3pm'] });
      assert.equal(res.status, 200);
      const s = res.body.data.suggestion;
      assert.equal(s.engine, 'RULES');
      assert.equal(s.quantities[0].quantity, 40);
      assert.equal(s.quantities[0].boqWbsCodeHint, null);
      assert.doesNotMatch(JSON.stringify(res.body), /verified against project geofence/);
    });
  });

  describe('telemetry and chat idempotency', () => {
    it('stores each ping once and writes one anomaly summary per day and type', async () => {
      const capturedAt = new Date().toISOString();
      const pings = [
        { clientPingId: crypto.randomUUID(), ...FAR_AWAY, accuracyMeters: 6, isMocked: false, capturedAt },
        { clientPingId: crypto.randomUUID(), ...FAR_AWAY, accuracyMeters: 6, isMocked: false, capturedAt },
        { clientPingId: crypto.randomUUID(), ...ABJ_POINT, accuracyMeters: 6, isMocked: true, capturedAt },
      ];
      const first = await request(app).post(`/api/v1/projects/${ids.abj}/telemetry`).set(fieldHeaders(ids.abjCow)).send({ pings });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.data.created, 3);
      const again = await request(app).post(`/api/v1/projects/${ids.abj}/telemetry`).set(fieldHeaders(ids.abjCow)).send({ pings });
      assert.equal(again.body.data.created, 0);

      const more = [{ clientPingId: crypto.randomUUID(), ...FAR_AWAY, accuracyMeters: 6, isMocked: false, capturedAt }];
      await request(app).post(`/api/v1/projects/${ids.abj}/telemetry`).set(fieldHeaders(ids.abjCow)).send({ pings: more });

      const rows = await prisma.telemetryAnomalyDaily.findMany({ where: { fieldSessionId: ids.abjCow } });
      const outside = rows.find((r) => r.anomalyType === 'OUTSIDE_GEOFENCE');
      assert.equal(outside?.pingCount, 3);
      assert.equal(rows.find((r) => r.anomalyType === 'MOCK_LOCATION')?.pingCount, 1);
      const summaries = await prisma.auditLog.count({
        where: { projectId: ids.abj, action: 'TELEMETRY_ANOMALY_SUMMARY', actorId: ids.abjCow },
      });
      assert.equal(summaries, 2);
    });

    it('stores a chat message once and refuses inline media', async () => {
      const url = `/api/v1/projects/${ids.abj}/boq/${ids.pvModules}/messages`;
      const body = { clientMessageId: crypto.randomUUID(), messageType: 'TEXT_COMMENT', textContent: 'Row C done' };
      const first = await request(app).post(url).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.data.senderSessionId, ids.abjCow);
      const retry = await request(app).post(url).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.data.id, first.body.data.id);

      const inline = await request(app)
        .post(url)
        .set(fieldHeaders(ids.abjCow))
        .send({ clientMessageId: crypto.randomUUID(), messageType: 'PHOTO', mediaUrls: ['data:image/png;base64,AAAA'] });
      assert.equal(inline.status, 400);
      const noCapture = await request(app)
        .post(url)
        .set(fieldHeaders(ids.abjCow))
        .send({ clientMessageId: crypto.randomUUID(), messageType: 'PHOTO' });
      assert.equal(noCapture.status, 400);
      assert.equal(noCapture.body.error.code, 'CAPTURE_REQUIRED');
    });

    it('stores an incident once and refuses device file paths', async () => {
      const body = {
        clientIncidentId: crypto.randomUUID(),
        category: 'CRITICAL_DELAY',
        title: 'Crane down',
        description: 'Tower crane hydraulic failure, lifting halted.',
      };
      const url = `/api/v1/projects/${ids.abj}/incidents`;
      const first = await request(app).post(url).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const retry = await request(app).post(url).set(fieldHeaders(ids.abjCow)).send(body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.data.id, first.body.data.id);
      const filePath = await request(app)
        .post(url)
        .set(fieldHeaders(ids.abjCow))
        .send({ ...body, clientIncidentId: crypto.randomUUID(), photoEvidenceUrls: ['file:///data/photo.jpg'] });
      assert.equal(filePath.status, 400);
    });
  });

  describe('evidence provider feeds reconciliation', () => {
    it('a confirmed mobile-style report with captures changes the rating of a line', async () => {
      const boq = await prisma.boqItem.create({
        data: {
          projectId: ids.abj,
          wbsCode: '09.09.9',
          section: 'TEST',
          description: 'Perimeter fence posts',
          unit: 'nr',
          totalQuantity: 100,
          rateNgn: 10000,
          budgetedCostNgn: 1000000,
        },
      });
      const line = {
        ipcLineItemId: 'line-test',
        boqItemId: boq.id,
        wbsCode: boq.wbsCode,
        description: boq.description,
        unit: 'nr',
        totalQuantity: 100,
        budgetedCostNgn: 1000000,
        isHoldPoint: false,
        isOpaqueLumpSum: false,
        previousCertifiedPct: 0,
        contractorClaimedPct: 40,
        contractorClaimedNgn: 400000,
        contractorRemarks: null,
      };
      const period = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 60_000) };
      const rate = async () => {
        const evidence = await provider.getEvidenceForBoqItems(ids.abj, [boq.id], period.end);
        return engine.rulesEngineRate(line, engine.computeLineFacts(line, evidence, period)).rating;
      };

      assert.equal(await rate(), 'UNSUPPORTED');

      const photo = await registerCapture({
        sessionId: ids.abjCow,
        projectId: ids.abj,
        bytes: await renderImage('checker', 300),
        wbsItemId: boq.id,
      });
      const submit = await request(app)
        .post(`/api/v1/projects/${ids.abj}/workday-reports`)
        .set(fieldHeaders(ids.abjCow))
        .send(
          reportBody({
            wbsItemId: boq.id,
            workdayDate: todayInLagos(),
            confirmedAt: new Date().toISOString(),
            submissionGeotag: { ...ABJ_POINT, accuracyMeters: 5, isMocked: false, capturedAt: new Date().toISOString() },
            summaryText: 'Installed 40 fence posts on the north perimeter.',
            reportedQuantity: 40,
            unitOfMeasure: 'nr',
            clientCaptureIds: [photo.body.clientCaptureId],
          })
        );
      assert.equal(submit.status, 201, JSON.stringify(submit.body));

      const evidence = await provider.getEvidenceForBoqItems(ids.abj, [boq.id], period.end);
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].source, 'WORKDAY_REPORT');
      assert.equal(evidence[0].media.length, 1);
      assert.equal(evidence[0].isWithinGeofence, true);
      assert.equal(await rate(), 'SUPPORTED');
    });
  });
});
