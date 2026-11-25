/**
 * UBEC IRL (2026-11-25): compass heading on capture registration, visit check-in and visit
 * submission geotags. Every heading field is optional: older clients that send none stay valid.
 *
 * Programme tenant, PRG-105 (live, default visit plan from seedR4). Officers are fresh provisioned
 * accounts (Resident Supervisor) made with createFieldSession. Uploads use local-disk storage.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs/promises';
import type { Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { addWorkdays, zonedCalendarDate, type VisitFormSnapshot } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
const PASSWORD = 'Password123!';
const P_MONITOR = 'me.officer@ubec.test';
const ids: Record<string, string> = {};
let monitorToken = '';

interface Officer {
  userId: string;
  sessionId: string;
  auth: { Authorization: string };
}

async function officer(): Promise<Officer> {
  const s = await createFieldSession(prisma, { projectId: ids.prg105, roleCode: 'INDEPENDENT_RESIDENT', name: 'IRL officer' });
  return { userId: s.userId, sessionId: s.sessionId, auth: await fieldAuth(prisma, s.sessionId) };
}

let seed = 1;
/** A small distinct JPEG, so duplicate screening never matches two fixtures. */
async function photo(): Promise<Buffer> {
  const size = 64;
  const raw = Buffer.alloc(size * size * 3);
  const s = seed++;
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + s * 97 + Math.floor(i / 192) * s) % 256;
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
}

