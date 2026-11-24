/**
 * Redesign R6c route tests: the project Overview (`GET /projects/:id/overview`) and the stage on the
 * directory and portfolio rows (D-R6.18 – D-R6.22), on the seeded programme tenant:
 * - PRG-101 is a draft (seedPhase16 "draft with kick-off planned"): no Overview (409 PROJECT_IS_DRAFT);
 * - PRG-102 mobilising, PRG-105 construction with sprints, a payment and visits, PRG-104 completion,
 *   PRG-103 closure (defects liability period), PRG-242 closure (archived);
 * - sections the caller may not see are null, never zero (per role);
 * - legacy LKK-402 (platform tenant): Construction with Kick-off and Mobilisation not tracked.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import {
  PortfolioOverviewDtoSchema,
  ProjectOverviewDtoSchema,
  ProjectSummaryDtoSchema,
  zonedCalendarDate,
  type ProjectOverviewDto,
} from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const ids: Record<string, string> = {};

const ADMIN = 'admin@ubec.test';
const MONITOR = 'me.officer@ubec.test';
/** UBEC roster: the Independent M&E (assigned to PRG-105; no defect permission) replaces the funder. */
const FUNDER = 'independent.me@ubec.test';
const VIEWER = 'r6c.viewer@insite.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

async function overview(email: string, code: string): Promise<ProjectOverviewDto> {
  const res = await request(app).get(`/api/v1/projects/${ids[code]}/overview`).set(await web(email));
  assert.equal(res.status, 200, `${code}: ${JSON.stringify(res.body)}`);
  return ProjectOverviewDtoSchema.parse(res.body.data);
}

