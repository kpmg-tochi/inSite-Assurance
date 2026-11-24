/**
 * Redesign R6a route tests: the two-level setup registry (sections saved by the server, five wizard
 * steps for people). Covers the new `contractor` section, the parties compatibility path (D-R6.4),
 * `wizardSteps` (D-R6.6), activation issues with `wizardStepId`, the planned completion warning
 * (D-R6.7), the draft list counts, and a draft created and activated through the five steps only,
 * saving the sections in the order the web sends them.
 *
 * Programme tenant: programme.admin@ with the seeded Central type (beneficiary, monitor and funder
 * required; contract milestones, so the contract section is required).
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const PROGRAMME_ADMIN = 'admin@ubec.test';
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

interface SectionStatus {
  stepId: string;
  wizardStepId: string;
  required: boolean;
  saved: boolean;
  complete: boolean;
  issues: Array<{ code: string; message: string; field?: string }>;
  warnings: Array<{ code: string; message: string; field?: string }>;
}
interface WizardStatus {
  id: string;
  sectionIds: string[];
  required: boolean;
  saved: boolean;
  complete: boolean;
  issueCount: number;
  warningCount: number;
}
interface SetupDto {
  projectId: string;
  status: string;
  canActivate: boolean;
  steps: SectionStatus[];
  wizardSteps: WizardStatus[];
  parties: {
    monitorOrganization: { id: string } | null;
    lenderOrganization: { id: string } | null;
    owningOrganization: { id: string } | null;
    contractors: Array<{ id: string; organizationId: string; organizationName: string; tradeCode: string }>;
  };
}

const section = (dto: SetupDto, id: string) => dto.steps.find((s) => s.stepId === id)!;
const wizard = (dto: SetupDto, id: string) => dto.wizardSteps.find((s) => s.id === id)!;

const url = (projectId: string, path = '') => `/api/v1/projects/${projectId}${path}`;
async function put(projectId: string, sectionId: string, body: unknown) {
  return request(app).put(url(projectId, `/setup/${sectionId}`)).set(await web(PROGRAMME_ADMIN)).send(body as object);
}
async function getSetup(projectId: string) {
  const res = await request(app).get(url(projectId, '/setup')).set(await web(PROGRAMME_ADMIN));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as SetupDto;
}

async function createDraft(code: string) {
  const res = await request(app)
    .post('/api/v1/projects')
    .set(await web(PROGRAMME_ADMIN))
    .send({
      name: `R6a draft ${code}`,
      codePrefix: code,
      stateLocation: 'Kano State',
      totalBudgetNgn: 200_000_000,
      projectTypeId: ids.central,
      regionId: ids.kano,
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as SetupDto;
}

const RADIAL = { mode: 'RADIAL', center: { latitude: 12.0, longitude: 8.5 }, radiusMeters: 150, siteLabel: 'School compound' };
const contractorRow = (orgId: string, extra: Record<string, unknown> = {}) => ({
  organization: { id: orgId },
  tradeCategory: 'Main contract',
  tradeCode: 'MAIN',
  ...extra,
});

/** Sprints, one unit and one line through the scope endpoints (as the Scope & sprints step does). */
async function addScope(projectId: string, lastSprintEnd = '2027-06-30') {
  const h = await web(PROGRAMME_ADMIN);
  const sprints = await request(app)
    .put(url(projectId, '/scope/sprints'))
    .set(h)
    .send({
      sprints: [
        { name: 'Sprint 1', startDate: '2027-01-04', endDate: '2027-03-31' },
        { name: 'Sprint 2', startDate: '2027-04-01', endDate: lastSprintEnd },
      ],
    });
  assert.equal(sprints.status, 200, JSON.stringify(sprints.body));
  const [s1, s2] = sprints.body.data.sprints as Array<{ id: string }>;
  const unit = await request(app)
    .post(url(projectId, '/scope/units'))
    .set(h)
    .send({ facilityId: ids.classroom, label: 'Classroom block', startSprintId: s1.id, endSprintId: s2.id });
  assert.equal(unit.status, 201, JSON.stringify(unit.body));
  const line = await request(app)
    .post(url(projectId, '/scope/lines'))
    .set(h)
    .send({
      facilityUnitId: unit.body.data.units[0].id,
      wbsCode: '01.01',
      description: 'Pad foundations in reinforced concrete',
      unit: 'm3',
      totalQuantity: 100,
      rateNgn: 1_000_000,
    });
  assert.equal(line.status, 201, JSON.stringify(line.body));
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.central = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CENTRAL' } })).id;
  ids.kano = (await prisma.region.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'N-KAN' } })).id;
  ids.classroom = (await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'CLASSROOM' } } })).id;
  ids.monitorOrg = (
    await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, categories: { has: 'ADVISORY_MONITOR' }, isArchived: false } })
  ).id;
  ids.contractorOrg = (
    await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, categories: { has: 'CONTRACTOR' }, isArchived: false } })
  ).id;
});

