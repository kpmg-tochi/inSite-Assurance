/**
 * Needs pipeline wave 1 (N0 + N1) against the seeded database:
 * - N0: Direct Intervention mobilisation milestones count 21 days from contract award (PRG-102 is
 *   due in 5 days); Matching Grants still count 14 days from the kick-off; the kick-off DTO warns
 *   (never blocks) when the planned kick-off is later than award + 14 days;
 * - the seed people of the cycle (D-N.25) sign in and hold the grants of plan section 8;
 * - both programme types carry their needs pipeline; other tenants' types are unchanged (disabled);
 * - the pipeline tables take a cycle with everything under it, keep their unique rules, and go with
 *   the cycle; `Project.origin` and the one-to-one with a proposed project.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import {
  addDays,
  cycleDeadlines,
  DEFAULT_DI_NEEDS_PIPELINE,
  formatProposalReference,
  NEEDS_TEMPLATE_VERSION,
  NeedsPipelineConfigSchema,
  normaliseSchoolName,
  ProjectKickoffDtoSchema,
  ProjectTypeDtoSchema,
  resolveProjectTypeConfig,
  SYSTEM_PERMISSIONS_CATALOG,
  zonedCalendarDate,
  type ProjectKickoffDto,
} from '@insite/shared';
import { NEEDS_PIPELINE_GRANTS, NEEDS_PIPELINE_PEOPLE } from '../db/seedUbecRoster';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let kickoffService: typeof import('../modules/contracts/kickoff.service');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let tenantId: string;
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');

const ADMIN = 'admin@ubec.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

async function permissionsOf(email: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { role: { include: { rolePermissions: { include: { permission: { select: { key: true } } } } } } },
  });
  return user.role.rolePermissions.map((rp) => rp.permission.key).sort();
}

async function kickoff(code: string): Promise<ProjectKickoffDto> {
  const res = await request(app).get(`/api/v1/projects/${ids[code]}/kickoff`).set(await web(ADMIN));
  assert.equal(res.status, 200, `${code}: ${JSON.stringify(res.body)}`);
  return ProjectKickoffDtoSchema.parse(res.body.data);
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  kickoffService = await import('../modules/contracts/kickoff.service');
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  tenantId = tenant.id;
  for (const p of await prisma.project.findMany({ where: { tenantId } })) ids[p.codePrefix] = p.id;
});

describe('Needs pipeline N0: Direct Intervention mobilisation from contract award', () => {
  it('the Direct Intervention type counts both mobilisation milestones 21 days from award; Matching Grants 14 days from the kick-off', async () => {
    const types = await prisma.projectType.findMany({ where: { tenantId } });
    const templates = (code: string) => {
      const config = resolveProjectTypeConfig({ config: types.find((t) => t.code === code)!.configJson })!;
      return new Map(config.contractMilestones.map((m) => [m.key, m]));
    };
    const di = templates('CENTRAL');
    for (const key of ['contractor-mobilised', 'mobilisation-documents']) {
      assert.equal(di.get(key)?.anchor, 'CONTRACT_AWARD', key);
      assert.equal(di.get(key)?.offsetValue, 21, key);
    }
    assert.equal(di.get('contractor-mobilised')?.completionMode, 'AUTO_CONTRACTOR_ON_SITE');
    const mg = templates('CO_FUNDED');
    for (const key of ['contractor-mobilised', 'mobilisation-documents']) {
      assert.equal(mg.get(key)?.anchor, 'KICKOFF', key);
      assert.equal(mg.get(key)?.offsetValue, 14, key);
    }
    // The rest of the Matching Grants list is as before.
    assert.equal(mg.get('minutes-approved')?.offsetUnit, 'WORKING_DAYS');
    assert.equal(mg.get('programme-of-works')?.completionMode, 'AUTO_SCHEDULE_BASELINE_SET');
  });

  it('PRG-102 (Direct Intervention): mobilisation is due 21 days from award, which is in 5 days', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } });
    assert.equal(project.contractAwardDate, addDays(today, -16));
    assert.ok(project.kickoffHeldAt, 'the kick-off was held');
    assert.ok(project.kickoffDate! <= addDays(project.contractAwardDate!, 14), 'inside the 14 days after award');
    assert.ok(project.contractSignedDate! >= project.contractAwardDate!);
    const milestones = await prisma.projectContractMilestone.findMany({ where: { projectId: project.id, key: { in: ['contractor-mobilised', 'mobilisation-documents'] } } });
    assert.equal(milestones.length, 2);
    for (const m of milestones) {
      assert.equal(m.anchor, 'CONTRACT_AWARD', m.key);
      assert.equal(m.dueDate, addDays(project.contractAwardDate!, 21), m.key);
      assert.equal(m.dueDate, addDays(today, 5), m.key);
      assert.notEqual(m.status, 'DONE', m.key);
    }
  });

  it('every other Direct Intervention project counts its mobilisation from award too', async () => {
    const rows = await prisma.projectContractMilestone.findMany({
      where: { project: { tenantId, projectType: { code: 'CENTRAL' } }, key: 'contractor-mobilised' },
      include: { project: { select: { codePrefix: true, contractAwardDate: true } } },
    });
    assert.ok(rows.length >= 4, `Direct Intervention projects with the milestone: ${rows.length}`);
    for (const m of rows) {
      assert.equal(m.anchor, 'CONTRACT_AWARD', m.project.codePrefix);
      if (m.project.contractAwardDate && !m.anchorDateOverride) assert.equal(m.dueDate, addDays(m.project.contractAwardDate, 21), m.project.codePrefix);
    }
    // The stories that mobilised on time before N0 still did (PRG-103 was late before and stays late).
    for (const code of ['PRG-104', 'PRG-105', 'PRG-106']) {
      const m = rows.find((r) => r.project.codePrefix === code);
      assert.ok(m && m.status === 'DONE' && m.completedAt && m.dueDate, `${code} has mobilised`);
      assert.ok(zonedCalendarDate(m.completedAt, 'Africa/Lagos') <= m.dueDate, `${code}: mobilised ${m.completedAt.toISOString()} against due ${m.dueDate}`);
    }
  });

  it('PRG-221 (Matching Grants) is unchanged: 14 days from the kick-off', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-221'] } });
    const milestones = await prisma.projectContractMilestone.findMany({ where: { projectId: project.id, key: { in: ['contractor-mobilised', 'mobilisation-documents'] } } });
    assert.equal(milestones.length, 2);
    for (const m of milestones) {
      assert.equal(m.anchor, 'KICKOFF', m.key);
      assert.equal(m.dueDate, addDays(project.kickoffDate!, 14), m.key);
    }
    assert.equal(project.kickoffDate, addDays(today, -20));
  });

  it('warns on the kick-off tab when the planned kick-off is later than award + 14 days, and never blocks', async () => {
    // PRG-102 is live with its kick-off held 8 days ago. Take the held record away: a kick-off scheduled
    // 8 days after an award 16 days ago is inside the window.
    const heldAt = (await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } })).kickoffHeldAt!;
    const held = await prisma.kickoffMeeting.findUniqueOrThrow({ where: { projectId: ids['PRG-102'] } });
    await prisma.kickoffMeeting.update({ where: { id: held.id }, data: { heldAt: null, quorumMet: null } });
    await prisma.project.update({ where: { id: ids['PRG-102'] }, data: { kickoffHeldAt: null } });
    const clean = await kickoff('PRG-102');
    assert.ok(clean.meeting && !clean.meeting.heldAt, 'a kick-off is scheduled, not held');
    assert.deepEqual(clean.warnings, []);

    // The award was 30 days ago: the scheduled kick-off (award + 22) is past the window.
    const award = addDays(today, -30);
    await prisma.project.update({ where: { id: ids['PRG-102'] }, data: { contractAwardDate: award } });
    const late = await kickoff('PRG-102');
    assert.equal(late.warnings.length, 1);
    const w = late.warnings[0];
    assert.equal(w.code, 'KICKOFF_AFTER_AWARD_WINDOW');
    assert.equal(w.contractAwardDate, award);
    assert.equal(w.latestKickoffDate, addDays(award, 14));
    assert.equal(w.plannedKickoffDate, addDays(today, -8));
    assert.match(w.message, /later than 14 days after the contract award/);

    // Not a block: the meeting can still be saved, and the answer carries the warning.
    const meeting = late.meeting!;
    const saved = await request(app)
      .put(`/api/v1/projects/${ids['PRG-102']}/kickoff`)
      .set(await web(ADMIN))
      .send({
        scheduledAt: meeting.scheduledAt,
        location: meeting.location,
        agendaDocumentId: meeting.agendaDocumentId,
        invitees: meeting.invitees.map((i) => ({ id: i.id, stakeholderGroup: i.stakeholderGroup, name: i.name, email: i.email, phone: i.phone, organizationId: i.organizationId, userId: i.userId })),
      });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(ProjectKickoffDtoSchema.parse(saved.body.data).warnings[0]?.code, 'KICKOFF_AFTER_AWARD_WINDOW');

    // Back to the seeded state: held, awarded 16 days ago.
    await prisma.kickoffMeeting.update({ where: { id: held.id }, data: { heldAt: held.heldAt, quorumMet: held.quorumMet } });
    await prisma.project.update({ where: { id: ids['PRG-102'] }, data: { kickoffHeldAt: heldAt, contractAwardDate: addDays(today, -16) } });
  });

  it('a draft with a kick-off planned inside the window has no warning; moving the award back raises it', async () => {
    // PRG-101 (Direct Intervention draft): awarded 3 days ago, kick-off scheduled in 9 days (award + 12).
    const clean = await kickoffService.getProjectKickoff(ids['PRG-101']);
    assert.ok(clean.meeting && !clean.meeting.heldAt);
    assert.deepEqual(clean.warnings, []);
    await prisma.project.update({ where: { id: ids['PRG-101'] }, data: { contractAwardDate: addDays(today, -20) } });
    const late = await kickoffService.getProjectKickoff(ids['PRG-101']);
    assert.equal(late.warnings[0]?.code, 'KICKOFF_AFTER_AWARD_WINDOW');
    assert.equal(late.warnings[0]?.plannedKickoffDate, addDays(today, 9));
    assert.equal(late.warnings[0]?.latestKickoffDate, addDays(today, -6));
    await prisma.project.update({ where: { id: ids['PRG-101'] }, data: { contractAwardDate: addDays(today, -3) } });
  });
  it('does not warn once the kick-off is held, nor on a Matching Grants project', async () => {
    // PRG-102: held. Even with an old award date there is nothing left to plan.
    await prisma.project.update({ where: { id: ids['PRG-102'] }, data: { contractAwardDate: addDays(today, -60) } });
    assert.deepEqual((await kickoff('PRG-102')).warnings, []);
    await prisma.project.update({ where: { id: ids['PRG-102'] }, data: { contractAwardDate: addDays(today, -16) } });

    // Matching Grants counts from the kick-off: a kick-off long after award is not this warning.
    const mg = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-221'] } });
    assert.deepEqual(
      kickoffService.kickoffWarnings({ projectTypeSnapshotJson: mg.projectTypeSnapshotJson, timezone: mg.timezone, contractAwardDate: addDays(today, -60), kickoffDate: addDays(today, 10), meeting: null }),
      []
    );
    // The same dates on a Direct Intervention snapshot do warn (planned date, no meeting yet).
    const di = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } });
    const warned = kickoffService.kickoffWarnings({ projectTypeSnapshotJson: di.projectTypeSnapshotJson, timezone: di.timezone, contractAwardDate: addDays(today, -60), kickoffDate: addDays(today, 10), meeting: null });
    assert.equal(warned[0]?.code, 'KICKOFF_AFTER_AWARD_WINDOW');
    // A project without a type has no rule.
    assert.deepEqual(kickoffService.kickoffWarnings({ projectTypeSnapshotJson: null, timezone: 'Africa/Lagos', contractAwardDate: addDays(today, -60), kickoffDate: addDays(today, 10), meeting: null }), []);
  });
});

describe('Needs pipeline N1: seed people and grants (D-N.25)', () => {
  it('the ten cycle logins (incl. the three SUBEB committee members, wave 3) exist in their organisations, are web roles and sign in', async () => {
    const ubec = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Universal Basic Education Commission' } } });
    const kano = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Kano State Universal Basic Education Board' } } });
    assert.deepEqual(
      NEEDS_PIPELINE_PEOPLE.map((p) => p.email).sort(),
      ['dpp@ubec.test', 'es@ubec.test', 'finance@ubec.test', 'kano.committee1@ubec.test', 'kano.committee2@ubec.test', 'kano.committee3@ubec.test', 'kano.dpp@ubec.test', 'kano.procurement@ubec.test', 'procurement@ubec.test', 'qs@ubec.test']
    );
    for (const person of NEEDS_PIPELINE_PEOPLE) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: person.email }, include: { role: true } });
      assert.equal(user.role.code, person.roleCode, person.email);
      assert.equal(user.role.surface, 'WEB', person.email);
      assert.equal(user.organizationId, person.organization === 'UBEC' ? ubec.id : kano.id, person.email);
      assert.equal(user.fullName, person.fullName);
      await web(person.email);
    }
  });

  it('each pipeline role holds exactly its plan section 8 grants', async () => {
    for (const person of NEEDS_PIPELINE_PEOPLE) {
      assert.deepEqual(await permissionsOf(person.email), [...NEEDS_PIPELINE_GRANTS[person.roleCode]].sort(), person.email);
    }
    assert.deepEqual(NEEDS_PIPELINE_GRANTS.PROCUREMENT_OFFICER, ['needs:view', 'needs:submit', 'needs:submit_portfolio', 'procurement:plan_lots', 'needs:score']);
    assert.deepEqual(NEEDS_PIPELINE_GRANTS.QUANTITY_SURVEYOR, ['needs:view', 'needs:cost', 'standards:manage']);
    assert.ok(NEEDS_PIPELINE_GRANTS.EXECUTIVE_SECRETARY.includes('needs:approve_portfolio') && NEEDS_PIPELINE_GRANTS.EXECUTIVE_SECRETARY.includes('needs:chair_committee'));
    assert.ok(!NEEDS_PIPELINE_GRANTS.EXECUTIVE_SECRETARY.includes('needs:record_funding'), 'the approver does not record the funding');
  });

  it('the existing roles got theirs: M&E validates, the SUBEB Administrator holds the Chairman grants, the administrator holds all', async () => {
    const me = await permissionsOf('me.officer@ubec.test');
    assert.ok(me.includes('needs:view') && me.includes('needs:validate'));
    assert.ok(me.includes('visits:review'), 'and keeps its M&E permissions');
    const lagosMe = await permissionsOf('lagos.me@ubec.test');
    assert.ok(!lagosMe.some((k) => k.startsWith('needs:')), 'the SUBEB M&E officer has no pipeline role');

    const kanoAdmin = await permissionsOf('kano.admin@ubec.test');
    for (const key of NEEDS_PIPELINE_GRANTS.ORGANIZATION_ADMIN) assert.ok(kanoAdmin.includes(key), key);
    assert.ok(kanoAdmin.includes('needs:score'), 'the Chairman scores too (16.2 O-2)');
    assert.deepEqual(NEEDS_PIPELINE_GRANTS.SUBEB_COMMITTEE_MEMBER, ['needs:view', 'needs:score']);
    assert.ok(!kanoAdmin.includes('needs:validate') && !kanoAdmin.includes('needs:cost') && !kanoAdmin.includes('needs:approve_beap'));
    assert.deepEqual(await permissionsOf('lagos.admin@ubec.test'), kanoAdmin, 'one role for every SUBEB Administrator');

    const admin = await permissionsOf(ADMIN);
    const newKeys = SYSTEM_PERMISSIONS_CATALOG.filter((p) => p.key.startsWith('needs:') || p.key === 'standards:manage' || p.key === 'procurement:plan_lots').map((p) => p.key);
    assert.equal(newKeys.length, 18);
    for (const key of newKeys) assert.ok(admin.includes(key), key);
    assert.equal(admin.length, SYSTEM_PERMISSIONS_CATALOG.length);
  });

  it('nobody else gained a pipeline permission', async () => {
    const holders = await prisma.role.findMany({
      where: { rolePermissions: { some: { permission: { key: { startsWith: 'needs:' } } } } },
      select: { code: true },
    });
    assert.deepEqual([...new Set(holders.map((r) => r.code))].sort(), ['TENANT_SUPER_ADMIN', ...Object.keys(NEEDS_PIPELINE_GRANTS)].sort());
  });
});

describe('Needs pipeline N1: type config', () => {
  it('both programme types carry their pipeline, and the type API returns it', async () => {
    const res = await request(app).get('/api/v1/project-types').set(await web(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const types = (res.body.data as unknown[]).map((t) => ProjectTypeDtoSchema.parse(t));
    const di = types.find((t) => t.code === 'CENTRAL')!.config.needsPipeline;
    const mg = types.find((t) => t.code === 'CO_FUNDED')!.config.needsPipeline;
    assert.deepEqual(di, NeedsPipelineConfigSchema.parse(DEFAULT_DI_NEEDS_PIPELINE));
    assert.equal(mg.enabled, true);
    assert.equal(mg.fundingGate, 'BEAP_APPROVAL');
    assert.equal(mg.cycleScope, 'STATE');
    assert.ok(!mg.stages.some((s) => s.stage === 'DESIGN'));
    // The earlier type rules are still there (the merge keeps every other key).
    const diType = types.find((t) => t.code === 'CENTRAL')!;
    assert.ok(diType.config.contractMilestones.length > 0);
    assert.ok(diType.config.monitoring.visitPlan.length > 0);
  });

  it("another tenant's types are unchanged: no pipeline", async () => {
    const others = await prisma.projectType.findMany({ where: { tenantId: { not: tenantId } } });
    for (const t of others) assert.equal(resolveProjectTypeConfig({ config: t.configJson })!.needsPipeline.enabled, false, t.code);
    // A project's snapshot from before the pipeline reads as disabled.
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-102'] } });
    assert.equal(resolveProjectTypeConfig(project.projectTypeSnapshotJson)!.needsPipeline.enabled, false);
  });
});

describe('Needs pipeline N1: tables', () => {
  it('starts empty: no cycle or proposed project is seeded yet; the programme tenant has costing standard v1 (wave 2)', async () => {
    assert.equal(await prisma.needsCycle.count(), 0);
    assert.equal(await prisma.needsProposal.count(), 0);
    const standards = await prisma.costingStandardVersion.findMany();
    assert.deepEqual(standards.map((v) => [v.tenantId, v.version, v.isLocked]), [[tenantId, 1, false]]);
  });

  it('a cycle holds everything under it, keeps its unique rules, and takes it all with it', async () => {
    const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } });
    const ubec = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Universal Basic Education Commission' } } });
    const by = async (email: string) => {
      const u = await prisma.user.findUniqueOrThrow({ where: { email } });
      return { id: u.id, name: u.fullName };
    };
    const dpp = await by('dpp@ubec.test');
    const procurement = await by('procurement@ubec.test');
    const me = await by('me.officer@ubec.test');
    const es = await by('es@ubec.test');
    const config = NeedsPipelineConfigSchema.parse(resolveProjectTypeConfig({ config: type.configJson })!.needsPipeline);

    const standard = await prisma.costingStandardVersion.create({
      data: { tenantId, version: 2, supervisionMonitoringPct: 3, contingencyPct: 5, savedByUserId: dpp.id, savedByName: dpp.name },
    });
    await assert.rejects(prisma.costingStandardVersion.create({ data: { tenantId, version: 2, savedByName: dpp.name } }), 'one row per tenant and version');

    const cycleData = {
      tenantId,
      projectTypeId: type.id,
      interventionYear: 2027,
      scopeKey: 'NATIONAL',
      owningOrganizationId: ubec.id,
      status: 'OPEN',
      configSnapshotJson: config,
      deadlinesJson: cycleDeadlines(config, 2027),
      templateVersion: NEEDS_TEMPLATE_VERSION,
      costingStandardVersionId: standard.id,
      indicativeCeilingNgn: 2_500_000_000,
      openedAt: new Date(),
      openedByUserId: dpp.id,
      openedByName: dpp.name,
    };
    const cycle = await prisma.needsCycle.create({ data: cycleData });
    await assert.rejects(prisma.needsCycle.create({ data: cycleData }), 'one national cycle per type and year');
    // A State cycle of the same type and year is another cycle.
    const kanoCycle = await prisma.needsCycle.create({ data: { ...cycleData, scopeKey: 'KN', stateCode: 'KN' } });

    const reference = formatProposalReference({ interventionYear: 2027, prefix: 'DI', stateCode: null, sequence: 1 });
    const proposalData = {
      tenantId,
      cycleId: cycle.id,
      reference,
      sequence: 1,
      title: 'Renovation of LEA Primary School, Garki',
      stage: 'VALIDATION',
      status: 'IN_PROGRESS',
      stateCode: 'FC',
      lgaCodes: ['FC-ABUJA-MUNICIPAL'],
      createdByUserId: procurement.id,
      createdByName: procurement.name,
    };
    const proposal = await prisma.needsProposal.create({ data: proposalData });
    await assert.rejects(prisma.needsProposal.create({ data: { ...proposalData, cycleId: kanoCycle.id } }), 'a reference is unique in the tenant');
    await assert.rejects(prisma.needsProposal.create({ data: { ...proposalData, reference: '2027-DI-002' } }), 'a sequence is unique in the cycle');

    const version = await prisma.needsAssessmentVersion.create({
      data: {
        proposalId: proposal.id,
        number: 1,
        source: 'UPLOAD',
        objectKey: 'needs/2027/2027-DI-001/v1.xlsx',
        fileName: '2027-DI-001 needs assessment.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 20480,
        sha256: 'a'.repeat(64),
        templateVersion: NEEDS_TEMPLATE_VERSION,
        costingStandardVersionId: standard.id,
        parsedJson: { templateVersion: NEEDS_TEMPLATE_VERSION, project: { title: proposalData.title } },
        siteCount: 1,
        breakdownRowCount: 1,
        uploadedByUserId: procurement.id,
        uploadedByName: procurement.name,
      },
    });
    await assert.rejects(prisma.needsAssessmentVersion.create({ data: { ...version, id: undefined, parsedJson: {} } }), 'version numbers are unique per proposal');
    await prisma.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: version.id } });

    await prisma.needsProposalSite.create({
      data: { proposalId: proposal.id, siteNumber: 1, schoolName: 'LEA Primary School, Garki', schoolNameKey: normaliseSchoolName('LEA Primary School, Garki'), schoolLevel: 'PRIMARY', lgaCode: 'FC-ABUJA-MUNICIPAL', latitude: 9.0335, longitude: 7.4892, enrolment: 640 },
    });
    const breakdownRow = {
      proposalId: proposal.id,
      siteNumber: 1,
      unitId: 'U01',
      facilityCode: 'CLASSROOM',
      interventionAction: 'RENOVATION',
      existingQuantity: 6,
      existingCondition: 'DILAPIDATED',
      requiredQuantity: 6,
      proposedQuantity: 6,
      unitOfMeasure: 'nr',
      technicalJustification: 'Roof and floors have failed.',
      criticality: 'HIGH',
    };
    await prisma.needsFacilityBreakdownRow.create({ data: breakdownRow });
    await assert.rejects(prisma.needsFacilityBreakdownRow.create({ data: breakdownRow }), 'a unit ID is unique per proposal');
    const drawing = await prisma.needsProposalDocument.create({
      data: { proposalId: proposal.id, kind: 'DRAWING', title: 'Standard classroom block', objectKey: 'needs/doc.pdf', fileName: 'drawing.pdf', mimeType: 'application/pdf', byteSize: 1024, sha256: 'b'.repeat(64), uploadedByUserId: procurement.id, uploadedByName: procurement.name },
    });
    const flag = await prisma.needsProposalFlag.create({
      data: { proposalId: proposal.id, kind: 'ESSENTIAL_FACILITY_GAP', detailsJson: { siteNumber: 1, groupLabel: 'Solar' }, raisedOnVersionId: version.id, raisedOnVersionNumber: 1 },
    });
    await prisma.needsValidationRecord.create({
      data: {
        proposalId: proposal.id,
        versionId: version.id,
        outcome: 'ADVANCE',
        deskNotes: 'Need confirmed against the school census.',
        siteVerificationJson: { method: 'WEB_EVIDENCE', verifiedOn: today, officerName: me.name, evidenceDocumentIds: [drawing.id] },
        duplicateResolutionsJson: [],
        recordedByUserId: me.id,
        recordedByName: me.name,
      },
    });
    await prisma.needsProposalFlag.update({ where: { id: flag.id }, data: { resolvedAt: new Date(), resolvedByUserId: me.id, resolvedByName: me.name, resolution: 'JUSTIFIED', resolutionReason: 'The school is on the grid.' } });

    const report = await prisma.needsCycleDocument.create({
      data: { cycleId: cycle.id, kind: 'VALIDATED_PROJECT_LIST', title: 'Validated Project List 2027', generated: true, objectKey: 'needs/list.pdf', fileName: 'list.pdf', mimeType: 'application/pdf', byteSize: 2048, sha256: 'c'.repeat(64), coveredProposalIds: [proposal.id], uploadedByUserId: me.id, uploadedByName: me.name },
    });
    const decision = await prisma.needsStageDecision.create({
      data: {
        cycleId: cycle.id,
        stage: 'VALIDATION',
        evidenceDocumentIds: [report.id],
        decidedByUserId: me.id,
        decidedByName: me.name,
        items: { create: [{ proposalId: proposal.id, outcome: 'ADVANCE', toStage: 'DESIGN', toStatus: 'IN_PROGRESS' }] },
      },
      include: { items: true },
    });
    assert.equal(decision.items.length, 1);

    const member = await prisma.needsCommitteeMember.create({ data: { cycleId: cycle.id, userId: es.id, role: 'CHAIR', conflictDeclaredAt: new Date(), conflictedProposalIds: [] } });
    await assert.rejects(prisma.needsCommitteeMember.create({ data: { cycleId: cycle.id, userId: es.id } }), 'a person is on a committee once');
    const sheet = { cycleId: cycle.id, proposalId: proposal.id, memberId: member.id, scoresJson: { severity_of_need: 5 } };
    await prisma.needsScoreSheet.create({ data: sheet });
    await assert.rejects(prisma.needsScoreSheet.create({ data: sheet }), 'one score sheet per member and proposal');

    const submission = await prisma.needsSubmission.create({
      data: {
        cycleId: cycle.id,
        kind: 'PORTFOLIO',
        status: 'IN_REVIEW',
        currentStepOrder: 1,
        submittedByUserId: procurement.id,
        submittedByName: procurement.name,
        submittedAt: new Date(),
        createdByUserId: procurement.id,
        createdByName: procurement.name,
        items: { create: [{ proposalId: proposal.id, included: true, amountNgn: 96_000_000 }] },
      },
    });
    const steps = [];
    for (const [i, s] of config.approvalChains.NEEDS_PORTFOLIO.entries()) {
      steps.push(
        await prisma.needsApprovalStep.create({
          data: { cycleId: cycle.id, chainType: 'NEEDS_PORTFOLIO', version: 1, stepOrder: i + 1, label: s.label, requiredPermissionKey: s.requiredPermissionKey, organizationScope: s.organizationScope },
        })
      );
    }
    assert.equal(steps.length, 2);
    await assert.rejects(
      prisma.needsApprovalStep.create({ data: { cycleId: cycle.id, chainType: 'NEEDS_PORTFOLIO', version: 1, stepOrder: 1, label: 'Again', requiredPermissionKey: 'needs:review_portfolio' } }),
      'a step order is unique in a chain version'
    );
    await prisma.needsApprovalAction.create({
      data: { cycleId: cycle.id, chainType: 'NEEDS_PORTFOLIO', subjectId: submission.id, stepId: steps[0].id, stepOrder: 1, decision: 'APPROVE', actorUserId: dpp.id, notes: 'Reviewed at the management meeting.' },
    });

    // Reading it back the way later waves will.
    const read = await prisma.needsProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { cycle: true, currentVersion: true, versions: true, sites: true, breakdownRows: true, documents: true, flags: true, validationRecords: true, scoreSheets: true, submissionItems: true, project: true },
    });
    assert.equal(read.currentVersion?.number, 1);
    assert.equal(read.sites[0].schoolNameKey, 'lea primary school garki');
    assert.equal(Number(read.breakdownRows[0].proposedQuantity), 6);
    assert.equal(read.project, null);
    assert.equal(read.cycle.scopeKey, 'NATIONAL');

    // A carried-forward proposal points at its source; the pointer clears when the source goes.
    const carried = await prisma.needsProposal.create({
      data: { ...proposalData, cycleId: kanoCycle.id, reference: '2028-DI-001', carriedFromId: proposal.id },
    });

    // A standard in use cannot be deleted (it is locked by reference).
    await assert.rejects(prisma.costingStandardVersion.delete({ where: { id: standard.id } }));

    // The action restricts its step, so a cycle with decisions is deleted children first (as the seed does).
    await prisma.needsApprovalAction.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.needsCycle.delete({ where: { id: cycle.id } });
    assert.equal(await prisma.needsProposal.count({ where: { id: proposal.id } }), 0);
    assert.equal(await prisma.needsAssessmentVersion.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.needsProposalSite.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.needsFacilityBreakdownRow.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.needsStageDecisionItem.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.needsScoreSheet.count({ where: { cycleId: cycle.id } }), 0);
    assert.equal(await prisma.needsSubmission.count({ where: { cycleId: cycle.id } }), 0);
    assert.equal(await prisma.needsApprovalStep.count({ where: { cycleId: cycle.id } }), 0);
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: carried.id } })).carriedFromId, null);
    await prisma.needsCycle.delete({ where: { id: kanoCycle.id } });
    await prisma.costingStandardVersion.delete({ where: { id: standard.id } });
  });

  it('Project.origin is empty on a new row, takes the four origins, and a project links to one proposed project', async () => {
    // Wave 4: the seed marks its projects LEGACY at the end; clear it to check the column has no default.
    await prisma.project.update({ where: { id: ids['PRG-101'] }, data: { origin: null } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids['PRG-101'] } });
    assert.equal(project.origin, null, 'no database default: the origin is set in code');
    assert.equal(project.needsProposalId, null);
    for (const origin of ['LEGACY', 'REGISTER_IMPORT', 'OUT_OF_CYCLE', 'NEEDS_PIPELINE'] as const) {
      assert.equal((await prisma.project.update({ where: { id: project.id }, data: { origin } })).origin, origin);
    }

    const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } });
    const ubec = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Universal Basic Education Commission' } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } });
    const cycle = await prisma.needsCycle.create({
      data: { tenantId, projectTypeId: type.id, interventionYear: 2029, scopeKey: 'NATIONAL', owningOrganizationId: ubec.id, configSnapshotJson: {}, templateVersion: NEEDS_TEMPLATE_VERSION },
    });
    const proposal = await prisma.needsProposal.create({
      data: { tenantId, cycleId: cycle.id, reference: '2029-DI-001', sequence: 1, title: 'Converted', stage: 'FUNDING', status: 'CONVERTED', createdByUserId: admin.id, createdByName: admin.fullName },
    });
    await prisma.project.update({ where: { id: project.id }, data: { needsProposalId: proposal.id } });
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { project: true } })).project?.id, project.id);
    await assert.rejects(prisma.project.update({ where: { id: ids['PRG-102'] }, data: { needsProposalId: proposal.id } }), 'one project per proposed project');

    // Deleting the proposal leaves the project, without the link.
    await prisma.needsCycle.delete({ where: { id: cycle.id } });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(after.needsProposalId, null);
    await prisma.project.update({ where: { id: project.id }, data: { origin: null } });
  });
});
