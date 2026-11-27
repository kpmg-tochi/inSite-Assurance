import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  NEEDS_VERIFICATION_CONDITION_BY_OPTION,
  NeedsVerificationDtoSchema,
  NeedsVerificationFeedDtoSchema,
  NeedsVerificationFormDtoSchema,
  distanceMeters,
  type NeedsVerificationForm,
  type NeedsVerificationSiteLocationInput,
} from '@insite/shared';
import { makeTestDeviceKey, type TestDeviceKey } from './fieldAuth';
import type { NeedsScenarioContext } from './needsScenarioSteps.n5';

/**
 * Needs pipeline wave 5 (N8): field verification helpers (shared with `routes.needs.n8.test.ts`) and
 * the scenario step FIELD-01, wired into `routes.needs.scenarios.test.ts`. API only, plus Prisma reads
 * for the assertions.
 *
 * FIELD-01 works on whatever Direct Intervention proposal waits at Validation in an open cycle (after
 * DI-13 that is 2028-DI-001, carried forward, so me.officer@ uploaded nothing on it and may accept);
 * when none is left it uploads a fresh one into the open 2027 cycle and submits it.
 */

const N = '/api/v1/needs';
const F = '/api/v1/needs-verifications';
const PASSWORD = 'Password123!';

export interface Phone {
  auth: { Authorization: string };
  key: TestDeviceKey;
}

const phones = new WeakMap<Express, Map<string, Phone>>();

/** The field app's sign-in (one device per account, cached per app). */
export async function phone(app: Express, email: string): Promise<Phone> {
  let byEmail = phones.get(app);
  if (!byEmail) phones.set(app, (byEmail = new Map()));
  const cached = byEmail.get(email);
  if (cached) return cached;
  const key = makeTestDeviceKey();
  const res = await request(app).post('/api/v1/auth/mobile/login').send({
    email,
    password: PASSWORD,
    deviceId: `n8-${email}`,
    deviceModel: 'Pixel 8',
    deviceOs: 'Android 15',
    devicePublicKey: key.publicKey,
    devicePublicKeyAlg: 'ED25519',
  });
  assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
  const p = { auth: { Authorization: `Bearer ${res.body.data.accessToken as string}` }, key };
  byEmail.set(email, p);
  return p;
}

/** A small JPEG-looking file (bytes differ each call). */
export const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64), Buffer.from([0xff, 0xd9])]);

/** Presign, PUT and register one photo on a verification; returns its clientCaptureId. */
export async function takeVerificationPhoto(
  app: Express,
  auth: { Authorization: string },
  verificationId: string,
  location: { latitude: number; longitude: number } | null = { latitude: 9.6, longitude: 6.55 }
): Promise<string> {
  const bytes = jpeg();
  const presign = await request(app).post(`${F}/${verificationId}/captures/presign`).set(auth).send({ kind: 'PHOTO', fileName: 'photo.jpg', mimeType: 'image/jpeg', byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const target = new URL(presign.body.data.uploadUrl);
  assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'image/jpeg').send(bytes)).status, 200);
  const clientCaptureId = crypto.randomUUID();
  const reg = await request(app)
    .post(`${F}/${verificationId}/captures`)
    .set(auth)
    .send({
      clientCaptureId,
      kind: 'PHOTO',
      objectKey: presign.body.data.objectKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      capturedAt: new Date().toISOString(),
      location: location ? { ...location, accuracyMeters: 8, altitudeMeters: null } : null,
    });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return clientCaptureId;
}

export interface Answer {
  path: string;
  value: string | number | string[] | null;
  comment: string | null;
  captures: Array<{ clientCaptureId: string; unitId: string | null; kind: 'PHOTO' }>;
}

const OPTION_OF_CONDITION = Object.fromEntries(Object.entries(NEEDS_VERIFICATION_CONDITION_BY_OPTION).map(([option, condition]) => [condition, option]));

/**
 * Answers every question as the needs assessment says (school found, counts and conditions as
 * recorded, "matches"), with `photosByPath` attached; photo questions without photos stay empty (a gap
 * the server accepts). `override` changes single answers by path.
 */
