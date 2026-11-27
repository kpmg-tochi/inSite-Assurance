/**
 * Needs pipeline wave 4, Track B (N7b–c): funding, BEAP and the activation gate.
 *
 * - B1: the Funding tab and the DI budget submission (acknowledgement document, gate, permission).
 * - B2: the appropriated schedule (template, preview outcomes, refusals, SAME_PERSON_FUNDING, an
 *   existing list, confirm: conversions, the approved list with linked rows, out-of-cycle link, not
 *   funded proposals, once per cycle).
 * - B3: the DI procurement plan (lots and batches on converted drafts, plan document).
 * - B4: the State's BEAP (build, submit, UBEC review per item, organisation rule, return, BEAP
 *   revision, resubmit, approval: conversions with lots, owner Kano SUBEB, MG_BEAP list).
 * - B5: the activation gate (PROJECT_ORIGIN_REQUIRED, COUNTERPART_EVIDENCE_REQUIRED).
 * - Scenario steps DI-11, DI-12, MG-07 … MG-10 (`helpers/needsScenarioSteps.n7.ts`) on their own
 *   starting states (2028 cycles built in the database the way Track A's steps leave them).
 *
 * Starting states are written directly in the database (proposals at FUNDING with approved amounts,
 * an approved portfolio acted on by dpp@ and es@), from the wave 2 fixtures.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  AppropriationPreviewDtoSchema,
  AppropriationResultDtoSchema,
  NeedsFundingDtoSchema,
  NeedsProcurementPlanDtoSchema,
  NeedsSubmissionDtoSchema,
  type ParsedNeedsAssessment,
} from '@insite/shared';
import { needsFixture, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { fixtureParseContext } from './fixtures/needs/needsFixtureContext';
import { buildFixtureFile } from './fixtures/needs/generateNeedsFixtures';
import { FIXTURE_SPECS } from './fixtures/needs/needsFixtureSpecs';
import { parseNeedsWorkbook } from '../modules/needs/workbook/needsWorkbook';
import type { NeedsScenarioContext } from './helpers/needsScenarioSteps.n5';
import { call, download, fileCycleDocument, ok, refused, stepDI11, stepDI12, stepMG07, stepMG08, stepMG09, stepMG10 } from './helpers/needsScenarioSteps.n7';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let tenantId = '';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const N = '/api/v1/needs';
const P = '/api/v1/projects';

const FINANCE = 'finance@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const DPP = 'dpp@ubec.test';
const ES = 'es@ubec.test';
const ADMIN = 'admin@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';
const KANO_PROCUREMENT = 'kano.procurement@ubec.test';
const KANO_ADMIN = 'kano.admin@ubec.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const ctx = (): NeedsScenarioContext => ({ app, prisma: prisma as never, web, ids, tenantId });
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

async function parsedFixture(name: NeedsFixtureName, programme: 'DI' | 'MG'): Promise<ParsedNeedsAssessment> {
  const stage = name === 'di-design-valid' ? 'DESIGN' : 'IDENTIFICATION';
  const result = await parseNeedsWorkbook(needsFixture(name), fixtureParseContext(programme, stage));
  assert.ok(result.parsed, `${name}: ${JSON.stringify(result.issues)}`);
  return result.parsed;
}

/** A proposal written directly at a stage (default: FUNDING, IN_PROGRESS) with its current version and tables. */
async function seedProposal(p: {
  cycleId: string;
  reference: string;
  fixture: NeedsFixtureName;
  programme: 'DI' | 'MG';
  approvedAmountNgn?: number | null;
  stage?: string;
  status?: string;
  route?: 'ANNUAL' | 'OUT_OF_CYCLE';
  by: string;
}) {
  const parsed = await parsedFixture(p.fixture, p.programme);
  const by = await prisma.user.findUniqueOrThrow({ where: { email: p.by } });
  const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: p.cycleId } });
  const costed = parsed.costingSummary?.totalNgn ?? null;
  const amounts = { preliminaryCostNgn: parsed.costingSummary?.subtotalNgn ?? null, costedTotalNgn: costed };
  const sequence = Number(p.reference.slice(p.reference.lastIndexOf('-') + 1));
  const { replaceCurrentTables } = await import('../modules/needs/needsVersions');
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.needsProposal.create({
      data: {
        tenantId,
        cycleId: p.cycleId,
        reference: p.reference,
        sequence,
        title: `${parsed.project.title ?? p.reference} (${p.reference})`,
        route: p.route ?? 'ANNUAL',
        stage: p.stage ?? 'FUNDING',
        status: p.status ?? 'IN_PROGRESS',
        stateCode: parsed.project.stateCode ?? null,
        lgaCodes: [...new Set(parsed.sites.map((s) => s.lgaCode))],
        preliminaryAmountNgn: amounts.preliminaryCostNgn,
        costedAmountNgn: amounts.costedTotalNgn,
        approvedAmountNgn: p.approvedAmountNgn === undefined ? amounts.costedTotalNgn : p.approvedAmountNgn,
        createdByUserId: by.id,
        createdByName: by.fullName,
      },
    });
    const version = await tx.needsAssessmentVersion.create({
      data: {
        proposalId: proposal.id,
        number: 1,
        source: 'COSTING',
        objectKey: `tenants/${tenantId}/needs/cycles/${p.cycleId}/versions/${p.reference}.xlsx`,
        fileName: `${p.reference}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 1000,
        sha256: sha(Buffer.from(`${p.reference}-${crypto.randomUUID()}`)),
        templateVersion: parsed.templateVersion,
        costingStandardVersionId: cycle.costingStandardVersionId,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        siteCount: parsed.sites.length,
        breakdownRowCount: parsed.breakdownRows.length,
        boqLineCount: parsed.boqLines.length,
        preliminaryCostNgn: amounts.preliminaryCostNgn,
        costedTotalNgn: amounts.costedTotalNgn,
        uploadedByUserId: by.id,
        uploadedByName: by.fullName,
      },
    });
    await tx.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: version.id } });
    await replaceCurrentTables(tx, proposal.id, parsed);
    await tx.needsCycle.update({ where: { id: p.cycleId }, data: { proposalSequence: { set: Math.max(cycle.proposalSequence, sequence) } } });
    return proposal;
  });
}

/** An APPROVED portfolio submission of the cycle with its steps approved by `approvers` (in step order). */
async function approvedPortfolio(cycleId: string, proposalIds: string[], approvers: string[]) {
  const steps = await prisma.needsApprovalStep.findMany({ where: { cycleId, chainType: 'NEEDS_PORTFOLIO' }, orderBy: { stepOrder: 'asc' } });
  const procurement = await prisma.user.findUniqueOrThrow({ where: { email: PROCUREMENT } });
  const sub = await prisma.needsSubmission.create({
    data: {
      cycleId,
      kind: 'PORTFOLIO',
      status: 'APPROVED',
      chainVersion: 1,
      currentStepOrder: null,
      submittedByUserId: procurement.id,
      submittedByName: procurement.fullName,
      submittedAt: new Date(),
      decidedAt: new Date(),
      createdByUserId: procurement.id,
      createdByName: procurement.fullName,
      items: { create: proposalIds.map((proposalId, i) => ({ proposalId, included: true, sortOrder: i })) },
    },
  });
  for (const [i, email] of approvers.entries()) {
    await prisma.needsApprovalAction.create({
      data: { cycleId, chainType: 'NEEDS_PORTFOLIO', subjectId: sub.id, stepId: steps[i].id, stepOrder: steps[i].stepOrder, decision: 'APPROVE', actorUserId: await userId(email) },
    });
  }
  return sub;
}

/** Grants a permission to a role for the duration of `fn` (the auth context is cached: cleared around it). */
async function withGrant(roleCode: string, key: string, fn: () => Promise<void>) {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId, code: roleCode } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
  const { clearAuthCache } = await import('../middleware/auth.middleware');
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  clearAuthCache();
  try {
    await fn();
  } finally {
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
    clearAuthCache();
  }
}

/** A cycle of `year` copied from an API-opened one (config snapshot, costing standard, chain steps). */
async function copyCycle(fromId: string, year: number) {
  const from = await prisma.needsCycle.findUniqueOrThrow({ where: { id: fromId } });
  const steps = await prisma.needsApprovalStep.findMany({ where: { cycleId: fromId } });
  const cycle = await prisma.needsCycle.create({
    data: {
      tenantId,
      projectTypeId: from.projectTypeId,
      interventionYear: year,
      stateCode: from.stateCode,
      scopeKey: from.scopeKey,
      owningOrganizationId: from.owningOrganizationId,
      status: 'OPEN',
      configSnapshotJson: from.configSnapshotJson as Prisma.InputJsonValue,
      deadlinesJson: from.deadlinesJson as Prisma.InputJsonValue,
      templateVersion: from.templateVersion,
      costingStandardVersionId: from.costingStandardVersionId,
      openedAt: new Date(),
      createdByUserId: from.createdByUserId,
    },
  });
  await prisma.needsApprovalStep.createMany({
    data: steps.map((s) => ({
      cycleId: cycle.id,
      chainType: s.chainType,
      version: s.version,
      stepOrder: s.stepOrder,
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      organizationScope: s.organizationScope,
      isActive: s.isActive,
    })),
  });
  return cycle.id;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  ids.kanoSubeb = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Kano State Universal Basic Education Board' } } })).id;
  const di = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2027 });
  assert.equal(di.status, 201, JSON.stringify(di.body));
  ids.diCycle2027 = di.body.data.id;
  const mg = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' });
  assert.equal(mg.status, 201, JSON.stringify(mg.body));
  ids.mgCycle2027 = mg.body.data.id;

  // DI 2027: three approved proposals at Funding (approved by dpp@ and es@), and one still at Approval.
  const p1 = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-001', fixture: 'di-design-valid', programme: 'DI', by: PROCUREMENT });
  const p2 = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-002', fixture: 'di-design-valid', programme: 'DI', approvedAmountNgn: 50_000_000, by: PROCUREMENT });
  const p3 = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-003', fixture: 'di-design-valid', programme: 'DI', approvedAmountNgn: 20_000_000, by: PROCUREMENT });
  const p4 = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-004', fixture: 'di-design-valid', programme: 'DI', stage: 'APPROVAL', approvedAmountNgn: null, by: PROCUREMENT });
  Object.assign(ids, { di1: p1.id, di2: p2.id, di3: p3.id, di4: p4.id });
  await approvedPortfolio(ids.diCycle2027, [p1.id, p2.id, p3.id], [DPP, ES]);

  // MG 2027 (Kano): three approved proposals at Funding.
  for (const n of [1, 2, 3]) {
    const p = await seedProposal({ cycleId: ids.mgCycle2027, reference: `2027-MG-KN-00${n}`, fixture: 'mg-complete-valid', programme: 'MG', by: KANO_PROCUREMENT });
    ids[`mg${n}`] = p.id;
  }
});

// ---------------------------------------------------------------------------
// B1
// ---------------------------------------------------------------------------

describe('Needs pipeline N7 B1: Funding tab and budget submission (DI)', () => {
  it('GET funding: the gate, the proposals at Funding at their approved amounts, finance@ may record', async () => {
    const dto = NeedsFundingDtoSchema.parse(await ok(ctx(), FINANCE, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
    assert.equal(dto.fundingGate, 'APPROPRIATION');
    assert.deepEqual(dto.awaiting.map((a) => a.reference), ['2027-DI-001', '2027-DI-002', '2027-DI-003']);
    assert.equal(dto.awaiting[1].amountNgn, 50_000_000);
    assert.equal(dto.canRecord, true);
    assert.equal(dto.cannotConfirmReason, null);
    assert.deepEqual(dto.records, []);
    // Read-only for others; an MG cycle reads its BEAP gate.
    const other = NeedsFundingDtoSchema.parse(await ok(ctx(), DPP, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
    assert.equal(other.canRecord, false);
    assert.ok(other.cannotConfirmReason);
    const mg = NeedsFundingDtoSchema.parse(await ok(ctx(), KANO_DPP, 'get', `${N}/cycles/${ids.mgCycle2027}/funding`));
    assert.equal(mg.fundingGate, 'BEAP_APPROVAL');
    assert.equal(mg.awaiting.length, 3);
  });

  it('records the budget submission with its acknowledgement; refusals: permission, document kind and cycle, the MG gate', async () => {
    const base = `${N}/cycles/${ids.diCycle2027}/funding/documents`;
    await refused(ctx(), DPP, 'post', `${N}/cycles/${ids.diCycle2027}/funding/budget-submission`, { submittedOn: '2026-12-12', amountNgn: 1 }, 403, 'FORBIDDEN_PERMISSION');
    // Only the two funding kinds are filed here.
    const pdf = Buffer.from('%PDF-1.4\n% other\n%%EOF\n');
    const presign = await ok(ctx(), FINANCE, 'post', `${base}/presign`, { fileName: 'other.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    await refused(ctx(), FINANCE, 'post', base, { objectKey: presign.objectKey, kind: 'OTHER', title: 'Other' }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    const schedule = await fileCycleDocument(ctx(), FINANCE, base, 'APPROPRIATED_SCHEDULE', 'Signed appropriation act extract');
    await refused(
      ctx(),
      FINANCE,
      'post',
      `${N}/cycles/${ids.diCycle2027}/funding/budget-submission`,
      { submittedOn: '2026-12-12', amountNgn: 100_000_000, acknowledgementDocumentId: schedule },
      422,
      'NEEDS_DOCUMENT_KIND_MISMATCH'
    );
    const ack = await fileCycleDocument(ctx(), FINANCE, base, 'BUDGET_SUBMISSION_ACKNOWLEDGEMENT', 'Ministry acknowledgement');
    const record = await ok(
      ctx(),
      FINANCE,
      'post',
      `${N}/cycles/${ids.diCycle2027}/funding/budget-submission`,
      { submittedOn: '2026-12-12', amountNgn: 150_000_000, acknowledgementDocumentId: ack, note: 'Submitted with the 2027 budget proposal.' },
      201
    );
    assert.deepEqual([record.kind, record.recordedOn, record.amountNgn, record.documentId], ['BUDGET_SUBMISSION', '2026-12-12', 150_000_000, ack]);
    const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'NEEDS_FUNDING_RECORDED', payload: { path: ['fundingRecordId'], equals: record.id } } });
    assert.ok(entry, 'ledger NEEDS_FUNDING_RECORDED');
    const dto = NeedsFundingDtoSchema.parse(await ok(ctx(), FINANCE, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
    assert.equal(dto.records.length, 1);

    // The MG cycle funds through the BEAP (a Kano user who could record).
    await withGrant('SUBEB_DIRECTOR_PHYSICAL_PLANNING', 'needs:record_funding', async () => {
      await refused(ctx(), KANO_DPP, 'post', `${N}/cycles/${ids.mgCycle2027}/funding/budget-submission`, { submittedOn: '2026-12-12', amountNgn: 1 }, 409, 'NEEDS_FUNDING_GATE_MISMATCH');
    });
    // A SUBEB does not see the national cycle (404), let alone write it.
    await withGrant('SUBEB_DIRECTOR_PHYSICAL_PLANNING', 'needs:record_funding', async () => {
      await refused(ctx(), KANO_DPP, 'post', `${N}/cycles/${ids.diCycle2027}/funding/budget-submission`, { submittedOn: '2026-12-12', amountNgn: 1 }, 404, 'NEEDS_CYCLE_NOT_FOUND');
    });
    // UBEC HQ sees the Kano cycle but does not own it (403).
    await refused(ctx(), FINANCE, 'post', `${N}/cycles/${ids.mgCycle2027}/funding/budget-submission`, { submittedOn: '2026-12-12', amountNgn: 1 }, 403, 'NEEDS_CYCLE_FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// B2
// ---------------------------------------------------------------------------

async function appropriationFile(rows: Array<{ ref: string; amount: number }>, header: { year?: number; kind?: 'DI_SCHEDULE' | 'MG_BEAP' } = {}) {
  const { buildAppropriationWorkbook } = await import('../modules/needs/funding/appropriationWorkbook');
  const buffer = await buildAppropriationWorkbook({
    generatedAt: new Date(),
    brandName: 'UBEC',
    interventionYear: header.year ?? 2027,
    rows: rows.map((r) => ({ reference: r.ref, title: `Funded ${r.ref}`, schoolNames: ['A school'], stateName: 'Niger', lgaNames: ['Bosso'], facilityScope: 'Classroom ×2', approvedAmountNgn: r.amount })),
  });
  if (header.kind === 'MG_BEAP') return rebuildWithKind(buffer);
  return buffer;
}

/** A copy of the file whose List sheet says "Matching Grants BEAP" (and Kano), for the kind check. */
async function rebuildWithKind(buffer: Buffer): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('List')!;
  ws.eachRow((row) => {
    const label = String(row.getCell(1).value ?? '');
    if (/^list$/i.test(label.trim())) row.getCell(2).value = 'Matching Grants: Approved BEAP';
    if (/^state$/i.test(label.trim())) row.getCell(2).value = 'Kano';
  });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const preview = async (email: string, cycleId: string, buffer: Buffer) =>
  call(ctx(), email, 'post', `${N}/cycles/${cycleId}/funding/appropriation/preview`, { fileName: 'Appropriated schedule.xlsx', fileBase64: buffer.toString('base64') });
const confirm = async (email: string, cycleId: string, buffer: Buffer, overrides: Record<string, unknown> = {}) =>
  call(ctx(), email, 'post', `${N}/cycles/${cycleId}/funding/appropriation/confirm`, {
    fileName: 'Appropriated schedule.xlsx',
    fileBase64: buffer.toString('base64'),
    sha256: sha(buffer),
    appropriatedOn: '2027-01-20',
    ...overrides,
  });

describe('Needs pipeline N7 B2: appropriated schedule (DI)', () => {
  it('template: the approved-list workbook with "Proposal reference", pre-filled with the proposals at Funding', async () => {
    const file = await download(ctx(), FINANCE, `${N}/cycles/${ids.diCycle2027}/funding/appropriation/template`);
    const { parseAppropriationWorkbook } = await import('../modules/needs/funding/appropriationWorkbook');
    const parsed = await parseAppropriationWorkbook(file);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.header.interventionYear, 2027);
    assert.equal(parsed.header.kind, 'DI_SCHEDULE');
    assert.deepEqual(parsed.rows.map((r) => r.proposalRef), ['2027-DI-001', '2027-DI-002', '2027-DI-003']);
    assert.equal(parsed.rows[1].costEstimateNgn, 50_000_000);
    assert.equal(parsed.rows[0].stateCode, 'NI');
    assert.ok(parsed.rows[0].schoolNames.length > 0);
    await refused(ctx(), DPP, 'get', `${N}/cycles/${ids.diCycle2027}/funding/appropriation/template`, undefined, 403, 'FORBIDDEN_PERMISSION');
  });

  it('out-of-cycle: an approved request of the programme is converted already (fixture for the next tests)', async () => {
    const ooc = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-050', fixture: 'di-design-valid', programme: 'DI', stage: 'APPROVAL', route: 'OUT_OF_CYCLE', approvedAmountNgn: 30_000_000, by: PROCUREMENT });
    const pending = await seedProposal({ cycleId: ids.diCycle2027, reference: '2027-DI-051', fixture: 'di-design-valid', programme: 'DI', stage: 'APPROVAL', route: 'OUT_OF_CYCLE', approvedAmountNgn: 10_000_000, by: PROCUREMENT });
    ids.ooc = ooc.id;
    ids.oocPending = pending.id;
    const { convertProposalToProject } = await import('../modules/needs/conversion/convertProposal');
    const es = await prisma.user.findUniqueOrThrow({ where: { email: ES }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
    const by = {
      tokenType: 'WEB_USER' as const,
      userId: es.id,
      email: es.email,
      fullName: es.fullName,
      tenantId,
      isPlatformSuperAdmin: false,
      roleId: es.roleId,
      roleCode: es.role.code,
      roleName: es.role.name,
      permissions: es.role.rolePermissions.map((rp) => rp.permission.key),
      organizationId: es.organizationId!,
      mustChangePassword: false,
    };
    const made = await prisma.$transaction((tx) => convertProposalToProject(tx, { id: ooc.id }, { fundedAmountNgn: 30_000_000, by, origin: 'OUT_OF_CYCLE' }));
    ids.oocProject = made.projectId;
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: made.projectId } })).origin, 'OUT_OF_CYCLE');
  });

  it('preview: matched, partly funded, out-of-cycle, not funded; nothing written', async () => {
    const file = await appropriationFile([
      { ref: '2027-DI-001', amount: Number((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di1 } })).approvedAmountNgn) },
      { ref: '2027-DI-002', amount: 45_000_000 },
      { ref: '2027-DI-050', amount: 40_000_000 },
    ]);
    const res = await preview(FINANCE, ids.diCycle2027, file);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = AppropriationPreviewDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.rows.map((r) => [r.proposalReference, r.outcome]), [
      ['2027-DI-001', 'MATCHED'],
      ['2027-DI-002', 'PARTLY_FUNDED'],
      ['2027-DI-050', 'OUT_OF_CYCLE'],
    ]);
    assert.equal(dto.rows[1].approvedAmountNgn, 50_000_000);
    assert.equal(dto.rows[1].fundedAmountNgn, 45_000_000);
    assert.deepEqual(dto.notFunded.map((n) => n.reference), ['2027-DI-003']);
    assert.equal(dto.totals.notFunded, 1);
    assert.equal(dto.canConfirm, true, JSON.stringify(dto.issues));
    assert.equal(dto.sha256, sha(file));
    assert.equal(await prisma.approvedList.count({ where: { tenantId, interventionYear: 2027, kind: 'DI_SCHEDULE' } }), 0);
    assert.equal(await prisma.needsFundingRecord.count({ where: { cycleId: ids.diCycle2027, kind: 'APPROPRIATION' } }), 0);
  });

  it('refused rows: unknown, not at Funding, above the approved amount, listed twice, unapproved out-of-cycle, another cycle; file issues; confirm 422', async () => {
    const file = await appropriationFile([
      { ref: '2027-DI-001', amount: 1_000_000_000 },
      { ref: '2027-DI-999', amount: 1_000_000 },
      { ref: '2027-DI-004', amount: 1_000_000 },
      { ref: '2027-DI-002', amount: 45_000_000 },
      { ref: '2027-DI-002', amount: 45_000_000 },
      { ref: '2027-DI-051', amount: 1_000_000 },
      { ref: '2027-MG-KN-001', amount: 1_000_000 },
    ]);
    const dto = AppropriationPreviewDtoSchema.parse((await preview(FINANCE, ids.diCycle2027, file)).body.data);
    const codes = dto.rows.map((r) => [r.proposalReference, r.outcome, r.issues.map((i) => i.code).join(',')]);
    assert.deepEqual(codes, [
      ['2027-DI-001', 'REFUSED', 'ABOVE_APPROVED_AMOUNT'],
      ['2027-DI-999', 'REFUSED', 'PROPOSAL_NOT_FOUND'],
      ['2027-DI-004', 'REFUSED', 'PROPOSAL_NOT_AT_FUNDING'],
      ['2027-DI-002', 'PARTLY_FUNDED', ''],
      ['2027-DI-002', 'REFUSED', 'DUPLICATE_ROW_REF,PROPOSAL_LISTED_TWICE'],
      ['2027-DI-051', 'REFUSED', 'OUT_OF_CYCLE_NOT_APPROVED'],
      ['2027-MG-KN-001', 'REFUSED', 'PROPOSAL_OTHER_CYCLE'],
    ]);
    assert.equal(dto.canConfirm, false);
    const res = await confirm(FINANCE, ids.diCycle2027, file);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_APPROPRIATION_INVALID');
    assert.ok((res.body.error.details.issues as unknown[]).length >= 6);

    // File issues: another year, a BEAP file.
    const wrongYear = AppropriationPreviewDtoSchema.parse((await preview(FINANCE, ids.diCycle2027, await appropriationFile([{ ref: '2027-DI-002', amount: 1 }], { year: 2026 }))).body.data);
    assert.ok(wrongYear.issues.some((i) => i.code === 'NEEDS_APPROPRIATION_YEAR'), JSON.stringify(wrongYear.issues));
    const beapFile = AppropriationPreviewDtoSchema.parse((await preview(FINANCE, ids.diCycle2027, await appropriationFile([{ ref: '2027-DI-002', amount: 1 }], { kind: 'MG_BEAP' }))).body.data);
    assert.ok(beapFile.issues.some((i) => i.code === 'NEEDS_APPROPRIATION_KIND'), JSON.stringify(beapFile.issues));
    // An approved-list file (no "Proposal reference") is refused.
    const { buildApprovedListWorkbook } = await import('../modules/approvedLists/approvedListWorkbook');
    const plain = await buildApprovedListWorkbook({ generatedAt: new Date(), brandName: 'UBEC', header: { interventionYear: 2027, kind: 'DI_SCHEDULE' }, rows: [{ rowRef: '1', projectTitle: 'x', state: 'Niger', costEstimate: 1 }] });
    const plainDto = AppropriationPreviewDtoSchema.parse((await preview(FINANCE, ids.diCycle2027, plain)).body.data);
    assert.ok(plainDto.issues.some((i) => i.code === 'WORKBOOK_COLUMN_MISSING'), JSON.stringify(plainDto.issues));
    assert.equal(plainDto.canConfirm, false);
  });

  it('confirm refusals: another file (409 NEEDS_FILE_CHANGED), permission, the MG cycle, a list for the year exists, SAME_PERSON_FUNDING', async () => {
    const file = await appropriationFile([{ ref: '2027-DI-002', amount: 45_000_000 }]);
    let res = await confirm(FINANCE, ids.diCycle2027, file, { sha256: 'a'.repeat(64) });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_FILE_CHANGED');
    res = await confirm(DPP, ids.diCycle2027, file);
    assert.equal(res.status, 403);
    await withGrant('SUBEB_DIRECTOR_PHYSICAL_PLANNING', 'needs:record_funding', async () => {
      res = await confirm(KANO_DPP, ids.mgCycle2027, file);
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'NEEDS_FUNDING_GATE_MISMATCH');
    });

    // A DI list for 2027 entered by hand blocks the funding gate.
    const manual = await prisma.approvedList.create({ data: { tenantId, interventionYear: 2027, kind: 'DI_SCHEDULE', title: 'Manual 2027 schedule', approvedBy: 'UBEC Board', approvedOn: '2026-12-01' } });
    try {
      res = await confirm(FINANCE, ids.diCycle2027, file);
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'NEEDS_APPROVED_LIST_EXISTS');
      const dto = NeedsFundingDtoSchema.parse(await ok(ctx(), FINANCE, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
      assert.match(dto.cannotConfirmReason ?? '', /Manual 2027 schedule/);
    } finally {
      await prisma.approvedList.delete({ where: { id: manual.id } });
    }

    // es@ approved the portfolio: with the funding permission, still not the confirmer.
    await withGrant('EXECUTIVE_SECRETARY', 'needs:record_funding', async () => {
      const dto = NeedsFundingDtoSchema.parse(await ok(ctx(), ES, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
      assert.equal(dto.canRecord, true);
      assert.match(dto.cannotConfirmReason ?? '', /approved this portfolio/);
      const pre = AppropriationPreviewDtoSchema.parse((await preview(ES, ids.diCycle2027, file)).body.data);
      assert.ok(pre.issues.some((i) => i.code === 'SAME_PERSON_FUNDING'));
      res = await confirm(ES, ids.diCycle2027, file);
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'SAME_PERSON_FUNDING');
    });
    assert.equal(await prisma.needsFundingRecord.count({ where: { cycleId: ids.diCycle2027, kind: 'APPROPRIATION' } }), 0);
  });

  it('confirm: conversions with the funded amounts, the DI_SCHEDULE list with linked rows (budget mismatch computed), the out-of-cycle link, not funded carried forward; once per cycle', async () => {
    const approved1 = Number((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di1 } })).approvedAmountNgn);
    const file = await appropriationFile([
      { ref: '2027-DI-001', amount: approved1 },
      { ref: '2027-DI-002', amount: 45_000_000 },
      { ref: '2027-DI-050', amount: 40_000_000 },
    ]);
    const res = await confirm(FINANCE, ids.diCycle2027, file);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const result = AppropriationResultDtoSchema.parse(res.body.data);
    assert.deepEqual(result.converted.map((c) => [c.reference, c.projectCode, c.fundedAmountNgn]), [
      ['2027-DI-001', '2027-DI-001', approved1],
      ['2027-DI-002', '2027-DI-002', 45_000_000],
    ]);
    assert.deepEqual(result.notSelected.map((n) => n.reference), ['2027-DI-003']);
    ids.di1Project = result.converted[0].projectId;
    ids.di2Project = result.converted[1].projectId;

    // Projects: origin, budget, link to their row; the out-of-cycle project linked too.
    for (const c of result.converted) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: c.projectId }, include: { approvedListRow: true } });
      assert.equal(project.origin, 'NEEDS_PIPELINE');
      assert.equal(project.status, 'DRAFT');
      assert.equal(Number(project.totalBudgetNgn), c.fundedAmountNgn);
      assert.equal(project.approvedListRow?.listId, result.approvedListId);
      const link = await ok(ctx(), ADMIN, 'get', `${P}/${c.projectId}/approved-list-row`);
      assert.equal(link.mismatch.flagged, false);
    }
    const oocLink = await ok(ctx(), ADMIN, 'get', `${P}/${ids.oocProject}/approved-list-row`);
    assert.equal(oocLink.rowRef, '2027-DI-050');
    assert.equal(oocLink.costEstimateNgn, 40_000_000);
    assert.equal(oocLink.mismatch.flagged, true, 'budget NGN 30m vs NGN 40m on the schedule');
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.ooc } })).status, 'CONVERTED', 'nothing converts again');

    const list = await prisma.approvedList.findUniqueOrThrow({ where: { id: result.approvedListId }, include: { rows: { orderBy: { sortOrder: 'asc' } } } });
    assert.deepEqual([list.kind, list.interventionYear, list.stateCode, list.title, list.approvedOn], ['DI_SCHEDULE', 2027, null, '2027 Appropriated schedule', '2027-01-20']);
    assert.equal(list.sourceSha256, sha(file));
    assert.ok(list.documentId);
    assert.deepEqual(list.rows.map((r) => [r.rowRef, Number(r.costEstimateNgn)]), [
      ['2027-DI-001', approved1],
      ['2027-DI-002', 45_000_000],
      ['2027-DI-050', 40_000_000],
    ]);
    const overview = await ok(ctx(), ADMIN, 'get', `/api/v1/approved-lists/rows?interventionYear=2027`);
    assert.ok(JSON.stringify(overview).includes('2027 Appropriated schedule'));

    // Proposals and the stage decision.
    const p3 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di3 } });
    assert.deepEqual([p3.stage, p3.status, p3.statusReason], ['FUNDING', 'NOT_SELECTED', 'Not funded at appropriation']);
    assert.equal((await ok(ctx(), FINANCE, 'get', `${N}/proposals/${ids.di3}`)).statusLabel, 'Not funded, carried forward');
    const decision = await prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId: ids.diCycle2027, stage: 'FUNDING' }, include: { items: true } });
    assert.deepEqual(decision.items.map((i) => i.toStatus).sort(), ['CONVERTED', 'CONVERTED', 'NOT_SELECTED']);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_STAGE_DECIDED', payload: { path: ['decisionId'], equals: decision.id } } }), 3);
    const doc = await prisma.needsCycleDocument.findUniqueOrThrow({ where: { id: list.documentId! } });
    assert.equal(doc.kind, 'APPROPRIATED_SCHEDULE');
    assert.deepEqual([...doc.coveredProposalIds].sort(), [ids.di1, ids.di2].sort());
    assert.equal(doc.sha256, sha(file));
    assert.deepEqual(decision.evidenceDocumentIds, [doc.id]);

    // Funding record and ledger.
    const record = result.fundingRecord;
    assert.deepEqual([record.kind, record.recordedOn, record.approvedListId, record.documentId], ['APPROPRIATION', '2027-01-20', result.approvedListId, doc.id]);
    assert.equal(record.amountNgn, approved1 + 45_000_000);
    assert.equal(record.summary.matched, 1);
    const imported = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'APPROVED_LIST_IMPORTED', payload: { path: ['listId'], equals: result.approvedListId } } });
    assert.equal((imported.payload as { source: string }).source, 'NEEDS_FUNDING');
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.di1Project, action: 'PROJECT_CREATED_FROM_PROPOSAL' } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.oocProject, action: 'APPROVED_LIST_ROW_LINKED' } }));

    // Once per cycle.
    const again = await confirm(FINANCE, ids.diCycle2027, file);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'NEEDS_FUNDING_ALREADY_IMPORTED');
    const dto = NeedsFundingDtoSchema.parse(await ok(ctx(), FINANCE, 'get', `${N}/cycles/${ids.diCycle2027}/funding`));
    assert.deepEqual(dto.awaiting, []);
    assert.deepEqual(dto.converted.map((c) => c.reference), ['2027-DI-001', '2027-DI-002', '2027-DI-050']);
    assert.match(dto.cannotConfirmReason ?? '', /already imported/);
  });
});

// ---------------------------------------------------------------------------
// B3
// ---------------------------------------------------------------------------

describe('Needs pipeline N7 B3: procurement plan (DI)', () => {
  it('procurement@ assigns lots and batches to the converted drafts (one new lot shared by two items); refusals', async () => {
    const base = `${N}/cycles/${ids.diCycle2027}/procurement-plan`;
    const plan = NeedsProcurementPlanDtoSchema.parse(await ok(ctx(), PROCUREMENT, 'get', base));
    assert.equal(plan.canPlan, true);
    assert.deepEqual(plan.rows.map((r) => [r.reference, r.projectCode, r.lotId]), [
      ['2027-DI-001', '2027-DI-001', null],
      ['2027-DI-002', '2027-DI-002', null],
      ['2027-DI-050', '2027-DI-050', null],
    ]);
    assert.equal(NeedsProcurementPlanDtoSchema.parse(await ok(ctx(), FINANCE, 'get', base)).canPlan, false);

    const title = 'Renovation of classrooms, North Central';
    const body = { items: [ids.di1Project, ids.di2Project].map((projectId) => ({ projectId, lotChoice: { newLotTitle: title } })) };
    await refused(ctx(), FINANCE, 'post', `${base}/lots`, body, 403, 'FORBIDDEN_PERMISSION');
    const seeded = await prisma.project.findFirstOrThrow({ where: { tenantId, codePrefix: 'PRG-102' } });
    await refused(ctx(), PROCUREMENT, 'post', `${base}/lots`, { items: [{ projectId: seeded.id, lotChoice: { newLotTitle: title } }] }, 404, 'NEEDS_PROJECT_NOT_IN_CYCLE');

    const after = NeedsProcurementPlanDtoSchema.parse(await ok(ctx(), PROCUREMENT, 'post', `${base}/lots`, body));
    const [r1, r2] = after.rows;
    assert.equal(r1.lotId, r2.lotId, 'one lot');
    assert.deepEqual([r1.batchNumber, r2.batchNumber], [1, 2]);
    assert.equal(r1.lotTitle, title);
    assert.equal(r1.projectCode, `LOT ${r1.lotNumber} BATCH 1`);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.di2Project } })).codePrefix, `2027-LOT-${r1.lotNumber}-BATCH-2`);
    assert.ok(after.lots.some((l) => l.id === r1.lotId && l.batchCount === 2));
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.di1Project, action: 'NEEDS_LOTS_ASSIGNED' } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { tenantId, projectId: null, action: 'NEEDS_LOTS_ASSIGNED' } }));

    // A draft keeps its lot; an existing lot gives the next batch.
    await refused(ctx(), PROCUREMENT, 'post', `${base}/lots`, { items: [{ projectId: ids.di1Project, lotChoice: { lotId: r1.lotId! } }] }, 409, 'NEEDS_LOT_ALREADY_ASSIGNED');
    const third = NeedsProcurementPlanDtoSchema.parse(await ok(ctx(), PROCUREMENT, 'post', `${base}/lots`, { items: [{ projectId: ids.oocProject, lotChoice: { lotId: r1.lotId! } }] }));
    assert.equal(third.rows.find((r) => r.projectId === ids.oocProject)?.batchNumber, 3);
    // Only drafts.
    await prisma.project.update({ where: { id: ids.oocProject }, data: { lotId: null, batchNumber: null, status: 'ACTIVE' } });
    try {
      await refused(ctx(), PROCUREMENT, 'post', `${base}/lots`, { items: [{ projectId: ids.oocProject, lotChoice: { lotId: r1.lotId! } }] }, 409, 'NEEDS_PROJECT_NOT_DRAFT');
    } finally {
      await prisma.project.update({ where: { id: ids.oocProject }, data: { status: 'DRAFT' } });
    }
  });

  it('the approved plan is filed as a cycle document (PROCUREMENT_PLAN only)', async () => {
    const base = `${N}/cycles/${ids.diCycle2027}/procurement-plan/documents`;
    const id = await fileCycleDocument(ctx(), PROCUREMENT, base, 'PROCUREMENT_PLAN', 'Approved procurement plan 2027');
    const plan = NeedsProcurementPlanDtoSchema.parse(await ok(ctx(), PROCUREMENT, 'get', `${N}/cycles/${ids.diCycle2027}/procurement-plan`));
    assert.deepEqual(plan.planDocuments.map((d) => d.id), [id]);
    const pdf = Buffer.from('%PDF-1.4\n% x\n%%EOF\n');
    const presign = await ok(ctx(), PROCUREMENT, 'post', `${base}/presign`, { fileName: 'x.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    await refused(ctx(), PROCUREMENT, 'post', base, { objectKey: presign.objectKey, kind: 'BEAP', title: 'Not a plan' }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// B4
// ---------------------------------------------------------------------------

const BEAP = () => `${N}/cycles/${ids.mgCycle2027}/beap`;
const beapItems = (overrides: Record<string, Record<string, unknown>> = {}) =>
  [1, 2, 3].map((n) => ({
    proposalId: ids[`mg${n}`],
    included: n !== 3,
    exclusionReason: n === 3 ? 'The site is not secured for 2027.' : null,
    lotTitle: n === 3 ? null : 'Kano 2027 classrooms',
    procurementMethod: n === 3 ? null : 'OPEN_COMPETITIVE_BIDDING',
    plannedStartDate: n === 3 ? null : '2027-02-01',
    plannedEndDate: n === 3 ? null : '2027-09-30',
    ...(overrides[`mg${n}`] ?? {}),
  }));

describe('Needs pipeline N7 B4: the BEAP (MG, Kano)', () => {
  it('build: no BEAP yet; permission, proposals at Funding only, document kinds; the draft', async () => {
    assert.equal(await ok(ctx(), KANO_DPP, 'get', BEAP()), null);
    await refused(ctx(), KANO_PROCUREMENT, 'put', BEAP(), { items: beapItems() }, 403, 'FORBIDDEN_PERMISSION');
    const p4 = await seedProposal({ cycleId: ids.mgCycle2027, reference: '2027-MG-KN-004', fixture: 'mg-complete-valid', programme: 'MG', stage: 'APPROVAL', by: KANO_PROCUREMENT });
    await refused(ctx(), KANO_DPP, 'put', BEAP(), { items: [...beapItems(), { proposalId: p4.id, included: true }] }, 409, 'NEEDS_PROPOSAL_NOT_AT_FUNDING');
    // The BEAP routes are the MG gate's.
    await withGrant('PROCUREMENT_OFFICER', 'needs:prepare_beap', async () => {
      await refused(ctx(), PROCUREMENT, 'put', `${N}/cycles/${ids.diCycle2027}/beap`, { items: [{ proposalId: ids.di3, included: true }] }, 409, 'NEEDS_FUNDING_GATE_MISMATCH');
    });
    const otherDoc = await fileCycleDocument(ctx(), KANO_DPP, `${N}/cycles/${ids.mgCycle2027}/documents`, 'OTHER', 'Not a narrative');
    await refused(ctx(), KANO_DPP, 'put', BEAP(), { items: beapItems(), narrativeDocumentId: otherDoc }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');

    const draft = NeedsSubmissionDtoSchema.parse(await ok(ctx(), KANO_DPP, 'put', BEAP(), { items: beapItems({ mg2: { procurementMethod: null } }), counterpartDeclaredNgn: 30_000_000 }));
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.chainType, 'BEAP');
    assert.deepEqual(draft.steps.map((s) => s.label), ['UBEC Physical Planning review', 'UBEC Executive Management approval']);
    assert.equal(draft.includedCount, 2);
    assert.equal(draft.items[0].amountNgn, Number((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.mg1 } })).approvedAmountNgn));
    assert.equal(draft.counterpartDeclaredNgn, 30_000_000);
    assert.ok(await prisma.auditLog.findFirst({ where: { tenantId, action: 'NEEDS_SUBMISSION_CREATED', payload: { path: ['submissionId'], equals: draft.id } } }));
    ids.beap = draft.id;
  });

  it('submit: incomplete (422 with every problem), a State list of the year exists (409), then IN_REVIEW', async () => {
    const error = await refused(ctx(), KANO_DPP, 'post', `${BEAP()}/submit`, {}, 422, 'NEEDS_BEAP_INCOMPLETE');
    const fields = (error.details.problems as Array<{ field: string; reference: string | null }>).map((p) => `${p.reference ?? '-'} ${p.field}`).sort();
    assert.deepEqual(fields, ['- narrativeDocumentId', '2027-MG-KN-002 procurementMethod']);

    const narrativeId = await fileCycleDocument(ctx(), KANO_DPP, `${BEAP()}/documents`, 'BEAP', 'Kano BEAP 2027 narrative');
    ids.narrative = narrativeId;
    await ok(ctx(), KANO_DPP, 'put', BEAP(), { items: beapItems(), narrativeDocumentId: narrativeId, counterpartDeclaredNgn: 30_000_000 });
    const manual = await prisma.approvedList.create({ data: { tenantId, interventionYear: 2027, kind: 'MG_BEAP', stateCode: 'KN', title: 'Manual BEAP', approvedBy: 'x', approvedOn: '2026-12-01' } });
    try {
      await refused(ctx(), KANO_DPP, 'post', `${BEAP()}/submit`, {}, 409, 'NEEDS_APPROVED_LIST_EXISTS');
    } finally {
      await prisma.approvedList.delete({ where: { id: manual.id } });
    }
    const submitted = NeedsSubmissionDtoSchema.parse(await ok(ctx(), KANO_DPP, 'post', `${BEAP()}/submit`, {}));
    assert.equal(submitted.status, 'IN_REVIEW');
    assert.equal(submitted.narrativeDocumentId, narrativeId);
    assert.equal(submitted.currentStepOrder, 1);
    await refused(ctx(), KANO_DPP, 'put', BEAP(), { items: beapItems() }, 409, 'NEEDS_SUBMISSION_NOT_EDITABLE');
  });

  it('UBEC review: dpp@ sees and acts; es@ is not the step approver; a SUBEB user is not UBEC (403 NOT_STEP_ORGANIZATION); per-item review', async () => {
    const dto = NeedsSubmissionDtoSchema.parse(await ok(ctx(), DPP, 'get', BEAP()));
    assert.equal(dto.canAct, true);
    await refused(ctx(), ES, 'post', `${BEAP()}/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_APPROVER');
    await withGrant('ORGANIZATION_ADMIN', 'needs:review_beap', async () => {
      await refused(ctx(), KANO_ADMIN, 'post', `${BEAP()}/review-items`, { items: [{ proposalId: ids.mg1, outcome: 'ACCEPTED' }] }, 403, 'NOT_STEP_ORGANIZATION');
      await refused(ctx(), KANO_ADMIN, 'post', `${BEAP()}/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_ORGANIZATION');
    });
    await refused(ctx(), DPP, 'post', `${BEAP()}/review-items`, { items: [{ proposalId: ids.di1, outcome: 'ACCEPTED' }] }, 404, 'NEEDS_PROPOSAL_NOT_FOUND');
    const reviewed = NeedsSubmissionDtoSchema.parse(
      await ok(ctx(), DPP, 'post', `${BEAP()}/review-items`, {
        items: [
          { proposalId: ids.mg1, outcome: 'ACCEPTED' },
          { proposalId: ids.mg2, outcome: 'COMMENTED', comment: 'The boards are priced above the market: revise the BoQ.' },
        ],
      })
    );
    assert.deepEqual(reviewed.items.map((i) => i.reviewOutcome), ['ACCEPTED', 'COMMENTED', null]);
    assert.ok(await prisma.auditLog.findFirst({ where: { tenantId, action: 'NEEDS_SUBMISSION_UPDATED', payload: { path: ['submissionId'], equals: ids.beap } } }));
    // A BEAP is not changed at approval.
    await refused(ctx(), DPP, 'post', `${BEAP()}/actions`, { decision: 'APPROVE', exclusions: [{ proposalId: ids.mg1, reason: 'Remove it please' }] }, 422, 'NEEDS_BEAP_EXCLUSIONS_NOT_ALLOWED');
  });

  it('revision: refused while in review; returned, the SUBEB uploads a BEAP_REVISION version (no stage reopens; amounts follow) and resubmits', async () => {
    const spec = structuredClone(FIXTURE_SPECS.find((s) => s.name === 'mg-complete-valid')!);
    spec.lines = spec.lines.map((l) => (l.itemCode === 'BRD-MAG' ? { ...l, rate: Math.round(l.rate * 0.9) } : l));
    const file = await buildFixtureFile(spec);
    const files = [{ fileName: 'MG-KN-002 BEAP revision.xlsx', fileBase64: file.toString('base64'), proposalId: ids.mg2 }];
    const inReview = await ok(ctx(), KANO_DPP, 'post', `${N}/cycles/${ids.mgCycle2027}/uploads/preview`, { files });
    assert.equal(inReview.files[0].status, 'INVALID');
    assert.match(JSON.stringify(inReview.files[0].issues), /with UBEC for review/);

    const returned = NeedsSubmissionDtoSchema.parse(await ok(ctx(), DPP, 'post', `${BEAP()}/actions`, { decision: 'RETURN', notes: 'Revise the BoQ of 2027-MG-KN-002.' }));
    assert.equal(returned.status, 'RETURNED');
    // Not the BEAP preparer: kano.procurement@ cannot upload a revision.
    const notPreparer = await ok(ctx(), KANO_PROCUREMENT, 'post', `${N}/cycles/${ids.mgCycle2027}/uploads/preview`, { files });
    assert.equal(notPreparer.files[0].status, 'INVALID');

    const before = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.mg2 } });
    const pre = await ok(ctx(), KANO_DPP, 'post', `${N}/cycles/${ids.mgCycle2027}/uploads/preview`, { files });
    assert.equal(pre.files[0].status, 'VALID', JSON.stringify(pre.files[0].issues));
    await ok(ctx(), KANO_DPP, 'post', `${N}/cycles/${ids.mgCycle2027}/uploads/confirm`, { files: files.map((f) => ({ ...f, sha256: sha(file) })) }, 201);
    const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.mg2 }, include: { currentVersion: true } });
    assert.deepEqual([p.stage, p.status, p.currentVersion!.source, p.currentVersion!.number], ['FUNDING', 'IN_PROGRESS', 'BEAP_REVISION', 2]);
    assert.ok(Number(p.currentVersion!.costedTotalNgn) < Number(before.costedAmountNgn), 'cheaper boards');
    assert.equal(Number(p.costedAmountNgn), Number(p.currentVersion!.costedTotalNgn));
    assert.equal(Number(p.approvedAmountNgn), Number(before.approvedAmountNgn), 'the State approval stays');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_VERSION_ADDED', payload: { path: ['proposalId'], equals: ids.mg2 } }, orderBy: { seq: 'desc' } });
    assert.equal((entry.payload as { source: string; reopenedStage?: string }).source, 'BEAP_REVISION');
    assert.equal((entry.payload as { reopenedStage?: string }).reopenedStage, undefined);

    const resubmitted = NeedsSubmissionDtoSchema.parse(await ok(ctx(), KANO_DPP, 'post', `${BEAP()}/submit`, {}));
    assert.equal(resubmitted.status, 'IN_REVIEW');
    const item = resubmitted.items.find((i) => i.proposalId === ids.mg2)!;
    assert.equal(item.amountNgn, Number(p.currentVersion!.costedTotalNgn));
    assert.equal(item.reviewOutcome, 'COMMENTED');
    assert.equal(item.currentVersionNumber, 2);
  });

  it('approval: dpp@ then es@ (Executive Management); dpp@ cannot take the second step; conversions with lot and batch, owner Kano SUBEB, the MG_BEAP list', async () => {
    const advanced = NeedsSubmissionDtoSchema.parse(await ok(ctx(), DPP, 'post', `${BEAP()}/actions`, { decision: 'APPROVE' }));
    assert.equal(advanced.currentStepOrder, 2);
    await refused(ctx(), DPP, 'post', `${BEAP()}/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_APPROVER');
    const approved = NeedsSubmissionDtoSchema.parse(await ok(ctx(), ES, 'post', `${BEAP()}/actions`, { decision: 'APPROVE', notes: 'Approved.' }));
    assert.equal(approved.status, 'APPROVED');
    const [i1, i2, i3] = approved.items;
    assert.equal(i1.lotNumber, i2.lotNumber);
    assert.deepEqual([i1.batchNumber, i2.batchNumber], [1, 2]);
    assert.equal(i3.projectId, null);
    for (const item of [i1, i2]) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: item.projectId! }, include: { approvedListRow: { include: { list: true } }, lot: true } });
      assert.equal(project.origin, 'NEEDS_PIPELINE');
      assert.equal(project.owningOrganizationId, ids.kanoSubeb);
      assert.equal(project.codePrefix, `2027-LOT-${item.lotNumber}-BATCH-${item.batchNumber}`);
      assert.equal(project.lot?.title, 'Kano 2027 classrooms');
      assert.equal(Number(project.totalBudgetNgn), item.amountNgn);
      assert.deepEqual([project.approvedListRow?.list.kind, project.approvedListRow?.list.stateCode, project.approvedListRow?.rowRef], ['MG_BEAP', 'KN', item.reference]);
      const link = await ok(ctx(), ADMIN, 'get', `${P}/${project.id}/approved-list-row`);
      assert.equal(link.mismatch.flagged, false);
    }
    ids.mgProject = i1.projectId!;
    const p3 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.mg3 } });
    assert.equal(p3.status, 'NOT_SELECTED');
    assert.match(p3.statusReason ?? '', /Excluded from the BEAP: The site is not secured/);
    const list = await prisma.approvedList.findFirstOrThrow({ where: { tenantId, kind: 'MG_BEAP', interventionYear: 2027, stateCode: 'KN' }, include: { rows: true } });
    assert.equal(list.title, 'Approved BEAP 2027: Kano State');
    assert.equal(list.documentId, ids.narrative);
    assert.equal(list.rows.length, 2);
    const decision = await prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId: ids.mgCycle2027, stage: 'FUNDING' }, include: { items: true } });
    assert.deepEqual(decision.items.map((i) => i.toStatus).sort(), ['CONVERTED', 'CONVERTED', 'NOT_SELECTED']);
    // Nothing changes after approval except the counterpart.
    await refused(ctx(), KANO_DPP, 'put', BEAP(), { items: beapItems() }, 409, 'NEEDS_SUBMISSION_NOT_EDITABLE');
  });
});

