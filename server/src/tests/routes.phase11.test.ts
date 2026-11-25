/**
 * Phase 11 route tests: organisation hierarchy, organisation-tree visibility, organisation scope on
 * approval steps, project types (apply, snapshot isolation, lock after activation), parties rules,
 * regions, filters and terminology.
 *
 * Uses the seeded programme tenant (seedPhase11, branded UBEC): flagship UBEC with subsidiaries Kano
 * SUBEB ("north") and Lagos SUBEB ("south"); live projects PRG-102 (Direct Intervention = CENTRAL, UBEC),
 * PRG-211 (Matching Grants = CO_FUNDED, Kano) and PRG-221 (Matching Grants, Lagos); drafts PRG-101
 * (Direct Intervention) and PRG-201 (Matching Grants, Lagos).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let chain: typeof import('../modules/process/approvalChain');
let processConfig: typeof import('../modules/process/processConfig.service');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const profiles: Record<string, Record<string, unknown>> = {};

const PROGRAMME_ADMIN = 'admin@ubec.test';
/**
 * UBEC roster: no UBEC HQ organisation administrator is seeded (the UBEC administrator sees the whole
 * tenant). This test-only user has the SUBEB Administrator role (organisation tree) at UBEC HQ, so
 * the flagship's organisation-tree visibility and scopes stay covered.
 */
const FLAGSHIP = 'ubec.tree.viewer@ubec.test';
const NORTH = 'kano.admin@ubec.test';
const SOUTH = 'lagos.admin@ubec.test';
const MAIN_ADMIN = 'admin@insite.ng';

// UBEC rebrand: the seeded organisations (seedPhase11).
const UBEC = 'Universal Basic Education Commission (UBEC)';
const KANO_SUBEB = 'Kano State Universal Basic Education Board (SUBEB)';
const LAGOS_SUBEB = 'Lagos State Universal Basic Education Board (SUBEB)';

async function login(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
    profiles[email] = res.body.data.user;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const ids: Record<string, string> = {};

/**
 * R1d: the main-tenant contractor login is gone. A web user who only holds projects:view_assigned
 * (no tenant-wide, tree or portfolio permission), assigned to LKK-402 and ABJ-108.
 */
const ASSIGNED_ONLY = 'assigned.only@insite.test';
async function ensureAssignedOnlyUser() {
  if (await prisma.user.findUnique({ where: { email: ASSIGNED_ONLY } })) return;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  const perm = await prisma.permission.findUniqueOrThrow({ where: { key: 'projects:view_assigned' } });
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Assigned viewer',
      code: 'ASSIGNED_VIEWER',
      surface: 'WEB',
      rolePermissions: { create: [{ permissionId: perm.id }] },
    },
  });
  const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: ASSIGNED_ONLY,
      passwordHash: await bcrypt.hash(PASSWORD, 8),
      fullName: 'Assigned Viewer',
      roleId: role.id,
      organizationId: org.id,
    },
  });
  const projects = await prisma.project.findMany({ where: { tenantId: tenant.id, codePrefix: { in: ['LKK-402', 'ABJ-108'] } } });
  await prisma.userProjectAssignment.createMany({ data: projects.map((p) => ({ userId: user.id, projectId: p.id })) });
}

async function projectId(code: string) {
  const p = await prisma.project.findFirstOrThrow({ where: { codePrefix: code }, select: { id: true } });
  return p.id;
}

