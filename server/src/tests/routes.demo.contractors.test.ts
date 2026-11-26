/**
 * Client demo updates F.1–F.3 (wave 2): the contractor register on the seeded UBEC tenant.
 * - GET /api/v1/contractors and /:id: `contractors:view_register` (list also `contractors:manage`); 403 without.
 * - POST creates the organisation tagged CONTRACTOR, INACTIVE, RC normalised; audit on the tenant ledger.
 * - Duplicates: an exact RC number is always refused (409 CONTRACTOR_DUPLICATE with candidates);
 *   a similar name needs `confirmNotDuplicate`; GET /duplicates lists both kinds.
 * - Uploading a signed contract (CONTRACT document) activates the project's INACTIVE contractor.
 * - Status changes need a reason and are audited.
 * - Rating refresh computes from accepted monitoring reports (workmanship answer), findings and
 *   verified work phases; the job `contractor-ratings` is registered and claims one run per tenant-day.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let storage: typeof import('../integrations/storage.service');
let jobs: typeof import('../jobs');

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const DAY_MS = 86_400_000;

async function web(email = ADMIN) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const withoutNulls = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as Record<string, unknown>;

/** Sets (or adds) the workmanship answer of a stored answers array. */
function withWorkmanship(answers: unknown, value: number) {
  const list = (Array.isArray(answers) ? answers : []) as Array<{ path: string; value: unknown }>;
  const rest = list.filter((a) => a.path !== 's:WORKMANSHIP/workmanship');
  return [...rest, { path: 's:WORKMANSHIP/workmanship', value, comment: null, captures: [] }] as never;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  storage = await import('../integrations/storage.service');
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
});

