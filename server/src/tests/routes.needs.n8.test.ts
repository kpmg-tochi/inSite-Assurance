/**
 * Needs pipeline wave 5 (N8): field verification through /api/v1/needs (web) and
 * /api/v1/needs-verifications (field app), on the seeded UBEC tenant (normal seed, needs cycles
 * cleared). The steps continue from one another.
 *
 * Walk: dpp@ opens the 2027 DI cycle, procurement@ uploads 2027-DI-001 (di-draft-valid, two Niger
 * sites, nine breakdown rows) and -002 (essential-gap) and submits both to Validation; kano.dpp@ opens
 * the Kano 2027 MG cycle, kano.procurement@ uploads 2027-MG-KN-001 and submits it. me.officer@ (UBEC
 * M&E, web and field app) assigns himself a verification of -001, works it on the phone, has it
 * returned, resubmits with site 1 recorded 120 m from the stored point, accepts it and records the
 * validation from the draft. kano.dpp@ gets a mobile role here (the seed adds one in wave 5).
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  NEEDS_TEMPLATE_VERSION,
  NEEDS_VERIFICATION_FIELD_KEYS,
  NEEDS_VERIFICATION_SECTION_CODES,
  NeedsVerificationDtoSchema,
  NeedsVerificationFeedDtoSchema,
  NeedsVerificationFormDtoSchema,
  NeedsVerificationOfficerSchema,
  NeedsVerificationSubmissionDtoSchema,
  SiteVerificationSchema,
  canonicalCaptureString,
  canonicalNeedsVerificationForm,
  distanceMeters,
  needsSitePath,
  siteCoordinateCorrections,
  sitesNotFound,
  type NeedsVerificationForm,
} from '@insite/shared';
import { needsFixture, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { answersFor, jpeg, locationsFor, northOf, phone, submitFromPhone, takeVerificationPhoto } from './helpers/needsScenarioSteps.n8';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let clearAuthCache: () => void;
const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let tenantId = '';

const DPP = 'dpp@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const ME = 'me.officer@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';
const KANO_PROCUREMENT = 'kano.procurement@ubec.test';
const N = '/api/v1/needs';
const F = '/api/v1/needs-verifications';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function upload(email: string, cycleId: string, names: NeedsFixtureName[]): Promise<string[]> {
  const files = names.map((n) => ({ fileName: `${n}.xlsx`, fileBase64: needsFixture(n).toString('base64'), proposalId: null }));
  const preview = await request(app).post(`${N}/cycles/${cycleId}/uploads/preview`).set(await web(email)).send({ files });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const confirm = await request(app)
    .post(`${N}/cycles/${cycleId}/uploads/confirm`)
    .set(await web(email))
    .send({ files: files.map((f, i) => ({ ...f, sha256: sha(needsFixture(names[i])) })) });
  assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
  const refs = (confirm.body.data.files as Array<{ reference: string }>).map((f) => f.reference);
  return Promise.all(refs.map(async (reference) => (await prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } })).id));
}

async function submit(email: string, cycleId: string, proposalIds: string[]) {
  const res = await request(app).post(`${N}/cycles/${cycleId}/proposal-actions`).set(await web(email)).send({ action: 'SUBMIT', proposalIds, reason: null });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function drawing(email: string, cycleId: string, proposalId: string) {
  const auth = await web(email);
  const pdf = Buffer.from(`%PDF-1.4\n% drawing ${crypto.randomUUID()}\n%%EOF\n`);
  const presign = await request(app).post(`${N}/cycles/${cycleId}/documents/presign`).set(auth).send({ fileName: 'drawing.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const target = new URL(presign.body.data.uploadUrl);
  assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
  const doc = await request(app).post(`${N}/proposals/${proposalId}/documents`).set(auth).send({ objectKey: presign.body.data.objectKey, kind: 'DRAWING', title: 'Classroom drawings' });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
}

const assign = async (email: string, proposalId: string, body: Record<string, unknown>) =>
  request(app).post(`${N}/proposals/${proposalId}/verifications`).set(await web(email)).send({ purpose: 'VALIDATION', dueDate: inDays(7), siteNumbers: [], ...body });

function refused(res: request.Response, status: number, code: string) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code, JSON.stringify(res.body));
}

async function withGrant<T>(roleCode: string, key: string, fn: () => Promise<T>): Promise<T> {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId, code: roleCode } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  clearAuthCache();
  try {
    return await fn();
  } finally {
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
    clearAuthCache();
  }
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  await clearSeededNeedsPipeline(prisma);
  ({ clearAuthCache } = await import('../middleware/auth.middleware'));
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  // Wave 5 owner decision 4: kano.dpp@ verifies Matching Grants proposals on the phone. Until the seed
  // gives it a mobile role, the SUBEB M&E Officer role (surface BOTH) stands in.
  const kanoDpp = await prisma.user.findUniqueOrThrow({ where: { email: KANO_DPP } });
  if (!kanoDpp.mobileRoleId) {
    const both = await prisma.role.findFirstOrThrow({ where: { tenantId, code: 'SUBEB_ME_OFFICER' } });
    await prisma.user.update({ where: { id: kanoDpp.id }, data: { mobileRoleId: both.id } });
  }
});

describe('N8 setup', () => {
  it('DI cycle with -001 and -002 at Validation; Kano MG cycle with -KN-001 at Validation', async () => {
    const di = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2027 });
    assert.equal(di.status, 201, JSON.stringify(di.body));
    ids.diCycle = di.body.data.id;
    [ids.p1, ids.p2] = await upload(PROCUREMENT, ids.diCycle, ['di-draft-valid', 'essential-gap']);
    await submit(PROCUREMENT, ids.diCycle, [ids.p1, ids.p2]);

    const mg = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' });
    assert.equal(mg.status, 201, JSON.stringify(mg.body));
    ids.mgCycle = mg.body.data.id;
    [ids.mg1] = await upload(KANO_PROCUREMENT, ids.mgCycle, ['mg-complete-valid']);
    await drawing(KANO_PROCUREMENT, ids.mgCycle, ids.mg1);
    await submit(KANO_PROCUREMENT, ids.mgCycle, [ids.mg1]);
    for (const id of [ids.p1, ids.p2, ids.mg1]) {
      const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([p.stage, p.status], ['VALIDATION', 'IN_PROGRESS']);
    }
  });
});

describe('N8 assign', () => {
  it('officers: VALIDATION = owner or below with a field app sign-in and needs:view; BEAP_REVIEW = strictly above the owner', async () => {
    const di = NeedsVerificationOfficerSchema.array().parse((await request(app).get(`${N}/proposals/${ids.p1}/verification-officers?purpose=VALIDATION`).set(await web(ME))).body.data);
    const names = di.map((o) => o.email);
    assert.ok(names.includes(ME), JSON.stringify(names));
    assert.ok(!names.includes(DPP), 'web-only role');
    assert.ok(!names.includes('resident.supervisor@ubec.test'), 'no needs:view');
    const kano = NeedsVerificationOfficerSchema.array().parse((await request(app).get(`${N}/proposals/${ids.mg1}/verification-officers?purpose=VALIDATION`).set(await web(KANO_DPP))).body.data);
    assert.deepEqual(kano.map((o) => o.email), [KANO_DPP], 'Kano SUBEB only (UBEC HQ is above it)');
    const beap = NeedsVerificationOfficerSchema.array().parse((await request(app).get(`${N}/proposals/${ids.mg1}/verification-officers?purpose=BEAP_REVIEW`).set(await web(DPP))).body.data);
    assert.ok(beap.some((o) => o.email === ME) && !beap.some((o) => o.email === KANO_DPP), JSON.stringify(beap));
    refused(await request(app).get(`${N}/proposals/${ids.p1}/verification-officers`).set(await web(PROCUREMENT)), 403, 'FORBIDDEN_PERMISSION');
  });

  it('refusals: permission, officer, sites, due date', async () => {
    const me = await userId(ME);
    refused(await assign(PROCUREMENT, ids.p1, { officerUserId: me }), 403, 'FORBIDDEN_PERMISSION');
    refused(await assign(ME, ids.p1, { officerUserId: await userId(DPP) }), 422, 'NEEDS_VERIFICATION_OFFICER_INVALID');
    refused(await assign(ME, ids.p1, { officerUserId: me, siteNumbers: [1, 9] }), 422, 'NEEDS_VERIFICATION_SITES_INVALID');
    refused(await assign(ME, ids.p1, { officerUserId: me, dueDate: '2020-01-01' }), 422, 'NEEDS_VERIFICATION_DUE_DATE_INVALID');
    // The Kano SUBEB writes only its own cycle.
    refused(await assign(KANO_DPP, ids.p1, { officerUserId: me }), 404, 'NEEDS_PROPOSAL_NOT_FOUND');
  });

  it('assign provisions the reserved sections lazily, freezes the form with its hash and audits it', async () => {
    await prisma.formSection.deleteMany({ where: { tenantId, code: { in: Object.values(NEEDS_VERIFICATION_SECTION_CODES) } } });
    const res = await assign(ME, ids.p1, { officerUserId: await userId(ME), instructions: 'Meet the head teacher first.' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsVerificationDtoSchema.parse(res.body.data);
    ids.v1 = dto.id;
    assert.deepEqual([dto.status, dto.purpose, dto.reference, dto.rowCount, dto.sites.map((s) => s.siteNumber)], ['ASSIGNED', 'VALIDATION', '2027-DI-001', 9, [1, 2]]);
    assert.deepEqual(dto.allowedActions, ['CANCEL']);
    const sections = await prisma.formSection.findMany({ where: { tenantId, code: { in: Object.values(NEEDS_VERIFICATION_SECTION_CODES) } } });
    assert.deepEqual(sections.map((s) => s.version), [1, 1]);
    const row = await prisma.needsVerification.findUniqueOrThrow({ where: { id: dto.id } });
    const form = row.formJson as unknown as NeedsVerificationForm;
    assert.equal(row.formHash, sha(Buffer.from(canonicalNeedsVerificationForm(form))));
    assert.equal(form.blocks.length, 11);
    assert.deepEqual(form.sources.sections.map((s) => s.id).sort(), sections.map((s) => s.id).sort());
    const { sectionUsage } = await import('../modules/forms/formLibrary.service');
    const usage = await sectionUsage(prisma, tenantId, sections.map((s) => s.id));
    assert.ok(sections.every((s) => usage.get(s.id) === 1), 'a frozen form is a use: the next save makes v2');
    assert.equal((await sectionUsage(prisma, crypto.randomUUID(), sections.map((s) => s.id))).size, 0, 'another tenant counts no use');
    // The seed's verifications wrote entries too (the ledger keeps them): read the latest.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_VERIFICATION_ASSIGNED' }, orderBy: { seq: 'desc' } });
    assert.equal((audit.payload as { proposalId: string }).proposalId, ids.p1);
  });

  it('one open verification per proposal and purpose', async () => {
    refused(await assign(ME, ids.p1, { officerUserId: await userId(ME) }), 409, 'NEEDS_VERIFICATION_OPEN_EXISTS');
  });

  it('BEAP site visit gates: organisation above the owner, proposal on a BEAP in review, permission', async () => {
    const me = await userId(ME);
    refused(await assign(DPP, ids.p1, { purpose: 'BEAP_REVIEW', officerUserId: me }), 403, 'NEEDS_CYCLE_FORBIDDEN');
    refused(await assign(DPP, ids.mg1, { purpose: 'BEAP_REVIEW', officerUserId: me }), 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    refused(await assign(KANO_DPP, ids.mg1, { purpose: 'BEAP_REVIEW', officerUserId: me }), 403, 'FORBIDDEN_PERMISSION');
  });
});

describe('N8 field app', () => {
  it('feed and form: ETag and 304; access by assignment only', async () => {
    const p = await phone(app, ME);
    const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set(p.auth)).body.data);
    const item = feed.items.find((i) => i.id === ids.v1);
    assert.ok(item, JSON.stringify(feed));
    assert.deepEqual([item.status, item.overdue, item.instructions, item.allowedActions], ['ASSIGNED', false, 'Meet the head teacher first.', []]);

    const form = await request(app).get(`${F}/${ids.v1}/form`).set(p.auth);
    assert.equal(form.status, 200, JSON.stringify(form.body));
    const dto = NeedsVerificationFormDtoSchema.parse(form.body.data);
    assert.equal(form.headers.etag, `"${dto.formHash}"`);
    assert.equal((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth).set('If-None-Match', `"${dto.formHash}"`)).status, 304);
    assert.equal((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth).set('If-None-Match', dto.formHash)).status, 304, 'unquoted too');
    assert.equal((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth).set('If-None-Match', '"0000"')).status, 200);
    // The phone stores a form only when its hash is the SHA-256 of the canonical form.
    assert.equal(dto.formHash, sha(Buffer.from(canonicalNeedsVerificationForm(dto.form))));

    const other = await phone(app, 'resident.supervisor@ubec.test');
    refused(await request(app).get(`${F}/${ids.v1}/form`).set(other.auth), 404, 'NEEDS_VERIFICATION_NOT_FOUND');
    assert.deepEqual(NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set(other.auth)).body.data).items, []);
    refused(await request(app).get(`${F}/${ids.v1}/form`).set(await web(DPP)), 404, 'NEEDS_VERIFICATION_NOT_FOUND');
    refused(await request(app).get(`${F}/${crypto.randomUUID()}/form`).set(p.auth), 404, 'NEEDS_VERIFICATION_NOT_FOUND');
  });

  it('captures: presign, upload, register (201), replay (200), not uploaded (409), another officer (404)', async () => {
    const p = await phone(app, ME);
    const bytes = jpeg();
    const presign = await request(app).post(`${F}/${ids.v1}/captures/presign`).set(p.auth).send({ kind: 'PHOTO', fileName: 'school.jpg', mimeType: 'image/jpeg', byteSize: bytes.length });
    assert.equal(presign.status, 200, JSON.stringify(presign.body));
    assert.ok((presign.body.data.objectKey as string).startsWith(`tenants/${tenantId}/needs/verifications/${ids.v1}/captures/`));
    const body = {
      clientCaptureId: crypto.randomUUID(),
      kind: 'PHOTO',
      objectKey: presign.body.data.objectKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256: sha(bytes),
      capturedAt: new Date().toISOString(),
      location: { latitude: 9.652, longitude: 6.515, accuracyMeters: 5, altitudeMeters: null },
      signature: 'c2lnbmF0dXJl',
    };
    refused(await request(app).post(`${F}/${ids.v1}/captures`).set(p.auth).send(body), 409, 'OBJECT_NOT_UPLOADED');
    const target = new URL(presign.body.data.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'image/jpeg').send(bytes)).status, 200);
    const first = await request(app).post(`${F}/${ids.v1}/captures`).set(p.auth).send(body);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const again = await request(app).post(`${F}/${ids.v1}/captures`).set(p.auth).send(body);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.data, first.body.data);
    const stored = await prisma.needsVerificationCapture.findUniqueOrThrow({ where: { clientCaptureId: body.clientCaptureId } });
    assert.deepEqual([stored.serverSha256, stored.signature, stored.signatureVerified, stored.byteSize], [sha(bytes), 'c2lnbmF0dXJl', false, bytes.length]);

    // Signed by the phone's device key over canonicalCaptureString with the verification id: verified.
    const voice = Buffer.from('voice note ' + crypto.randomUUID());
    const vp = await request(app).post(`${F}/${ids.v1}/captures/presign`).set(p.auth).send({ kind: 'AUDIO', fileName: 'note.m4a', mimeType: 'audio/mp4', byteSize: voice.length });
    assert.equal(vp.status, 200, JSON.stringify(vp.body));
    const vt = new URL(vp.body.data.uploadUrl);
    assert.equal((await request(app).put(vt.pathname + vt.search).set('Content-Type', 'audio/mp4').send(voice)).status, 200);
    const signed = { clientCaptureId: crypto.randomUUID(), kind: 'AUDIO', objectKey: vp.body.data.objectKey, mimeType: 'audio/mp4', byteSize: voice.length, sha256: sha(voice), capturedAt: new Date().toISOString(), location: null, isMockLocation: false };
    const signature = p.key.sign(
      canonicalCaptureString({ clientCaptureId: signed.clientCaptureId, projectId: ids.v1, mediaType: 'VOICE_NOTE', sha256: signed.sha256, byteSize: signed.byteSize, capturedAt: signed.capturedAt, latitude: null, longitude: null, accuracyMeters: null, isMockLocation: false })
    );
    assert.equal((await request(app).post(`${F}/${ids.v1}/captures`).set(p.auth).send({ ...signed, signature })).status, 201);
    assert.equal((await prisma.needsVerificationCapture.findUniqueOrThrow({ where: { clientCaptureId: signed.clientCaptureId } })).signatureVerified, true);
    ids.capture1 = body.clientCaptureId;
    const other = await phone(app, 'resident.supervisor@ubec.test');
    refused(await request(app).post(`${F}/${ids.v1}/captures`).set(other.auth).send({ ...body, clientCaptureId: crypto.randomUUID() }), 404, 'NEEDS_VERIFICATION_NOT_FOUND');
  });

  it('submission refusals: stale hash, unregistered capture (retryable), invalid answers, missing site location', async () => {
    const p = await phone(app, ME);
    const { form, formHash } = NeedsVerificationFormDtoSchema.parse((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth)).body.data);
    const base = { clientSubmissionId: crypto.randomUUID(), formHash, answers: answersFor(form), siteLocations: locationsFor(form), notes: null, submittedAtDevice: new Date().toISOString() };
    refused(await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send({ ...base, formHash: 'f'.repeat(64) }), 409, 'NEEDS_VERIFICATION_FORM_STALE');

    const sitePhoto = form.blocks[0].fields.find((f) => f.type === 'PHOTO')!.path;
    const unregistered = await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send({ ...base, answers: answersFor(form, { [sitePhoto]: [crypto.randomUUID()] }) });
    refused(unregistered, 409, 'CAPTURES_NOT_REGISTERED');
    assert.equal(unregistered.body.error.details.retryable, true);

    const quantityPath = form.blocks[1].fields.find((f) => f.type === 'NUMBER')!.path;
    const invalid = await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send({ ...base, answers: answersFor(form, {}, { [quantityPath]: { value: null } }) });
    refused(invalid, 422, 'NEEDS_VERIFICATION_INVALID');
    assert.ok((invalid.body.error.details.errors as Array<{ path: string; code: string }>).some((e) => e.path === quantityPath && e.code === 'REQUIRED'), JSON.stringify(invalid.body));

    const noLocation = await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send({ ...base, siteLocations: locationsFor(form).slice(0, 1) });
    refused(noLocation, 422, 'NEEDS_VERIFICATION_INVALID');
    assert.deepEqual((noLocation.body.error.details.locationErrors as Array<{ code: string; siteNumber: number }>).map((e) => [e.code, e.siteNumber]), [['SITE_LOCATION_MISSING', 2]]);
    assert.equal(await prisma.needsVerificationSubmission.count({ where: { verificationId: ids.v1 } }), 0);
  });

  it('submits (201; photo gaps accepted), replays (200), then the officer can no longer upload', async () => {
    const p = await phone(app, ME);
    const { form, formHash } = NeedsVerificationFormDtoSchema.parse((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth)).body.data);
    const sitePhoto = form.blocks[0].fields.find((f) => f.type === 'PHOTO')!.path;
    const body = {
      clientSubmissionId: crypto.randomUUID(),
      formHash,
      answers: answersFor(form, { [sitePhoto]: [ids.capture1] }),
      siteLocations: locationsFor(form),
      notes: 'First visit.',
      submittedAtDevice: new Date().toISOString(),
    };
    const res = await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsVerificationSubmissionDtoSchema.parse(res.body.data);
    assert.deepEqual([dto.status, dto.clientSubmissionId, dto.notes], ['SUBMITTED', body.clientSubmissionId, 'First visit.']);
    const replay = await request(app).post(`${F}/${ids.v1}/submissions`).set(p.auth).send(body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.id, dto.id, 'the stored submission');
    assert.equal(await prisma.needsVerificationSubmission.count({ where: { verificationId: ids.v1 } }), 1);
    const capture = await prisma.needsVerificationCapture.findUniqueOrThrow({ where: { clientCaptureId: ids.capture1 } });
    assert.deepEqual([capture.submissionId, capture.answerPath], [dto.id, sitePhoto]);
    refused(
      await request(app).post(`${F}/${ids.v1}/captures/presign`).set(p.auth).send({ kind: 'PHOTO', fileName: 'late.jpg', mimeType: 'image/jpeg', byteSize: 10 }),
      409,
      'NEEDS_VERIFICATION_NOT_OPEN'
    );
    const history = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_VERIFICATION_SUBMITTED' } });
    assert.deepEqual([history.projectId, history.actorType, (history.payload as { proposalId: string }).proposalId], [null, 'FIELD_AGENT', ids.p1]);
  });
});

describe('N8 review and validation record', () => {
  it('web reads: allowed actions per viewer, capture links on the proposal list only', async () => {
    const asMe = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${ids.v1}`).set(await web(ME))).body.data);
    assert.deepEqual(asMe.allowedActions, ['REVIEW']);
    assert.ok(asMe.captures[0].url, 'signed link');
    const asDpp = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${ids.v1}`).set(await web(DPP))).body.data);
    assert.deepEqual(asDpp.allowedActions, []);
    const cycleList = NeedsVerificationDtoSchema.array().parse((await request(app).get(`${N}/cycles/${ids.diCycle}/verifications`).set(await web(DPP))).body.data);
    assert.deepEqual(cycleList.map((v) => [v.id, v.captures[0]?.url ?? null]), [[ids.v1, null]]);
    const proposalList = NeedsVerificationDtoSchema.array().parse((await request(app).get(`${N}/proposals/${ids.p1}/verifications`).set(await web(PROCUREMENT))).body.data);
    assert.ok(proposalList[0].captures[0].url);
    refused(await request(app).get(`${N}/verifications/${ids.v1}`).set(await web('lagos.admin@ubec.test')), 404, 'NEEDS_VERIFICATION_NOT_FOUND');
  });

  it('a FIELD_APP validation record needs an accepted verification (422 NEEDS_VERIFICATION_NOT_ACCEPTED)', async () => {
    const body = (verificationId: string) => ({
      outcome: 'ADVANCE',
      deskNotes: 'Needs confirmed against the school census.',
      siteVerification: { method: 'FIELD_APP', verifiedOn: inDays(0), officerName: 'Ngozi Eze', notes: null, evidenceDocumentIds: [], verificationId },
    });
    refused(await request(app).post(`${N}/proposals/${ids.p1}/validation`).set(await web(ME)).send(body(ids.v1)), 422, 'NEEDS_VERIFICATION_NOT_ACCEPTED');
    refused(await request(app).post(`${N}/proposals/${ids.p1}/validation`).set(await web(ME)).send(body(crypto.randomUUID())), 422, 'NEEDS_VERIFICATION_NOT_ACCEPTED');
  });

  it('an uploader cannot accept (409 SAME_PERSON_VALIDATION); me.officer@ returns it; the phone sees RETURNED', async () => {
    await withGrant('PROCUREMENT_OFFICER', 'needs:validate', async () => {
      refused(
        await request(app).post(`${N}/verifications/${ids.v1}/review`).set(await web(PROCUREMENT)).send({ decision: 'ACCEPT', correctCoordinates: true }),
        409,
        'SAME_PERSON_VALIDATION'
      );
    });
    refused(await request(app).post(`${N}/verifications/${ids.v1}/review`).set(await web(ME)).send({ decision: 'RETURN', reason: null }), 400, 'VALIDATION_ERROR');
    const res = await request(app).post(`${N}/verifications/${ids.v1}/review`).set(await web(ME)).send({ decision: 'RETURN', reason: 'Add a photo of site 2 and recheck the toilet count.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = NeedsVerificationDtoSchema.parse(res.body.data);
    assert.deepEqual([dto.status, dto.submission?.status, dto.submission?.reviewReason], ['RETURNED', 'RETURNED', 'Add a photo of site 2 and recheck the toilet count.']);
    refused(await request(app).post(`${N}/verifications/${ids.v1}/review`).set(await web(ME)).send({ decision: 'ACCEPT' }), 409, 'NEEDS_VERIFICATION_NOT_SUBMITTED');
    const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set((await phone(app, ME)).auth)).body.data);
    const returned = feed.items.find((i) => i.id === ids.v1)!;
    assert.equal(returned.status, 'RETURNED');
    // The phone rebuilds the correction draft offline from the returned submission.
    assert.deepEqual([returned.submission?.status, returned.submission?.notes, returned.submission?.siteLocations.length], ['RETURNED', 'First visit.', 2]);
    assert.ok((returned.submission?.answers.length ?? 0) > 0);
  });

  it('resubmitted with site 1 recorded 120 m away, then accepted: site corrected, photos filed, draft ready', async () => {
    const p = await phone(app, ME);
    const site1 = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 1 } });
    ids.site1From = JSON.stringify({ latitude: site1.latitude, longitude: site1.longitude });
    const movedTo = northOf({ latitude: site1.latitude!, longitude: site1.longitude! }, 120);
    // The returned photo is sent again; site 2 gets a new one.
    const { form } = NeedsVerificationFormDtoSchema.parse((await request(app).get(`${F}/${ids.v1}/form`).set(p.auth)).body.data);
    const sitePhoto = (n: number) => form.blocks.find((b) => b.key === `n:site:${n}`)!.fields.find((f) => f.type === 'PHOTO')!.path;
    const photo2 = await takeVerificationPhoto(app, p.auth, ids.v1);
    const { res } = await submitFromPhone(app, p.auth, ids.v1, { moved: { 1: movedTo }, reusePhotos: { [sitePhoto(1)]: [ids.capture1], [sitePhoto(2)]: [photo2] } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await prisma.needsVerificationSubmission.count({ where: { verificationId: ids.v1 } }), 2);

    const accepted = await request(app).post(`${N}/verifications/${ids.v1}/review`).set(await web(ME)).send({ decision: 'ACCEPT', reason: null });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const dto = NeedsVerificationDtoSchema.parse(accepted.body.data);
    assert.equal(dto.status, 'ACCEPTED');
    const corrections = dto.submission!.siteCorrections!;
    assert.deepEqual(corrections.map((c) => [c.siteNumber, c.distanceMeters]), [[1, 120]]);
    const after = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 1 } });
    assert.ok(distanceMeters({ latitude: after.latitude!, longitude: after.longitude! }, movedTo) < 0.5);
    const site2 = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 2 } });
    assert.deepEqual([site2.latitude, site2.longitude], [9.701, 6.481], 'site 2 within tolerance: unchanged');

    const docs = await prisma.needsProposalDocument.findMany({ where: { id: { in: dto.submission!.evidenceDocumentIds } }, orderBy: { title: 'asc' } });
    assert.deepEqual(docs.map((d) => [d.kind, d.title]), [
      ['PHOTO', 'Field verification 2027-DI-001, site 1: photo 1'],
      ['PHOTO', 'Field verification 2027-DI-001, site 2: photo 1'],
    ]);
    const capture = await prisma.needsVerificationCapture.findUniqueOrThrow({ where: { clientCaptureId: ids.capture1 } });
    assert.ok(docs.some((d) => d.objectKey === capture.objectKey), 'the capture object is reused');

    const draft = dto.siteVerificationDraft!;
    assert.equal(draft.method, 'FIELD_APP');
    assert.equal(draft.verificationId, ids.v1);
    assert.deepEqual([...draft.evidenceDocumentIds].sort(), docs.map((d) => d.id).sort());
    assert.match(draft.notes ?? '', /Site 1 location corrected \(moved 120 m\)/);
    assert.equal(draft.officerName, (await prisma.user.findUniqueOrThrow({ where: { email: ME } })).fullName);

    const corrected = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_SITE_COORDINATES_CORRECTED' } });
    const entry = (corrected.payload as { corrections: Array<{ from: { latitude: number } | null }> }).corrections[0];
    assert.equal(entry.from?.latitude, JSON.parse(ids.site1From).latitude);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_VERIFICATION_REVIEWED' } }), 2);
  });

  it('the validator records the validation from the draft (method FIELD_APP, the filed photos as evidence)', async () => {
    const dto = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${ids.v1}`).set(await web(ME))).body.data);
    const res = await request(app)
      .post(`${N}/proposals/${ids.p1}/validation`)
      .set(await web(ME))
      .send({ outcome: 'ADVANCE', deskNotes: 'Field verification accepted; needs confirmed.', siteVerification: dto.siteVerificationDraft });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.data.siteVerification.method, res.body.data.siteVerification.verificationId], ['FIELD_APP', ids.v1]);
    assert.deepEqual(res.body.data.siteVerification.evidenceDocumentIds, dto.siteVerificationDraft!.evidenceDocumentIds);
  });

  it('corrections survive a version that still carries the old point, and conversion reads the corrected sites', async () => {
    const { replaceCurrentTables } = await import('../modules/needs/needsVersions');
    const { overlayCurrentSiteCoordinates } = await import('../modules/needs/verifications/siteCorrections');
    const { parsedOf } = await import('../modules/needs/needsSupport');
    const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.p1 }, include: { currentVersion: true } });
    const parsed = parsedOf(p.currentVersion!.parsedJson)!;
    const corrected = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 1 } });
    const overlaid = await prisma.$transaction(async (tx) => {
      await replaceCurrentTables(tx, ids.p1, parsed);
      return overlayCurrentSiteCoordinates(tx, ids.p1, parsed);
    });
    const after = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 1 } });
    assert.deepEqual([after.latitude, after.longitude], [corrected.latitude, corrected.longitude], 're-applied after the rewrite');
    assert.deepEqual([overlaid.sites[0].latitude, overlaid.sites[1].latitude], [corrected.latitude, 9.701]);
    // A file that gives a new point for the site wins.
    const moved = { ...parsed, sites: parsed.sites.map((s) => (s.siteNumber === 1 ? { ...s, latitude: 9.7, longitude: 6.6 } : s)) };
    await prisma.$transaction((tx) => replaceCurrentTables(tx, ids.p1, moved));
    const kept = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p1, siteNumber: 1 } });
    assert.deepEqual([kept.latitude, kept.longitude], [9.7, 6.6]);
    await prisma.$transaction((tx) => replaceCurrentTables(tx, ids.p1, parsed));
  });
});

describe('N8 cancel and Matching Grants', () => {
  it('cancel: only the assigner side, only before submission; the phone sees CANCELLED', async () => {
    const res = await assign(ME, ids.p2, { officerUserId: await userId(ME) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const id = res.body.data.id as string;
    refused(await request(app).post(`${N}/verifications/${id}/cancel`).set(await web(PROCUREMENT)).send({ reason: 'Not needed' }), 403, 'FORBIDDEN_PERMISSION');
    const cancelled = await request(app).post(`${N}/verifications/${id}/cancel`).set(await web(ME)).send({ reason: 'Desk evidence is enough' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.deepEqual([cancelled.body.data.status, cancelled.body.data.cancelReason], ['CANCELLED', 'Desk evidence is enough']);
    refused(await request(app).post(`${N}/verifications/${id}/cancel`).set(await web(ME)).send({ reason: 'Again' }), 409, 'NEEDS_VERIFICATION_NOT_OPEN');
    refused(await request(app).post(`${N}/verifications/${ids.v1}/cancel`).set(await web(ME)).send({ reason: 'Too late' }), 409, 'NEEDS_VERIFICATION_NOT_OPEN');
    const p = await phone(app, ME);
    const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set(p.auth)).body.data);
    assert.equal(feed.items.find((i) => i.id === id)?.status, 'CANCELLED');
    refused(await request(app).post(`${F}/${id}/captures/presign`).set(p.auth).send({ kind: 'PHOTO', fileName: 'x.jpg', mimeType: 'image/jpeg', byteSize: 10 }), 409, 'NEEDS_VERIFICATION_NOT_OPEN');
    // A new one may be assigned after the cancellation.
    assert.equal((await assign(ME, ids.p2, { officerUserId: await userId(ME) })).status, 201);
  });

  it('kano.dpp@ assigns a Matching Grants verification to himself and sees it on the phone; a capture id of another officer is refused', async () => {
    const res = await assign(KANO_DPP, ids.mg1, { officerUserId: await userId(KANO_DPP), siteNumbers: [2] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsVerificationDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.sites.map((s) => s.siteNumber), [2]);
    const p = await phone(app, KANO_DPP);
    const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set(p.auth)).body.data);
    assert.deepEqual(feed.items.map((i) => i.id), [dto.id]);
    refused(
      await request(app)
        .post(`${F}/${dto.id}/captures`)
        .set(p.auth)
        .send({ clientCaptureId: ids.capture1, kind: 'PHOTO', objectKey: 'x', mimeType: 'image/jpeg', byteSize: 1, sha256: 'a'.repeat(64), capturedAt: new Date().toISOString() }),
      409,
      'NEEDS_CAPTURE_ID_CONFLICT'
    );
  });
});

// ---------------------------------------------------------------------------
// Review fixes (wave 5): stale versions, "school not found", flags on corrected sites, feed, captures,
// draft evidence cap, reserved sections. They work on 2027-DI-002 (one site, Tunga Primary School at
// 9.6, 6.57), whose verification the cancel test left ASSIGNED to me.officer@.
// ---------------------------------------------------------------------------

/** A new version of a proposal with the same content as its current one (the file still has the old points). */
async function sameContentVersion(proposalId: string) {
  const { writeVersionInTx } = await import('../modules/needs/needsVersions');
  const { cycleConfig, parsedOf } = await import('../modules/needs/needsSupport');
  const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { currentVersion: true, cycle: true } });
  const parsed = parsedOf(p.currentVersion!.parsedJson)!;
  const fileSha = crypto.randomBytes(32).toString('hex');
  return prisma.$transaction((tx) =>
    writeVersionInTx(tx, {
      tenantId,
      cycle: p.cycle,
      config: cycleConfig(p.cycle),
      proposal: { id: p.id, reference: p.reference, stateCode: p.stateCode },
      source: 'CORRECTION',
      file: {
        objectKey: `tenants/${tenantId}/needs/cycles/${p.cycleId}/versions/${fileSha}.xlsx`,
        fileName: 'same.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 1,
        sha256: fileSha,
      },
      parsed,
      costingStandardVersionId: null,
      isLegacyTemplate: p.currentVersion!.templateVersion !== NEEDS_TEMPLATE_VERSION,
      uploadedBy: { userId: p.currentVersion!.uploadedByUserId, name: p.currentVersion!.uploadedByName },
    })
  );
}