async function codesVisibleTo(email: string, query = '') {
  const res = await request(app).get(`/api/v1/projects${query}`).set(await login(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.data as Array<{ codePrefix: string }>).map((p) => p.codePrefix).filter((c) => c.startsWith('PRG')).sort();
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  chain = await import('../modules/process/approvalChain');
  processConfig = await import('../modules/process/processConfig.service');
  const orgs = await prisma.organization.findMany({
    where: { name: { in: [UBEC, KANO_SUBEB, LAGOS_SUBEB] } },
  });
  ids.flagship = orgs.find((o) => o.name === UBEC)!.id;
  ids.north = orgs.find((o) => o.name === KANO_SUBEB)!.id;
  ids.south = orgs.find((o) => o.name === LAGOS_SUBEB)!.id;
  const types = await prisma.projectType.findMany();
  ids.central = types.find((t) => t.code === 'CENTRAL')!.id;
  ids.coFunded = types.find((t) => t.code === 'CO_FUNDED')!.id;
  for (const code of ['PRG-101', 'PRG-102', 'PRG-201', 'PRG-211', 'PRG-221']) ids[code] = await projectId(code);
  const subebAdmin = await prisma.user.findUniqueOrThrow({ where: { email: NORTH } });
  await prisma.user.create({
    data: {
      tenantId: subebAdmin.tenantId,
      email: FLAGSHIP,
      passwordHash: subebAdmin.passwordHash,
      fullName: 'UBEC HQ Tree Viewer',
      roleId: subebAdmin.roleId,
      organizationId: ids.flagship,
    },
  });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 11 seed', () => {
  it('applies the type: snapshot, template, owner and funder defaults (R4f: no reporting defaults)', async () => {
    const central = await prisma.project.findUniqueOrThrow({
      where: { id: ids['PRG-101'] },
      include: { beneficiaries: true, processConfig: true },
    });
    assert.equal(central.projectTypeId, ids.central);
    assert.equal(central.projectTypeVersion, 1);
    assert.equal(central.owningOrganizationId, ids.flagship, 'default owner from the type');
    assert.equal(central.lenderOrganizationId, ids.flagship, 'FIXED funder default');
    assert.equal('reportingDefaults' in (central.projectTypeSnapshotJson as Record<string, unknown>), false, 'removed in R4f');
    assert.equal(central.processConfig?.requireReportApproval, true, 'template switches copied');
    assert.equal(central.beneficiaries.filter((b) => b.isPrimary).length, 1);

    const coFunded = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-211'] } });
    assert.equal(coFunded.owningOrganizationId, ids.north);
    assert.equal(coFunded.lenderOrganizationId, ids.north, 'OWNER funder default: the subsidiary funds its project');
    const steps = await prisma.approvalStep.findMany({
      where: { projectId: ids['PRG-211'], chainType: 'REPORT', isActive: true },
      orderBy: { stepOrder: 'asc' },
    });
    assert.deepEqual(
      steps.map((s) => s.organizationScope),
      ['ANY'],
      'the template report chain is copied'
    );
    const applied = await prisma.auditLog.count({ where: { projectId: ids['PRG-211'], action: 'PROJECT_TYPE_APPLIED' } });
    assert.equal(applied, 1);
  });

  it('keeps existing projects without a type', async () => {
    const lkk = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } });
    assert.equal(lkk.projectTypeId, null);
    assert.equal(lkk.owningOrganizationId, null);
  });
});

describe('organisation hierarchy', () => {
  it('refuses cycles, self-parenting and depth beyond five levels, and audits moves', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const cycle = await request(app).patch(`/api/v1/organizations/${ids.flagship}`).set(h).send({ parentOrganizationId: ids.north });
    assert.equal(cycle.status, 422, JSON.stringify(cycle.body));
    assert.equal(cycle.body.error.code, 'ORGANIZATION_HIERARCHY_CYCLE');

    const self = await request(app).patch(`/api/v1/organizations/${ids.north}`).set(h).send({ parentOrganizationId: ids.north });
    assert.equal(self.status, 422);

    // flagship(1) → north(2) → L3 → L4 → L5 ok; L6 refused.
    let parent = ids.north;
    const created: string[] = [];
    for (const level of [3, 4, 5]) {
      const res = await request(app)
        .post('/api/v1/organizations')
        .set(h)
        .send({ name: `Level ${level} unit`, categories: ['OTHER'], parentOrganizationId: parent });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.parentOrganizationId, parent);
      parent = res.body.data.id;
      created.push(parent);
    }
    const tooDeep = await request(app)
      .post('/api/v1/organizations')
      .set(h)
      .send({ name: 'Level 6 unit', categories: ['OTHER'], parentOrganizationId: parent });
    assert.equal(tooDeep.status, 422);
    assert.equal(tooDeep.body.error.code, 'ORGANIZATION_HIERARCHY_TOO_DEEP');

    // Moving a subtree under a deep node is refused too (north's subtree is 4 levels high).
    const moveDeep = await request(app).patch(`/api/v1/organizations/${ids.south}`).set(h).send({ parentOrganizationId: created[2] });
    // South is a leaf; under level 5 it would be level 6.
    assert.equal(moveDeep.status, 422);

    const audits = await prisma.auditLog.count({ where: { action: 'ORGANIZATION_HIERARCHY_CHANGED' } });
    assert.equal(audits, 3);

    const list = await request(app).get('/api/v1/organizations').set(h);
    const north = (list.body.data as Array<{ id: string; parentOrganizationId: string | null }>).find((o) => o.id === ids.north);
    assert.equal(north?.parentOrganizationId, ids.flagship);

    // Clean up so later tests see the seeded tree only.
    for (const id of created.reverse()) await prisma.organization.delete({ where: { id } });
  });
});