async function register(o: Officer, extra: Record<string, unknown> = {}) {
  const bytes = await photo();
  const presign = await request(app)
    .post(`/api/v1/projects/${ids.prg105}/evidence/presign`)
    .set(o.auth)
    .send({ mediaType: 'SITE_PHOTO', fileName: 'capture.jpg', mimeType: 'image/jpeg', byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const url = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(url.pathname + url.search).set('Content-Type', 'image/jpeg').send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return request(app)
    .post(`/api/v1/projects/${ids.prg105}/captures`)
    .set(o.auth)
    .send({
      clientCaptureId: crypto.randomUUID(),
      mediaType: 'SITE_PHOTO',
      objectKey: presign.body.data.objectKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      capturedAt: new Date().toISOString(),
      location: { latitude: 9.05, longitude: 7.49, accuracyMeters: 4 },
      isMockLocation: false,
      signature: null,
      ...extra,
    });
}

const today = () => zonedCalendarDate(new Date(), 'Africa/Lagos');

async function plannedVisit(o: Officer, daysAhead: number) {
  const res = await request(app)
    .post(`/api/v1/projects/${ids.prg105}/visits`)
    .set({ Authorization: `Bearer ${monitorToken}` })
    .send({ visitKind: 'ROUTINE', plannedDate: addWorkdays(today(), daysAhead, [1, 2, 3, 4, 5, 6]), assignees: [{ userId: o.userId, isLead: true }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string };
}

/** Valid answers for every non-capture question; `photoAnswer` answers one photo question. */
function answers(snapshot: VisitFormSnapshot, photoAnswer?: { path: string; clientCaptureId: string }) {
  const out: Array<{ path: string; value: unknown; comment: string | null; captures: unknown[] }> = [];
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      if (f.type === 'PHOTO' || f.type === 'VOICE_NOTE') {
        if (photoAnswer?.path === f.path) out.push({ path: f.path, value: null, comment: null, captures: [{ clientCaptureId: photoAnswer.clientCaptureId, unitId: null, kind: 'PHOTO' }] });
        continue;
      }
      let value: unknown = null;
      switch (f.type) {
        case 'SHORT_TEXT':
        case 'LONG_TEXT':
          value = 'Checked on site';
          break;
        case 'NUMBER':
          value = f.boundedByPlannedQuantity && f.plannedQuantity !== null ? f.plannedQuantity : (f.min ?? 1);
          break;
        case 'PERCENTAGE':
          value = 50;
          break;
        case 'RATING_1_5':
          value = 4;
          break;
        case 'YES_NO':
          value = 'YES';
          break;
        case 'SINGLE_CHOICE':
          value = f.options[0]?.key ?? null;
          break;
        case 'MULTI_CHOICE':
          value = f.options.slice(0, Math.max(1, f.minSelected ?? 1)).map((o) => o.key);
          break;
        case 'DATE':
          value = today();
          break;
      }
      out.push({ path: f.path, value, comment: 'All checked', captures: [] });
    }
  }
  return out;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.prg105 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  const login = await request(app).post('/api/v1/auth/login').send({ email: P_MONITOR, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  monitorToken = login.body.data.accessToken as string;
});

after(async () => {
  await prisma?.$disconnect();
  if (process.env.LOCAL_STORAGE_DIR) await fs.rm(process.env.LOCAL_STORAGE_DIR, { recursive: true, force: true }).catch(() => undefined);
});

describe('UBEC IRL: compass heading on captures', () => {
  it('stores the heading sent with a photo and returns it', async () => {
    const o = await officer();
    const res = await register(o, { headingDegrees: 47.25 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.headingDegrees, 47.3);
    const row = await prisma.fieldEvidenceLog.findUniqueOrThrow({ where: { clientCaptureId: res.body.data.clientCaptureId } });
    assert.equal(row.headingDegrees, 47.3);
  });

  it('a heading of 360 is stored as 0; an older client without a heading stays valid', async () => {
    const o = await officer();
    const full = await register(o, { headingDegrees: 360 });
    assert.equal(full.status, 201, JSON.stringify(full.body));
    assert.equal(full.body.data.headingDegrees, 0);
    const old = await register(o);
    assert.equal(old.status, 201, JSON.stringify(old.body));
    assert.equal(old.body.data.headingDegrees, null);
    const nulled = await register(o, { headingDegrees: null });
    assert.equal(nulled.status, 201, JSON.stringify(nulled.body));
    assert.equal(nulled.body.data.headingDegrees, null);
  });

  it('refuses a heading outside 0-360', async () => {
    const o = await officer();
    const res = await register(o, { headingDegrees: 400 });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });
});

describe('UBEC IRL: compass heading on visit geotags', () => {
  it('check-in keeps the heading, reference and calibration; without them the geotag has none', async () => {
    const o = await officer();
    const v = await plannedVisit(o, 2);
    const at = new Date().toISOString();
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/check-in`)
      .set(o.auth)
      .send({
        clientCheckInId: crypto.randomUUID(),
        checkedInAt: at,
        geotag: { latitude: 9.05, longitude: 7.49, accuracyMeters: 5, capturedAt: at, headingDegrees: 182.4, headingReference: 'TRUE', headingAccuracyLevel: 3 },
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.visit.findUniqueOrThrow({ where: { id: v.id } });
    const geotag = row.checkInGeotag as Record<string, unknown>;
    assert.equal(geotag.headingDegrees, 182.4);
    assert.equal(geotag.headingReference, 'TRUE');
    assert.equal(geotag.headingAccuracyLevel, 3);

    const o2 = await officer();
    const v2 = await plannedVisit(o2, 2);
    const old = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v2.id}/check-in`)
      .set(o2.auth)
      .send({ clientCheckInId: crypto.randomUUID(), checkedInAt: at, geotag: { latitude: 9.05, longitude: 7.49, accuracyMeters: 5, capturedAt: at } });
    assert.equal(old.status, 200, JSON.stringify(old.body));
    const row2 = await prisma.visit.findUniqueOrThrow({ where: { id: v2.id } });
    assert.equal('headingDegrees' in (row2.checkInGeotag as Record<string, unknown>), false);
  });

  it('refuses an unknown heading reference or calibration level', async () => {
    const o = await officer();
    const v = await plannedVisit(o, 2);
    const at = new Date().toISOString();
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/check-in`)
      .set(o.auth)
      .send({ clientCheckInId: crypto.randomUUID(), checkedInAt: at, geotag: { latitude: 9.05, longitude: 7.49, capturedAt: at, headingDegrees: 10, headingReference: 'GRID', headingAccuracyLevel: 7 } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  it('the submission geotag returns its heading, and each photo answer carries its own', async () => {
    const o = await officer();
    const v = await plannedVisit(o, 1);
    const formRes = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}/form`).set(o.auth);
    assert.equal(formRes.status, 200, JSON.stringify(formRes.body));
    const form = formRes.body.data as { formSnapshotId: string; formHash: string; snapshot: VisitFormSnapshot };
    const photoField = form.snapshot.blocks.flatMap((b) => b.fields).find((f) => f.type === 'PHOTO' && f.photo?.mode === 'AT_LEAST_N');
    assert.ok(photoField, 'the routine form has a photo question');
    const cap = await register(o, { headingDegrees: 271 });
    assert.equal(cap.status, 201, JSON.stringify(cap.body));

    const at = new Date().toISOString();
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`)
      .set(o.auth)
      .send({
        clientSubmissionId: crypto.randomUUID(),
        formSnapshotId: form.formSnapshotId,
        formHash: form.formHash,
        answers: answers(form.snapshot, { path: photoField!.path, clientCaptureId: cap.body.data.clientCaptureId }),
        overallFinding: 'SATISFACTORY',
        summaryText: 'Works progressing as planned.',
        confirmedAt: at,
        submissionGeotag: { latitude: 9.05, longitude: 7.49, accuracyMeters: 6, capturedAt: at, headingDegrees: 90, headingReference: 'MAGNETIC', headingAccuracyLevel: null },
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const s = res.body.data as {
      submissionGeotag: { headingDegrees?: number; headingReference?: string; headingAccuracyLevel?: number | null };
      answers: Array<{ path: string; captures: Array<{ headingDegrees?: number | null }> }>;
    };
    assert.equal(s.submissionGeotag.headingDegrees, 90);
    assert.equal(s.submissionGeotag.headingReference, 'MAGNETIC');
    assert.equal(s.submissionGeotag.headingAccuracyLevel, null);
    const answer = s.answers.find((a) => a.path === photoField!.path);
    assert.equal(answer?.captures[0]?.headingDegrees, 271);
  });
});