/** Submits the verification from me.officer@'s phone with answer overrides and moved sites. */
async function submitWith(
  verificationId: string,
  opts: { override?: (form: NeedsVerificationForm) => Record<string, { value: string; comment: string }>; moved?: Record<number, { latitude: number; longitude: number }> } = {}
) {
  const p = await phone(app, ME);
  const { form, formHash } = NeedsVerificationFormDtoSchema.parse((await request(app).get(`${F}/${verificationId}/form`).set(p.auth)).body.data);
  const res = await request(app)
    .post(`${F}/${verificationId}/submissions`)
    .set(p.auth)
    .send({
      clientSubmissionId: crypto.randomUUID(),
      formHash,
      answers: answersFor(form, {}, opts.override?.(form) ?? {}),
      siteLocations: locationsFor(form, opts.moved ?? {}),
      notes: null,
      submittedAtDevice: new Date().toISOString(),
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return form;
}

const liveVerificationOf = async (proposalId: string) =>
  (await prisma.needsVerification.findFirstOrThrow({ where: { proposalId, status: { in: ['ASSIGNED', 'SUBMITTED', 'RETURNED'] } } })).id;
const review = async (verificationId: string, body: Record<string, unknown>) => request(app).post(`${N}/verifications/${verificationId}/review`).set(await web(ME)).send(body);

describe('N8 review fixes', () => {
  it('a site whose school was not found is never moved (sitesNotFound, server and web preview agree)', async () => {
    const id = await liveVerificationOf(ids.p2);
    ids.v2NotFound = id;
    const site = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p2, siteNumber: 1 } });
    const far = northOf({ latitude: site.latitude!, longitude: site.longitude! }, 300);
    const form = await submitWith(id, {
      override: (f) => ({ [needsSitePath(f.sites[0].siteNumber, NEEDS_VERIFICATION_FIELD_KEYS.schoolFound)]: { value: 'NO', comment: 'No school here: a market.' } }),
      moved: { 1: far },
    });
    const submitted = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${id}`).set(await web(ME))).body.data);
    assert.deepEqual(sitesNotFound(form, submitted.submission!.answers), [1]);
    assert.equal(siteCoordinateCorrections(form.sites, submitted.submission!.siteLocations).length, 1, 'without the skip it would move');
    assert.deepEqual(siteCoordinateCorrections(form.sites, submitted.submission!.siteLocations, { skipSiteNumbers: [1] }), []);
    const res = await review(id, { decision: 'ACCEPT', reason: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.submission.siteCorrections, []);
    const after = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p2, siteNumber: 1 } });
    assert.deepEqual([after.latitude, after.longitude], [site.latitude, site.longitude]);
  });

  it('flags of a new version read the corrected sites; the draft caps evidence at 50; an earlier version is refused (422 NEEDS_VERIFICATION_STALE_VERSION)', async () => {
    assert.equal((await assign(ME, ids.p2, { officerUserId: await userId(ME) })).status, 201);
    const id = await liveVerificationOf(ids.p2);
    // Recorded onto 2027-DI-001's site 2 (9.701, 6.481): the corrected site is a duplicate of it.
    await submitWith(id, { moved: { 1: { latitude: 9.701, longitude: 6.481 } } });
    const accepted = await review(id, { decision: 'ACCEPT', reason: null });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.deepEqual(accepted.body.data.submission.siteCorrections.map((c: { siteNumber: number }) => c.siteNumber), [1]);
    const openDuplicate = () => prisma.needsProposalFlag.count({ where: { proposalId: ids.p2, kind: 'DUPLICATE', resolvedAt: null } });
    assert.equal(await openDuplicate(), 1, 'acceptance re-ran the flags on the corrected site');
    const draft = NeedsVerificationDtoSchema.parse(accepted.body.data).siteVerificationDraft!;
    assert.equal(draft.verificationId, id);

    // More than 50 photos: the draft keeps 50 and says how many more are filed.
    const { siteVerificationDraft, VERIFICATION_INCLUDE } = await import('../modules/needs/verifications/needsVerificationSupport');
    const row = await prisma.needsVerification.findUniqueOrThrow({ where: { id }, include: VERIFICATION_INCLUDE });
    const many = Array.from({ length: 53 }, () => crypto.randomUUID());
    const big = siteVerificationDraft({ ...row, submissions: row.submissions.map((s) => (s.status === 'ACCEPTED' ? { ...s, evidenceDocumentIds: many } : s)) }, 'Africa/Lagos')!;
    SiteVerificationSchema.parse(big);
    assert.deepEqual(big.evidenceDocumentIds, many.slice(0, 50));
    assert.match(big.notes ?? '', /3 more photos are filed on the proposal's Documents tab\.$/);

    // A new version whose file still carries the old point: the correction is re-applied and the flags
    // are computed on it, so the duplicate stays open.
    const written = await sameContentVersion(ids.p2);
    assert.ok(written.flags.some((f) => f.kind === 'DUPLICATE'), JSON.stringify(written.flags.map((f) => f.kind)));
    assert.equal(await openDuplicate(), 1);
    const site = await prisma.needsProposalSite.findFirstOrThrow({ where: { proposalId: ids.p2, siteNumber: 1 } });
    assert.deepEqual([site.latitude, site.longitude], [9.701, 6.481]);

    const stale = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${id}`).set(await web(ME))).body.data);
    assert.equal(stale.siteVerificationDraft, null, 'no draft once the proposal has a newer version');
    refused(
      await request(app).post(`${N}/proposals/${ids.p2}/validation`).set(await web(ME)).send({ outcome: 'ADVANCE', deskNotes: 'From the old draft.', siteVerification: draft }),
      422,
      'NEEDS_VERIFICATION_STALE_VERSION'
    );
  });

  it('captures: two registrations of one upload at once, one wins (409 NEEDS_CAPTURE_OBJECT_IN_USE)', async () => {
    assert.equal((await assign(ME, ids.p2, { officerUserId: await userId(ME) })).status, 201);
    const id = await liveVerificationOf(ids.p2);
    ids.v2Stale = id;
    const p = await phone(app, ME);
    const bytes = jpeg();
    const presign = await request(app).post(`${F}/${id}/captures/presign`).set(p.auth).send({ kind: 'PHOTO', fileName: 'race.jpg', mimeType: 'image/jpeg', byteSize: bytes.length });
    const target = new URL(presign.body.data.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'image/jpeg').send(bytes)).status, 200);
    const body = () => ({
      clientCaptureId: crypto.randomUUID(),
      kind: 'PHOTO',
      objectKey: presign.body.data.objectKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256: sha(bytes),
      capturedAt: new Date().toISOString(),
    });
    const results = await Promise.all([request(app).post(`${F}/${id}/captures`).set(p.auth).send(body()), request(app).post(`${F}/${id}/captures`).set(p.auth).send(body())]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.find((r) => r.status === 409)!.body.error.code, 'NEEDS_CAPTURE_OBJECT_IN_USE');
    assert.equal(await prisma.needsVerificationCapture.count({ where: { objectKey: presign.body.data.objectKey } }), 1);
  });

  it('feed: a submission waiting for review stays however old; accepted ones age out after 30 days', async () => {
    const id = ids.v2Stale;
    await submitWith(id);
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.$executeRaw`UPDATE needs_verifications SET "updatedAt" = ${old} WHERE id IN (${id}::uuid, ${ids.v2NotFound}::uuid)`;
    const feed = NeedsVerificationFeedDtoSchema.parse((await request(app).get(`${F}/mine`).set((await phone(app, ME)).auth)).body.data);
    assert.equal(feed.items.find((i) => i.id === id)?.status, 'SUBMITTED');
    assert.ok(!feed.items.some((i) => i.id === ids.v2NotFound), 'accepted 40 days ago: gone');
  });

  it('accepting a verification of an earlier version, or once the proposal left Validation, is refused (409 NEEDS_VERIFICATION_STALE); returning still works', async () => {
    const id = ids.v2Stale;
    // Same version, but the proposal is no longer IN_PROGRESS at Validation.
    await prisma.needsProposal.update({ where: { id: ids.p2 }, data: { status: 'RETURNED' } });
    try {
      refused(await review(id, { decision: 'ACCEPT', reason: null }), 409, 'NEEDS_VERIFICATION_STALE');
    } finally {
      await prisma.needsProposal.update({ where: { id: ids.p2 }, data: { status: 'IN_PROGRESS' } });
    }
    await sameContentVersion(ids.p2);
    refused(await review(id, { decision: 'ACCEPT', reason: null }), 409, 'NEEDS_VERIFICATION_STALE');
    const dto = NeedsVerificationDtoSchema.parse((await request(app).get(`${N}/verifications/${id}`).set(await web(ME))).body.data);
    assert.deepEqual(dto.allowedActions, ['REVIEW'], 'return is still offered');
    const returned = await review(id, { decision: 'RETURN', reason: 'The needs assessment changed: cancel and reassign.' });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.equal(returned.body.data.status, 'RETURNED');
  });

  it('reserved sections: no archive (409 FORM_SECTION_RESERVED), fixed keys and condition options kept (422 FORM_SECTION_RESERVED_KEYS), not in templates (422)', async () => {
    const admin = await web('admin@ubec.test');
    const L = '/api/v1/form-library';
    refused(await request(app).patch(`${L}/sections/${NEEDS_VERIFICATION_SECTION_CODES.SITE}`).set(admin).send({ archived: true }), 409, 'FORM_SECTION_RESERVED');
    type Section = { code: string; title: string; description: string | null; fields: Array<{ key: string; label: string; options: Array<{ key: string; label: string }> }> };
    const latest = async (code: string) => (await request(app).get(`${L}/sections/${code}/versions`).set(admin)).body.data[0] as Section;
    const save = async (s: Section, fields: unknown[]) => request(app).put(`${L}/sections/${s.code}`).set(admin).send({ code: s.code, title: s.title, description: s.description, fields });

    const site = await latest(NEEDS_VERIFICATION_SECTION_CODES.SITE);
    const noFound = await save(site, site.fields.filter((f) => f.key !== NEEDS_VERIFICATION_FIELD_KEYS.schoolFound));
    refused(noFound, 422, 'FORM_SECTION_RESERVED_KEYS');
    assert.equal(noFound.body.error.details.key, NEEDS_VERIFICATION_FIELD_KEYS.schoolFound);

    const facility = await latest(NEEDS_VERIFICATION_SECTION_CODES.FACILITY);
    const condition = facility.fields.find((f) => f.key === NEEDS_VERIFICATION_FIELD_KEYS.existingCondition)!;
    const withOptions = (options: Array<{ key: string; label: string }>) => facility.fields.map((f) => (f.key === NEEDS_VERIFICATION_FIELD_KEYS.existingCondition ? { ...f, options } : f));
    refused(await save(facility, withOptions(condition.options.slice(1))), 422, 'FORM_SECTION_RESERVED_KEYS');
    refused(await save(facility, withOptions([...condition.options, { key: 'unknown', label: 'Unknown' }])), 422, 'FORM_SECTION_RESERVED_KEYS');
    const relabelled = await save(facility, withOptions(condition.options.map((o) => ({ ...o, label: `${o.label} (seen)` }))));
    assert.equal(relabelled.status, 200, JSON.stringify(relabelled.body));

    refused(
      await request(app)
        .post(`${L}/templates`)
        .set(admin)
        .send({ code: 'AD_HOC_NEEDS', name: 'Needs check', visitKind: 'AD_HOC', blocks: [{ type: 'SECTION', sectionCode: NEEDS_VERIFICATION_SECTION_CODES.SITE }] }),
      422,
      'FORM_SECTION_RESERVED'
    );
  });
});