describe('organisation-tree visibility', () => {
  it('flagship sees all subsidiaries’ projects; a subsidiary sees its own; a sibling sees neither', async () => {
    assert.deepEqual(await codesVisibleTo(FLAGSHIP), ['PRG-102', 'PRG-103', 'PRG-104', 'PRG-105', 'PRG-106', 'PRG-211', 'PRG-221', 'PRG-241', 'PRG-242']);
    assert.deepEqual(await codesVisibleTo(NORTH), ['PRG-211']);
    assert.deepEqual(await codesVisibleTo(SOUTH), ['PRG-221', 'PRG-241', 'PRG-242']);
  });

  it('the project guard follows the same rule', async () => {
    const own = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/baseline`).set(await login(NORTH));
    assert.notEqual(own.status, 403, JSON.stringify(own.body));
    const sibling = await request(app).get(`/api/v1/projects/${ids['PRG-221']}/baseline`).set(await login(NORTH));
    assert.equal(sibling.status, 403);
    const flagship = await request(app).get(`/api/v1/projects/${ids['PRG-221']}/baseline`).set(await login(FLAGSHIP));
    assert.notEqual(flagship.status, 403);
  });

  it('the portfolio and notification lists use the same scope', async () => {
    const res = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(NORTH));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      (res.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix),
      ['PRG-211']
    );
    assert.equal(res.body.data.projects[0].owningOrganization.id, ids.north);
    assert.equal(res.body.data.projects[0].projectType.code, 'CO_FUNDED');

    // Web notifications are per project and go through the project guard.
    const own = await request(app).get(`/api/v1/projects/${ids['PRG-221']}/web-notifications`).set(await login(SOUTH));
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const sibling = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/web-notifications`).set(await login(SOUTH));
    assert.equal(sibling.status, 403);

    // The audit ledger too.
    const ledger = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/audit-trail`).set(await login(NORTH));
    assert.notEqual(ledger.status, 403, JSON.stringify(ledger.body));
    const foreignLedger = await request(app).get(`/api/v1/projects/${ids['PRG-221']}/audit-trail`).set(await login(NORTH));
    assert.equal(foreignLedger.status, 403);
  });

  it('users without the tree permission still see only assigned projects', async () => {
    await ensureAssignedOnlyUser();
    const res = await request(app).get('/api/v1/projects').set(await login(ASSIGNED_ONLY));
    assert.equal(res.status, 200);
    assert.ok((res.body.data as unknown[]).length >= 1);
    assert.ok((res.body.data as Array<{ codePrefix: string }>).every((p) => !p.codePrefix.startsWith('PRG')));
  });
});

describe('filters', () => {
  it('filters by type, region (with its areas) and owner', async () => {
    assert.deepEqual(await codesVisibleTo(FLAGSHIP, `?projectTypeId=${ids.coFunded}`), ['PRG-211', 'PRG-221', 'PRG-241', 'PRG-242']);
    const north = await prisma.region.findFirstOrThrow({ where: { code: 'N' } });
    assert.deepEqual(await codesVisibleTo(FLAGSHIP, `?regionId=${north.id}`), ['PRG-102', 'PRG-103', 'PRG-105', 'PRG-106', 'PRG-211']);
    assert.deepEqual(await codesVisibleTo(FLAGSHIP, `?owningOrganizationId=${ids.south}`), ['PRG-221', 'PRG-241', 'PRG-242']);
  });
});

describe('organisation scope on approval steps', () => {
  async function payload(email: string) {
    await login(email);
    const u = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    return {
      tokenType: 'WEB_USER' as const,
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      tenantId: u.tenantId,
      isPlatformSuperAdmin: false,
      roleId: u.roleId,
      roleCode: u.role.code,
      roleName: u.role.name,
      permissions: [...u.role.rolePermissions.map((rp) => rp.permission.key), 'visits:review'],
      organizationId: u.organizationId,
      mustChangePassword: false,
    };
  }

  // Redesign R1b: the disbursement chain is gone; organisation scopes are exercised on a report
  // chain written for these projects (step 1 ANY, 2 PROJECT_OWNER, 3 PROJECT_OWNER_OR_ANCESTOR;
  // PRG-102: step 2 FUNDER).
  const step = (label: string, organizationScope: 'ANY' | 'PROJECT_OWNER' | 'PROJECT_OWNER_OR_ANCESTOR' | 'FUNDER') => ({
    label,
    requiredPermissionKey: 'visits:review',
    requiredRoleId: null,
    minAmountThresholdNgn: null,
    isSystemStep: false,
    organizationScope,
  });
  before(async () => {
    for (const code of ['PRG-211', 'PRG-221']) {
      await prisma.$transaction(async (tx) =>
        processConfig.writeChainVersion(
          tx,
          ids[code],
          'REPORT',
          [step('Monitor approval', 'ANY'), step('Delivery entity review', 'PROJECT_OWNER'), step('Programme review', 'PROJECT_OWNER_OR_ANCESTOR')],
          await processConfig.getProcessConfig(ids[code], tx)
        )
      );
    }
    await prisma.$transaction(async (tx) =>
      processConfig.writeChainVersion(
        tx,
        ids['PRG-102'],
        'REPORT',
        [step('Monitor approval', 'ANY'), step('Funding authority review', 'FUNDER')],
        await processConfig.getProcessConfig(ids['PRG-102'], tx)
      )
    );
  });

  async function gate(email: string, code: string, stepOrder: number) {
    const chainRows = await processConfig.getActiveChain(prisma, ids[code], 'REPORT');
    const step = chainRows!.steps.find((s) => s.stepOrder === stepOrder)!;
    const orgContext = await chain.orgContextForStep(prisma, ids[code], step);
    return chain.gateForStep({ webUser: await payload(email), step, actions: [], orgContext });
  }

  it('a subsidiary approver can act on its own project, not on a sibling’s', async () => {
    // Step 2: PROJECT_OWNER.
    assert.equal((await gate(NORTH, 'PRG-211', 2)).allowed, true);
    const sibling = await gate(NORTH, 'PRG-221', 2);
    assert.equal(sibling.allowed, false);
    assert.match(sibling.reason!, /owning organisation/);
    // The flagship is not the owner, so PROJECT_OWNER refuses it.
    assert.equal((await gate(FLAGSHIP, 'PRG-211', 2)).allowed, false);
  });

  it('a flagship approver with PROJECT_OWNER_OR_ANCESTOR can act on both subsidiaries’ projects', async () => {
    assert.equal((await gate(FLAGSHIP, 'PRG-211', 3)).allowed, true);
    assert.equal((await gate(FLAGSHIP, 'PRG-221', 3)).allowed, true);
    assert.equal((await gate(NORTH, 'PRG-211', 3)).allowed, true);
    assert.equal((await gate(NORTH, 'PRG-221', 3)).allowed, false);
  });

  it('a FUNDER-scoped step follows the funding organisation', async () => {
    // Central: step 2 is FUNDER (the flagship funds).
    assert.equal((await gate(FLAGSHIP, 'PRG-102', 2)).allowed, true);
    assert.equal((await gate(NORTH, 'PRG-102', 2)).allowed, false);
  });

  it('the chain DTO and template JSON carry the scope', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/process`).set(await login(PROGRAMME_ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.reportChain.steps[1].organizationScope, 'PROJECT_OWNER');
  });
});