export function answersFor(form: NeedsVerificationForm, photosByPath: Record<string, string[]> = {}, override: Record<string, Partial<Answer>> = {}): Answer[] {
  const out: Answer[] = [];
  for (const block of form.blocks) {
    for (const f of block.fields) {
      const row = f.unitId ? form.rows.find((r) => r.rowId === f.unitId) : undefined;
      let value: Answer['value'] = null;
      if (f.type === 'YES_NO') value = 'YES';
      else if (f.type === 'NUMBER') value = row ? row.existingQuantity : 0;
      else if (f.type === 'SINGLE_CHOICE') value = row ? (OPTION_OF_CONDITION[row.existingCondition] ?? f.options[0]?.key ?? null) : (f.options[0]?.key ?? null);
      const captures = (photosByPath[f.path] ?? []).map((id) => ({ clientCaptureId: id, unitId: null, kind: 'PHOTO' as const }));
      if (value === null && !captures.length && !override[f.path]) continue;
      out.push({ path: f.path, value, comment: null, captures, ...override[f.path] });
    }
  }
  return out;
}

/** A location `meters` north of a point (about). */
export const northOf = (p: { latitude: number; longitude: number }, meters: number) => ({ latitude: p.latitude + meters / 111_320, longitude: p.longitude });

export function locationsFor(form: NeedsVerificationForm, moved: Record<number, { latitude: number; longitude: number }> = {}): NeedsVerificationSiteLocationInput[] {
  return form.sites.map((s) => ({
    siteNumber: s.siteNumber,
    ...(moved[s.siteNumber] ?? { latitude: s.latitude ?? 9.6, longitude: s.longitude ?? 6.55 }),
    accuracyMeters: 6,
    capturedAt: new Date().toISOString(),
    isMockLocation: false,
  }));
}

