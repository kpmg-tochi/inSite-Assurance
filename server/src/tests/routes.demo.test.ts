/**
 * The UBEC demo, walked through the API as the web portal and the field app make the calls, on the
 * seeded UBEC tenant with the seeded logins (`saas_updates/demo_pack/README.md`). Dates are relative to
 * the day the test runs.
 *
 * 1. admin@ creates the Direct Intervention draft, imports the demo needs assessment (preview +
 *    confirm), saves the setup sections (contractor typed as a new organisation, team, Resident
 *    Supervisor as visit officer), files the contract documents and activates.
 * 2. Kick-off today: briefing pack, notice with a short-notice reason, held with quorum, minutes
 *    signed by the owner and the M&E officer; mobilisation documents filed and signed.
 * 3. The proposed mobilisation check is moved to today by me.officer@, published to the Resident
 *    Supervisor, who confirms, checks in and submits "Contractor on site: Yes" on the phone;
 *    me.officer@ approves it and the contractor-on-site milestone is done.
 * 4. me.officer@ plans an Ad hoc visit for independent.me@ (Toilet picked); on the phone, "PPE worn by
 *    all workers" = No (photo) raises a finding when me.officer@ approves; the next routine visit,
 *    once published, re-checks it.
 * 5. Completion and closure on the live project: completion notice, final evaluation visit (re-check
 *    resolved), CoC (two signatures + the beneficiary's paper copy), handover recorded by one user and
 *    reviewed by another (SAME_PERSON_REVIEW), liability period, then what closing needs.
 * 6. The seeded twins: PRG-104 (CoC and handover to finish) and PRG-106 (liability period over:
 *    close, closeout report, archive, closure pack).
 */
import { resetTestDatabase } from './helpers/testDb';
import { makeTestDeviceKey, type TestDeviceKey } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import {
  addDays,
  canonicalCaptureString,
  nextWorkdayOnOrAfter,
  validateVisitAnswers,
  type VisitFormSnapshot,
  zonedCalendarDate,
} from '@insite/shared';
import { DEMO_LINES, DEMO_PROJECT, DEMO_UNITS, demoDates, demoDocumentContext, demoWorkbookData } from '../scripts/demoProject';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let storage: typeof import('../integrations/storage.service');
let pack: typeof import('../modules/completion/closurePack.service');
const queuedPacks: string[] = [];

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const ME = 'me.officer@ubec.test';
const INDEPENDENT = 'independent.me@ubec.test';
const RESIDENT = 'resident.supervisor@ubec.test';
const WORK_WEEK = [1, 2, 3, 4, 5];

const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const dates = demoDates(today);
/** The day the field visits happen: today, or the next working day when the test runs at a weekend. */
const visitDay = nextWorkdayOnOrAfter(today, WORK_WEEK);
const SITE = { latitude: DEMO_PROJECT.latitude, longitude: DEMO_PROJECT.longitude };

const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

interface Phone {
  auth: { Authorization: string };
  key: TestDeviceKey;
}
const phones: Record<string, Phone> = {};
/** The field app's sign-in (one device per account). */
async function phone(email: string): Promise<Phone> {
  if (!phones[email]) {
    const key = makeTestDeviceKey();
    const res = await request(app).post('/api/v1/auth/mobile/login').send({
      email,
      password: PASSWORD,
      deviceId: `demo-${email}`,
      deviceModel: 'Pixel 8',
      deviceOs: 'Android 15',
      devicePublicKey: key.publicKey,
      devicePublicKeyAlg: 'ED25519',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    phones[email] = { auth: { Authorization: `Bearer ${res.body.data.accessToken as string}` }, key };
  }
  return phones[email];
}

const url = (path = '', projectId = ids.project) => `/api/v1/projects/${projectId}${path}`;

/** Upload through the presigned URL (local-disk storage in tests) and return the object key. */
async function uploadObject(auth: { Authorization: string }, projectId: string, mediaType: string, bytes: Buffer, mimeType: string, fileName: string) {
  const presign = await request(app).post(url('/evidence/presign', projectId)).set(auth).send({ mediaType, fileName, mimeType, byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const target = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(target.pathname + target.search).set('Content-Type', mimeType).send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return presign.body.data.objectKey as string;
}

/** A demo-pack PDF filed in the register, as the Documents page's "Add document" does. */
async function fileDocument(email: string, code: string, title: string, opts: { typeCode?: string; contractor?: boolean; projectId?: string; date?: string } = {}) {
  const projectId = opts.projectId ?? ids.project;
  const { renderDemoDocument } = await import('../db/demoDocuments');
  const bytes = await renderDemoDocument(code, demoDocumentContext(today, opts.date ?? today));
  const h = await web(email);
  const objectKey = await uploadObject(h, projectId, 'PROJECT_DOCUMENT', bytes, 'application/pdf', `${title}.pdf`);
  const type = await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.tenant, code: opts.typeCode ?? code } } });
  const res = await request(app)
    .post(url('/documents', projectId))
    .set(h)
    .send({ documentTypeId: type.id, title, objectKey, projectContractorId: opts.contractor ? ids.projectContractor : null });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; currentVersion: number };
}