describe('project types', () => {
  it('a tenant with types requires one on a new draft', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(await login(PROGRAMME_ADMIN))
      .send({ name: 'No type project', codePrefix: 'PRG-901', stateLocation: 'Kano State', totalBudgetNgn: 1000000 });
    assert.equal(res.status, 422, JSON.stringify(res.body));
  });

  it('editing a type bumps its version and does not change projects that have it', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const before = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-211'] } });
    const current = await request(app).get(`/api/v1/project-types/${ids.coFunded}`).set(h);
    const body = { ...current.body.data };
    for (const k of ['id', 'workflowTemplateName', 'version', 'projectCount', 'createdAt', 'updatedAt']) delete body[k];
    body.config.parties.beneficiaryRequired = false;
    const saved = await request(app).put(`/api/v1/project-types/${ids.coFunded}`).set(h).send(body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.version, 2);

    const afterEdit = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-211'] } });
    assert.equal(afterEdit.projectTypeVersion, 1);
    assert.deepEqual(afterEdit.projectTypeSnapshotJson, before.projectTypeSnapshotJson);

    // A new project gets the new version.
    const created = await request(app)
      .post('/api/v1/projects')
      .set(h)
      .send({ name: 'Co-funded v2 project', codePrefix: 'PRG-231', stateLocation: 'Lagos State', totalBudgetNgn: 5000000, projectTypeId: ids.coFunded });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.basics.projectType.version, 2);
  });

  it('changing the type re-applies on a draft and is locked on a live project', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const setup = await request(app).get(`/api/v1/projects/${ids['PRG-201']}/setup`).set(h);
    const basics = { ...setup.body.data.basics, regionId: setup.body.data.basics.region.id };
    delete basics.projectType;
    delete basics.region;
    const draft = await request(app)
      .put(`/api/v1/projects/${ids['PRG-201']}/setup/basics`)
      .set(h)
      .send({ ...basics, projectTypeId: ids.central });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.data.basics.projectType.code, 'CENTRAL');
    // South is not an allowed Central owner: the Parties step now reports it.
    const parties = draft.body.data.steps.find((s: { stepId: string }) => s.stepId === 'parties');
    assert.ok(parties.issues.some((i: { code: string }) => i.code === 'OWNER_NOT_ALLOWED'), JSON.stringify(parties.issues));
    const config201 = await prisma.projectProcessConfig.findUniqueOrThrow({ where: { projectId: ids['PRG-201'] } });
    assert.equal(config201.enableHandoverModule, true, 'Central template applied');

    const liveSetup = await request(app).get(`/api/v1/projects/${ids['PRG-211']}/setup`).set(h);
    const liveBasics = { ...liveSetup.body.data.basics };
    delete liveBasics.projectType;
    delete liveBasics.region;
    const locked = await request(app)
      .put(`/api/v1/projects/${ids['PRG-211']}/setup/basics`)
      .set(h)
      .send({ ...liveBasics, projectTypeId: ids.central });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'PROJECT_TYPE_LOCKED');
  });

  it('activation readiness honours the type’s party rules', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-101']}/setup`).set(h);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.parties.rules.beneficiaryRequired, true);
    const cleared = await request(app)
      .put(`/api/v1/projects/${ids['PRG-101']}/setup/parties`)
      .set(h)
      .send({
        owningOrganizationId: ids.flagship,
        monitorOrganization: { id: res.body.data.parties.monitorOrganization.id },
        lenderOrganization: { id: ids.flagship },
        contractors: res.body.data.parties.contractors.map((c: Record<string, unknown>) => ({
          id: c.id,
          organization: { id: c.organizationId },
          tradeCategory: c.tradeCategory,
          tradeCode: c.tradeCode,
        })),
        beneficiaries: [],
      });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    const parties = cleared.body.data.steps.find((s: { stepId: string }) => s.stepId === 'parties');
    assert.ok(parties.issues.some((i: { code: string }) => i.code === 'BENEFICIARY_REQUIRED'));
  });

  it('a workflow template used by a type cannot be deleted', async () => {
    const type = await prisma.projectType.findUniqueOrThrow({ where: { id: ids.central } });
    const res = await request(app).delete(`/api/v1/workflow-templates/${type.workflowTemplateId}`).set(await login(PROGRAMME_ADMIN));
    assert.equal(res.status, 409, JSON.stringify(res.body));
  });
});

