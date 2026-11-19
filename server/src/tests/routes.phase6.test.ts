/**
 * Phase 6 route-level tests: organisation directory and input mode, the staged project wizard and
 * its lifecycle, draft exclusion, contractor model and multi-prime IPC scoping, per-contractor join
 * codes, geofence settings, and BOQ revisions.
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let runMorningBriefCronTick: typeof import('../jobs/morningBriefCron')['runMorningBriefCronTick'];

const PASSWORD = 'Password123!';
const DAY = 24 * 3600 * 1000;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const tokens: Record<string, string> = {};

async function as(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return bearer(tokens[email]);
}

function makeDeviceKey() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  return Buffer.from(x, 'base64url').toString('base64');
}

async function mobileToken(email: string, deviceId: string) {
  const res = await request(app).post('/api/v1/auth/mobile/login').send({
    email,
    password: PASSWORD,
    deviceId,
    deviceModel: 'Pixel 8',
    deviceOs: 'Android 15',
    devicePublicKey: makeDeviceKey(),
    devicePublicKeyAlg: 'ED25519',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as { accessToken: string; projects: Array<{ id: string; codePrefix: string }> };
}

const ids = {
  tenant: '',
  monitorOrg: '',
  lenderOrg: '',
  kan: '',
  ogn: '',
  lkk: '',
  draft: '',
};

const PERIMETER = {
  mode: 'PERIMETER',
  siteLabel: 'Test plot',
  perimeterCoordinates: [
    [3.39, 6.95],
    [3.4, 6.95],
    [3.4, 6.96],
    [3.39, 6.96],
  ],
};

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { seedDatabase } = await import('../db/seedDatabase');
  const { createApp } = await import('../app');
  ({ runMorningBriefCronTick } = await import('../jobs/morningBriefCron'));
  await seedDatabase();
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const project = (code: string) =>
    prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } }).then((p) => p.id);
  ids.kan = await project('KAN-210');
  ids.ogn = await project('OGN-305');
  ids.lkk = await project('LKK-402');
  ids.monitorOrg = (await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, categories: { has: 'ADVISORY_MONITOR' } } })).id;
  ids.lenderOrg = (
    await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: { startsWith: 'InfraCredit' } } })
  ).id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 6', { concurrency: false }, () => {
  // -------------------------------------------------------------------------
  describe('organisation directory', () => {
    it('lists by tag, hides archived entries unless asked, and is readable by any tenant user', async () => {
      const res = await request(app).get('/api/v1/organizations?tag=CONTRACTOR').set(await as('contractor@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const names = res.body.data.map((o: { name: string }) => o.name);
      assert.ok(names.includes('Voltaic Power Systems Ltd'));
      assert.ok(!names.some((n: string) => n.startsWith('Legacy Works')));
      for (const o of res.body.data) assert.ok(o.categories.includes('CONTRACTOR'));

      const all = await request(app).get('/api/v1/organizations?includeArchived=true').set(await as('contractor@insite.ng'));
      assert.ok(all.body.data.some((o: { name: string }) => o.name.startsWith('Legacy Works')));
    });

    it('needs organizations:manage to create, edit and archive; names are unique per tenant', async () => {
      const denied = await request(app)
        .post('/api/v1/organizations')
        .set(await as('contractor@insite.ng'))
        .send({ name: 'Rogue Ltd', categories: ['CONTRACTOR'] });
      assert.equal(denied.status, 403);

      const created = await request(app)
        .post('/api/v1/organizations')
        .set(await as('admin@insite.ng'))
        .send({ name: 'Sahel Surveys Ltd', categories: ['ADVISORY_MONITOR', 'CONTRACTOR'], contactEmail: '' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.deepEqual(created.body.data.categories.sort(), ['ADVISORY_MONITOR', 'CONTRACTOR']);

      const dup = await request(app)
        .post('/api/v1/organizations')
        .set(await as('admin@insite.ng'))
        .send({ name: 'sahel surveys ltd', categories: ['OTHER'] });
      assert.equal(dup.status, 409);

      const archived = await request(app)
        .post(`/api/v1/organizations/${created.body.data.id}/archive`)
        .set(await as('admin@insite.ng'));
      assert.equal(archived.status, 200);
      assert.equal(archived.body.data.isArchived, true);
      assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ORGANIZATION_UPDATED', projectId: null } }));
    });

    it('tenant settings are readable by any user and changed only with tenant:manage_settings', async () => {
      const read = await request(app).get('/api/v1/rbac/tenant/settings').set(await as('contractor@insite.ng'));
      assert.equal(read.status, 200);
      assert.equal(read.body.data.organizationInputMode, 'BOTH');
      assert.deepEqual(read.body.data.enabledGeofenceModes.sort(), ['LINEAR_CORRIDOR', 'PERIMETER', 'RADIAL']);
      assert.equal(read.body.data.defaultGeofenceToleranceMeters, 100);

      const denied = await request(app)
        .put('/api/v1/rbac/tenant/settings')
        .set(await as('monitor@insite.ng'))
        .send({ organizationInputMode: 'DIRECTORY' });
      assert.equal(denied.status, 403);
      const bad = await request(app)
        .put('/api/v1/rbac/tenant/settings')
        .set(await as('admin@insite.ng'))
        .send({ defaultGeofenceToleranceMeters: 5000 });
      assert.equal(bad.status, 400);
    });
  });

  // -------------------------------------------------------------------------
  describe('staged project creation', () => {
    const basics = {
      name: 'Phase 6 Test Clinic',
      codePrefix: 'TST-601',
      stateLocation: 'Ogun State',
      totalBudgetNgn: 500_000_000,
    };
    const step = async (stepId: string, body: unknown, email = 'monitor@insite.ng') =>
      request(app).put(`/api/v1/projects/${ids.draft}/setup/${stepId}`).set(await as(email)).send(body as object);

    it('creates a draft from the basics step only', async () => {
      const bad = await request(app)
        .post('/api/v1/projects')
        .set(await as('monitor@insite.ng'))
        .send({ ...basics, codePrefix: 'bad' });
      assert.equal(bad.status, 400);

      const res = await request(app).post('/api/v1/projects').set(await as('monitor@insite.ng')).send(basics);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'DRAFT');
      ids.draft = res.body.data.projectId;
      assert.equal(res.body.data.canActivate, false);
      // The creator's organisation is a monitor, so it is pre-filled.
      assert.equal(res.body.data.parties.monitorOrganization?.id, ids.monitorOrg);
      const steps = Object.fromEntries(res.body.data.steps.map((s: { stepId: string }) => [s.stepId, s]));
      assert.equal(steps.basics.complete, true);
      assert.equal(steps.parties.complete, false);
      assert.equal(await prisma.projectJoinCode.count({ where: { projectId: ids.draft } }), 0, 'a draft has no join codes');
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'PROJECT_DRAFT_CREATED' } }));
    });

    it('validates each step on save', async () => {
      assert.equal((await step('parties', { contractors: [{ organization: { name: 'X Ltd' }, tradeCategory: 'Civil', tradeCode: 'c!' }] })).status, 400);
      const crossing = { ...PERIMETER, perimeterCoordinates: [[3.39, 6.95], [3.4, 6.96], [3.4, 6.95], [3.39, 6.96]] };
      assert.equal((await step('site', { geofence: crossing })).status, 400);
      assert.equal((await step('site', { geofence: PERIMETER, timezone: 'Mars/Olympus' })).status, 400);
      assert.equal((await step('reporting', { reportingCadence: 'DAILY', workdayStartTime: '17:00', workdayEndTime: '08:00' })).status, 400);
      const over = await step('facility', {
        tranches: [{ trancheNumber: 1, name: 'Tranche 1', allocatedAmountNgn: 600_000_000, targetCompletionPct: 100 }],
      });
      assert.equal(over.status, 422);
      assert.equal(over.body.error.code, 'TRANCHES_EXCEED_BUDGET');
      assert.equal((await step('boq', { items: [{ boqItemId: crypto.randomUUID(), trancheId: null, isHoldPoint: false }] })).status, 404);
      assert.equal((await step('nonsense', {})).status, 404);
    });

    it('refuses activation with the exact issues while steps are incomplete', async () => {
      const res = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('monitor@insite.ng'));
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'PROJECT_INCOMPLETE');
      const codes = res.body.error.details.issues.map((i: { stepId: string; code: string }) => `${i.stepId}:${i.code}`);
      for (const expected of [
        'parties:STEP_NOT_SAVED',
        'parties:LENDER_REQUIRED',
        'parties:CONTRACTOR_MODEL_REQUIRED',
        'parties:CONTRACTOR_REQUIRED',
        'site:GEOFENCE_REQUIRED',
        'facility:TRANCHE_REQUIRED',
        'boq:BOQ_REQUIRED',
        'reporting:STEP_NOT_SAVED',
      ]) {
        assert.ok(codes.includes(expected), `missing ${expected} in ${codes.join(', ')}`);
      }
      assert.ok(!codes.some((c: string) => c.startsWith('basics:') || c.startsWith('team:')));
    });

    it('enforces the organisation input mode on the server', async () => {
      await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ organizationInputMode: 'DIRECTORY' });
      const typedNew = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { name: 'Brand New Bank Plc' },
        contractorExecutionMode: 'SINGLE_CONTRACTOR',
        contractors: [],
      });
      assert.equal(typedNew.status, 422, JSON.stringify(typedNew.body));
      assert.equal(typedNew.body.error.code, 'ORGANIZATION_NOT_IN_DIRECTORY');
      assert.equal(await prisma.organization.count({ where: { name: 'Brand New Bank Plc' } }), 0);

      // A typed name that matches the directory is a pick, not a new organisation.
      const typedExisting = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { name: 'infracredit guarantee & project finance desk' },
        contractorExecutionMode: 'SINGLE_CONTRACTOR',
        contractors: [],
      });
      assert.equal(typedExisting.status, 200, JSON.stringify(typedExisting.body));
      assert.equal(typedExisting.body.data.parties.lenderOrganization.id, ids.lenderOrg);
      await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ organizationInputMode: 'BOTH' });
    });

    it('refuses a geofence mode the tenant has not enabled', async () => {
      await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ enabledGeofenceModes: ['RADIAL'] });
      const res = await step('site', { geofence: PERIMETER });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'GEOFENCE_MODE_DISABLED');
      await request(app)
        .put('/api/v1/rbac/tenant/settings')
        .set(await as('admin@insite.ng'))
        .send({ enabledGeofenceModes: ['RADIAL', 'LINEAR_CORRIDOR', 'PERIMETER'] });
    });

    it('keeps drafts out of lists, portfolio, executive summary, mobile and scheduled jobs', async () => {
      // Make the draft look runnable to the cron: BOQ items and a day that has already started.
      const upload = await request(app)
        .post(`/api/v1/projects/${ids.draft}/boq/upload`)
        .set(await as('monitor@insite.ng'))
        .send({
          items: [
            { wbsCode: '01.01', section: 'BILL 1', description: 'Pad foundations in reinforced concrete', unit: 'm3', totalQuantity: 100, rateNgn: 1_000_000, budgetedCostNgn: 100_000_000, isHoldPoint: false },
            { wbsCode: '01.02', section: 'BILL 1', description: 'Blockwork walls 225mm', unit: 'm2', totalQuantity: 2_000, rateNgn: 50_000, budgetedCostNgn: 100_000_000, isHoldPoint: false },
          ],
        });
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      await prisma.project.update({ where: { id: ids.draft }, data: { workdayStartTime: '00:00' } });

      const list = await request(app).get('/api/v1/projects').set(await as('monitor@insite.ng'));
      assert.ok(!list.body.data.some((p: { id: string }) => p.id === ids.draft));
      const drafts = await request(app).get('/api/v1/projects/drafts').set(await as('monitor@insite.ng'));
      assert.ok(drafts.body.data.some((p: { id: string; canDelete: boolean }) => p.id === ids.draft && p.canDelete));
      const exec = await request(app).get('/api/v1/projects/portfolio/executive-summary').set(await as('monitor@insite.ng'));
      assert.equal(exec.status, 200);
      assert.ok(!exec.body.data.projects.some((p: { projectId: string }) => p.projectId === ids.draft));

      // Someone without projects:create or edit_baseline does not see another person's draft.
      const lenderView = await request(app).get(`/api/v1/projects/${ids.draft}/setup`).set(await as('lender@insite.ng'));
      assert.equal(lenderView.status, 404);
      const lenderDrafts = await request(app).get('/api/v1/projects/drafts').set(await as('lender@insite.ng'));
      assert.equal(lenderDrafts.body.data.length, 0);

      // Non-setup routes refuse a draft.
      const ipcs = await request(app).get(`/api/v1/projects/${ids.draft}/ipcs`).set(await as('monitor@insite.ng'));
      assert.equal(ipcs.status, 409);
      assert.equal(ipcs.body.error.code, 'PROJECT_IS_DRAFT');

      // Mobile: not listed, and field routes refuse it even for an assigned provisioned account.
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-draft');
      assert.ok(!mobile.projects.some((p) => p.id === ids.draft));
      assert.ok(!mobile.projects.some((p) => p.codePrefix === 'ENU-501'));
      const field = await request(app).get(`/api/v1/projects/${ids.draft}/notifications`).set(bearer(mobile.accessToken));
      assert.ok([403, 404].includes(field.status), String(field.status));

      await runMorningBriefCronTick();
      assert.equal(await prisma.morningDeliverableBrief.count({ where: { projectId: ids.draft } }), 0);
    });

    it('saves every step and activates once, issuing join codes', async () => {
      const parties = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { id: ids.lenderOrg },
        contractorExecutionMode: 'SINGLE_CONTRACTOR',
        contractors: [
          { organization: { name: 'Phase Six Builders Ltd' }, tradeCategory: 'Building works', tradeCode: 'BLD', isMainContractor: false },
        ],
      });
      assert.equal(parties.status, 200, JSON.stringify(parties.body));
      const contractor = parties.body.data.parties.contractors[0];
      assert.equal(contractor.isMainContractor, true, 'the only contractor of a single-contractor project is main');
      const created = await prisma.organization.findFirstOrThrow({ where: { name: 'Phase Six Builders Ltd' } });
      assert.deepEqual(created.categories, ['CONTRACTOR']);

      const site = await step('site', { geofence: PERIMETER, geofenceToleranceMeters: 40, timezone: 'Africa/Lagos' });
      assert.equal(site.status, 200, JSON.stringify(site.body));
      assert.equal(site.body.data.site.effectiveToleranceMeters, 40);
      assert.equal(site.body.data.site.geofence.perimeterCoordinates.length, 5, 'ring stored closed');

      const facility = await step('facility', {
        tranches: [
          {
            trancheNumber: 1,
            name: 'Tranche 1 — Whole works',
            allocatedAmountNgn: 450_000_000,
            targetCompletionPct: 100,
            conditionsPrecedent: [{ referenceCode: 'CP-01', description: 'Signed facility agreement', status: 'SATISFIED' }],
          },
        ],
      });
      assert.equal(facility.status, 200, JSON.stringify(facility.body));
      const facilityStep = facility.body.data.steps.find((s: { stepId: string }) => s.stepId === 'facility');
      assert.ok(facilityStep.warnings.some((w: { code: string }) => w.code === 'TRANCHES_BELOW_BUDGET'));
      const trancheId = facility.body.data.facility.tranches[0].id;
      assert.equal(facility.body.data.facility.tranches[0].conditionsPrecedent[0].status, 'PENDING', 'setup never sets CP status');

      const items = await prisma.boqItem.findMany({ where: { projectId: ids.draft } });
      // Uploading does not map items to tranches by itself.
      assert.ok(items.every((i) => i.trancheId === null));
      const boq = await step('boq', {
        items: items.map((i) => ({ boqItemId: i.id, trancheId, isHoldPoint: false })),
      });
      assert.equal(boq.status, 200, JSON.stringify(boq.body));
      assert.equal(boq.body.data.boq.unmappedCount, 0);

      const reporting = await step('reporting', { reportingCadence: 'WEEKLY', workdayStartTime: '07:30', workdayEndTime: '16:30' });
      assert.equal(reporting.status, 200);
      assert.equal(reporting.body.data.canActivate, true, JSON.stringify(reporting.body.data.steps));

      const lender = await prisma.user.findUniqueOrThrow({ where: { email: 'lender@insite.ng' } });
      const team = await step('team', { userIds: [lender.id], joinCodeRoleIds: null });
      assert.equal(team.status, 200, JSON.stringify(team.body));
      assert.ok(team.body.data.team.userIds.includes(lender.id));

      const contractorDenied = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('contractor@insite.ng'));
      assert.ok([403, 404].includes(contractorDenied.status));

      const activated = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('monitor@insite.ng'));
      assert.equal(activated.status, 200, JSON.stringify(activated.body));
      assert.equal(activated.body.data.status, 'ACTIVE');
      // Join-code roles of the tenant: Resident CoW (project-wide) and Contractor Site Engineer (bound to the contractor).
      assert.equal(activated.body.data.issuedJoinCodes.length, 2);
      const codes = await prisma.projectJoinCode.findMany({ where: { projectId: ids.draft }, include: { role: true } });
      const con = codes.find((c) => c.role.fieldPersonaType === 'CONTRACTOR_EXECUTOR')!;
      assert.equal(con.projectContractorId, contractor.id);
      assert.match(con.code, /^TST-601-CON-[0-9A-HJKMNP-TV-Z]{6}$/);

      const again = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('monitor@insite.ng'));
      assert.equal(again.status, 409);
      assert.equal(await prisma.projectJoinCode.count({ where: { projectId: ids.draft } }), 2, 'codes are issued once');
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'PROJECT_ACTIVATED' } }));
      const saves = await prisma.auditLog.count({ where: { projectId: ids.draft, action: 'PROJECT_SETUP_STEP_SAVED' } });
      assert.ok(saves >= 6);

      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-active');
      assert.ok(mobile.projects.some((p) => p.id === ids.draft), 'active projects appear on mobile');
    });

    it('as settings: refuses changes that would invalidate live data', async () => {
      const prefix = await step('basics', { ...basics, codePrefix: 'TST-602' });
      assert.equal(prefix.status, 409);
      assert.equal(prefix.body.error.code, 'CODE_PREFIX_LOCKED');
      const ok = await step('basics', { ...basics, name: 'Phase 6 Test Clinic (renamed)' });
      assert.equal(ok.status, 200);
      const contractorEdit = await step('reporting', { reportingCadence: 'DAILY', workdayStartTime: '07:00', workdayEndTime: '16:00' }, 'contractor@insite.ng');
      assert.ok([403, 404].includes(contractorEdit.status));
    });

    it('deletes a draft for its creator only, and never an active project', async () => {
      const d = await request(app)
        .post('/api/v1/projects')
        .set(await as('monitor@insite.ng'))
        .send({ ...basics, codePrefix: 'TST-699', name: 'Throwaway draft' });
      assert.equal(d.status, 201);
      const lenderDelete = await request(app).delete(`/api/v1/projects/${d.body.data.projectId}`).set(await as('lender@insite.ng'));
      assert.equal(lenderDelete.status, 404);
      const del = await request(app).delete(`/api/v1/projects/${d.body.data.projectId}`).set(await as('monitor@insite.ng'));
      assert.equal(del.status, 200, JSON.stringify(del.body));
      assert.equal(await prisma.project.count({ where: { id: d.body.data.projectId } }), 0);
      assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PROJECT_DRAFT_DELETED', projectId: null } }));

      const active = await request(app).delete(`/api/v1/projects/${ids.draft}`).set(await as('monitor@insite.ng'));
      assert.equal(active.status, 409);
    });
  });

  // -------------------------------------------------------------------------
  describe('archiving', () => {
    it('archives an active project: read-only, off mobile, codes deactivated, audited', async () => {
      const denied = await request(app).post(`/api/v1/projects/${ids.draft}/archive`).set(await as('contractor@insite.ng')).send({});
      assert.ok([403, 404].includes(denied.status));

      const res = await request(app)
        .post(`/api/v1/projects/${ids.draft}/archive`)
        .set(await as('monitor@insite.ng'))
        .send({ reason: 'Works completed' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'ARCHIVED');
      assert.equal(await prisma.projectJoinCode.count({ where: { projectId: ids.draft, isActive: true } }), 0);
      const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'PROJECT_ARCHIVED' } });
      assert.ok(audit);
      assert.equal((audit.payload as { reason: string }).reason, 'Works completed');

      // Still readable on the web, listed as archived, but every write is refused.
      const baseline = await request(app).get(`/api/v1/projects/${ids.draft}/baseline`).set(await as('monitor@insite.ng'));
      assert.equal(baseline.status, 200);
      const list = await request(app).get('/api/v1/projects').set(await as('monitor@insite.ng'));
      assert.equal(list.body.data.find((p: { id: string }) => p.id === ids.draft)?.status, 'ARCHIVED');
      const write = await request(app)
        .put(`/api/v1/projects/${ids.draft}/setup/reporting`)
        .set(await as('monitor@insite.ng'))
        .send({ reportingCadence: 'DAILY', workdayStartTime: '07:00', workdayEndTime: '16:00' });
      assert.equal(write.status, 409);
      assert.equal(write.body.error.code, 'PROJECT_ARCHIVED');
      const again = await request(app).post(`/api/v1/projects/${ids.draft}/archive`).set(await as('monitor@insite.ng')).send({});
      assert.equal(again.status, 409);

      // Gone from mobile and from the executive summary.
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-archived');
      assert.ok(!mobile.projects.some((p) => p.id === ids.draft));
      const exec = await request(app).get('/api/v1/projects/portfolio/executive-summary').set(await as('monitor@insite.ng'));
      assert.ok(!exec.body.data.projects.some((p: { projectId: string }) => p.projectId === ids.draft));
    });
  });

  // -------------------------------------------------------------------------
  describe('multi-prime contractors', () => {
    const claim = async (email: string, wbsCode: string, trancheNumber = 1) => {
      const item = await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.kan, wbsCode } });
      const tranche = await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: ids.kan, trancheNumber } });
      return request(app)
        .post(`/api/v1/projects/${ids.kan}/ipcs`)
        .set(await as(email))
        .send({
          trancheId: tranche.id,
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [{ boqItemId: item.id, claimedCumulativePct: 20 }],
        });
    };
    let civIpcId = '';

    it('a contractor claims its own items; IPC numbers run per contractor', async () => {
      const civ = await claim('contractor@insite.ng', '01.01');
      assert.equal(civ.status, 201, JSON.stringify(civ.body));
      assert.equal(civ.body.data.ipcNumber, 1);
      assert.equal(civ.body.data.contractorTradeCode, 'CIV');
      civIpcId = civ.body.data.id;

      // Another contractor's open IPC on the same tranche does not block this one.
      const elec = await claim('electrical@insite.ng', '02.01');
      assert.equal(elec.status, 201, JSON.stringify(elec.body));
      assert.equal(elec.body.data.ipcNumber, 1);
      assert.equal(elec.body.data.contractorName, 'Voltaic Power Systems Ltd');
    });

    it("a contractor cannot claim another contractor's item", async () => {
      // Tranche 2 (no open IPC for Voltaic there yet); 03.02 belongs to the MEP package.
      const res = await claim('electrical@insite.ng', '03.02', 2);
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'BOQ_ITEM_NOT_IN_PACKAGE');
    });

    it('one open IPC per tranche per contractor', async () => {
      const res = await claim('contractor@insite.ng', '01.02');
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'TRANCHE_HAS_OPEN_IPC');
    });

    it("a contractor sees only its own IPCs; the monitor sees all", async () => {
      const elecList = await request(app).get(`/api/v1/projects/${ids.kan}/ipcs`).set(await as('electrical@insite.ng'));
      assert.equal(elecList.status, 200);
      assert.deepEqual(elecList.body.data.map((i: { contractorTradeCode: string }) => i.contractorTradeCode), ['ELEC']);
      const other = await request(app).get(`/api/v1/projects/${ids.kan}/ipcs/${civIpcId}`).set(await as('electrical@insite.ng'));
      assert.equal(other.status, 404);
      const monitorList = await request(app).get(`/api/v1/projects/${ids.kan}/ipcs`).set(await as('monitor@insite.ng'));
      assert.equal(monitorList.body.data.length, 2);
    });

    it('issues one contractor code per package with its trade code, and scopes the mobile BOQ', async () => {
      const codes = await prisma.projectJoinCode.findMany({
        where: { projectId: ids.kan, isActive: true, projectContractorId: { not: null } },
        include: { projectContractor: true },
      });
      assert.equal(codes.length, 3);
      for (const c of codes) assert.match(c.code, new RegExp(`^KAN-210-CON-${c.projectContractor!.tradeCode}-[0-9A-HJKMNP-TV-Z]{6}$`));
      const elec = codes.find((c) => c.projectContractor!.tradeCode === 'ELEC')!;

      const join = await request(app).post('/api/v1/auth/join-project').send({
        joinCode: elec.code,
        agentFullName: 'Electrician Joiner',
        agentPhoneNumber: '+2348012345678',
        deviceId: 'device-p6-elec',
      });
      assert.equal(join.status, 201, JSON.stringify(join.body));
      assert.equal(join.body.data.sessionProfile.contractor.tradeCode, 'ELEC');
      assert.ok(join.body.data.sessionProfile.tenantBranding.primaryColorHex);
      const wbs = join.body.data.baselinePack.boqItems.map((b: { wbsCode: string }) => b.wbsCode).sort();
      assert.deepEqual(wbs, ['02.01', '02.02']);
      const session = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: join.body.data.sessionProfile.sessionId } });
      assert.equal(session.projectContractorId, elec.projectContractorId);
    });

    it('turning field reporting off for a contractor deactivates its code', async () => {
      const mep = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.kan, tradeCode: 'MEP' }, include: { organization: true } });
      const res = await request(app)
        .patch(`/api/v1/projects/${ids.kan}/contractors/${mep.id}`)
        .set(await as('monitor@insite.ng'))
        .send({
          organization: { id: mep.organizationId },
          tradeCategory: mep.tradeCategory,
          tradeCode: mep.tradeCode,
          isMainContractor: false,
          allowFieldReporting: false,
        });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await prisma.projectJoinCode.count({ where: { projectContractorId: mep.id, isActive: true } }), 0);

      const civ = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.kan, tradeCode: 'CIV' } });
      const remove = await request(app).delete(`/api/v1/projects/${ids.kan}/contractors/${civ.id}`).set(await as('monitor@insite.ng'));
      assert.equal(remove.status, 409, 'a contractor with IPC claims cannot be removed');
      assert.equal(remove.body.error.code, 'CONTRACTOR_HAS_ACTIVITY');
    });

    it('the contractor model cannot change once an IPC exists', async () => {
      const setup = await request(app).get(`/api/v1/projects/${ids.kan}/setup`).set(await as('monitor@insite.ng'));
      const res = await request(app)
        .put(`/api/v1/projects/${ids.kan}/setup/parties`)
        .set(await as('monitor@insite.ng'))
        .send({
          monitorOrganization: { id: setup.body.data.parties.monitorOrganization.id },
          lenderOrganization: { id: setup.body.data.parties.lenderOrganization.id },
          contractorExecutionMode: 'MAIN_PLUS_SUBS_UNIFIED_IPC',
          contractors: setup.body.data.parties.contractors.map((c: Record<string, unknown>) => ({
            id: c.id,
            organization: { id: c.organizationId },
            tradeCategory: c.tradeCategory,
            tradeCode: c.tradeCode,
            isMainContractor: c.isMainContractor,
            allowFieldReporting: c.allowFieldReporting,
          })),
        });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'CONTRACTOR_MODEL_LOCKED');
    });

    it('the unified and single models only let the main contractor submit', async () => {
      // On LKK-402 (single contractor) the Voltaic user is not a contractor at all.
      const lkk = await prisma.project.findUniqueOrThrow({ where: { id: ids.lkk } });
      const electrical = await prisma.user.findUniqueOrThrow({ where: { email: 'electrical@insite.ng' } });
      await prisma.userProjectAssignment.create({ data: { userId: electrical.id, projectId: lkk.id } });
      const item = await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk, trancheId: { not: null } } });
      const tranche = { id: item.trancheId! };
      const res = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/ipcs`)
        .set(await as('electrical@insite.ng'))
        .send({
          trancheId: tranche.id,
          periodStart: new Date(Date.now() - 7 * DAY).toISOString(),
          periodEnd: new Date().toISOString(),
          lineItems: [{ boqItemId: item.id, claimedCumulativePct: 99 }],
        });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'NOT_A_PROJECT_CONTRACTOR');
    });
  });

  // -------------------------------------------------------------------------
  describe('geofence on live projects', () => {
    it('the perimeter project baseline carries its tolerance; captures within tolerance are flagged, not refused', async () => {
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-ogn');
      assert.ok(mobile.projects.some((p) => p.id === ids.ogn));
      const pack = await request(app).get(`/api/v1/auth/mobile/projects/${ids.ogn}/baseline`).set(bearer(mobile.accessToken));
      assert.equal(pack.status, 200, JSON.stringify(pack.body));
      assert.equal(pack.body.data.geofenceMode, 'PERIMETER');
      assert.equal(pack.body.data.geofenceToleranceMeters, 50);

      const verify = await request(app)
        .post(`/api/v1/projects/${ids.ogn}/verify-geofence`)
        .set(await as('monitor@insite.ng'))
        // About 30 m south of the southern edge (latitude 6.945).
        .send({ latitude: 6.945 - 30 / 111_320, longitude: 3.4 });
      assert.equal(verify.status, 200, JSON.stringify(verify.body));
      assert.equal(verify.body.data.status, 'WITHIN_TOLERANCE');
      assert.equal(verify.body.data.toleranceMeters, 50);
    });
  });

  // -------------------------------------------------------------------------
  describe('BOQ revisions after activation', () => {
    it('requires a reason and never goes below certified progress', async () => {
      const certified = await prisma.boqItem.findFirstOrThrow({
        where: { projectId: ids.lkk, cumulativeCertifiedPct: { gt: 0 } },
        orderBy: { cumulativeCertifiedPct: 'desc' },
      });
      const asInput = (overrides: Partial<{ totalQuantity: number; rateNgn: number }> = {}) => {
        const totalQuantity = overrides.totalQuantity ?? Number(certified.totalQuantity);
        const rateNgn = overrides.rateNgn ?? Number(certified.rateNgn);
        return {
          wbsCode: certified.wbsCode,
          section: certified.section,
          description: certified.description,
          unit: certified.unit,
          totalQuantity,
          rateNgn,
          budgetedCostNgn: totalQuantity * rateNgn,
          isHoldPoint: certified.isHoldPoint,
        };
      };
      const upload = async (body: object) =>
        request(app).post(`/api/v1/projects/${ids.lkk}/boq/upload`).set(await as('monitor@insite.ng')).send(body);

      const noReason = await upload({ items: [asInput()], mode: 'MERGE' });
      assert.equal(noReason.status, 422);
      assert.equal(noReason.body.error.code, 'REVISION_REASON_REQUIRED');

      const certifiedQty = (Number(certified.cumulativeCertifiedPct) / 100) * Number(certified.totalQuantity);
      const below = await upload({ items: [asInput({ totalQuantity: certifiedQty * 0.5 })], mode: 'MERGE', reason: 'Re-measure' });
      assert.equal(below.status, 409, JSON.stringify(below.body));
      assert.equal(below.body.error.code, 'BOQ_BELOW_CERTIFIED');

      const lowerRate = await upload({ items: [asInput({ rateNgn: Number(certified.rateNgn) * 0.9 })], mode: 'MERGE', reason: 'Rate cut' });
      assert.equal(lowerRate.status, 409);

      const removal = await upload({
        items: [{ wbsCode: 'NEW.01', section: 'EXTRA', description: 'Additional kerbs', unit: 'm', totalQuantity: 10, rateNgn: 1000, budgetedCostNgn: 10000, isHoldPoint: false }],
        mode: 'REPLACE',
        reason: 'Replace everything',
      });
      assert.equal(removal.status, 409);
      assert.equal(removal.body.error.code, 'BOQ_ITEM_HAS_PROGRESS');

      const before = Number(certified.cumulativeCertifiedPct) * Number(certified.totalQuantity);
      const grow = await upload({
        items: [asInput({ totalQuantity: Number(certified.totalQuantity) * 2 })],
        mode: 'MERGE',
        reason: 'Variation order 3: scope doubled',
      });
      assert.equal(grow.status, 201, JSON.stringify(grow.body));
      assert.equal(grow.body.data.revisionNumber, 1);
      const after = await prisma.boqItem.findUniqueOrThrow({ where: { id: certified.id } });
      // The certified quantity is kept, so the percentage halves.
      assert.ok(Math.abs(Number(after.cumulativeCertifiedPct) * Number(after.totalQuantity) - before) < 1);
      assert.ok(after.lastRevisionId);
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.lkk, action: 'BOQ_REVISED' } }));
      const revisions = await request(app).get(`/api/v1/projects/${ids.lkk}/boq/revisions`).set(await as('monitor@insite.ng'));
      assert.equal(revisions.body.data[0].reason, 'Variation order 3: scope doubled');
    });

    it('suggests contractor packages without saving anything', async () => {
      const before = await prisma.projectContractor.count();
      const res = await request(app).post(`/api/v1/projects/${ids.kan}/boq/suggest-contractors`).set(await as('monitor@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.engine, 'RULES_ENGINE');
      const codes = res.body.data.packages.map((p: { tradeCode: string }) => p.tradeCode);
      assert.ok(codes.includes('ELEC'), codes.join(','));
      const all = res.body.data.packages.flatMap((p: { matchedWbsCodes: string[] }) => p.matchedWbsCodes).sort();
      assert.deepEqual(all, ['01.01', '01.02', '02.01', '02.02', '03.01', '03.02']);
      assert.equal(await prisma.projectContractor.count(), before);
    });
  });
});
