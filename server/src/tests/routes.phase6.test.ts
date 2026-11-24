/**
 * Phase 6 route-level tests: organisation directory and input mode, the staged project wizard and
 * its lifecycle, draft exclusion, one contractor per project (redesign R1d, decision T; join codes
 * and multi-prime are gone), geofence settings, and BOQ revisions.
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

const PASSWORD = 'Password123!';
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
  const { createApp } = await import('../app');
  const jobs = await import('../jobs');
  jobs.registerAllJobs();
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
      const res = await request(app).get('/api/v1/organizations?tag=CONTRACTOR').set(await as('lender@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const names = res.body.data.map((o: { name: string }) => o.name);
      assert.ok(names.includes('Voltaic Power Systems Ltd'));
      assert.ok(!names.some((n: string) => n.startsWith('Legacy Works')));
      for (const o of res.body.data) assert.ok(o.categories.includes('CONTRACTOR'));

      const all = await request(app).get('/api/v1/organizations?includeArchived=true').set(await as('lender@insite.ng'));
      assert.ok(all.body.data.some((o: { name: string }) => o.name.startsWith('Legacy Works')));
    });

    it('needs organizations:manage to create, edit and archive; names are unique per tenant', async () => {
      const denied = await request(app)
        .post('/api/v1/organizations')
        .set(await as('lender@insite.ng'))
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
      const read = await request(app).get('/api/v1/rbac/tenant/settings').set(await as('lender@insite.ng'));
      assert.equal(read.status, 200);
      assert.equal(read.body.data.organizationInputMode, 'BOTH');
      assert.deepEqual(read.body.data.enabledGeofenceModes.sort(), ['PERIMETER', 'RADIAL']);
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
      // Redesign: the workspace default radius for new radial boundaries (projects set their own).
      assert.equal(read.body.data.defaultGeofenceRadiusMeters, 150);
      const tooSmall = await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ defaultGeofenceRadiusMeters: 5 });
      assert.equal(tooSmall.status, 400);
      const radius = await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ defaultGeofenceRadiusMeters: 250 });
      assert.equal(radius.status, 200, JSON.stringify(radius.body));
      assert.equal(radius.body.data.defaultGeofenceRadiusMeters, 250);
      const corridor = await request(app)
        .put('/api/v1/rbac/tenant/settings')
        .set(await as('admin@insite.ng'))
        .send({ enabledGeofenceModes: ['LINEAR_CORRIDOR'] });
      assert.equal(corridor.status, 400, 'linear corridors are no longer a mode');
      await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ defaultGeofenceRadiusMeters: 150 });
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
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'PROJECT_DRAFT_CREATED' } }));
    });

    it('validates each step on save', async () => {
      assert.equal((await step('parties', { contractors: [{ organization: { name: 'X Ltd' }, tradeCategory: 'Civil', tradeCode: 'c!' }] })).status, 400);
      const crossing = { ...PERIMETER, perimeterCoordinates: [[3.39, 6.95], [3.4, 6.96], [3.4, 6.95], [3.39, 6.96]] };
      assert.equal((await step('site', { geofence: crossing })).status, 400);
      assert.equal((await step('site', { geofence: PERIMETER, timezone: 'Mars/Olympus' })).status, 400);
      const retention = await step('facility', { retention: { retentionPercentage: 5, retentionDurationMonths: null, retentionReleaseAtCompletionPct: 0 } });
      assert.equal(retention.status, 422);
      assert.equal(retention.body.error.code, 'RETENTION_DURATION_REQUIRED');
      // Redesign R2b: the BOQ step is now "Scope & sprints".
      assert.equal((await step('boq', {})).status, 404);
      // Redesign R4f: the reporting step is gone (visits replace reporting obligations).
      assert.equal((await step('reporting', { reportingCadence: 'DAILY', workdayStartTime: '07:00', workdayEndTime: '16:00' })).status, 404);
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
        // Redesign R6a (D-R6.4): the contractor is its own section.
        'contractor:STEP_NOT_SAVED',
        'contractor:CONTRACTOR_REQUIRED',
        'site:GEOFENCE_REQUIRED',
        'scope:SPRINT_REQUIRED',
        'scope:SCOPE_REQUIRED',
      ]) {
        assert.ok(codes.includes(expected), `missing ${expected} in ${codes.join(', ')}`);
      }
      assert.ok(!codes.some((c: string) => c.startsWith('basics:') || c.startsWith('team:') || c.startsWith('reporting:')));
      // R1d: there is no contractor model to choose any more.
      assert.ok(!codes.includes('parties:CONTRACTOR_MODEL_REQUIRED'));
    });

    it('enforces the organisation input mode on the server', async () => {
      await request(app).put('/api/v1/rbac/tenant/settings').set(await as('admin@insite.ng')).send({ organizationInputMode: 'DIRECTORY' });
      const typedNew = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { name: 'Brand New Bank Plc' },
        contractors: [],
      });
      assert.equal(typedNew.status, 422, JSON.stringify(typedNew.body));
      assert.equal(typedNew.body.error.code, 'ORGANIZATION_NOT_IN_DIRECTORY');
      assert.equal(await prisma.organization.count({ where: { name: 'Brand New Bank Plc' } }), 0);

      // A typed name that matches the directory is a pick, not a new organisation.
      const typedExisting = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { name: 'infracredit guarantee & project finance desk' },
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
        .send({ enabledGeofenceModes: ['RADIAL', 'PERIMETER'] });
    });

    it('keeps drafts out of lists, the portfolio, mobile and scheduled jobs', async () => {
      // Make the draft look runnable to the cron: scope lines on a unit in a running sprint (redesign
      // R2b) and a day that has already started.
      const monitorAuth = await as('monitor@insite.ng');
      const scope = (path: string) => `/api/v1/projects/${ids.draft}/scope${path}`;
      const sprints = await request(app)
        .put(scope('/sprints'))
        .set(monitorAuth)
        .send({ sprints: [{ name: 'Construction', startDate: '2026-01-05', endDate: '2027-12-31' }] });
      assert.equal(sprints.status, 200, JSON.stringify(sprints.body));
      const sprintId = sprints.body.data.sprints[0].id;
      const classroom = await prisma.facility.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'CLASSROOM' } });
      const unit = await request(app)
        .post(scope('/units'))
        .set(monitorAuth)
        .send({ facilityId: classroom.id, label: 'Classroom block', startSprintId: sprintId, endSprintId: sprintId });
      assert.equal(unit.status, 201, JSON.stringify(unit.body));
      const facilityUnitId = unit.body.data.units[0].id;
      for (const line of [
        { wbsCode: '01.01', description: 'Pad foundations in reinforced concrete', unit: 'm3', totalQuantity: 100, rateNgn: 1_000_000 },
        { wbsCode: '01.02', description: 'Blockwork walls 225mm', unit: 'm2', totalQuantity: 2_000, rateNgn: 50_000 },
      ]) {
        const res = await request(app).post(scope('/lines')).set(monitorAuth).send({ facilityUnitId, ...line });
        assert.equal(res.status, 201, JSON.stringify(res.body));
      }
      await prisma.project.update({ where: { id: ids.draft }, data: { workdayStartTime: '00:00' } });

      const list = await request(app).get('/api/v1/projects').set(await as('monitor@insite.ng'));
      assert.ok(!list.body.data.some((p: { id: string }) => p.id === ids.draft));
      const drafts = await request(app).get('/api/v1/projects/drafts').set(await as('monitor@insite.ng'));
      assert.ok(drafts.body.data.some((p: { id: string; canDelete: boolean }) => p.id === ids.draft && p.canDelete));
      const exec = await request(app).get('/api/v1/projects/portfolio/overview').set(await as('monitor@insite.ng'));
      assert.equal(exec.status, 200);
      assert.ok(!exec.body.data.projects.some((p: { id: string }) => p.id === ids.draft));

      // Someone without projects:create or edit_baseline does not see another person's draft.
      const lenderView = await request(app).get(`/api/v1/projects/${ids.draft}/setup`).set(await as('lender@insite.ng'));
      assert.equal(lenderView.status, 404);
      const lenderDrafts = await request(app).get('/api/v1/projects/drafts').set(await as('lender@insite.ng'));
      assert.equal(lenderDrafts.body.data.length, 0);

      // Non-setup routes refuse a draft.
      const payments = await request(app).get(`/api/v1/projects/${ids.draft}/payments`).set(await as('monitor@insite.ng'));
      assert.equal(payments.status, 409);
      assert.equal(payments.body.error.code, 'PROJECT_IS_DRAFT');

      // Mobile: not listed, and field routes refuse it even for an assigned provisioned account.
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-draft');
      assert.ok(!mobile.projects.some((p) => p.id === ids.draft));
      assert.ok(!mobile.projects.some((p) => p.codePrefix === 'ENU-501'));
      const field = await request(app).get(`/api/v1/projects/${ids.draft}/notifications`).set(bearer(mobile.accessToken));
      assert.ok([403, 404].includes(field.status), String(field.status));
    });

    it('saves every step and activates once', async () => {
      // R1d: a project has one contractor; two are refused by the step schema.
      const two = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { id: ids.lenderOrg },
        contractors: [
          { organization: { name: 'Phase Six Builders Ltd' }, tradeCategory: 'Building works', tradeCode: 'BLD' },
          { organization: { name: 'Phase Six Electrical Ltd' }, tradeCategory: 'Electrical works', tradeCode: 'ELEC' },
        ],
      });
      assert.equal(two.status, 400, JSON.stringify(two.body));
      const parties = await step('parties', {
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: { id: ids.lenderOrg },
        contractors: [{ organization: { name: 'Phase Six Builders Ltd' }, tradeCategory: 'Building works', tradeCode: 'BLD' }],
      });
      assert.equal(parties.status, 200, JSON.stringify(parties.body));
      assert.equal(parties.body.data.parties.contractors.length, 1);
      assert.equal(parties.body.data.parties.contractorExecutionMode, undefined, 'no contractor model any more');
      const created = await prisma.organization.findFirstOrThrow({ where: { name: 'Phase Six Builders Ltd' } });
      assert.deepEqual(created.categories, ['CONTRACTOR']);

      const site = await step('site', { geofence: PERIMETER, geofenceToleranceMeters: 40, timezone: 'Africa/Lagos' });
      assert.equal(site.status, 200, JSON.stringify(site.body));
      assert.equal(site.body.data.site.effectiveToleranceMeters, 40);
      assert.equal(site.body.data.site.geofence.perimeterCoordinates.length, 5, 'ring stored closed');

      // Redesign R1b: the "facility" step holds the retention settings only.
      const facility = await step('facility', {
        retention: { retentionPercentage: 5, retentionDurationMonths: 12, retentionReleaseAtCompletionPct: 50 },
      });
      assert.equal(facility.status, 200, JSON.stringify(facility.body));
      assert.equal(facility.body.data.facility.retention.retentionPercentage, 5);
      assert.equal(facility.body.data.facility.tranches, undefined);

      // Redesign R2b: scope data is saved through /scope; saving the step marks it reviewed.
      const scopeStep = await step('scope', {});
      assert.equal(scopeStep.status, 200, JSON.stringify(scopeStep.body));
      assert.equal(scopeStep.body.data.steps.find((x: { stepId: string }) => x.stepId === 'scope').complete, true);
      // R4f: activation no longer needs a reporting save.
      assert.equal(scopeStep.body.data.canActivate, true, JSON.stringify(scopeStep.body.data.steps));
      assert.ok(!scopeStep.body.data.steps.some((x: { stepId: string }) => x.stepId === 'reporting'));

      const lender = await prisma.user.findUniqueOrThrow({ where: { email: 'lender@insite.ng' } });
      const team = await step('team', { userIds: [lender.id] });
      assert.equal(team.status, 200, JSON.stringify(team.body));
      assert.ok(team.body.data.team.userIds.includes(lender.id));

      const lenderDenied = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('lender@insite.ng'));
      assert.ok([403, 404].includes(lenderDenied.status));

      const activated = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('monitor@insite.ng'));
      assert.equal(activated.status, 200, JSON.stringify(activated.body));
      assert.equal(activated.body.data.status, 'ACTIVE');
      assert.equal(activated.body.data.issuedJoinCodes, undefined, 'no join codes (R1d)');

      const again = await request(app).post(`/api/v1/projects/${ids.draft}/activate`).set(await as('monitor@insite.ng'));
      assert.equal(again.status, 409);
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
      const lenderEdit = await step('basics', { ...basics, name: 'Lender rename' }, 'lender@insite.ng');
      assert.ok([403, 404].includes(lenderEdit.status));
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
    it('archives an active project: read-only, off mobile, audited', async () => {
      const denied = await request(app).post(`/api/v1/projects/${ids.draft}/archive`).set(await as('lender@insite.ng')).send({});
      assert.ok([403, 404].includes(denied.status));

      const res = await request(app)
        .post(`/api/v1/projects/${ids.draft}/archive`)
        .set(await as('monitor@insite.ng'))
        .send({ reason: 'Works completed' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'ARCHIVED');
      const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'PROJECT_ARCHIVED' } });
      assert.ok(audit);
      assert.equal((audit.payload as { reason: string }).reason, 'Works completed');

      // Still readable on the web, listed as archived, but every write is refused.
      const baseline = await request(app).get(`/api/v1/projects/${ids.draft}/baseline`).set(await as('monitor@insite.ng'));
      assert.equal(baseline.status, 200);
      const list = await request(app).get('/api/v1/projects').set(await as('monitor@insite.ng'));
      assert.equal(list.body.data.find((p: { id: string }) => p.id === ids.draft)?.status, 'ARCHIVED');
      const write = await request(app)
        .put(`/api/v1/projects/${ids.draft}/setup/basics`)
        .set(await as('monitor@insite.ng'))
        .send({ name: 'Archived rename', codePrefix: 'TST-601', stateLocation: 'Ogun State', totalBudgetNgn: 500_000_000 });
      assert.equal(write.status, 409);
      assert.equal(write.body.error.code, 'PROJECT_ARCHIVED');
      const again = await request(app).post(`/api/v1/projects/${ids.draft}/archive`).set(await as('monitor@insite.ng')).send({});
      assert.equal(again.status, 409);

      // Gone from mobile and from the portfolio.
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-archived');
      assert.ok(!mobile.projects.some((p) => p.id === ids.draft));
      const exec = await request(app).get('/api/v1/projects/portfolio/overview').set(await as('monitor@insite.ng'));
      assert.ok(!exec.body.data.projects.some((p: { id: string }) => p.id === ids.draft));
    });
  });

  // -------------------------------------------------------------------------
  describe('one contractor per project (R1d)', () => {
    it('refuses a second contractor on a live project and keeps the seeded one', async () => {
      const before = await request(app).get(`/api/v1/projects/${ids.kan}/contractors`).set(await as('monitor@insite.ng'));
      assert.equal(before.status, 200, JSON.stringify(before.body));
      assert.equal(before.body.data.length, 1, 'KAN-210 has one contractor since R1d');
      const res = await request(app)
        .post(`/api/v1/projects/${ids.kan}/contractors`)
        .set(await as('monitor@insite.ng'))
        .send({ organization: { name: 'Second Contractor Ltd' }, tradeCategory: 'Electrical works', tradeCode: 'ELEC' });
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'ONE_CONTRACTOR_ONLY');
      assert.equal(await prisma.projectContractor.count({ where: { projectId: ids.kan } }), 1);
    });

    it('serves the baseline pack to the field (no contractor packages on sessions)', async () => {
      const mobile = await mobileToken('monitor@insite.ng', 'device-p6-kan');
      const res = await request(app).get(`/api/v1/auth/mobile/projects/${ids.kan}/baseline`).set(bearer(mobile.accessToken));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.projectId, ids.kan);
      // Redesign R5e: the pack no longer carries the BOQ (the visit app reads facility units).
      assert.ok(Array.isArray(res.body.data.facilityUnits));
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

  // Redesign R2d: BOQ revisions by upload and contractor package suggestions are gone; scope edits on
  // live projects are covered by routes.r2.test.ts.
});