describe('regions', () => {
  it('has two levels only', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const kano = await prisma.region.findFirstOrThrow({ where: { code: 'N-KAN' } });
    const res = await request(app).post('/api/v1/regions').set(h).send({ name: 'Kano Municipal', code: 'N-KAN-MUN', parentRegionId: kano.id });
    assert.equal(res.status, 422);
    const ok = await request(app).post('/api/v1/regions').set(h).send({ name: 'Katsina', code: 'n-kat', parentRegionId: kano.parentRegionId });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.code, 'N-KAT');
    const forbidden = await request(app).post('/api/v1/regions').set(await login(NORTH)).send({ name: 'X region', code: 'X' });
    assert.equal(forbidden.status, 403);
  });
});

describe('terminology', () => {
  it('resolves per tenant on the profile; API values never change', async () => {
    await login(PROGRAMME_ADMIN);
    await login(MAIN_ADMIN);
    const programme = profiles[PROGRAMME_ADMIN].terminology as Record<string, { singular: string }>;
    const main = profiles[MAIN_ADMIN].terminology as Record<string, { singular: string }>;
    assert.equal(programme.funderParty.singular, 'Funding authority');
    assert.equal(main.funderParty.singular, 'Funder');
    assert.equal(main.contractor.singular, 'Contractor');

    // DTO field names and canonical values stay as they were.
    const res = await request(app).get('/api/v1/projects').set(await login(FLAGSHIP));
    assert.ok('lenderOrganizationName' in res.body.data[0]);
  });

  it('is edited by tenant admins, validated and audited', async () => {
    const h = await login(PROGRAMME_ADMIN);
    const bad = await request(app).put('/api/v1/rbac/tenant/settings/terminology').set(h).send({ labels: { lenderX: { singular: 'x' } } });
    assert.equal(bad.status, 400);
    const ok = await request(app)
      .put('/api/v1/rbac/tenant/settings/terminology')
      .set(h)
      .send({ labels: { funderParty: { singular: 'Funding authority' }, retention: { singular: 'Holdback' } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.resolved.retention.singular, 'Holdback');
    assert.equal(ok.body.data.resolved.contractor.singular, 'Contractor', 'omitted keys fall back to the default');
    assert.equal(ok.body.data.resolved.funderParty.plural, 'Funding authority', 'plural defaults to the singular');
    const audit = await prisma.auditLog.count({ where: { action: 'TERMINOLOGY_UPDATED' } });
    assert.equal(audit, 1);
    const forbidden = await request(app).put('/api/v1/rbac/tenant/settings/terminology').set(await login(NORTH)).send({ labels: {} });
    assert.equal(forbidden.status, 403);
  });
});

describe('cross-project web notifications (projectId = all)', () => {
  it('lists, reads and read-alls only notifications of visible projects', async () => {
    const { createWebNotification } = await import('../modules/notifications/notifications.service');
    const northNote = await createWebNotification(prisma, {
      projectId: ids['PRG-211'],
      targetPermissionKey: 'visits:view',
      category: 'VISIT_PENDING_APPROVAL',
      title: 'North item',
      description: 'For the north entity',
    });
    const southNote = await createWebNotification(prisma, {
      projectId: ids['PRG-221'],
      targetPermissionKey: 'visits:view',
      category: 'VISIT_PENDING_APPROVAL',
      title: 'South item',
      description: 'For the south entity',
    });

    const list = await request(app).get('/api/v1/projects/all/web-notifications').set(await login(NORTH));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const listed = (list.body.data as Array<{ id: string }>).map((n) => n.id);
    assert.ok(listed.includes(northNote.id));
    assert.ok(!listed.includes(southNote.id), 'a sibling entity’s notification is not listed');

    const flagship = await request(app).get('/api/v1/projects/all/web-notifications').set(await login(FLAGSHIP));
    const flagshipIds = (flagship.body.data as Array<{ id: string }>).map((n) => n.id);
    assert.ok(flagshipIds.includes(northNote.id) && flagshipIds.includes(southNote.id));

    const foreignRead = await request(app)
      .patch(`/api/v1/projects/all/web-notifications/${southNote.id}/read`)
      .set(await login(NORTH));
    assert.equal(foreignRead.status, 404);
    const ownRead = await request(app)
      .patch(`/api/v1/projects/all/web-notifications/${northNote.id}/read`)
      .set(await login(NORTH));
    assert.equal(ownRead.status, 200, JSON.stringify(ownRead.body));
    assert.equal(ownRead.body.data.isRead, true);

    // Read-all marks exactly the unread notifications South can see (the south item, plus seeded
    // Phase 13 default-case notifications on PRG-221), never the north one.
    const southList = await request(app).get('/api/v1/projects/all/web-notifications').set(await login(SOUTH));
    const southUnread = (southList.body.data as Array<{ id: string; isRead: boolean }>).filter((n) => !n.isRead);
    assert.ok(southUnread.some((n) => n.id === southNote.id) && !southUnread.some((n) => n.id === northNote.id));
    const readAll = await request(app).post('/api/v1/projects/all/web-notifications/read-all').set(await login(SOUTH));
    assert.equal(readAll.status, 200, JSON.stringify(readAll.body));
    assert.equal(readAll.body.data.count, southUnread.length);

    // Other writes on 'all' stay refused.
    const otherWrite = await request(app).put('/api/v1/projects/all/setup/basics').set(await login(PROGRAMME_ADMIN)).send({});
    assert.equal(otherWrite.status, 404);
  });
});

describe('portfolio dashboard', () => {
  it('returns map points and KPIs over the visible, filtered projects', async () => {
    const north = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(NORTH));
    assert.equal(north.status, 200, JSON.stringify(north.body));
    assert.deepEqual(
      (north.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix),
      ['PRG-211']
    );
    const pin = north.body.data.projects[0];
    assert.ok(Math.abs(pin.point.latitude - 11.9964) < 0.001 && Math.abs(pin.point.longitude - 8.5167) < 0.001);
    assert.equal(pin.projectType.code, 'CO_FUNDED');
    assert.equal(north.body.data.kpis.projectCount, 1);

    const flagship = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(FLAGSHIP));
    // Phase 15 added PRG-103 (liability period) and PRG-241 (closed); Phase 16 PRG-104 (CoC pending) and
    // PRG-105 (under construction); the demo closure twin PRG-106 (liability period over); PRG-242 is
    // archived, so not on the map.
    assert.equal(flagship.body.data.kpis.projectCount, 8);
    assert.equal(flagship.body.data.kpis.totalCommitmentNgn, 240_000_000 + 70_000_000 + 85_000_000 + 150_000_000 + 64_000_000 + 165_000_000 + 210_000_000 + 98_000_000);
    assert.equal(flagship.body.data.kpis.quietSiteCount, 4, 'no captures yet on the seeded projects under construction');

    const filtered = await request(app)
      .get(`/api/v1/projects/portfolio/overview?projectTypeId=${ids.coFunded}`)
      .set(await login(FLAGSHIP));
    assert.equal(filtered.body.data.kpis.projectCount, 3);
    assert.equal(filtered.body.data.kpis.totalCommitmentNgn, 70_000_000 + 85_000_000 + 64_000_000);
  });

  it('is open to any web user (UBEC Dashboard) and keeps the visibility rule', async () => {
    await ensureAssignedOnlyUser();
    const res = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(ASSIGNED_ONLY));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      (res.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort(),
      ['ABJ-108', 'LKK-402']
    );
    assert.equal(res.body.data.kpis.projectCount, 2);
  });

  it('reports contractor, open findings, ongoing projects and visit counts', async () => {
    const res = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(FLAGSHIP));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body.data.projects as Array<{
      id: string;
      codePrefix: string;
      status: string;
      constructionPhase: string;
      contractorName: string | null;
      openFindingsCount: number;
    }>;
    const kpis = res.body.data.kpis;
    const rowIds = rows.map((r) => r.id);

    // Contractor: the project's contractor organisation.
    for (const row of rows) {
      const c = await prisma.projectContractor.findFirst({
        where: { projectId: row.id },
        orderBy: { createdAt: 'asc' },
        include: { organization: { select: { name: true } } },
      });
      assert.equal(row.contractorName, c?.organization.name ?? null, row.codePrefix);
    }
    assert.ok(rows.some((r) => r.contractorName), 'seeded projects have a contractor');

    // Open findings per project and in total.
    for (const row of rows) {
      const open = await prisma.finding.count({ where: { projectId: row.id, status: 'OPEN' } });
      assert.equal(row.openFindingsCount, open, row.codePrefix);
    }
    assert.equal(kpis.openFindingsCount, rows.reduce((s, r) => s + r.openFindingsCount, 0));

    // Ongoing: ACTIVE and under construction or in handover.
    const ongoing = rows.filter(
      (r) => r.status === 'ACTIVE' && ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'].includes(r.constructionPhase)
    );
    assert.equal(kpis.ongoingCount, ongoing.length);
    assert.ok(ongoing.some((r) => r.codePrefix === 'PRG-105'));
    assert.ok(!ongoing.some((r) => r.codePrefix === 'PRG-103'), 'PRG-103 is in its liability period');

    // Visits: a planned visit tomorrow is upcoming, one last week is overdue, a missed one is overdue.
    const before = { upcoming: kpis.upcomingVisitCount as number, overdue: kpis.overdueVisitCount as number };
    const prg105 = rows.find((r) => r.codePrefix === 'PRG-105')!;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: prg105.id }, select: { timezone: true } });
    const { zonedCalendarDate, addDays } = await import('@insite/shared');
    const today = zonedCalendarDate(new Date(), project.timezone);
    const created = await Promise.all(
      [
        { status: 'PLANNED' as const, plannedDate: addDays(today, 1) },
        { status: 'PLANNED' as const, plannedDate: addDays(today, 30) },
        { status: 'IN_PROGRESS' as const, plannedDate: addDays(today, -7) },
        { status: 'MISSED' as const, plannedDate: addDays(today, -20) },
      ].map((v) =>
        prisma.visit.create({
          data: { projectId: prg105.id, visitKind: 'AD_HOC', originalPlannedDate: v.plannedDate, ...v },
        })
      )
    );
    try {
      const again = await request(app).get('/api/v1/projects/portfolio/overview').set(await login(FLAGSHIP));
      assert.equal(again.body.data.kpis.upcomingVisitCount, before.upcoming + 1);
      assert.equal(again.body.data.kpis.overdueVisitCount, before.overdue + 2);
    } finally {
      await prisma.visit.deleteMany({ where: { id: { in: created.map((v) => v.id) } } });
    }

    // The visit counts match the definitions over the seeded visits.
    const visits = await prisma.visit.findMany({
      where: { projectId: { in: rowIds }, status: { in: ['PLANNED', 'IN_PROGRESS', 'MISSED'] } },
      select: { status: true, plannedDate: true, project: { select: { timezone: true } } },
    });
    let upcoming = 0;
    let overdue = 0;
    for (const v of visits) {
      const day = zonedCalendarDate(new Date(), v.project.timezone);
      if (v.status === 'MISSED' || v.plannedDate < day) overdue += 1;
      else if (v.plannedDate <= addDays(day, 7)) upcoming += 1;
    }
    assert.equal(before.upcoming, upcoming);
    assert.equal(before.overdue, overdue);
  });
});