const states = (o: ProjectOverviewDto) => o.stage.stages.map((s) => `${s.key}:${s.state}`);

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  for (const p of await prisma.project.findMany({ where: { tenantId: tenant.id } })) ids[p.codePrefix] = p.id;
  ids['LKK-402'] = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } })).id;

  // A web user who sees every project of the tenant and holds none of the section permissions.
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'R6c tenant viewer',
      code: 'R6C_TENANT_VIEWER',
      surface: 'WEB',
      rolePermissions: { create: [{ permission: { connect: { key: 'projects:view_all_tenant' } } }] },
    },
  });
  const org = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id } });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: VIEWER,
      passwordHash: await (await import('bcryptjs')).default.hash(PASSWORD, 8),
      fullName: 'R6c Viewer',
      roleId: role.id,
      organizationId: org.id,
    },
  });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('R6c: project Overview', () => {
  it('needs a web sign-in', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-105']}/overview`);
    assert.equal(res.status, 401);
  });

  it('PRG-101 is a draft: no Overview', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['PRG-101']}/overview`).set(await web(ADMIN));
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code ?? res.body.code, 'PROJECT_IS_DRAFT');
  });

  it('PRG-102 is mobilising: kick-off held, sprints not started, next deadline the earliest open one', async () => {
    const o = await overview(ADMIN, 'PRG-102');
    assert.equal(o.today, today);
    assert.equal(o.stage.current, 'MOBILISATION');
    assert.deepEqual(states(o), ['KICKOFF:DONE', 'MOBILISATION:CURRENT', 'CONSTRUCTION:UPCOMING', 'COMPLETION:UPCOMING', 'CLOSURE:UPCOMING']);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } });
    assert.equal(o.stage.stages[1].enteredAt, project.kickoffHeldAt!.toISOString());

    // seedR2: sprints start in a week.
    assert.equal(o.hasSprints, true);
    assert.equal(o.currentSprint?.relation, 'NEXT');
    assert.equal(o.currentSprint?.number, 1);
    assert.equal(o.currentSprint?.status, 'UPCOMING');
    assert.ok((o.currentSprint?.activeUnitCount ?? 0) > 0);

    // The earliest of the open milestones and the open visits' submission deadlines.
    const milestones = await prisma.projectContractMilestone.findMany({
      where: { projectId: ids['PRG-102'], status: { in: ['PENDING', 'DUE', 'OVERDUE'] }, dueDate: { not: null } },
    });
    const visits = await prisma.visit.findMany({
      where: { projectId: ids['PRG-102'], status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] }, submissionDeadline: { not: null } },
    });
    const dates = [...milestones.map((m) => m.dueDate!), ...visits.map((v) => v.submissionDeadline!)].sort();
    assert.ok(o.nextDeadline, 'an open deadline');
    assert.equal(o.nextDeadline!.dueDate, dates[0]);
    assert.equal(o.overdueMilestoneCount, milestones.filter((m) => m.dueDate! < today).length);
  });

  it('PRG-105 is in construction: active sprint, next visit with officers, counts', async () => {
    const o = await overview(ADMIN, 'PRG-105');
    assert.equal(o.stage.current, 'CONSTRUCTION');
    assert.deepEqual(states(o).slice(0, 3), ['KICKOFF:DONE', 'MOBILISATION:DONE', 'CONSTRUCTION:CURRENT']);

    // seedR2: sprint 3 runs −14..+80.
    assert.equal(o.currentSprint?.relation, 'ACTIVE');
    assert.equal(o.currentSprint?.number, 3);
    assert.equal(o.currentSprint?.totalSprints, 3);
    assert.equal(o.currentSprint?.status, 'ACTIVE');

    const next = await prisma.visit.findFirst({
      where: { projectId: ids['PRG-105'], status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] }, plannedDate: { gte: today } },
      orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
      include: { assignees: { include: { user: true } } },
    });
    assert.ok(next, 'seedR4 publishes visits on PRG-105');
    assert.equal(o.nextVisit?.id, next.id);
    assert.equal(o.nextVisit?.plannedDate, next.plannedDate);
    assert.ok(o.nextVisit!.plannedDate >= today);
    assert.deepEqual([...o.nextVisit!.officerNames].sort(), next.assignees.map((a) => a.user.fullName).sort());

    assert.equal(typeof o.openFindingCount, 'number');
    assert.equal(typeof o.openDefectCount, 'number');
  });

  it('PRG-104 is in completion (handover, CoC drafted)', async () => {
    const o = await overview(ADMIN, 'PRG-104');
    assert.equal(o.stage.current, 'COMPLETION');
    assert.deepEqual(states(o), ['KICKOFF:DONE', 'MOBILISATION:DONE', 'CONSTRUCTION:DONE', 'COMPLETION:CURRENT', 'CLOSURE:UPCOMING']);
    assert.ok(o.stage.stages[3].enteredAt);
    assert.equal(o.stage.subLabel, null);
  });

  it('PRG-103 is in closure: defects liability period, open defects counted', async () => {
    const o = await overview(ADMIN, 'PRG-103');
    assert.equal(o.stage.current, 'CLOSURE');
    assert.equal(o.stage.subLabel, 'Defects liability period');
    assert.equal(o.stage.stages[4].note, 'Defects liability period');
    assert.equal(o.stage.flags.archived, false);
    // seedPhase16: the handover snags became defect tickets.
    const open = await prisma.retentionDefectTicket.count({
      where: { projectId: ids['PRG-103'], status: { in: ['OPEN', 'ASSIGNED', 'RECTIFIED_PENDING_VERIFICATION'] } },
    });
    assert.ok(open > 0);
    assert.equal(o.openDefectCount, open);
  });

  it('PRG-242 is archived: closure, read-only GET still served', async () => {
    const o = await overview(ADMIN, 'PRG-242');
    assert.equal(o.stage.current, 'CLOSURE');
    assert.equal(o.stage.subLabel, 'Archived');
    assert.equal(o.stage.flags.archived, true);
    assert.deepEqual(states(o), ['KICKOFF:DONE', 'MOBILISATION:DONE', 'CONSTRUCTION:DONE', 'COMPLETION:DONE', 'CLOSURE:CURRENT']);
  });

  it('a caller without the section permissions gets null sections, never zero', async () => {
    for (const code of ['PRG-102', 'PRG-105', 'PRG-103']) {
      const o = await overview(VIEWER, code);
      assert.ok(o.stage.current, 'the stage is for every viewer');
      assert.equal(o.currentSprint, null);
      assert.equal(o.hasSprints, null);
      assert.equal(o.nextVisit, null);
      assert.equal(o.nextDeadline, null);
      assert.equal(o.overdueMilestoneCount, null);
      assert.equal(o.openDefectCount, null);
      assert.equal(o.openFindingCount, null);
    }
  });

  it('the Independent M&E sees sprints, visits, deadlines and findings but not defects', async () => {
    const o = await overview(FUNDER, 'PRG-105');
    assert.equal(o.currentSprint?.number, 3);
    assert.ok(o.nextVisit);
    assert.equal(typeof o.overdueMilestoneCount, 'number');
    assert.equal(typeof o.openFindingCount, 'number');
    assert.equal(o.openDefectCount, null);
  });

  it('the monitor sees every section on PRG-105', async () => {
    const o = await overview(MONITOR, 'PRG-105');
    assert.equal(o.stage.current, 'CONSTRUCTION');
    assert.ok(o.currentSprint);
    assert.ok(o.nextVisit);
    assert.equal(typeof o.openDefectCount, 'number');
    assert.equal(typeof o.openFindingCount, 'number');
  });

  it('another tenant cannot read it', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids['LKK-402']}/overview`).set(await web(ADMIN));
    assert.ok([403, 404].includes(res.status), String(res.status));
  });

  it('legacy LKK-402: Construction, Kick-off and Mobilisation not tracked', async () => {
    const o = await overview('admin@insite.ng', 'LKK-402');
    assert.equal(o.stage.current, 'CONSTRUCTION');
    assert.deepEqual(states(o).slice(0, 3), ['KICKOFF:NOT_TRACKED', 'MOBILISATION:NOT_TRACKED', 'CONSTRUCTION:CURRENT']);
  });
});