describe('client demo F.1–F.3: contractor register', () => {
  it('needs contractors:view_register (or contractors:manage for the list)', async () => {
    const res = await request(app).get('/api/v1/contractors').set(await web());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length > 0, 'the seed has contractors');
    const row = res.body.data[0];
    assert.ok('rating' in row && 'activeProjectCount' in row && 'statesWorkedIn' in row);
    assert.equal(row.openFlagCount, 0);

    // A UBEC user whose role holds neither key.
    const users = await prisma.user.findMany({
      where: { tenantId: ids.tenant, isActive: true, role: { surface: { not: 'MOBILE' } } },
      select: { email: true, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const outsider = users.find(
      (u) => !u.role.rolePermissions.some((p) => ['contractors:view_register', 'contractors:manage'].includes(p.permission.key))
    );
    assert.ok(outsider, 'a user without the register keys');
    const denied = await request(app).get('/api/v1/contractors').set(await web(outsider!.email));
    assert.equal(denied.status, 403);
    const deniedDetail = await request(app).get(`/api/v1/contractors/${row.id}`).set(await web(outsider!.email));
    assert.equal(deniedDetail.status, 403);
    const deniedCreate = await request(app).post('/api/v1/contractors').set(await web(outsider!.email)).send({ name: 'Nobody Builders' });
    assert.equal(deniedCreate.status, 403);
  });

  it('creates a contractor INACTIVE with the RC number normalised, audited on the tenant ledger', async () => {
    const res = await request(app)
      .post('/api/v1/contractors')
      .set(await web())
      .send({ name: 'Kogi Trust Builders Ltd', registrationNumber: 'rc-7654321', stateCode: 'ko', contactPhone: '0803 000 0000' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'INACTIVE');
    assert.equal(res.body.data.registrationNumber, 'RC 7654321');
    assert.equal(res.body.data.stateCode, 'KO');
    assert.equal(res.body.data.canManage, true);
    assert.equal(res.body.data.rating.rated, false);
    assert.equal(res.body.data.rating.summary, 'Not yet rated: 0 reports');
    ids.contractor = res.body.data.id;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ids.contractor } });
    assert.deepEqual(org.categories, ['CONTRACTOR']);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: ids.tenant, projectId: null, action: 'CONTRACTOR_CREATED' } });
    assert.ok(audit);
    assert.equal((audit!.payload as Record<string, unknown>).organizationId, ids.contractor);

    const list = await request(app).get('/api/v1/contractors').query({ status: 'INACTIVE', q: 'kogi trust' }).set(await web());
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.data.map((c: { id: string }) => c.id),
      [ids.contractor]
    );
  });

  it('refuses an exact RC number always, and a similar name until confirmed', async () => {
    const exact = await request(app)
      .post('/api/v1/contractors')
      .set(await web())
      .send({ name: 'Completely Different Works', registrationNumber: 'RC7654321', confirmNotDuplicate: true });
    assert.equal(exact.status, 409, JSON.stringify(exact.body));
    assert.equal(exact.body.error.code, 'CONTRACTOR_DUPLICATE');
    assert.equal(exact.body.error.details.candidates[0].id, ids.contractor);
    assert.equal(exact.body.error.details.candidates[0].match, 'EXACT_RC');

    const similar = await request(app).post('/api/v1/contractors').set(await web()).send({ name: 'KOGI TRUST BUILDERS (NIG.) LIMITED' });
    assert.equal(similar.status, 409, JSON.stringify(similar.body));
    assert.equal(similar.body.error.details.candidates[0].match, 'SIMILAR_NAME');

    const lookup = await request(app).get('/api/v1/contractors/duplicates').query({ name: 'Kogi Trust Builders Nigeria', rc: 'RC 7654321' }).set(await web());
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.data.length, 1);
    assert.equal(lookup.body.data[0].match, 'EXACT_RC');

    const confirmed = await request(app)
      .post('/api/v1/contractors')
      .set(await web())
      .send({ name: 'KOGI TRUST BUILDERS (NIG.) LIMITED', confirmNotDuplicate: true });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    ids.second = confirmed.body.data.id;

    // Profile edits refuse an RC number another organisation holds.
    const clash = await request(app).put(`/api/v1/contractors/${ids.second}`).set(await web()).send({ registrationNumber: 'RC 7654321' });
    assert.equal(clash.status, 409);
    const edit = await request(app).put(`/api/v1/contractors/${ids.second}`).set(await web()).send({ tin: '12345678-0001', address: '4 Lokoja Road' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.tin, '12345678-0001');
    assert.equal(await prisma.auditLog.count({ where: { tenantId: ids.tenant, projectId: null, action: 'CONTRACTOR_UPDATED' } }), 1);
  });

  it('computes the rating from accepted monitoring reports, findings and verified work phases', async () => {
    const template = await prisma.visitSubmission.findFirst({
      where: { status: 'APPROVED', project: { tenantId: ids.tenant, status: 'ACTIVE', contractors: { some: {} } } },
      orderBy: { createdAt: 'asc' },
    });
    assert.ok(template, 'the seed has an accepted monitoring report on a live UBEC project');
    ids.project = template!.projectId;
    const engagement = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.project }, orderBy: { createdAt: 'asc' } });
    ids.engagement = engagement.id;
    // The new (INACTIVE) contractor takes over this project, so its facts come from this project only.
    await prisma.projectContractor.updateMany({ where: { projectId: ids.project }, data: { organizationId: ids.contractor } });
    await prisma.projectContractor.deleteMany({ where: { projectId: ids.project, id: { not: engagement.id } } });

    const existing = await prisma.visitSubmission.findMany({ where: { projectId: ids.project, status: 'APPROVED' } });
    for (const s of existing) {
      await prisma.visitSubmission.update({ where: { id: s.id }, data: { answersJson: withWorkmanship(s.answersJson, 4), confirmedAt: new Date(Date.now() - 3 * DAY_MS) } });
    }
    const visit = await prisma.visit.findUniqueOrThrow({ where: { id: template!.visitId } });
    const extra = Math.max(0, 6 - existing.length);
    for (let i = 0; i < extra; i += 1) {
      const v = await prisma.visit.create({
        data: { ...withoutNulls(visit), id: undefined, generatorKey: null, clientVisitId: null, clientCheckInId: null, status: 'APPROVED' } as never,
      });
      await prisma.visitSubmission.create({
        data: {
          ...withoutNulls(template!),
          id: undefined,
          clientSubmissionId: crypto.randomUUID(),
          visitId: v.id,
          status: 'APPROVED',
          answersJson: withWorkmanship(template!.answersJson, i % 2 === 0 ? 3 : 5),
          confirmedAt: new Date(Date.now() - (10 + i) * DAY_MS),
        } as never,
      });
    }
    const reportCount = existing.length + extra;
    // One major finding on the project, rectified in 10 days.
    await prisma.finding.create({
      data: {
        projectId: ids.project,
        checklistItemKey: 'workmanship',
        visitSubmissionId: template!.id,
        projectContractorId: engagement.id,
        description: 'Plaster cracking on the classroom block',
        severity: 'MAJOR',
        status: 'RESOLVED',
        createdAt: new Date(Date.now() - 20 * DAY_MS),
        resolvedAt: new Date(Date.now() - 10 * DAY_MS),
      },
    });

    const refresh = await request(app).post('/api/v1/contractors/refresh-ratings').set(await web());
    assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
    assert.ok(refresh.body.data.count > 0);

    const snap = await prisma.contractorRatingSnapshot.findUniqueOrThrow({ where: { organizationId: ids.contractor } });
    assert.equal(snap.rated, true);
    assert.equal(snap.reportCount, reportCount);
    assert.equal(snap.projectCount, 1);
    assert.ok(Number(snap.score) > 0 && Number(snap.score) <= 5);
    assert.match(snap.summary, /reports on 1 project/);
    const components = snap.componentsJson as Array<{ key: string; score: number | null; basis: string }>;
    const workmanship = components.find((c) => c.key === 'WORKMANSHIP')!;
    assert.ok(workmanship.score !== null && workmanship.score >= 3 && workmanship.score <= 5);
    const findings = components.find((c) => c.key === 'FINDINGS')!;
    assert.match(findings.basis, /1 major or critical finding/);
    assert.match(findings.basis, /rectified in 10 days/);

    const detail = await request(app).get(`/api/v1/contractors/${ids.contractor}`).set(await web());
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.data.rating.rated, true);
    assert.equal(detail.body.data.rating.reportCount, reportCount);
    const project = detail.body.data.projects.find((p: { projectId: string }) => p.projectId === ids.project);
    assert.equal(project.standing, 'CURRENT');
    assert.equal(project.reportCount, reportCount);
    assert.ok(project.averageWorkmanship >= 3 && project.averageWorkmanship <= 5);
    assert.equal(detail.body.data.activeProjectCount, 1);

    // A contractor with no reports gets a snapshot that is not rated.
    const second = await prisma.contractorRatingSnapshot.findUniqueOrThrow({ where: { organizationId: ids.second } });
    assert.equal(second.rated, false);
    assert.equal(second.summary, 'Not yet rated: 0 reports');
  });

  it('activates the INACTIVE contractor when a signed contract is uploaded', async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ids.contractor } });
    assert.equal(before.contractorStatus, 'INACTIVE');
    const h = await web();
    const body = Buffer.from(`%PDF-1.4 signed contract ${crypto.randomUUID()}`);
    const presign = await request(app)
      .post(`/api/v1/projects/${ids.project}/evidence/presign`)
      .set(h)
      .send({ mediaType: 'PROJECT_DOCUMENT', fileName: 'contract.pdf', mimeType: 'application/pdf', byteSize: body.length });
    assert.equal(presign.status, 200, JSON.stringify(presign.body));
    await storage.storageService.putLocalObject(presign.body.data.objectKey, body, 'application/pdf');
    const type = await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.tenant, code: 'CONTRACT' } } });
    const res = await request(app)
      .post(`/api/v1/projects/${ids.project}/documents`)
      .set(h)
      .send({ documentTypeId: type.id, title: 'Signed contract agreement', objectKey: presign.body.data.objectKey });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: ids.contractor } });
    assert.equal(after.contractorStatus, 'ACTIVE');
    const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'CONTRACTOR_STATUS_CHANGED' } });
    assert.ok(audit);
    assert.match(audit!.summaryText, /Signed contract on file for/);
    assert.equal((audit!.payload as Record<string, unknown>).to, 'ACTIVE');
  });

  it('changes the status with a reason, audited', async () => {
    const noReason = await request(app).post(`/api/v1/contractors/${ids.contractor}/status`).set(await web()).send({ status: 'SUSPENDED', reason: '' });
    assert.equal(noReason.status, 400);
    const res = await request(app)
      .post(`/api/v1/contractors/${ids.contractor}/status`)
      .set(await web())
      .send({ status: 'SUSPENDED', reason: 'Decision of the Executive Secretary after repeated poor workmanship.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'SUSPENDED');
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: ids.tenant, projectId: null, action: 'CONTRACTOR_STATUS_CHANGED' } });
    assert.ok(audit);
    assert.equal((audit!.payload as Record<string, unknown>).from, 'ACTIVE');
    assert.equal((audit!.payload as Record<string, unknown>).to, 'SUSPENDED');
    const again = await request(app)
      .post(`/api/v1/contractors/${ids.contractor}/status`)
      .set(await web())
      .send({ status: 'SUSPENDED', reason: 'Same status again' });
    assert.equal(again.status, 409);
  });

  it('registers the contractor-ratings job, one run per tenant-day', async () => {
    assert.ok(jobs.registeredJobs().some((j) => j.name === 'contractor-ratings'));
    const now = new Date();
    assert.equal(await jobs.runJobOnce('contractor-ratings', now), true);
    const today = zonedCalendarDate(now, 'Africa/Lagos');
    const run = await prisma.jobRun.findUnique({ where: { jobName_scopeKey: { jobName: 'contractor-ratings', scopeKey: `${ids.tenant}:${today}` } } });
    assert.equal(run?.status, 'DONE');
  });
});