async function signOff(email: string, documentId: string, projectId = ids.project) {
  const res = await request(app).post(url(`/documents/${documentId}/sign-off`, projectId)).set(await web(email)).send({ version: 1 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

let photoSeed = 1;
async function photoBytes(): Promise<Buffer> {
  let state = (photoSeed++ * 2654435761) >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const size = 96;
  const raw = Buffer.alloc(size * size * 3);
  const grid = Array.from({ length: 64 }, () => Math.floor(rand() * 256));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = grid[Math.floor(y / 12) * 8 + Math.floor(x / 12)];
    raw.set([v, (v * 3) % 256, (v * 7) % 256], (y * size + x) * 3);
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}

/** A site photo taken in the app: uploaded, then registered with the device signature and a fix on site. */
async function takePhoto(p: Phone, projectId = ids.project) {
  const bytes = await photoBytes();
  const objectKey = await uploadObject(p.auth, projectId, 'SITE_PHOTO', bytes, 'image/jpeg', 'photo.jpg');
  const clientCaptureId = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const location = { ...SITE, accuracyMeters: 6 };
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const body = {
    clientCaptureId,
    mediaType: 'SITE_PHOTO',
    objectKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256,
    capturedAt,
    location,
    isMockLocation: false,
    signature: p.key.sign(
      canonicalCaptureString({
        clientCaptureId,
        projectId,
        mediaType: 'SITE_PHOTO',
        sha256,
        byteSize: bytes.length,
        capturedAt,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        isMockLocation: false,
      })
    ),
  };
  const res = await request(app).post(url('/captures', projectId)).set(p.auth).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return clientCaptureId;
}

type Answer = { path: string; value: unknown; comment: string | null; captures: Array<{ clientCaptureId: string; unitId: string | null; kind: 'PHOTO' }> };

/**
 * Answers a frozen form as an officer would: `values` by field key (the last segment of the path,
 * before any @unit), sensible defaults otherwise, a comment where a rule asks for one, and a photo
 * for every photo question, per-unit slot and photo rule.
 */
async function answerForm(p: Phone, snapshot: VisitFormSnapshot, values: Record<string, { value: unknown; comment?: string }> = {}, projectId = ids.project) {
  const answers: Answer[] = [];
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      const key = f.path.split('/').pop()!.split('@')[0];
      const given = values[key] ?? (f.recheck ? values[`recheck:${f.recheck.id}`] : undefined);
      if (f.type === 'VOICE_NOTE') continue;
      if (f.type === 'PHOTO') {
        const captures: Answer['captures'] = [];
        const slots = f.photo?.slots ?? [];
        if (slots.length) for (const s of slots) captures.push({ clientCaptureId: await takePhoto(p, projectId), unitId: s.unitId, kind: 'PHOTO' });
        else for (let i = 0; i < Math.max(1, f.photo?.minCount ?? 1); i++) captures.push({ clientCaptureId: await takePhoto(p, projectId), unitId: f.unitId ?? null, kind: 'PHOTO' });
        answers.push({ path: f.path, value: null, comment: null, captures });
        continue;
      }
      let value: unknown = given?.value;
      if (value === undefined) {
        switch (f.type) {
          case 'YES_NO':
            value = f.key === 'incidents' ? 'NO' : 'YES';
            break;
          case 'NUMBER':
            value = f.boundedByPlannedQuantity && f.plannedQuantity !== null ? f.plannedQuantity : Math.max(f.min ?? 0, 12);
            break;
          case 'PERCENTAGE':
            value = 10;
            break;
          case 'RATING_1_5':
            value = 4;
            break;
          case 'SINGLE_CHOICE':
            value = f.options[0]?.key ?? null;
            break;
          case 'MULTI_CHOICE':
            value = f.options.slice(0, Math.max(1, f.minSelected ?? 1)).map((o) => o.key);
            break;
          case 'DATE':
            value = visitDay;
            break;
          default:
            value = 'Checked on site with the site engineer.';
        }
      }
      const fires = (when: Record<string, unknown>) =>
        ('equals' in when && when.equals === value) || ('atMost' in when && typeof value === 'number' && value <= (when.atMost as number));
      const needsComment = f.rules.some((r) => r.then === 'REQUIRE_COMMENT' && fires(r.when as Record<string, unknown>));
      const needsPhoto = f.rules.some((r) => r.then === 'REQUIRE_PHOTO' && fires(r.when as Record<string, unknown>));
      const captures: Answer['captures'] = needsPhoto ? [{ clientCaptureId: await takePhoto(p, projectId), unitId: f.unitId ?? null, kind: 'PHOTO' }] : [];
      answers.push({ path: f.path, value, comment: given?.comment ?? (needsComment ? 'Noted on site.' : null), captures });
    }
  }
  const check = validateVisitAnswers(snapshot, answers as never);
  assert.deepEqual(check.errors, [], 'no blocking errors');
  assert.deepEqual(check.photoGaps, [], 'every photo the form asks for is there (the phone allows the submission)');
  return answers;
}

async function visitForm(p: Phone, visitId: string, projectId = ids.project) {
  const res = await request(app).get(url(`/visits/${visitId}/form`, projectId)).set(p.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as { formSnapshotId: string; formHash: string; snapshot: VisitFormSnapshot };
}

/** On the phone: confirm, check in on site, answer and submit. Returns the submission. */
async function doVisit(p: Phone, visitId: string, values: Record<string, { value: unknown; comment?: string }>, summary: string, overall = 'SATISFACTORY', projectId = ids.project) {
  const confirm = await request(app).post(url(`/visits/${visitId}/respond`, projectId)).set(p.auth).send({ clientActionId: crypto.randomUUID(), action: 'CONFIRM' });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  const checkIn = await request(app)
    .post(url(`/visits/${visitId}/check-in`, projectId))
    .set(p.auth)
    .send({ clientCheckInId: crypto.randomUUID(), checkedInAt: new Date().toISOString(), geotag: { ...SITE, accuracyMeters: 8, capturedAt: new Date().toISOString() } });
  assert.equal(checkIn.status, 200, JSON.stringify(checkIn.body));
  assert.equal(checkIn.body.data.checkInGeofenceStatus, 'INSIDE');
  const form = await visitForm(p, visitId, projectId);
  const answers = await answerForm(p, form.snapshot, values, projectId);
  const res = await request(app)
    .post(url(`/visits/${visitId}/submissions`, projectId))
    .set(p.auth)
    .send({
      clientSubmissionId: crypto.randomUUID(),
      formSnapshotId: form.formSnapshotId,
      formHash: form.formHash,
      answers,
      overallFinding: overall,
      summaryText: summary,
      confirmedAt: new Date().toISOString(),
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { submission: res.body.data as { id: string; status: string; findingIds: string[] }, form, fieldCount: form.snapshot.blocks.reduce((n, b) => n + b.fields.length, 0) };
}

async function review(email: string, visitId: string, submissionId: string, projectId = ids.project) {
  return request(app).post(url(`/visits/${visitId}/submissions/${submissionId}/review`, projectId)).set(await web(email)).send({ decision: 'APPROVE' });
}

async function visits(projectId = ids.project) {
  const res = await request(app).get(url('/visits', projectId)).set(await web(ME));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.visits as Array<{ id: string; visitKind: string; status: string; plannedDate: string; assignees: Array<{ userId: string; isLead: boolean }> }>;
}

async function milestone(key: string, projectId = ids.project) {
  const res = await request(app).get(url('/milestones', projectId)).set(await web(ADMIN));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.data.milestones as Array<{ id: string; key: string; status: string; completedAt: string | null; readyToComplete: boolean }>).find((m) => m.key === key)!;
}

async function phase(projectId: string) {
  const res = await request(app).get(url('/phase', projectId)).set(await web(ADMIN));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as { phase: string; transitions: Array<{ to: string; allowed: boolean; reason: string | null }> };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  storage = await import('../integrations/storage.service');
  pack = await import('../modules/completion/closurePack.service');
  pack.setClosurePackScheduler((id) => queuedPacks.push(id));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.central = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: DEMO_PROJECT.typeCode } })).id;
  ids.kano = (await prisma.region.findFirstOrThrow({ where: { tenantId: tenant.id, name: DEMO_PROJECT.region } })).id;
  ids.meOrg = (await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Independent M&E Consultants (COREN-certified)' } })).id;
  for (const [k, email] of [['admin', ADMIN], ['me', ME], ['independent', INDEPENDENT], ['resident', RESIDENT]] as const) {
    ids[k] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }
  ids.toilet = (await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'TOILET' } } })).id;
});