/** Downloads the form on the phone and submits it answered (one photo on each site); returns the response. */
export async function submitFromPhone(app: Express, auth: { Authorization: string }, verificationId: string, opts: { moved?: Record<number, { latitude: number; longitude: number }>; reusePhotos?: Record<string, string[]> } = {}) {
  const formRes = await request(app).get(`${F}/${verificationId}/form`).set(auth);
  assert.equal(formRes.status, 200, JSON.stringify(formRes.body));
  const { form, formHash } = NeedsVerificationFormDtoSchema.parse(formRes.body.data);
  const photos: Record<string, string[]> = { ...(opts.reusePhotos ?? {}) };
  if (!opts.reusePhotos) {
    for (const block of form.blocks.filter((b) => b.key.startsWith('n:site:'))) {
      const field = block.fields.find((f) => f.type === 'PHOTO');
      if (field) photos[field.path] = [await takeVerificationPhoto(app, auth, verificationId)];
    }
  }
  const res = await request(app)
    .post(`${F}/${verificationId}/submissions`)
    .set(auth)
    .send({
      clientSubmissionId: crypto.randomUUID(),
      formHash,
      answers: answersFor(form, photos),
      siteLocations: locationsFor(form, opts.moved),
      notes: 'Visited with the head teacher.',
      submittedAtDevice: new Date().toISOString(),
    });
  return { res, form, formHash, photos };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function stepFIELD01(ctx: NeedsScenarioContext): Promise<void> {
  const { app, prisma, web, tenantId, ids } = ctx;
  const ME = 'me.officer@ubec.test';
  let target = await prisma.needsProposal.findFirst({
    where: { tenantId, stage: 'VALIDATION', status: 'IN_PROGRESS', cycle: { status: 'OPEN', projectTypeId: ids.di } },
    orderBy: { createdAt: 'asc' },
  });
  if (!target) {
    // None left: a fresh proposal in the open 2027 cycle (new bytes), submitted to Validation.
    const { buildFixtureFile } = await import('../fixtures/needs/generateNeedsFixtures');
    const { FIXTURE_SPECS } = await import('../fixtures/needs/needsFixtureSpecs');
    const spec = structuredClone(FIXTURE_SPECS.find((s) => s.name === 'di-draft-valid')!);
    spec.project = { ...spec.project, title: `${spec.project.title} (field verification)` };
    const buffer = await buildFixtureFile(spec);
    const files = [{ fileName: 'field-verification.xlsx', fileBase64: buffer.toString('base64'), proposalId: null }];
    const procurement = await web('procurement@ubec.test');
    assert.equal((await request(app).post(`${N}/cycles/${ids.diCycle}/uploads/preview`).set(procurement).send({ files })).status, 200);
    const confirm = await request(app)
      .post(`${N}/cycles/${ids.diCycle}/uploads/confirm`)
      .set(procurement)
      .send({ files: files.map((f) => ({ ...f, sha256: crypto.createHash('sha256').update(buffer).digest('hex') })) });
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    const created = await prisma.needsProposal.findFirstOrThrow({ where: { cycleId: ids.diCycle, reference: confirm.body.data.files[0].reference } });
    const submit = await request(app).post(`${N}/cycles/${ids.diCycle}/proposal-actions`).set(procurement).send({ action: 'SUBMIT', proposalIds: [created.id], reason: null });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    target = await prisma.needsProposal.findUniqueOrThrow({ where: { id: created.id } });
  }

  // Assign to me.officer@ (UBEC M&E, field app sign-in).
  const me = await web(ME);
  const officer = await prisma.user.findUniqueOrThrow({ where: { email: ME } });
  const assigned = await request(app).post(`${N}/proposals/${target.id}/verifications`).set(me).send({ purpose: 'VALIDATION', officerUserId: officer.id, dueDate: inDays(7), siteNumbers: [] });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const verificationId = NeedsVerificationDtoSchema.parse(assigned.body.data).id;

  // The phone: feed, form, captures, submission with site 1 recorded 120 m from the stored point.
  const p = await phone(app, ME);
  const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set(p.auth)).body.data);
  assert.ok(feed.items.some((i) => i.id === verificationId && i.status === 'ASSIGNED'));
  const before = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: target.id, siteNumber: 1 } });
  const stored = { latitude: before.latitude ?? 9.6, longitude: before.longitude ?? 6.55 };
  const movedTo = northOf(stored, 120);
  const { res } = await submitFromPhone(app, p.auth, verificationId, { moved: { 1: movedTo } });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  // me.officer@ (no upload on this proposal: the VALIDATE separation allows) accepts.
  const review = await request(app).post(`${N}/verifications/${verificationId}/review`).set(me).send({ decision: 'ACCEPT', reason: null, correctCoordinates: true });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const accepted = NeedsVerificationDtoSchema.parse(review.body.data);
  assert.equal(accepted.status, 'ACCEPTED');
  const after = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: target.id, siteNumber: 1 } });
  assert.ok(distanceMeters({ latitude: after.latitude!, longitude: after.longitude! }, movedTo) < 0.5, 'site 1 moved to the recorded point');
  const draft = accepted.siteVerificationDraft;
  assert.ok(draft && draft.method === 'FIELD_APP' && draft.verificationId === verificationId && draft.evidenceDocumentIds.length > 0, JSON.stringify(draft));

  // The validation record takes the draft.
  const record = await request(app)
    .post(`${N}/proposals/${target.id}/validation`)
    .set(me)
    .send({ outcome: 'ADVANCE', deskNotes: 'Field verification accepted; needs confirmed.', siteVerification: draft, flagResolutions: [] });
  assert.equal(record.status, 201, JSON.stringify(record.body));
  assert.equal(record.body.data.siteVerification.method, 'FIELD_APP');
  assert.deepEqual(record.body.data.siteVerification.evidenceDocumentIds, draft.evidenceDocumentIds);
  const docs = await prisma.needsProposalDocument.findMany({ where: { id: { in: draft.evidenceDocumentIds } } });
  assert.ok(docs.length === draft.evidenceDocumentIds.length && docs.every((d) => d.kind === 'PHOTO'));
}