// ---------------------------------------------------------------------------
// B5
// ---------------------------------------------------------------------------

describe('Needs pipeline N7 B5: the activation gate', () => {
  it('a DI draft without an origin: 409 PROJECT_ORIGIN_REQUIRED; a converted draft passes the gate (setup checks follow)', async () => {
    const created = await ok(ctx(), ADMIN, 'post', P, { name: 'Manual draft', codePrefix: 'NOO-201', stateLocation: 'Kano', totalBudgetNgn: 10_000_000, projectTypeId: ids.di }, 201);
    await refused(ctx(), ADMIN, 'post', `${P}/${created.projectId}/activate`, {}, 409, 'PROJECT_ORIGIN_REQUIRED');
    await refused(ctx(), ADMIN, 'post', `${P}/${ids.di1Project}/activate`, {}, 422, 'PROJECT_INCOMPLETE');
  });

  it('MG: refused until the counterpart evidence is recorded (any status, the right document kind), then the setup checks follow', async () => {
    await refused(ctx(), ADMIN, 'post', `${P}/${ids.mgProject}/activate`, {}, 409, 'COUNTERPART_EVIDENCE_REQUIRED');
    const wrong = await fileCycleDocument(ctx(), KANO_DPP, `${BEAP()}/documents`, 'BEAP', 'Not the evidence');
    await refused(ctx(), KANO_DPP, 'put', `${BEAP()}/counterpart`, { counterpartDeclaredNgn: 30_000_000, counterpartEvidenceDocumentId: wrong }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    await refused(ctx(), DPP, 'put', `${BEAP()}/counterpart`, { counterpartDeclaredNgn: 30_000_000, counterpartEvidenceDocumentId: wrong }, 403, 'FORBIDDEN_PERMISSION');
    const evidence = await fileCycleDocument(ctx(), KANO_DPP, `${BEAP()}/documents`, 'COUNTERPART_EVIDENCE', 'Kano counterpart: bank confirmation');
    const recorded = NeedsSubmissionDtoSchema.parse(await ok(ctx(), KANO_DPP, 'put', `${BEAP()}/counterpart`, { counterpartDeclaredNgn: 32_000_000, counterpartEvidenceDocumentId: evidence }));
    assert.deepEqual([recorded.status, recorded.counterpartDeclaredNgn, recorded.counterpartEvidenceDocumentId], ['APPROVED', 32_000_000, evidence]);
    assert.ok(recorded.counterpartRecordedAt);
    assert.ok(await prisma.auditLog.findFirst({ where: { tenantId, action: 'NEEDS_COUNTERPART_RECORDED', payload: { path: ['submissionId'], equals: ids.beap } } }));
    await refused(ctx(), ADMIN, 'post', `${P}/${ids.mgProject}/activate`, {}, 422, 'PROJECT_INCOMPLETE');
  });

  it('a cycle whose config does not require the evidence does not gate on it', async () => {
    const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: ids.mgCycle2027 } });
    const config = cycle.configSnapshotJson as Record<string, unknown>;
    await prisma.needsSubmission.update({ where: { id: ids.beap }, data: { counterpartEvidenceDocumentId: null } });
    await prisma.needsCycle.update({ where: { id: cycle.id }, data: { configSnapshotJson: { ...config, requireCounterpartEvidenceBeforeActivation: false } as Prisma.InputJsonValue } });
    try {
      await refused(ctx(), ADMIN, 'post', `${P}/${ids.mgProject}/activate`, {}, 422, 'PROJECT_INCOMPLETE');
    } finally {
      await prisma.needsCycle.update({ where: { id: cycle.id }, data: { configSnapshotJson: config as Prisma.InputJsonValue } });
    }
    await refused(ctx(), ADMIN, 'post', `${P}/${ids.mgProject}/activate`, {}, 409, 'COUNTERPART_EVIDENCE_REQUIRED');
  });

  it('an out-of-cycle project has no BEAP to carry the evidence: not gated on it', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.mgProject }, select: { needsProposalId: true } });
    await prisma.needsProposal.update({ where: { id: project.needsProposalId! }, data: { route: 'OUT_OF_CYCLE' } });
    try {
      await refused(ctx(), ADMIN, 'post', `${P}/${ids.mgProject}/activate`, {}, 422, 'PROJECT_INCOMPLETE');
    } finally {
      await prisma.needsProposal.update({ where: { id: project.needsProposalId! }, data: { route: 'ANNUAL' } });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario steps on their own starting states (2028 cycles, as Track A's DI-10 and MG-06 leave them)
// ---------------------------------------------------------------------------

describe('Needs pipeline N7: scenario steps DI-11, DI-12, MG-07 … MG-10', () => {
  before(async () => {
    ids.diCycle = await copyCycle(ids.diCycle2027, 2028);
    const p1 = await seedProposal({ cycleId: ids.diCycle, reference: '2028-DI-001', fixture: 'di-design-valid', programme: 'DI', by: PROCUREMENT });
    const p2 = await seedProposal({ cycleId: ids.diCycle, reference: '2028-DI-002', fixture: 'di-design-valid', programme: 'DI', status: 'NOT_SELECTED', by: PROCUREMENT });
    await prisma.needsProposal.update({ where: { id: p2.id }, data: { stage: 'APPROVAL', statusReason: 'Excluded at approval: the site overlaps a State project.' } });
    await approvedPortfolio(ids.diCycle, [p1.id, p2.id], [DPP, ES]);
    ids.mgCycle = await copyCycle(ids.mgCycle2027, 2028);
    await seedProposal({ cycleId: ids.mgCycle, reference: '2028-MG-KN-001', fixture: 'mg-complete-valid', programme: 'MG', by: KANO_PROCUREMENT });
  });

  it('DI-11 finance@ records the budget submission and imports the appropriated schedule; the funded proposal converts; the excluded one is "Not funded, carried forward"', async () => {
    await stepDI11(ctx());
  });
  it("DI-12 the draft project has the proposal's sites, units, BoQ lines and funded budget, origin NEEDS_PIPELINE, an approved-list row; procurement@ assigns a lot; a draft with origin none cannot be activated", async () => {
    await stepDI12(ctx());
  });
  it('MG-07 BEAP built and submitted', async () => {
    await stepMG07(ctx());
  });
  it('MG-08 dpp@ reviews, comments and returns; SUBEB revises and resubmits', async () => {
    await stepMG08(ctx());
  });
  it('MG-09 es@ approves; proposals convert, owner Kano SUBEB, lot and batch from the BEAP', async () => {
    await stepMG09(ctx());
  });
  it('MG-10 activation refused until counterpart evidence is recorded; then allowed', async () => {
    await stepMG10(ctx());
  });
});