describe('UBEC roster: SUBEB administrators see only their jurisdiction', () => {
  for (const [email, orgName, expected] of [
    [NORTH, KANO_SUBEB, ['PRG-211']],
    [SOUTH, LAGOS_SUBEB, ['PRG-221', 'PRG-241', 'PRG-242']],
  ] as const) {
    it(`${email}: projects list, portfolio, KPIs and the project guard`, async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      });
      const perms = user.role.rolePermissions.map((rp) => rp.permission.key);
      assert.ok(perms.includes('projects:view_organization_tree'));
      assert.ok(!perms.includes('projects:view_all_tenant'), 'no tenant-wide visibility');
      assert.ok(!perms.some((k) => ['users:invite_manage', 'roles:create_edit', 'tenant:manage_settings', 'project_types:manage', 'organizations:manage'].includes(k)), 'no Settings permissions');
      const org = await prisma.organization.findFirstOrThrow({ where: { name: orgName } });
      const h = await login(email);

      // Every list holds only projects their SUBEB owns.
      const ownedBy = async (codes: string[]) => {
        const rows = await prisma.project.findMany({ where: { codePrefix: { in: codes } }, select: { owningOrganizationId: true } });
        return rows.every((r) => r.owningOrganizationId === org.id);
      };
      const list = await request(app).get('/api/v1/projects').set(h);
      const listCodes = (list.body.data as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort();
      assert.deepEqual(listCodes, [...expected]);
      const portfolio = await request(app).get('/api/v1/projects/portfolio/overview').set(h);
      const portfolioCodes = (portfolio.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort();
      assert.ok(portfolioCodes.every((c) => (expected as readonly string[]).includes(c)), portfolioCodes.join(','));
      assert.ok(await ownedBy(portfolioCodes));
      const kpis = await request(app).get('/api/v1/kpis').set(h);
      assert.equal(kpis.status, 200, JSON.stringify(kpis.body));
      const kpiCodes = (kpis.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort();
      assert.ok(kpiCodes.length > 0 && kpiCodes.every((c) => (expected as readonly string[]).includes(c)), kpiCodes.join(','));

      // The guard refuses a Direct Intervention project (UBEC-owned) and the other SUBEB's projects.
      for (const code of ['PRG-102', 'PRG-105', email === NORTH ? 'PRG-221' : 'PRG-211']) {
        const p = await prisma.project.findFirstOrThrow({ where: { codePrefix: code } });
        const res = await request(app).get(`/api/v1/projects/${p.id}/overview`).set(h);
        assert.equal(res.status, 403, `${code}: ${res.status}`);
      }
    });
  }
});