describe('R6c: stage on list rows (D-R6.22)', () => {
  it('directory rows carry the stage and match the shared summary schema', async () => {
    const res = await request(app).get('/api/v1/projects').set(await web(ADMIN));
    assert.equal(res.status, 200);
    const rows = ProjectSummaryDtoSchema.array().parse(res.body.data);
    const byCode = new Map(rows.map((r) => [r.codePrefix, r]));
    assert.ok(!byCode.has('PRG-101'), 'drafts are not in the directory');
    assert.equal(byCode.get('PRG-102')?.stage?.current, 'MOBILISATION');
    assert.equal(byCode.get('PRG-105')?.stage?.current, 'CONSTRUCTION');
    assert.equal(byCode.get('PRG-104')?.stage?.current, 'COMPLETION');
    assert.deepEqual(byCode.get('PRG-103')?.stage, {
      current: 'CLOSURE',
      currentLabel: 'Closure',
      subLabel: 'Defects liability period',
      contractTerminated: false,
    });
    assert.equal(byCode.get('PRG-242')?.stage?.subLabel, 'Archived');
    for (const r of rows) assert.ok(r.stage, `${r.codePrefix} has a stage`);
  });

  it('a terminated contract is flagged on the row', async () => {
    const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids['PRG-221'] } });
    await prisma.projectContractor.update({ where: { id: contractor.id }, data: { contractStatus: 'TERMINATED' } });
    try {
      const res = await request(app).get('/api/v1/projects').set(await web(ADMIN));
      const row = ProjectSummaryDtoSchema.array().parse(res.body.data).find((r) => r.codePrefix === 'PRG-221');
      assert.equal(row?.stage?.contractTerminated, true);
      const o = await overview(ADMIN, 'PRG-221');
      assert.equal(o.stage.flags.contractTerminated, true);
      assert.match(o.stage.stages.find((s) => s.state === 'CURRENT')!.note ?? '', /Contract terminated/);
    } finally {
      await prisma.projectContractor.update({ where: { id: contractor.id }, data: { contractStatus: contractor.contractStatus } });
    }
  });

  it('portfolio rows carry the stage', async () => {
    const res = await request(app).get('/api/v1/projects/portfolio/overview').set(await web(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = PortfolioOverviewDtoSchema.parse(res.body.data);
    assert.ok(dto.projects.length > 0);
    for (const p of dto.projects) assert.ok(p.stage, `${p.codePrefix} has a stage`);
    assert.equal(dto.projects.find((p) => p.codePrefix === 'PRG-105')?.stage?.current, 'CONSTRUCTION');
  });

  it('the batched loader skips drafts', async () => {
    const { loadProjectStageSummaries } = await import('../modules/projects/projectStage.service');
    const all = await loadProjectStageSummaries(Object.values(ids));
    assert.ok(all.size >= 8);
    assert.ok(!all.has(ids['PRG-101']), 'drafts have no stage');
  });
});