after(async () => {
  pack?.setClosurePackScheduler(null);
});

describe('UBEC demo: Direct Intervention, live', () => {
  it('1. the administrator creates the draft and imports the needs assessment', async () => {
    const created = await request(app).post('/api/v1/projects').set(await web(ADMIN)).send({
      name: DEMO_PROJECT.name,
      codePrefix: DEMO_PROJECT.code,
      stateLocation: DEMO_PROJECT.stateLocation,
      totalBudgetNgn: DEMO_PROJECT.budgetNgn,
      projectTypeId: ids.central,
      regionId: ids.kano,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.project = created.body.data.projectId;

    const { buildScopeWorkbook } = await import('../modules/scope/workbook/scopeWorkbook');
    const file = (await buildScopeWorkbook(demoWorkbookData(today))).toString('base64');
    const preview = await request(app).post(url('/scope/import/preview')).set(await web(ADMIN)).send({ fileBase64: file, fileName: 'Dawakin Tofa needs assessment.xlsx' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const p = preview.body.data;
    assert.deepEqual(p.issues, []);
    assert.equal(p.canConfirm, true);
    assert.equal(p.totals.unitCount, DEMO_UNITS.length);
    assert.equal(p.totals.lineCount, DEMO_LINES.length);
    assert.equal(p.totals.amountNgn, 44_275_000);
    const fills = (p.projectChanges as Array<{ field: string; action: string }>).filter((c) => c.action === 'FILL').map((c) => c.field).sort();
    assert.deepEqual(fills, ['geofence', 'lgaLocation', 'school', 'siteAddress', 'strategicJustification', 'assumptions', 'interventionYear', 'fundingSource'].sort());

    const confirm = await request(app).post(url('/scope/import/confirm')).set(await web(ADMIN)).send({ fileBase64: file, sha256: p.sha256 });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const scope = await request(app).get(url('/scope')).set(await web(ADMIN));
    assert.equal(scope.body.data.sprints.length, 2);
    assert.equal(scope.body.data.sprints[0].startDate, dates.sprints[0].startDate);
    assert.equal(scope.body.data.units.length, 3);
  });

  it('2. setup: contractor (new organisation), contract, team, the Resident Supervisor as visit officer; contract documents; activation', async () => {
    const h = await web(ADMIN);
    let dto = (await request(app).get(url('/setup')).set(h)).body.data;
    assert.equal(dto.site.geofence?.mode, 'RADIAL', JSON.stringify(dto.site));
    assert.equal(dto.basics.lgaLocation, DEMO_PROJECT.lga);
    const bodies: Record<string, unknown> = {
      basics: { name: DEMO_PROJECT.name, codePrefix: DEMO_PROJECT.code, stateLocation: DEMO_PROJECT.stateLocation, lgaLocation: DEMO_PROJECT.lga, totalBudgetNgn: DEMO_PROJECT.budgetNgn, projectTypeId: ids.central, regionId: ids.kano },
      parties: {
        owningOrganizationId: dto.parties.owningOrganization?.id ?? null,
        monitorOrganization: { id: ids.meOrg },
        lenderOrganization: dto.parties.lenderOrganization ? { id: dto.parties.lenderOrganization.id } : null,
        beneficiaries: (dto.parties.beneficiaries as Array<{ id: string; name: string }>).map((b) => ({
          id: b.id,
          name: b.name,
          beneficiaryType: 'SCHOOL',
          contactName: DEMO_PROJECT.headTeacher,
          isPrimary: true,
        })),
      },
      // The import drew a radial boundary of the workspace default radius on the workbook's GPS point.
      site: { geofence: dto.site.geofence, geofenceToleranceMeters: null, timezone: 'Africa/Lagos' },
      // Client demo updates C2 (wave 2): the sites section saves the list as it is (empty for a one-site project).
      sites: {
        sites: ((dto.sites?.sites ?? []) as Array<Record<string, unknown>>).map((s) => ({
          id: s.id,
          schoolName: s.schoolName,
          schoolLevel: s.schoolLevel,
          lgaCode: s.lgaCode,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      },
      contractor: {
        contractors: [{ organization: { name: DEMO_PROJECT.contractor }, tradeCategory: 'Water and sanitation works', tradeCode: 'WASH', plannedCompletionDate: dates.plannedCompletion }],
      },
      contract: {
        contractReference: DEMO_PROJECT.contractReference,
        contractAwardDate: dates.awardDate,
        contractSignedDate: dates.signedDate,
        contractSumNgn: DEMO_PROJECT.contractSumNgn,
        kickoffDate: dates.kickoffDate,
      },
      facility: { retention: { retentionPercentage: 5, retentionDurationMonths: 12, retentionReleaseAtCompletionPct: 0 } },
      team: { userIds: [ids.admin, ids.me, ids.independent, ids.resident] },
      visits: { workWeekDays: WORK_WEEK },
    };
    for (const step of ['project', 'contract', 'scope', 'team']) {
      const wizard = (dto.wizardSteps as Array<{ id: string; sectionIds: string[] }>).find((w) => w.id === step)!;
      for (const sectionId of wizard.sectionIds) {
        if (sectionId === 'visits') {
          // The visits section saves its officers through /visit-officers, then the working days.
          const officers = await request(app).put(url('/visit-officers')).set(h).send({ userIds: [ids.resident] });
          assert.equal(officers.status, 200, JSON.stringify(officers.body));
        }
        const res = await request(app).put(url(`/setup/${sectionId}`)).set(h).send((bodies[sectionId] ?? {}) as object);
        assert.equal(res.status, 200, `${sectionId}: ${JSON.stringify(res.body)}`);
        dto = res.body.data;
      }
    }
    assert.equal(dto.parties.contractors.length, 1);
    ids.projectContractor = dto.parties.contractors[0].id;
    ids.contractorOrg = dto.parties.contractors[0].organizationId;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ids.contractorOrg } });
    assert.equal(org.name, DEMO_PROJECT.contractor);
    assert.ok(org.categories.includes('CONTRACTOR'));

    // Step 2 documents (allowed on a draft): award, acceptance, contract.
    await fileDocument(ADMIN, 'AWARD_LETTER', 'Letter of award', { date: dates.awardDate });
    await fileDocument(ADMIN, 'ACCEPTANCE_LETTER', `Acceptance of award, ${DEMO_PROJECT.contractor}`, { contractor: true, date: dates.acceptanceDate });
    await fileDocument(ADMIN, 'CONTRACT', `Contract agreement ${DEMO_PROJECT.contractReference}`, { date: dates.signedDate });

    const setup = (await request(app).get(url('/setup')).set(h)).body.data;
    assert.equal(setup.canActivate, true, JSON.stringify((setup.steps as Array<{ complete: boolean }>).filter((s) => !s.complete)));
    const activated = await request(app).post(url('/activate')).set(h);
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.data.status, 'ACTIVE');

    // Activation proposed the type's visit plan with the Resident Supervisor as lead.
    const proposed = (await visits()).filter((v) => v.status === 'PROPOSED');
    const mobilisation = proposed.filter((v) => v.visitKind === 'MOBILISATION_CHECK');
    assert.ok(mobilisation.length >= 1, JSON.stringify(proposed.map((v) => [v.visitKind, v.plannedDate])));
    assert.deepEqual(mobilisation[0].assignees.map((a) => [a.userId, a.isLead]), [[ids.resident, true]]);
    ids.mobilisationCheck = mobilisation.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0].id;
    assert.ok(proposed.some((v) => v.visitKind === 'ROUTINE'), 'weekly routine visits from sprint 1');
    // The acceptance letter is on file, so its milestone can be completed.
    const acceptance = await milestone('acceptance-letter');
    assert.equal(acceptance.readyToComplete, true);
    const done = await request(app).post(url(`/milestones/${acceptance.id}/complete`)).set(h).send({ notes: 'Acceptance letter received.' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  });

  it('3. kick-off today: notice with a short-notice reason, held with quorum, minutes signed; mobilisation documents', async () => {
    const h = await web(ADMIN);
    const agenda = await fileDocument(ADMIN, 'KICKOFF_BRIEFING_PACK', 'Kick-off agenda and briefing pack');
    const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const save = await request(app).put(url('/kickoff')).set(h).send({
      scheduledAt,
      location: `${DEMO_PROJECT.school}, head teacher's office`,
      agendaDocumentId: agenda.id,
      invitees: [
        { stakeholderGroup: 'OWNER', name: 'Hauwa Bello', email: ADMIN, userId: ids.admin },
        { stakeholderGroup: 'MONITOR', name: 'Ngozi Eze', email: ME, userId: ids.me },
        { stakeholderGroup: 'CONTRACTOR', name: DEMO_PROJECT.contractor, email: 'projects@kurmi-waterworks.example', organizationId: ids.contractorOrg },
        { stakeholderGroup: 'BENEFICIARY', name: DEMO_PROJECT.headTeacher, email: null },
      ],
    });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    const short = await request(app).post(url('/kickoff/send-notice')).set(h).send({});
    assert.equal(short.status, 422);
    assert.equal(short.body.error.code, 'NOTICE_LEAD_TIME_SHORT');
    const sent = await request(app).post(url('/kickoff/send-notice')).set(h).send({ waiveLeadTimeReason: 'Demo: all parties agreed to meet the same day.' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));

    const minutes = await fileDocument(ADMIN, 'KICKOFF_MINUTES', `Kick-off meeting minutes, ${today.split('-').reverse().join('/')}`);
    const meeting = sent.body.data.meeting as { invitees: Array<{ id: string }> };
    const held = await request(app)
      .post(url('/kickoff/held'))
      .set(h)
      .send({ heldAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), attendance: meeting.invitees.map((i) => ({ inviteeId: i.id, attended: true })), minutesDocumentId: minutes.id });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    for (const key of ['kickoff-notice', 'kickoff-held']) assert.equal((await milestone(key)).status, 'DONE', key);
    await signOff(ADMIN, minutes.id);
    await signOff(ME, minutes.id);
    const minutesSigned = await milestone('minutes-signed');
    assert.equal(minutesSigned.readyToComplete, true);
    await request(app).post(url(`/milestones/${minutesSigned.id}/complete`)).set(h).send({ notes: 'Signed by the owner and the M&E officer.' }).expect(200);

    // Documents issued after the kick-off.
    await fileDocument(ADMIN, 'LETTER_OF_INTRODUCTION', 'Letter of introduction to the Head Teacher');
    await fileDocument(ADMIN, 'SUPERVISOR_ASSIGNMENT', 'Resident Supervisor assignment, Musa Danladi');
    const agreement = await fileDocument(ADMIN, 'MOBILISATION_AGREEMENT', 'Mobilisation agreement (incl. PPE on site)', { contractor: true });
    const possession = await fileDocument(ADMIN, 'SITE_POSSESSION_FORM', 'Site possession form', { contractor: true });
    await signOff(ADMIN, agreement.id);
    await signOff(ADMIN, possession.id);
    for (const key of ['letter-of-introduction', 'supervisor-assignment']) {
      const m = await milestone(key);
      assert.equal(m.readyToComplete, true, key);
    }
    const contractor = await milestone('contractor-mobilised');
    assert.notEqual(contractor.status, 'DONE');
  });

  it('4. mobilisation check: moved to the visit day, published, done on the phone, approved on the web', async () => {
    // me.officer@ (visits:plan) moves the proposed check and publishes it to the Resident Supervisor.
    const moved = await request(app).patch(url(`/visits/${ids.mobilisationCheck}`)).set(await web(ME)).send({ plannedDate: visitDay });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const published = await request(app).post(url('/visits/publish')).set(await web(ME)).send({ visitIds: [ids.mobilisationCheck] });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.data[0].status, 'PLANNED');

    const p = await phone(RESIDENT);
    const feed = await request(app).get('/api/v1/visits/mine').set(p.auth);
    assert.equal(feed.status, 200, JSON.stringify(feed.body));
    assert.ok(feed.body.data.items.some((i: { visit: { id: string } }) => i.visit.id === ids.mobilisationCheck));
    const { submission, fieldCount } = await doVisit(
      p,
      ids.mobilisationCheck,
      { 'contractor-on-site': { value: 'YES' }, 'letter-presented': { value: 'YES' }, workers: { value: 14 } },
      'Contractor on site with site office, signboard and drilling rig. Letter of introduction presented to the head teacher.'
    );
    assert.equal(fieldCount, 10, 'mobilisation check: 7 mobilisation questions + 3 health & safety');
    assert.equal(submission.status, 'PENDING_APPROVAL');

    const approved = await review(ME, ids.mobilisationCheck, submission.id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, 'APPROVED');
    const m = await milestone('contractor-mobilised');
    assert.equal(m.status, 'DONE');
    assert.equal(m.completedAt!.slice(0, 10), visitDay);
    assert.ok((await visits()).filter((v) => v.visitKind === 'MOBILISATION_CHECK' && v.id !== ids.mobilisationCheck).every((v) => v.status === 'CANCELLED'));
    const overview = await request(app).get(url('/overview')).set(await web(ADMIN));
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    // Confirming the contractor on site ends mobilisation: the stage bar moves to Construction.
    assert.equal(overview.body.data.stage.current, 'CONSTRUCTION');
  });

  it('5. inspector visit: an Ad hoc visit for the Independent M&E; PPE not worn raises a finding; the next visit re-checks it', async () => {
    const created = await request(app)
      .post(url('/visits'))
      .set(await web(ME))
      .send({ visitKind: 'AD_HOC', plannedDate: visitDay, assignees: [{ userId: ids.independent, isLead: true }], pickedFacilityIds: [ids.toilet] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.inspection = created.body.data.id;
    const p = await phone(INDEPENDENT);
    const { submission, form, fieldCount } = await doVisit(
      p,
      ids.inspection,
      { 'ppe-worn': { value: 'NO', comment: 'Two labourers on the toilet block foundations without helmets or boots.' }, 'percent-complete': { value: 15 }, stage: { value: 'substructure' } },
      'Toilet block foundations under way. PPE not worn by all workers.',
      'MINOR_ISSUES'
    );
    assert.ok(fieldCount <= 12, `short form: ${fieldCount} questions`);
    assert.equal(submission.status, 'PENDING_APPROVAL');
    assert.equal(form.snapshot.blocks.filter((b) => b.kind === 'FACILITY').length, 1, 'only the picked Toilet');

    const approved = await review(ME, ids.inspection, submission.id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const findings = await request(app).get(url(`/findings?visitId=${ids.inspection}`)).set(await web(ME));
    assert.equal(findings.status, 200, JSON.stringify(findings.body));
    const ppe = (findings.body.data as Array<{ id: string; questionKey: string; status: string; severity: string }>).find((f) => f.questionKey.endsWith('ppe-worn'));
    assert.ok(ppe, JSON.stringify(findings.body.data));
    assert.equal(ppe.status, 'OPEN');
    ids.ppeFinding = ppe.id;
    const toiletUnit = await prisma.facilityUnit.findFirstOrThrow({ where: { projectId: ids.project, code: 'T1' } });
    assert.equal(Number(toiletUnit.progressPct), 15);

    // The next routine visit, published by the planner, re-checks the finding.
    const nextRoutine = (await visits()).filter((v) => v.visitKind === 'ROUTINE' && v.status === 'PROPOSED').sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0];
    const pub = await request(app).post(url('/visits/publish')).set(await web(ME)).send({ visitIds: [nextRoutine.id] });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const routineForm = await visitForm(await phone(RESIDENT), nextRoutine.id);
    const recheck = routineForm.snapshot.blocks.find((b) => b.kind === 'RECHECK')?.fields.find((f) => f.recheck?.id === ids.ppeFinding);
    assert.ok(recheck, 'the routine visit re-checks the PPE finding');
  });

  it('6. completion on the live project: notice, final evaluation, CoC, handover (two people), liability period', async () => {
    const h = await web(ADMIN);
    const notice = await request(app).post(url('/phase')).set(h).send({ to: 'HANDOVER_IN_PROGRESS' });
    assert.equal(notice.status, 200, JSON.stringify(notice.body));
    const fe = (await visits()).find((v) => v.visitKind === 'FINAL_EVALUATION' && v.status === 'PROPOSED');
    assert.ok(fe, 'the completion notice proposed the final evaluation');
    await request(app).patch(url(`/visits/${fe.id}`)).set(await web(ME)).send({ plannedDate: visitDay, assignees: [{ userId: ids.me, isLead: true }] }).expect(200);
    await request(app).post(url('/visits/publish')).set(await web(ME)).send({ visitIds: [fe.id] }).expect(200);
    const p = await phone(ME);
    const { submission, form } = await doVisit(
      p,
      fe.id,
      { [`recheck:${ids.ppeFinding}`]: { value: 'YES', comment: 'All workers in helmets, boots and vests.' } },
      'Final evaluation: toilet block, borehole and solar pump delivered to specification and working.'
    );
    assert.ok(form.snapshot.blocks.some((b) => b.kind === 'RECHECK'), 'the final evaluation re-checks the PPE finding');
    // The submitter cannot approve their own report; the administrator does.
    const self = await review(ME, fe.id, submission.id);
    assert.notEqual(self.status, 200);
    const approved = await review(ADMIN, fe.id, submission.id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const finding = (await request(app).get(url(`/findings?visitId=${ids.inspection}`)).set(await web(ME))).body.data.find((f: { id: string }) => f.id === ids.ppeFinding);
    assert.equal(finding.status, 'RESOLVED');

    const draft = await request(app).post(url('/completion/certificate')).set(h).send({ completionDate: today });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    for (const [email, slotKey] of [[ADMIN, 'head-physical-planning'], [ME, 'head-me']] as const) {
      const s = await request(app).post(url('/completion/certificate/sign')).set(await web(email)).send({ slotKey });
      assert.equal(s.status, 200, `${slotKey}: ${JSON.stringify(s.body)}`);
    }
    const { renderDemoDocument } = await import('../db/demoDocuments');
    const paper = await uploadObject(h, ids.project, 'PROJECT_DOCUMENT', await renderDemoDocument('COC_SIGNED_COPY', demoDocumentContext(today)), 'application/pdf', 'coc-signed.pdf');
    const beneficiary = await request(app)
      .post(url('/completion/certificate/beneficiary'))
      .set(h)
      .send({ slotKey: 'beneficiary', beneficiaryName: DEMO_PROJECT.headTeacher, beneficiaryRole: 'Head teacher', objectKey: paper, attest: true });
    assert.equal(beneficiary.status, 200, JSON.stringify(beneficiary.body));
    const completion = await request(app).get(url('/completion')).set(h);
    assert.equal(completion.body.data.certificate.status, 'ISSUED', JSON.stringify(completion.body.data.certificate));

    const recorded = await request(app).post(url('/handover/submissions')).set(await web(ME)).send({
      stakeholderType: 'END_USER',
      decision: 'ACCEPTED',
      submitterName: DEMO_PROJECT.headTeacher,
      submitterRole: 'Head teacher',
      feedbackText: 'We accept the toilet block, borehole and solar pump. Thank you.',
      attest: true,
    });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    const sameReviewer = await request(app).post(url(`/handover/submissions/${recorded.body.data.id}/review`)).set(await web(ME)).send({});
    assert.equal(sameReviewer.status, 409);
    assert.equal(sameReviewer.body.error.code, 'SAME_PERSON_REVIEW');
    const reviewed = await request(app).post(url(`/handover/submissions/${recorded.body.data.id}/review`)).set(h).send({ notes: 'Matches the signed copy.' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal((await milestone('handover-ceremony')).status, 'DONE');

    const liability = await request(app).post(url('/phase')).set(h).send({ to: 'RETENTION_PERIOD' });
    assert.equal(liability.status, 200, JSON.stringify(liability.body));
    const after = await phase(ids.project);
    assert.equal(after.phase, 'RETENTION_PERIOD');
    const close = after.transitions.find((t) => t.to === 'COMPLETED_CLOSED')!;
    assert.equal(close.allowed, false);
    ids.liveCloseReason = close.reason ?? '';
  });

  it('6b. the live project cannot close until its defects liability period has ended; then ratings and as-built remain', async () => {
    const h = await web(ADMIN);
    assert.match(ids.liveCloseReason, /defects liability period runs until/);
    const criteria = (await request(app).get('/api/v1/closure/rating-criteria').set(h)).body.data as Array<{ key: string }>;
    const rated = await request(app)
      .post(url('/contractor-ratings'))
      .set(await web(ME))
      .send({ projectContractorId: ids.projectContractor, stage: 'COMPLETION', criteria: criteria.map((c) => ({ key: c.key, score: 4 })), comments: 'Good work; PPE fixed after the finding.' });
    assert.equal(rated.status, 201, JSON.stringify(rated.body));
    const lesson = await request(app).post(url('/lessons')).set(await web(ME)).send({
      category: 'SITE_DELIVERY',
      title: 'Check PPE from the mobilisation visit',
      description: 'Workers on the toilet block had no PPE on the first inspection; it was fixed by the final evaluation.',
      recommendation: 'Check PPE on the mobilisation check, not only on construction visits.',
      stage: 'MOBILISATION',
    });
    assert.equal(lesson.status, 201, JSON.stringify(lesson.body));
    await request(app).post(url(`/lessons/${lesson.body.data.id}/publish`)).set(await web(ME)).expect(200);
    await request(app).post(url('/closure/before-close/as-built/complete')).set(h).send({ notes: 'As-built drawings and pump manual received.' }).expect(200);
    const waiting = (await phase(ids.project)).transitions.find((t) => t.to === 'COMPLETED_CLOSED')!;
    assert.equal(waiting.allowed, false, 'closing waits for the end of the liability period');
    assert.match(waiting.reason ?? '', /defects liability period/);
    // Twelve months later (simulated): the period has ended and the project can close.
    await prisma.project.update({ where: { id: ids.project }, data: { retentionEndDate: addDays(today, -1) } });
    assert.equal((await phase(ids.project)).transitions.find((t) => t.to === 'COMPLETED_CLOSED')!.allowed, true);
  });
});

describe('UBEC demo: seeded twins', () => {
  it('PRG-104: the Head of M&E signs, the beneficiary copy issues the CoC, the handover is recorded and reviewed', async () => {
    const prg104 = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-104' } });
    const sign = await request(app).post(url('/completion/certificate/sign', prg104.id)).set(await web(ME)).send({ slotKey: 'head-me' });
    assert.equal(sign.status, 200, JSON.stringify(sign.body));
    const { renderDemoDocument } = await import('../db/demoDocuments');
    const paper = await uploadObject(await web(ADMIN), prg104.id, 'PROJECT_DOCUMENT', await renderDemoDocument('COC_SIGNED_COPY', {}), 'application/pdf', 'coc.pdf');
    const ben = await request(app)
      .post(url('/completion/certificate/beneficiary', prg104.id))
      .set(await web(ADMIN))
      .send({ slotKey: 'beneficiary', beneficiaryName: 'Mrs Adeola Martins (Principal)', beneficiaryRole: 'Principal', objectKey: paper, attest: true });
    assert.equal(ben.status, 200, JSON.stringify(ben.body));
    const rec = await request(app).post(url('/handover/submissions', prg104.id)).set(await web(ME)).send({
      stakeholderType: 'END_USER',
      decision: 'ACCEPTED_WITH_SNAGS',
      submitterName: 'Mrs Adeola Martins',
      submitterRole: 'Principal',
      snags: [{ title: 'Dripping tap', location: 'Toilet block' }],
      attest: true,
    });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    const rev = await request(app).post(url(`/handover/submissions/${rec.body.data.id}/review`, prg104.id)).set(await web(ADMIN)).send({});
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    assert.equal((await phase(prg104.id)).transitions.find((t) => t.to === 'RETENTION_PERIOD')!.allowed, true);
  });

  it('PRG-106: liability period over, retention released; close, closeout report, archive, closure pack', async () => {
    const prg106 = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-106' } });
    assert.ok(prg106.retentionEndDate! < today, 'the liability period has ended');
    assert.equal(Number(prg106.retentionHeldNgn), 0);
    const before = await phase(prg106.id);
    assert.equal(before.phase, 'RETENTION_PERIOD');
    assert.equal(before.transitions.find((t) => t.to === 'COMPLETED_CLOSED')!.allowed, true, JSON.stringify(before.transitions));
    const h = await web(ADMIN);
    const closed = await request(app).post(url('/phase', prg106.id)).set(h).send({ to: 'COMPLETED_CLOSED' });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    const early = await request(app).post(url('/archive', prg106.id)).set(h).send({ reason: 'Closure complete.' });
    assert.equal(early.status, 409, 'the closeout report is still missing');
    await fileDocument(ADMIN, 'CLOSEOUT_REPORT', 'Closeout report: Gwale Central Primary School', { projectId: prg106.id });
    const archived = await request(app).post(url('/archive', prg106.id)).set(h).send({ reason: 'Closure complete; closeout report filed.' });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    const packRes = await request(app).post(url('/closure-pack', prg106.id)).set(h);
    assert.equal(packRes.status, 202, JSON.stringify(packRes.body));
    await pack.runClosurePackExport(queuedPacks[queuedPacks.length - 1]);
    const list = await request(app).get(url('/closure-pack', prg106.id)).set(h);
    assert.equal(list.body.data[0].status, 'DONE', JSON.stringify(list.body.data[0]));
    assert.equal(list.body.data[0].chainVerified, true);
    void storage;
  });
});