describe('UBEC roster: M&E officers see only the projects they are assigned to', () => {
  for (const [email, listed, notAssigned] of [
    ['me.officer@ubec.test', ['PRG-102', 'PRG-103', 'PRG-104', 'PRG-105', 'PRG-106', 'PRG-211', 'PRG-221'], ['PRG-241', 'PRG-242']],
    ['lagos.me@ubec.test', ['PRG-221', 'PRG-241', 'PRG-242'], ['PRG-105', 'PRG-211']],
    ['independent.me@ubec.test', ['PRG-102', 'PRG-105', 'PRG-211'], ['PRG-103', 'PRG-221']],
  ] as const) {
    it(`${email}: projects list, portfolio, KPIs and a 403 elsewhere`, async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      });
      const perms = user.role.rolePermissions.map((rp) => rp.permission.key);
      assert.ok(perms.includes('projects:view_assigned'));
      for (const k of ['projects:view_all_tenant', 'projects:view_organization_tree', 'projects:view_portfolio']) {
        assert.ok(!perms.includes(k), `${email} must not hold ${k}`);
      }
      const h = await login(email);
      const list = await request(app).get('/api/v1/projects').set(h);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.deepEqual((list.body.data as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort(), [...listed]);

      // The portfolio map/table lists live projects only (archived PRG-242 is not on it).
      const portfolio = await request(app).get('/api/v1/projects/portfolio/overview').set(h);
      assert.equal(portfolio.status, 200, JSON.stringify(portfolio.body));
      assert.deepEqual(
        (portfolio.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix).sort(),
        listed.filter((c) => c !== 'PRG-242')
      );
      const kpis = await request(app).get('/api/v1/kpis').set(h);
      assert.equal(kpis.status, 200, JSON.stringify(kpis.body));
      const kpiCodes = (kpis.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix);
      assert.ok(kpiCodes.length > 0 && kpiCodes.every((c) => (listed as readonly string[]).includes(c)), kpiCodes.join(','));

      // Not assigned: the project guard refuses the project, its completion page and its visits.
      for (const code of notAssigned) {
        const p = await prisma.project.findFirstOrThrow({ where: { codePrefix: code } });
        for (const path of ['overview', 'completion', 'visits']) {
          const res = await request(app).get(`/api/v1/projects/${p.id}/${path}`).set(h);
          assert.equal(res.status, 403, `${code}/${path}: ${res.status}`);
        }
      }
    });
  }
});