describe('Redesign R6a: sections and wizard steps', () => {
  it('a new draft reports the contractor as its own section on step 2 "Contract"', async () => {
    const dto = await createDraft('RSA-601');
    ids.draft = dto.projectId;
    const contractor = section(dto, 'contractor');
    assert.equal(contractor.wizardStepId, 'contract');
    assert.equal(contractor.required, true);
    const codes = contractor.issues.map((i) => i.code);
    assert.deepEqual(codes, ['STEP_NOT_SAVED', 'CONTRACTOR_REQUIRED']);
    assert.equal(contractor.issues[0].message, 'Open step 2 "Contract" and save it.');
    // The contractor issues left the parties section.
    assert.ok(!section(dto, 'parties').issues.some((i) => i.code === 'CONTRACTOR_REQUIRED'));
    assert.equal(section(dto, 'parties').issues[0].message, 'Open step 1 "Project" and save it.');
    // Every section names its wizard step.
    assert.equal(section(dto, 'basics').wizardStepId, 'project');
    assert.equal(section(dto, 'site').wizardStepId, 'project');
    assert.equal(section(dto, 'facility').wizardStepId, 'contract');
    assert.equal(section(dto, 'scope').wizardStepId, 'scope');
    assert.equal(section(dto, 'visits').wizardStepId, 'team');
    assert.equal(section(dto, 'process').wizardStepId, 'advanced');
  });

  it('aggregates wizard steps from their sections (Review left out)', async () => {
    const dto = await getSetup(ids.draft);
    assert.deepEqual(
      dto.wizardSteps.map((w) => w.id),
      ['project', 'contract', 'scope', 'team', 'advanced']
    );
    const project = wizard(dto, 'project');
    assert.deepEqual(project.sectionIds, ['basics', 'parties', 'site']);
    assert.equal(project.required, true);
    assert.equal(project.saved, false);
    assert.equal(project.complete, false);
    const sectionIssues = dto.steps.filter((s) => s.wizardStepId === 'project').reduce((n, s) => n + s.issues.length, 0);
    assert.equal(project.issueCount, sectionIssues);
    assert.deepEqual(wizard(dto, 'contract').sectionIds, ['contractor', 'contract', 'facility']);
    assert.deepEqual(wizard(dto, 'team').sectionIds, ['team', 'visits']);
    assert.equal(wizard(dto, 'team').required, false);
    assert.equal(wizard(dto, 'advanced').required, false);
    assert.ok(wizard(dto, 'team').warningCount >= 1, 'NO_VISIT_OFFICER warning counts');
  });

  it('saves the contractor section, and refuses a second contractor or a missing list', async () => {
    const two = await put(ids.draft, 'contractor', {
      contractors: [contractorRow(ids.contractorOrg), { organization: { name: 'Second Ltd' }, tradeCategory: 'Electrical', tradeCode: 'ELEC' }],
    });
    assert.equal(two.status, 400, JSON.stringify(two.body));
    assert.equal((await put(ids.draft, 'contractor', {})).status, 400);

    const res = await put(ids.draft, 'contractor', { contractors: [contractorRow(ids.contractorOrg, { plannedCompletionDate: '2027-05-31' })] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = res.body.data as SetupDto;
    assert.equal(dto.parties.contractors.length, 1);
    assert.equal(dto.parties.contractors[0].tradeCode, 'MAIN');
    assert.equal(section(dto, 'contractor').saved, true);
    assert.equal(section(dto, 'contractor').complete, true);
    const audit = await prisma.auditLog.findFirst({
      where: { projectId: ids.draft, action: 'PROJECT_SETUP_STEP_SAVED' },
      orderBy: { seq: 'desc' },
    });
    assert.equal((audit!.payload as { stepId: string }).stepId, 'contractor');
    assert.deepEqual((audit!.payload as { contractorsAdded: string[] }).contractorsAdded, ['MAIN']);
  });

  it('parties without contractors keeps the contractor', async () => {
    const res = await put(ids.draft, 'parties', {
      monitorOrganization: { id: ids.monitorOrg },
      beneficiaries: [{ name: 'Kano Test School', beneficiaryType: 'SCHOOL', isPrimary: true }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = res.body.data as SetupDto;
    assert.equal(dto.parties.contractors.length, 1, 'omitted contractors keeps the contractor');
    assert.equal(section(dto, 'parties').saved, true);
  });

  it('parties with contractors still works and also marks the contractor section saved (D-R6.4)', async () => {
    const dto0 = await createDraft('RSA-602');
    ids.compat = dto0.projectId;
    const res = await put(ids.compat, 'parties', {
      monitorOrganization: { id: ids.monitorOrg },
      beneficiaries: [{ name: 'Compat School', beneficiaryType: 'SCHOOL', isPrimary: true }],
      contractors: [contractorRow(ids.contractorOrg)],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = res.body.data as SetupDto;
    assert.equal(dto.parties.contractors.length, 1);
    assert.equal(section(dto, 'contractor').saved, true);
    assert.ok(!section(dto, 'contractor').issues.some((i) => i.code === 'STEP_NOT_SAVED'));
    // An explicit empty list through parties still removes it (the old behaviour).
    const cleared = await put(ids.compat, 'parties', { monitorOrganization: { id: ids.monitorOrg }, contractors: [] });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal((cleared.body.data as SetupDto).parties.contractors.length, 0);
  });

  it('warns on the contract section when the planned completion is before the last sprint ends', async () => {
    await addScope(ids.draft, '2027-06-30');
    const dto = await getSetup(ids.draft);
    const warning = section(dto, 'contract').warnings.find((w) => w.code === 'PLANNED_COMPLETION_BEFORE_SPRINTS_END');
    assert.ok(warning, JSON.stringify(section(dto, 'contract').warnings));
    assert.equal(warning.field, 'plannedCompletionDate');
    assert.match(warning.message, /2027-05-31.*2027-06-30/);
    assert.ok(wizard(dto, 'contract').warningCount >= 1);
    // Moving the planned completion to the end of the last sprint clears it.
    const contractorId = dto.parties.contractors[0].id;
    const moved = await put(ids.draft, 'contractor', {
      contractors: [{ id: contractorId, ...contractorRow(ids.contractorOrg, { plannedCompletionDate: '2027-06-30' }) }],
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.ok(!section(moved.body.data, 'contract').warnings.some((w: { code: string }) => w.code === 'PLANNED_COMPLETION_BEFORE_SPRINTS_END'));
  });

  it('activation issues carry the section and the wizard step', async () => {
    const res = await request(app).post(url(ids.draft, '/activate')).set(await web(PROGRAMME_ADMIN));
    assert.equal(res.status, 422, JSON.stringify(res.body));
    const issues = res.body.error.details.issues as Array<{ stepId: string; wizardStepId: string; code: string }>;
    assert.ok(issues.length > 0);
    for (const i of issues) assert.ok(i.wizardStepId, `no wizardStepId on ${JSON.stringify(i)}`);
    const site = issues.find((i) => i.stepId === 'site' && i.code === 'GEOFENCE_REQUIRED');
    assert.equal(site?.wizardStepId, 'project');
    // The Central type's milestones count from the contract dates, not entered yet.
    const contract = issues.find((i) => i.stepId === 'contract' && i.code === 'CONTRACT_DATE_REQUIRED');
    assert.equal(contract?.wizardStepId, 'contract');
    // The scope endpoints marked the scope section saved on the draft (R2b), so it has no issue.
    assert.ok(!issues.some((i) => i.stepId === 'scope'));
  });

  it('the drafts list counts required wizard steps, not sections', async () => {
    const res = await request(app).get('/api/v1/projects/drafts').set(await web(PROGRAMME_ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body.data.find((d: { id: string }) => d.id === ids.draft);
    assert.ok(row);
    // Project, Contract and Scope & sprints are required; Team & visits and Advanced are optional.
    assert.equal(row.totalRequiredSteps, 3);
    const dto = await getSetup(ids.draft);
    assert.equal(row.completedRequiredSteps, dto.wizardSteps.filter((w) => w.required && w.complete).length);
    assert.ok(row.completedRequiredSteps < 3);
  });

  it('refuses unknown section ids, including inherited property names', async () => {
    for (const id of ['nonsense', 'toString', 'project', 'review', 'reporting']) {
      const res = await put(ids.draft, id, {});
      assert.equal(res.status, 404, `${id}: ${res.status}`);
    }
  });
});

describe('Redesign R6a: a draft through the five steps only', () => {
  it('creates, saves each step’s sections in the web order and activates', async () => {
    const created = await createDraft('RSA-603');
    const projectId = created.projectId;
    await addScope(projectId);
    const resident = await prisma.user.findUniqueOrThrow({ where: { email: 'resident.supervisor@ubec.test' } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: PROGRAMME_ADMIN } });

    /** What the web sends per section, built from the current DTO (unchanged values when nothing to set). */
    const bodies = (dto: SetupDto): Record<string, unknown> => ({
      basics: {
        name: 'R6a five-step school',
        codePrefix: 'RSA-603',
        stateLocation: 'Kano State',
        totalBudgetNgn: 200_000_000,
        projectTypeId: ids.central,
        regionId: ids.kano,
      },
      parties: {
        owningOrganizationId: dto.parties.owningOrganization?.id ?? null,
        monitorOrganization: { id: ids.monitorOrg },
        lenderOrganization: dto.parties.lenderOrganization ? { id: dto.parties.lenderOrganization.id } : null,
        beneficiaries: [{ name: 'Five Step Primary School', beneficiaryType: 'SCHOOL', isPrimary: true }],
      },
      site: { geofence: RADIAL, geofenceToleranceMeters: null, timezone: 'Africa/Lagos' },
      contractor: { contractors: [contractorRow(ids.contractorOrg, { plannedCompletionDate: '2027-06-30' })] },
      contract: {
        contractReference: 'CTR/R6A/603',
        contractAwardDate: '2026-12-01',
        contractSignedDate: '2026-12-05',
        contractSumNgn: 150_000_000,
        kickoffDate: '2026-12-14',
      },
      facility: { retention: { retentionPercentage: 5, retentionDurationMonths: 12, retentionReleaseAtCompletionPct: 0 } },
      scope: {},
      standards: {},
      team: { userIds: [admin.id, resident.id] },
      visits: { workWeekDays: [1, 2, 3, 4, 5] },
    });

    let dto = await getSetup(projectId);
    const numbered = ['project', 'contract', 'scope', 'team'];
    for (const stepId of numbered) {
      // "Save and continue": every section of the step the web shows, in order.
      for (const sectionId of wizard(dto, stepId).sectionIds) {
        const res = await put(projectId, sectionId, bodies(dto)[sectionId]);
        assert.equal(res.status, 200, `${stepId}/${sectionId}: ${JSON.stringify(res.body)}`);
        dto = res.body.data;
      }
      const after = wizard(dto, stepId);
      assert.equal(after.saved, true, `${stepId} saved`);
      assert.equal(after.complete, true, `${stepId}: ${JSON.stringify(dto.steps.filter((s) => s.wizardStepId === stepId))}`);
    }
    // Advanced (process) was never opened.
    assert.equal(section(dto, 'process').saved, false);
    assert.equal(dto.canActivate, true, JSON.stringify(dto.steps.filter((s) => !s.complete)));

    const drafts = await request(app).get('/api/v1/projects/drafts').set(await web(PROGRAMME_ADMIN));
    const row = drafts.body.data.find((d: { id: string }) => d.id === projectId);
    assert.equal(row.completedRequiredSteps, row.totalRequiredSteps);

    const activated = await request(app).post(url(projectId, '/activate')).set(await web(PROGRAMME_ADMIN));
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.data.status, 'ACTIVE');

    const live = await getSetup(projectId);
    assert.ok(live.steps.every((s) => s.saved), 'a live project reports every section saved');
    assert.ok(live.wizardSteps.every((w) => w.saved));
    const saved = await prisma.auditLog.findMany({ where: { projectId, action: 'PROJECT_SETUP_STEP_SAVED' } });
    const sectionsSaved = new Set(saved.map((a) => (a.payload as { stepId: string }).stepId));
    for (const id of ['basics', 'parties', 'site', 'contractor', 'contract', 'facility', 'scope', 'team', 'visits']) {
      assert.ok(sectionsSaved.has(id), `audit for ${id}`);
    }
  });
});
