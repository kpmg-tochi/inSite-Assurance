/**
 * Needs pipeline wave 3, N7a (M1–M3): the conversion core. `needsToScopeImport` (pure) and
 * `convertProposalToProject` on proposals built directly in the database from the wave 2 fixtures
 * (parsed with the seeded context): counts and amounts carry over, the code is the proposal
 * reference unless a lot is given, a converted proposal is refused the second time, a file that
 * cannot be mapped is refused without writing anything. No gate calls it yet (wave 4).
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_TEMPLATE_VERSION, lineAmount, normaliseSchoolName, type ParsedNeedsAssessment } from '@insite/shared';
import type { Prisma } from '@prisma/client';
import { needsFixture, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { DI_CONFIG, MG_CONFIG, fixtureParseContext } from './fixtures/needs/needsFixtureContext';
import { parseNeedsWorkbook } from '../modules/needs/workbook/needsWorkbook';
import { needsToScopeImport } from '../modules/needs/conversion/needsToScopeImport';
import type { WebJwtPayload } from '../middleware/auth.middleware';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type Convert = typeof import('../modules/needs/conversion/convertProposal')['convertProposalToProject'];

let prisma: PrismaClientType;
let convertProposalToProject: Convert;
let tenantId = '';
const ids: Record<string, string> = {};

async function parsed(name: NeedsFixtureName, programme: 'DI' | 'MG' = 'DI'): Promise<ParsedNeedsAssessment> {
  const stage = name === 'di-design-valid' ? 'DESIGN' : 'IDENTIFICATION';
  const result = await parseNeedsWorkbook(needsFixture(name), fixtureParseContext(programme, stage));
  assert.ok(result.parsed, `${name}: ${JSON.stringify(result.issues)}`);
  return result.parsed;
}

async function webUser(email: string): Promise<WebJwtPayload> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
  return {
    tokenType: 'WEB_USER',
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId!,
    isPlatformSuperAdmin: false,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    permissions: u.role.rolePermissions.map((rp) => rp.permission.key),
    organizationId: u.organizationId!,
    mustChangePassword: false,
  };
}

/** A cycle and one proposal at Funding whose current version is the parsed fixture. */
async function proposalAtFunding(p: { programme: 'DI' | 'MG'; year: number; reference: string; parsed: ParsedNeedsAssessment; stateCode: string; by: WebJwtPayload }) {
  const scopeKey = p.programme === 'MG' ? p.stateCode : 'NATIONAL';
  const owner = p.programme === 'MG' ? ids.kanoSubeb : ids.ubecHq;
  const cycle =
    (await prisma.needsCycle.findFirst({ where: { tenantId, projectTypeId: ids[p.programme], interventionYear: p.year, scopeKey } })) ??
    (await prisma.needsCycle.create({
      data: {
        tenantId,
        projectTypeId: ids[p.programme],
        interventionYear: p.year,
        stateCode: p.programme === 'MG' ? p.stateCode : null,
        scopeKey,
        owningOrganizationId: owner,
        status: 'OPEN',
        configSnapshotJson: (p.programme === 'MG' ? MG_CONFIG : DI_CONFIG) as unknown as Prisma.InputJsonValue,
        templateVersion: NEEDS_TEMPLATE_VERSION,
        openedAt: new Date(),
      },
    }));
  const sequence = Number(p.reference.slice(p.reference.lastIndexOf('-') + 1));
  const proposal = await prisma.needsProposal.create({
    data: {
      tenantId,
      cycleId: cycle.id,
      reference: p.reference,
      sequence,
      title: p.parsed.project.title ?? p.reference,
      stage: 'FUNDING',
      status: 'IN_PROGRESS',
      stateCode: p.stateCode,
      lgaCodes: [...new Set(p.parsed.sites.map((s) => s.lgaCode))],
      createdByUserId: p.by.userId,
      createdByName: p.by.fullName,
    },
  });
  const version = await prisma.needsAssessmentVersion.create({
    data: {
      proposalId: proposal.id,
      number: 1,
      source: 'UPLOAD',
      objectKey: `tenants/${tenantId}/needs/cycles/${cycle.id}/versions/${p.reference}.xlsx`,
      fileName: `${p.reference}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: 1000,
      sha256: p.reference.padEnd(64, '0').slice(0, 64),
      templateVersion: p.parsed.templateVersion,
      parsedJson: p.parsed as unknown as Prisma.InputJsonValue,
      siteCount: p.parsed.sites.length,
      breakdownRowCount: p.parsed.breakdownRows.length,
      boqLineCount: p.parsed.boqLines.length,
      uploadedByUserId: p.by.userId,
      uploadedByName: p.by.fullName,
    },
  });
  await prisma.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: version.id } });
  await prisma.needsProposalSite.createMany({
    data: p.parsed.sites.map((s) => ({ proposalId: proposal.id, siteNumber: s.siteNumber, schoolName: s.schoolName, schoolNameKey: normaliseSchoolName(s.schoolName), schoolLevel: s.schoolLevel, lgaCode: s.lgaCode })),
  });
  return proposal;
}

const convert = (proposalId: string, options: Omit<Parameters<Convert>[2], 'by'> & { by: WebJwtPayload }) =>
  prisma.$transaction((tx) => convertProposalToProject(tx, { id: proposalId }, options));

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ convertProposalToProject } = await import('../modules/needs/conversion/convertProposal'));
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.DI = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.MG = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  ids.ubecHq = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Universal Basic Education Commission' } } })).id;
  ids.kanoSubeb = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Kano State Universal Basic Education Board' } } })).id;
});

describe('Needs pipeline N7a: needsToScopeImport (pure)', () => {
  it('sites, a unit per proposed breakdown row (proposed 0 = no unit) and every BoQ line on its unit, amounts recomputed', async () => {
    const p = await parsed('di-design-valid');
    const plan = needsToScopeImport(p, new Map([['CLASSROOM', 'Classroom']]));
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.sites.length, p.sites.length);
    const proposedRows = p.breakdownRows.filter((r) => r.proposedQuantity > 0);
    assert.ok(proposedRows.length < p.breakdownRows.length, 'the fixture records existing facilities without work');
    assert.deepEqual(plan.units.map((u) => u.code), proposedRows.map((r) => r.unitId));
    for (const u of plan.units) {
      const row = proposedRows.find((r) => r.unitId === u.code)!;
      assert.equal(u.siteNumber, row.siteNumber);
      assert.equal(u.plannedQuantity, row.proposedQuantity);
      assert.equal(u.quantityUnit, row.unitOfMeasure);
    }
    assert.match(plan.units[0].label, /^Classroom, renovation \(site 1\)$/);
    assert.equal(plan.lines.length, p.boqLines.length);
    const expected = Math.round(p.boqLines.reduce((s, l) => s + lineAmount(l.totalQuantity, l.rateNgn), 0) * 100) / 100;
    assert.equal(plan.totals.amountNgn, expected);
    assert.ok(plan.totals.amountNgn > 0);
  });

  it('an identification draft without BoQ lines maps sites and units only', async () => {
    const plan = needsToScopeImport(await parsed('di-draft-valid'));
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.lines.length, 0);
    assert.ok(plan.units.length > 0);
  });

  it('a file it cannot map gives issues: no breakdown, a line on an unknown unit, a row on an unknown site', async () => {
    const v1 = await parsed('v1-scope-workbook');
    const plan = needsToScopeImport(v1);
    assert.deepEqual([...new Set(plan.issues.map((i) => i.code))].sort(), ['LINE_UNIT_UNKNOWN', 'NO_UNITS']);
    const p = await parsed('di-design-valid');
    const broken = needsToScopeImport({ ...p, breakdownRows: p.breakdownRows.map((r, i) => (i === 0 ? { ...r, siteNumber: 9 } : r)) });
    assert.ok(broken.issues.some((i) => i.code === 'UNIT_SITE_UNKNOWN'));
    assert.ok(broken.issues.some((i) => i.code === 'LINE_UNIT_UNKNOWN'), 'its lines lose their unit');
  });
});

describe('Needs pipeline N7a: convertProposalToProject', () => {
  it('a Direct Intervention proposal becomes a draft: code = reference, type applied, sites, units, BoQ lines and budget = funded amount, origin and links, ledger on both sides', async () => {
    const finance = await webUser('finance@ubec.test');
    const p = await parsed('di-design-valid');
    const proposal = await proposalAtFunding({ programme: 'DI', year: 2027, reference: '2027-DI-001', parsed: p, stateCode: 'NI', by: await webUser('procurement@ubec.test') });
    const result = await convert(proposal.id, { fundedAmountNgn: 61_250_000, by: finance });

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: result.projectId },
      include: { sites: true, facilityUnits: { include: { facility: true, site: true } }, boqItems: true, beneficiaries: true },
    });
    assert.equal(project.status, 'DRAFT');
    assert.equal(project.codePrefix, '2027-DI-001');
    assert.equal(project.origin, 'NEEDS_PIPELINE');
    assert.equal(project.needsProposalId, proposal.id);
    assert.equal(project.projectTypeId, ids.DI);
    assert.equal(project.interventionYear, 2027);
    assert.equal(project.stateCode, 'NI');
    assert.equal(Number(project.totalBudgetNgn), 61_250_000);
    assert.equal(project.name, p.project.title);
    assert.equal(project.strategicJustification, p.project.justification);
    assert.ok(project.owningOrganizationId, 'the owner is derived when the type is applied');

    assert.deepEqual(project.sites.map((s) => [s.siteNumber, s.schoolName, s.lgaCode]).sort(), p.sites.map((s) => [s.siteNumber, s.schoolName, s.lgaCode]).sort());
    const proposedRows = p.breakdownRows.filter((r) => r.proposedQuantity > 0);
    assert.equal(project.facilityUnits.length, proposedRows.length);
    for (const row of proposedRows) {
      const unit = project.facilityUnits.find((u) => u.code === row.unitId)!;
      assert.ok(unit, row.unitId);
      assert.equal(unit.facility.code, row.facilityCode);
      assert.equal(unit.site?.siteNumber, row.siteNumber);
      assert.equal(Number(unit.plannedQuantity), row.proposedQuantity);
    }
    assert.equal(project.boqItems.length, p.boqLines.length);
    const total = Math.round(project.boqItems.reduce((s, l) => s + Number(l.budgetedCostNgn), 0) * 100) / 100;
    assert.equal(total, needsToScopeImport(p).totals.amountNgn);
    for (const line of p.boqLines) {
      const item = project.boqItems.find((b) => b.wbsCode === line.wbsCode)!;
      assert.equal(project.facilityUnits.find((u) => u.id === item.facilityUnitId)!.code, line.unitId);
    }
    assert.equal(project.beneficiaries.find((b) => b.isPrimary)?.name, p.sites[0].schoolName);
    assert.deepEqual(result, { projectId: project.id, codePrefix: '2027-DI-001', siteCount: p.sites.length, unitCount: proposedRows.length, lineCount: p.boqLines.length });

    const after = await prisma.needsProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { project: true } });
    assert.equal(after.status, 'CONVERTED');
    assert.equal(Number(after.fundedAmountNgn), 61_250_000);
    assert.equal(after.project?.id, project.id);

    const projectLedger = await prisma.auditLog.findFirstOrThrow({ where: { projectId: project.id, action: 'PROJECT_CREATED_FROM_PROPOSAL' } });
    assert.equal((projectLedger.payload as { proposalId: string }).proposalId, proposal.id);
    assert.equal((projectLedger.payload as { reference: string }).reference, '2027-DI-001');
    const tenantLedger = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, projectId: null, action: 'NEEDS_PROPOSAL_CONVERTED' } });
    assert.equal((tenantLedger.payload as { projectId: string }).projectId, project.id);
  });

  it('converting the same proposal again is refused (409 NEEDS_PROPOSAL_ALREADY_CONVERTED) and creates nothing', async () => {
    const proposal = await prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference: '2027-DI-001' } });
    const before = await prisma.project.count({ where: { tenantId } });
    await assert.rejects(convert(proposal.id, { fundedAmountNgn: 1_000_000, by: await webUser('finance@ubec.test') }), (e: { statusCode?: number; code?: string }) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.code, 'NEEDS_PROPOSAL_ALREADY_CONVERTED');
      return true;
    });
    assert.equal(await prisma.project.count({ where: { tenantId } }), before);
  });

  it('a Matching Grants proposal with a lot gets the lot/batch code and the State SUBEB as owner', async () => {
    const proposal = await proposalAtFunding({ programme: 'MG', year: 2027, reference: '2027-MG-KN-001', parsed: await parsed('mg-complete-valid', 'MG'), stateCode: 'KN', by: await webUser('kano.procurement@ubec.test') });
    const result = await convert(proposal.id, { fundedAmountNgn: 40_000_000, lot: { newLotTitle: 'Kano Matching Grants 2027, lot A' }, by: await webUser('es@ubec.test') });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId }, include: { lot: true } });
    assert.match(project.codePrefix, /^2027-LOT-\d+-BATCH-1$/);
    assert.equal(project.lot?.title, 'Kano Matching Grants 2027, lot A');
    assert.equal(project.projectTypeId, ids.MG);
    assert.equal(project.owningOrganizationId, ids.kanoSubeb);
    assert.equal(project.origin, 'NEEDS_PIPELINE');
  });

  it("the year comes from the cycle, outside the new-draft window; a draft without BoQ lines converts with units only", async () => {
    const proposal = await proposalAtFunding({ programme: 'DI', year: 2029, reference: '2029-DI-001', parsed: await parsed('di-draft-valid'), stateCode: 'NI', by: await webUser('procurement@ubec.test') });
    const result = await convert(proposal.id, { fundedAmountNgn: 50_000_000, by: await webUser('finance@ubec.test') });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
    assert.equal(project.interventionYear, 2029);
    assert.equal(result.lineCount, 0);
    assert.ok(result.unitCount > 0);
  });

  it('a proposal whose file cannot be mapped is refused (422 NEEDS_CONVERSION_INVALID) and nothing is written', async () => {
    const proposal = await proposalAtFunding({ programme: 'DI', year: 2027, reference: '2027-DI-002', parsed: await parsed('v1-scope-workbook'), stateCode: 'NI', by: await webUser('procurement@ubec.test') });
    const before = await prisma.project.count({ where: { tenantId } });
    await assert.rejects(convert(proposal.id, { fundedAmountNgn: 10_000_000, by: await webUser('finance@ubec.test') }), (e: { statusCode?: number; code?: string; details?: { issues?: string[] } }) => {
      assert.equal(e.statusCode, 422);
      assert.equal(e.code, 'NEEDS_CONVERSION_INVALID');
      assert.ok((e.details?.issues ?? []).length > 0);
      return true;
    });
    assert.equal(await prisma.project.count({ where: { tenantId } }), before);
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, 'IN_PROGRESS');
  });
});
