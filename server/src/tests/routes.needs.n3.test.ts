/**
 * Needs pipeline wave 2 (N3, Track B2): cycles, upload, proposals, flags, documents and
 * carry-forward through /api/v1/needs, on the seeded UBEC tenant (normal seed: costing standard v1
 * unlocked; DI = CENTRAL, MG = CO_FUNDED). Fixtures: `fixtures/needs` (Track A; DI files in Niger
 * State, MG files in Kano, year 2027). The steps of each suite continue from the one before.
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  NEEDS_TEMPLATE_VERSION,
  NeedsCycleDtoSchema,
  NeedsOptionsDtoSchema,
  NeedsProposalDetailDtoSchema,
  NeedsProposalSummaryDtoSchema,
  NeedsUploadPreviewDtoSchema,
  NeedsUploadResultDtoSchema,
  ParsedNeedsAssessmentSchema,
  ProjectTypeConfigSchema,
  cycleDeadlines,
  type NeedsPipelineConfig,
} from '@insite/shared';
import { needsBatchFixtures, needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
/** The seed's pipeline ledger entries end here (wave 5): tenant-wide counts read after it. */
let ledgerFloor = BigInt(0);

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let tenantId = '';

const DPP = 'dpp@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';
const KANO_PROCUREMENT = 'kano.procurement@ubec.test';
const LAGOS_ADMIN = 'lagos.admin@ubec.test';
const LAGOS_ME = 'lagos.me@ubec.test';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const N = '/api/v1/needs';
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const file = (name: NeedsFixtureName, proposalId: string | null = null) => ({ fileName: `${name}.xlsx`, fileBase64: needsFixtureBase64(name), proposalId });
const confirmFile = (name: NeedsFixtureName, proposalId: string | null = null) => ({ ...file(name, proposalId), sha256: sha(needsFixture(name)) });

async function preview(email: string, cycleId: string, files: Array<ReturnType<typeof file>>) {
  return request(app).post(`${N}/cycles/${cycleId}/uploads/preview`).set(await web(email)).send({ files });
}
async function confirm(email: string, cycleId: string, files: Array<ReturnType<typeof confirmFile>>) {
  return request(app).post(`${N}/cycles/${cycleId}/uploads/confirm`).set(await web(email)).send({ files });
}

/** Presign → PUT → returns the object key (as the web does). */
async function putDocument(email: string, cycleId: string, bytes: Buffer, mimeType: string, fileName: string): Promise<string> {
  const presign = await request(app).post(`${N}/cycles/${cycleId}/documents/presign`).set(await web(email)).send({ fileName, mimeType, byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const target = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(target.pathname + target.search).set('Content-Type', mimeType).send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return presign.body.data.objectKey as string;
}

const PDF = Buffer.from('%PDF-1.4\n% needs pipeline test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function needsCounts() {
  return {
    proposals: await prisma.needsProposal.count(),
    versions: await prisma.needsAssessmentVersion.count(),
    sites: await prisma.needsProposalSite.count(),
    rows: await prisma.needsFacilityBreakdownRow.count(),
    flags: await prisma.needsProposalFlag.count(),
  };
}

const proposalByRef = (reference: string) => prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ ledgerFloor } = await clearSeededNeedsPipeline(prisma));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  tenantId = tenant.id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  ids.ubec = (await prisma.user.findUniqueOrThrow({ where: { email: DPP } })).organizationId;
  ids.kano = (await prisma.user.findUniqueOrThrow({ where: { email: KANO_DPP } })).organizationId;
});

describe('needs pipeline N3: options and opening cycles', () => {
  it('options: dpp@ can open the national DI cycle, kano.dpp@ the Kano MG cycle; a user without needs:view is refused', async () => {
    const dpp = await request(app).get(`${N}/options`).set(await web(DPP));
    assert.equal(dpp.status, 200, JSON.stringify(dpp.body));
    const o = NeedsOptionsDtoSchema.parse(dpp.body.data);
    const di = o.programmes.find((p) => p.projectTypeId === ids.di)!;
    const mg = o.programmes.find((p) => p.projectTypeId === ids.mg)!;
    assert.equal(di.canOpen, true);
    assert.equal(di.cycleScope, 'NATIONAL');
    assert.equal(mg.canOpen, false);
    assert.deepEqual(mg.openableStateCodes, []);
    assert.ok(di.defaultDeadlines.some((d) => d.key === 'stage:VALIDATION'));

    const kano = NeedsOptionsDtoSchema.parse((await request(app).get(`${N}/options`).set(await web(KANO_DPP))).body.data);
    assert.equal(kano.programmes.find((p) => p.projectTypeId === ids.mg)!.canOpen, true);
    assert.deepEqual(kano.programmes.find((p) => p.projectTypeId === ids.mg)!.openableStateCodes, ['KN']);
    assert.equal(kano.programmes.find((p) => p.projectTypeId === ids.di)!.canOpen, false);

    const refused = await request(app).get(`${N}/options`).set(await web(LAGOS_ME));
    assert.equal(refused.status, 403);
  });

  it('refuses a programme without a pipeline, a wrong State rule, another organisation and an unknown deadline', async () => {
    const central = await prisma.projectType.findUniqueOrThrow({ where: { id: ids.di } });
    const off = ProjectTypeConfigSchema.parse({ ...ProjectTypeConfigSchema.parse(central.configJson), needsPipeline: { enabled: false } });
    const disabled = await prisma.projectType.create({
      data: { tenantId, code: 'NO_PIPELINE', name: 'No pipeline', workflowTemplateId: central.workflowTemplateId, configJson: off as object },
    });
    let res = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: disabled.id, interventionYear: 2027 });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_PIPELINE_DISABLED');

    res = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2027, stateCode: 'KN' });
    assert.equal(res.body.error.code, 'NEEDS_CYCLE_STATE_NOT_ALLOWED');
    res = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: ids.mg, interventionYear: 2027 });
    assert.equal(res.body.error.code, 'NEEDS_CYCLE_STATE_REQUIRED');

    res = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: ids.di, interventionYear: 2027 });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'NEEDS_CYCLE_FORBIDDEN');
    res = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' });
    assert.equal(res.status, 403);

    res = await request(app)
      .post(`${N}/cycles`)
      .set(await web(DPP))
      .send({ projectTypeId: ids.di, interventionYear: 2027, deadlines: [{ key: 'stage:NOPE', date: '2026-08-01' }] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_DEADLINE_UNKNOWN');

    res = await request(app).post(`${N}/cycles`).set(await web(PROCUREMENT)).send({ projectTypeId: ids.di, interventionYear: 2027 });
    assert.equal(res.status, 403, 'needs:manage_cycle is required');
    assert.equal(await prisma.needsCycle.count(), 0);
  });

  it('dpp@ opens the 2027 DI cycle: config frozen, deadlines with the override, chain steps copied, costing standard locked, ledger entry', async () => {
    const res = await request(app)
      .post(`${N}/cycles`)
      .set(await web(DPP))
      .send({ projectTypeId: ids.di, interventionYear: 2027, indicativeCeilingNgn: 500_000_000, deadlines: [{ key: 'stage:VALIDATION', date: '2026-08-15' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cycle = NeedsCycleDtoSchema.parse(res.body.data);
    ids.diCycle = cycle.id;
    assert.equal(cycle.status, 'OPEN');
    assert.equal(cycle.owningOrganizationId, ids.ubec);
    assert.equal(cycle.templateVersion, NEEDS_TEMPLATE_VERSION);
    assert.equal(cycle.costingStandardVersion, 1);
    assert.equal(cycle.indicativeCeilingNgn, 500_000_000);
    assert.equal(cycle.config.referencePrefix, 'DI');
    const expected = cycleDeadlines(cycle.config as NeedsPipelineConfig, 2027);
    assert.equal(cycle.deadlines.length, expected.length);
    assert.equal(cycle.deadlines.find((d) => d.key === 'stage:VALIDATION')!.date, '2026-08-15');
    assert.equal(cycle.deadlines.find((d) => d.key === 'stage:IDENTIFICATION')!.date, expected.find((d) => d.key === 'stage:IDENTIFICATION')!.date);

    const steps = await prisma.needsApprovalStep.findMany({ where: { cycleId: cycle.id }, orderBy: [{ chainType: 'asc' }, { stepOrder: 'asc' }] });
    const portfolio = steps.filter((s) => s.chainType === 'NEEDS_PORTFOLIO');
    assert.deepEqual(portfolio.map((s) => [s.stepOrder, s.requiredPermissionKey, s.organizationScope, s.version]), [
      [1, 'needs:review_portfolio', 'PROJECT_OWNER', 1],
      [2, 'needs:approve_portfolio', 'PROJECT_OWNER', 1],
    ]);
    assert.equal(steps.filter((s) => s.chainType === 'OUT_OF_CYCLE').length, 1);
    assert.equal(steps.filter((s) => s.chainType === 'BEAP').length, 0);
    assert.equal((await prisma.costingStandardVersion.findFirstOrThrow({ where: { tenantId, version: 1 } })).isLocked, true);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_CYCLE_OPENED' } });
    assert.equal(entry.projectId, null);
    assert.equal((entry.payload as Record<string, unknown>).cycleId, cycle.id);

    const again = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2027 });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'NEEDS_CYCLE_EXISTS');
  });

  it('kano.dpp@ opens the Kano 2027 MG cycle, owned by the Kano SUBEB', async () => {
    const res = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cycle = NeedsCycleDtoSchema.parse(res.body.data);
    ids.mgCycle = cycle.id;
    assert.equal(cycle.owningOrganizationId, ids.kano);
    assert.equal(cycle.stateCode, 'KN');
    assert.equal(cycle.fundingGate, 'BEAP_APPROVAL');
    const beap = await prisma.needsApprovalStep.count({ where: { cycleId: cycle.id, chainType: 'BEAP' } });
    assert.equal(beap, 2);
  });
});

describe('needs pipeline N3: visibility and the write rule', () => {
  it('dpp@ and procurement@ see both cycles; kano.dpp@ sees only Kano; Lagos sees neither; no needs:view is 403', async () => {
    const list = async (email: string) => {
      const res = await request(app).get(`${N}/cycles?interventionYear=2027`).set(await web(email));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return (res.body.data as Array<{ id: string }>).map((c) => c.id).sort();
    };
    assert.deepEqual(await list(DPP), [ids.diCycle, ids.mgCycle].sort());
    assert.deepEqual(await list(PROCUREMENT), [ids.diCycle, ids.mgCycle].sort());
    assert.deepEqual(await list(KANO_DPP), [ids.mgCycle]);
    assert.deepEqual(await list(LAGOS_ADMIN), []);
    const hidden = await request(app).get(`${N}/cycles/${ids.mgCycle}`).set(await web(LAGOS_ADMIN));
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.error.code, 'NEEDS_CYCLE_NOT_FOUND');
    const hiddenDi = await request(app).get(`${N}/cycles/${ids.diCycle}`).set(await web(KANO_DPP));
    assert.equal(hiddenDi.status, 404);
    assert.equal((await request(app).get(`${N}/cycles`).set(await web(LAGOS_ME))).status, 403);
  });

  it('dpp@ cannot change Kano’s cycle (403); kano.procurement@ cannot upload to the DI cycle (404); procurement@ cannot upload to Kano’s (403)', async () => {
    const patch = await request(app).patch(`${N}/cycles/${ids.mgCycle}`).set(await web(DPP)).send({ indicativeCeilingNgn: 1 });
    assert.equal(patch.status, 403);
    assert.equal(patch.body.error.code, 'NEEDS_CYCLE_FORBIDDEN');
    const kano = await preview(KANO_PROCUREMENT, ids.diCycle, [file('di-draft-valid')]);
    assert.equal(kano.status, 404);
    const ubec = await preview(PROCUREMENT, ids.mgCycle, [file('mg-complete-valid')]);
    assert.equal(ubec.status, 403);
    assert.equal(ubec.body.error.code, 'NEEDS_CYCLE_FORBIDDEN');
  });

  it('dpp@ updates the DI cycle’s deadlines and ceiling (ledger entry)', async () => {
    const res = await request(app)
      .patch(`${N}/cycles/${ids.diCycle}`)
      .set(await web(DPP))
      .send({ indicativeCeilingNgn: 450_000_000, deadlines: [{ key: 'stage:COSTING', date: '2026-10-20' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const cycle = NeedsCycleDtoSchema.parse(res.body.data);
    assert.equal(cycle.indicativeCeilingNgn, 450_000_000);
    assert.equal(cycle.deadlines.find((d) => d.key === 'stage:COSTING')!.date, '2026-10-20');
    assert.equal(cycle.deadlines.find((d) => d.key === 'stage:VALIDATION')!.date, '2026-08-15', 'earlier overrides stay');
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_CYCLE_UPDATED' } }), 1);
    const bad = await request(app).patch(`${N}/cycles/${ids.diCycle}`).set(await web(DPP)).send({ deadlines: [{ key: 'nope', date: '2026-10-20' }] });
    assert.equal(bad.status, 422);
  });
});

describe('needs pipeline N3: upload', () => {
  it('preview reads every file and writes nothing; the invalid file lists row, column and reason', async () => {
    const before = await needsCounts();
    const res = await preview(PROCUREMENT, ids.diCycle, [file('di-draft-valid'), file('row-errors')]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = NeedsUploadPreviewDtoSchema.parse(res.body.data);
    assert.equal(dto.validCount, 1);
    assert.equal(dto.invalidCount, 1);
    const [valid, invalid] = dto.files;
    assert.equal(valid.status, 'VALID');
    assert.equal(valid.action, 'NEW_PROPOSAL');
    assert.equal(valid.templateVersion, NEEDS_TEMPLATE_VERSION);
    assert.equal(valid.summary!.siteCount, 2);
    assert.match(valid.summary!.facilitiesSummary, /×/);
    assert.equal(valid.sha256, sha(needsFixture('di-draft-valid')));
    assert.equal(invalid.status, 'INVALID');
    assert.ok(invalid.issues.some((i) => i.row !== null && i.column !== null && i.reason.length > 0), JSON.stringify(invalid.issues));
    assert.deepEqual(await needsCounts(), before);
  });

  it('confirm creates one proposal per valid file with references 2027-DI-001…; the invalid one is refused', async () => {
    const res = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('di-draft-valid'), confirmFile('essential-gap'), confirmFile('row-errors')]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.files.map((f) => [f.outcome, f.reference]), [
      ['CREATED', '2027-DI-001'],
      ['CREATED', '2027-DI-002'],
      ['REFUSED', null],
    ]);
    assert.equal(dto.createdCount, 2);
    assert.equal(dto.refusedCount, 1);
    const p1 = await proposalByRef('2027-DI-001');
    ids.di1 = p1.id;
    ids.di2 = (await proposalByRef('2027-DI-002')).id;
    assert.equal(p1.stage, 'IDENTIFICATION');
    assert.equal(p1.status, 'DRAFT');
    assert.equal(p1.stateCode, 'NI');
    assert.deepEqual(p1.lgaCodes, ['NI-BOSSO']);
    const v1 = await prisma.needsAssessmentVersion.findFirstOrThrow({ where: { proposalId: p1.id } });
    assert.equal(p1.currentVersionId, v1.id);
    assert.equal(v1.number, 1);
    assert.equal(v1.source, 'UPLOAD');
    assert.equal(v1.sha256, sha(needsFixture('di-draft-valid')));
    assert.match(v1.objectKey, new RegExp(`^tenants/${tenantId}/needs/cycles/${ids.diCycle}/versions/`));
    assert.equal(await prisma.needsProposalSite.count({ where: { proposalId: p1.id } }), 2);
    assert.equal(await prisma.needsFacilityBreakdownRow.count({ where: { proposalId: p1.id } }), v1.breakdownRowCount);
    const created = await prisma.auditLog.findMany({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_PROPOSAL_CREATED', projectId: null } });
    assert.equal(created.length, 2);
    const payload = created.find((e) => (e.payload as Record<string, unknown>).reference === '2027-DI-001')!.payload as Record<string, unknown>;
    assert.equal(payload.cycleId, ids.diCycle);
    assert.equal(payload.proposalId, p1.id);
    assert.equal(payload.versionNumber, 1);
    assert.equal(payload.sha256, v1.sha256);
  });

  it('the same file twice in one request, and a file already uploaded, are refused; with nothing left it is 422', async () => {
    const res = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('di-draft-valid'), confirmFile('di-draft-valid')]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_FILE_INVALID');
    const files = res.body.error.details.files as Array<{ outcome: string; issues: Array<{ reason: string }> }>;
    assert.ok(files[0].issues.some((i) => i.reason.includes('already uploaded as 2027-DI-001 v1')));
    assert.ok(files[1].issues.some((i) => /listed twice/.test(i.reason)));
    assert.equal(await prisma.needsProposal.count({ where: { cycleId: ids.diCycle } }), 2);
  });

  it('a sha256 that does not match its file is 409 NEEDS_FILE_CHANGED and nothing is written', async () => {
    const before = await needsCounts();
    const res = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('rate-variance'), { ...confirmFile('missing-sm-line'), sha256: sha(needsFixture('rate-variance')) }]);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NEEDS_FILE_CHANGED');
    assert.deepEqual(await needsCounts(), before);
  });

  it('kano.procurement@ uploads to the Kano cycle: 2027-MG-KN-001; the file without BoQ is refused', async () => {
    const res = await confirm(KANO_PROCUREMENT, ids.mgCycle, [confirmFile('mg-complete-valid'), confirmFile('mg-no-boq')]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.files.map((f) => [f.outcome, f.reference]), [
      ['CREATED', '2027-MG-KN-001'],
      ['REFUSED', null],
    ]);
    ids.mg1 = (await proposalByRef('2027-MG-KN-001')).id;
    assert.equal((await proposalByRef('2027-MG-KN-001')).stateCode, 'KN');
  });

  it('each flag kind is raised by its fixture (duplicate, essential gap, rate variance, missing S&M line)', async () => {
    const res = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('duplicate-of-di-draft'), confirmFile('rate-variance'), confirmFile('missing-sm-line')]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    const byFile = Object.fromEntries(dto.files.map((f) => [f.fileName, f]));
    const dup = byFile['duplicate-of-di-draft.xlsx'];
    assert.equal(dup.reference, '2027-DI-003');
    const dupFlag = dup.flags.find((f) => f.kind === 'DUPLICATE');
    assert.ok(dupFlag, JSON.stringify(dup.flags));
    const match = (dupFlag!.details.matches as Array<Record<string, unknown>>)[0];
    assert.equal(match.kind, 'PROPOSAL');
    assert.equal(match.reference, '2027-DI-001');
    assert.equal(match.reason, 'SAME_SCHOOL');
    assert.ok(byFile['rate-variance.xlsx'].flags.some((f) => f.kind === 'RATE_VARIANCE'), JSON.stringify(byFile['rate-variance.xlsx'].flags));
    assert.ok(byFile['missing-sm-line.xlsx'].flags.some((f) => f.kind === 'MISSING_SUPERVISION_LINE'), JSON.stringify(byFile['missing-sm-line.xlsx'].flags));
    ids.rateVariance = (await proposalByRef(byFile['rate-variance.xlsx'].reference!)).id;

    const gap = await prisma.needsProposalFlag.findMany({ where: { proposalId: ids.di2, resolvedAt: null } });
    assert.deepEqual(gap.map((f) => f.kind), ['ESSENTIAL_FACILITY_GAP']);
    const gaps = (gap[0].detailsJson as { gaps: Array<{ groupLabel: string }> }).gaps;
    assert.deepEqual([...new Set(gaps.map((g) => g.groupLabel))], ['Water']);
    assert.equal(await prisma.needsProposalFlag.count({ where: { proposalId: ids.di1 } }), 0, 'the original is not flagged');
  });

  it('a ceiling breach and a project-site duplicate are found by the flag rules', async () => {
    const { computeFlagFindings } = await import('../modules/needs/needsFlags.service');
    const { costingStandardById, cycleConfig } = await import('../modules/needs/needsSupport');
    const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: ids.diCycle } });
    const version = await prisma.needsAssessmentVersion.findFirstOrThrow({ where: { proposalId: ids.rateVariance } });
    const parsed = ParsedNeedsAssessmentSchema.parse(version.parsedJson);
    // Ten times the amounts of the toilet unit: above the standard's ceiling for toilets.
    const inflated = { ...parsed, boqLines: parsed.boqLines.map((l) => (l.unitId === 'U01' ? { ...l, amountNgn: l.amountNgn * 10, rateNgn: l.rateNgn * 10 } : l)) };
    const project = await prisma.project.findFirstOrThrow({ where: { tenantId } });
    await prisma.projectSite.create({
      data: { projectId: project.id, siteNumber: 99, schoolName: parsed.sites[0].schoolName, schoolLevel: 'PRIMARY', lgaCode: parsed.sites[0].lgaCode },
    });
    const findings = await computeFlagFindings(
      prisma,
      { tenantId, config: cycleConfig(cycle), standard: await costingStandardById(cycle.costingStandardVersionId), stateCode: 'NI', proposalId: ids.rateVariance, isLegacyTemplate: false },
      inflated
    );
    const kinds = findings.map((f) => f.kind);
    assert.ok(kinds.includes('CEILING_EXCEEDED'), JSON.stringify(kinds));
    const dup = findings.find((f) => f.kind === 'DUPLICATE')!;
    assert.equal((dup.details.matches as Array<Record<string, unknown>>)[0].kind, 'PROJECT_SITE');
    assert.equal((dup.details.matches as Array<Record<string, unknown>>)[0].reference, project.codePrefix);

    // Review fix (wave 2): a viewer only sees a match they can open. procurement@ holds no project
    // permission, so the project is redacted for them; admin@ (every permission) sees its code.
    const flag = await prisma.needsProposalFlag.create({ data: { proposalId: ids.rateVariance, kind: 'DUPLICATE', detailsJson: dup.details as object } });
    const asProcurement = await request(app).get(`${N}/proposals/${ids.rateVariance}`).set(await web(PROCUREMENT));
    const seen = (asProcurement.body.data.flags as Array<{ id: string; details: { matches: Array<Record<string, unknown>> } }>).find((f) => f.id === flag.id)!;
    assert.equal(seen.details.matches[0].reference, null);
    assert.equal(seen.details.matches[0].id, null);
    assert.equal(seen.details.matches[0].hidden, true);
    assert.equal(seen.details.matches[0].label, 'a project you cannot open');
    const asAdmin = await request(app).get(`${N}/proposals/${ids.rateVariance}`).set(await web('admin@ubec.test'));
    const full = (asAdmin.body.data.flags as Array<{ id: string; details: { matches: Array<Record<string, unknown>> } }>).find((f) => f.id === flag.id)!;
    assert.equal(full.details.matches[0].reference, project.codePrefix);
    await prisma.needsProposalFlag.delete({ where: { id: flag.id } });
    await prisma.projectSite.deleteMany({ where: { projectId: project.id, siteNumber: 99 } });
  });

  it('review fixes: a file aimed at a proposal outside the cycle is refused on its own; files over 10 MB together are refused', async () => {
    const batch = needsBatchFixtures();
    const res = await preview(PROCUREMENT, ids.diCycle, [
      { fileName: batch[2].fileName, fileBase64: batch[2].buffer.toString('base64'), proposalId: null },
      { fileName: batch[4].fileName, fileBase64: batch[4].buffer.toString('base64'), proposalId: crypto.randomUUID() },
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const files = res.body.data.files as Array<{ status: string; action: string; issues: Array<{ reason: string }> }>;
    assert.equal(files.length, 2, 'the batch is previewed, not refused as a whole');
    assert.equal(files[1].status, 'INVALID');
    assert.equal(files[1].action, 'NEW_VERSION');
    assert.match(files[1].issues[0].reason, /not in this cycle/);
    const big = crypto.randomBytes(3.5 * 1024 * 1024).toString('base64');
    const tooBig = await preview(PROCUREMENT, ids.diCycle, [1, 2, 3].map((n) => ({ fileName: `big-${n}.xlsx`, fileBase64: big, proposalId: null })));
    assert.equal(tooBig.status, 400, JSON.stringify(tooBig.body).slice(0, 300));
    assert.match(JSON.stringify(tooBig.body), /larger than 10 MB/);
  });

  it('a new version of a named proposal: v2 current, v1 kept, tables replaced, flags re-run and a fixed one resolved CORRECTED', async () => {
    const res = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('di-design-valid', ids.di1)]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    assert.equal(dto.files[0].outcome, 'VERSION_ADDED');
    assert.equal(dto.files[0].versionNumber, 2);
    const versions = await prisma.needsAssessmentVersion.findMany({ where: { proposalId: ids.di1 }, orderBy: { number: 'asc' } });
    assert.deepEqual(versions.map((v) => v.number), [1, 2]);
    const p1 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di1 } });
    assert.equal(p1.currentVersionId, versions[1].id);
    assert.ok(versions[1].boqLineCount > 0);
    assert.equal(await prisma.needsFacilityBreakdownRow.count({ where: { proposalId: ids.di1 } }), versions[1].breakdownRowCount);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_VERSION_ADDED' } }), 1);

    // essential-gap (2027-DI-002) corrected by a file that covers every essential group.
    const batch1 = needsBatchFixtures()[0];
    assert.ok(batch1.valid);
    const corrected = await confirm(PROCUREMENT, ids.diCycle, [
      { fileName: batch1.fileName, fileBase64: batch1.buffer.toString('base64'), proposalId: ids.di2, sha256: sha(batch1.buffer) },
    ]);
    assert.equal(corrected.status, 201, JSON.stringify(corrected.body));
    const flag = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.di2, kind: 'ESSENTIAL_FACILITY_GAP' } });
    assert.ok(flag.resolvedAt);
    assert.equal(flag.resolution, 'CORRECTED');
    assert.equal(flag.resolvedByName, 'System (needs)');
    assert.equal(flag.raisedOnVersionNumber, 1);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_FLAG_RESOLVED' } }), 1);
  });

  it('a new version of a proposal of another cycle is refused on that file (preview) and never written (confirm)', async () => {
    // Review fix (wave 2): per-file, not a 404 for the whole batch.
    const res = await preview(PROCUREMENT, ids.diCycle, [file('di-design-valid', ids.mg1)]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const f = NeedsUploadPreviewDtoSchema.parse(res.body.data).files[0];
    assert.equal(f.status, 'INVALID');
    assert.match(f.issues[0].reason, /not in this cycle/);
    const saved = await confirm(PROCUREMENT, ids.diCycle, [confirmFile('di-design-valid', ids.mg1)]);
    assert.equal(saved.status, 422);
    assert.equal(saved.body.error.code, 'NEEDS_FILE_INVALID');
    assert.equal(await prisma.needsAssessmentVersion.count({ where: { proposalId: ids.mg1 } }), 1);
  });

  it('a v1 scope workbook is accepted at DI Identification with a warning, and refused at a later stage', async () => {
    const res = await preview(PROCUREMENT, ids.diCycle, [file('v1-scope-workbook')]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const f = NeedsUploadPreviewDtoSchema.parse(res.body.data).files[0];
    assert.equal(f.status, 'VALID', JSON.stringify(f.issues));
    assert.ok(f.warnings.length > 0);
    assert.notEqual(f.templateVersion, NEEDS_TEMPLATE_VERSION);
    assert.ok(!f.expectedFlags.some((x) => x.kind === 'ESSENTIAL_FACILITY_GAP'), 'an old file has no breakdown to check');

    // A proposal at Design (needs:submit uploads there): the old template is refused.
    const p3 = await proposalByRef('2027-DI-003');
    await prisma.needsProposal.update({ where: { id: p3.id }, data: { stage: 'DESIGN', status: 'IN_PROGRESS' } });
    const later = await preview(PROCUREMENT, ids.diCycle, [file('v1-scope-workbook', p3.id)]);
    const g = NeedsUploadPreviewDtoSchema.parse(later.body.data).files[0];
    assert.equal(g.status, 'INVALID');
    assert.ok(g.issues.some((i) => /old needs assessment template/.test(i.reason)), JSON.stringify(g.issues));
    await prisma.needsProposal.update({ where: { id: p3.id }, data: { stage: 'IDENTIFICATION', status: 'DRAFT' } });
  });
});

describe('needs pipeline N3: proposals, documents and templates', () => {
  it('lists the cycle’s proposals with labels, next actor and "waiting for me"', async () => {
    const res = await request(app).get(`${N}/cycles/${ids.diCycle}/proposals`).set(await web(PROCUREMENT));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = NeedsProposalSummaryDtoSchema.array().parse(res.body.data);
    const p1 = rows.find((r) => r.reference === '2027-DI-001')!;
    assert.equal(p1.statusLabel, 'Draft');
    assert.equal(p1.nextActor, 'Identification: Procurement');
    assert.equal(p1.waitingForMe, true);
    assert.equal(p1.currentVersionNumber, 2);
    assert.ok(rows.find((r) => r.reference === '2027-DI-003')!.openFlagKinds.includes('DUPLICATE'));
    const mine = await request(app).get(`${N}/cycles/${ids.diCycle}/proposals?waitingForMe=true`).set(await web('me.officer@ubec.test'));
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.length, 0, 'nothing waits for the validator before submission');
    const search = await request(app).get(`${N}/cycles/${ids.diCycle}/proposals?q=DI-001`).set(await web(PROCUREMENT));
    assert.deepEqual((search.body.data as Array<{ reference: string }>).map((r) => r.reference), ['2027-DI-001']);
  });

  it('the detail carries versions, flags, tasks, allowed actions and history', async () => {
    const res = await request(app).get(`${N}/proposals/${ids.di1}`).set(await web(PROCUREMENT));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = NeedsProposalDetailDtoSchema.parse(res.body.data);
    assert.deepEqual(d.versions.map((v) => [v.number, v.isCurrent]), [
      [2, true],
      [1, false],
    ]);
    assert.ok(d.allowedActions.includes('UPLOAD_VERSION'));
    assert.ok(d.tasks.some((t) => t.label === 'Submit for validation' && t.status === 'TODO' && t.mine));
    assert.deepEqual(d.history.map((h) => h.action), ['NEEDS_VERSION_ADDED', 'NEEDS_PROPOSAL_CREATED']);
    assert.ok(d.sites.length === 2 && d.breakdownRows.length > 0 && d.boqLines.length > 0);

    const dup = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${(await proposalByRef('2027-DI-003')).id}`).set(await web(PROCUREMENT))).body.data);
    const task = dup.tasks.find((t) => t.key === 'resolve-duplicate')!;
    assert.equal(task.label, 'Resolve possible duplicate');
    assert.equal(task.status, 'TODO');
    assert.equal(task.mine, false, 'the validator resolves it');

    const mg = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${ids.mg1}`).set(await web(KANO_PROCUREMENT))).body.data);
    assert.ok(mg.tasks.some((t) => t.label === 'Upload drawings' && t.status === 'TODO'));
    assert.ok(mg.tasks.some((t) => t.label === 'Submit for field verification' && t.status === 'BLOCKED'));

    assert.equal((await request(app).get(`${N}/proposals/${ids.mg1}`).set(await web(LAGOS_ADMIN))).status, 404);
  });

  it('cycle documents: presign, PUT, register (circular), list and file link; a key of another cycle is refused', async () => {
    const key = await putDocument(KANO_DPP, ids.mgCycle, PDF, 'application/pdf', 'Kano circular 2027.pdf');
    const res = await request(app)
      .post(`${N}/cycles/${ids.mgCycle}/documents`)
      .set(await web(KANO_DPP))
      .send({ objectKey: key, kind: 'CIRCULAR', title: 'Matching Grants circular 2027', proposalIds: [ids.mg1] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.sha256, sha(PDF));
    assert.equal(res.body.data.byteSize, PDF.length);
    ids.circular = res.body.data.id;

    const list = await request(app).get(`${N}/cycles/${ids.mgCycle}/documents`).set(await web(DPP));
    assert.equal(list.status, 200);
    assert.deepEqual((list.body.data as Array<{ id: string }>).map((d) => d.id), [ids.circular]);
    const link = await request(app).get(`${N}/cycles/${ids.mgCycle}/documents/${ids.circular}/file?format=json`).set(await web(DPP));
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const target = new URL(link.body.data.url);
    const got = await request(app).get(target.pathname + target.search).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(got.status, 200);
    assert.equal(sha(got.body as Buffer), sha(PDF));
    assert.equal((await request(app).get(`${N}/cycles/${ids.mgCycle}/documents/${ids.circular}/file`).set(await web(DPP))).status, 302);

    // Supersede with another kind: refused; same kind: kept, current first.
    const key2 = await putDocument(KANO_DPP, ids.mgCycle, PDF, 'application/pdf', 'circular v2.pdf');
    const wrongKind = await request(app).post(`${N}/cycles/${ids.mgCycle}/documents`).set(await web(KANO_DPP)).send({ objectKey: key2, kind: 'OTHER', title: 'x title', supersedesId: ids.circular });
    assert.equal(wrongKind.status, 422);
    const v2 = await request(app).post(`${N}/cycles/${ids.mgCycle}/documents`).set(await web(KANO_DPP)).send({ objectKey: key2, kind: 'CIRCULAR', title: 'Circular (revised)', supersedesId: ids.circular });
    assert.equal(v2.status, 201);
    const again = await request(app).get(`${N}/cycles/${ids.mgCycle}/documents`).set(await web(KANO_DPP));
    assert.deepEqual((again.body.data as Array<{ id: string }>).map((d) => d.id), [v2.body.data.id, ids.circular]);

    // A key issued for the DI cycle cannot be registered on the Kano cycle; a proposal of another cycle neither.
    const diKey = await putDocument(DPP, ids.diCycle, PDF, 'application/pdf', 'di.pdf');
    const foreign = await request(app).post(`${N}/cycles/${ids.mgCycle}/documents`).set(await web(KANO_DPP)).send({ objectKey: diKey, kind: 'OTHER', title: 'Foreign file' });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.error.code, 'INVALID_OBJECT_KEY');
    const otherProposal = await request(app).post(`${N}/cycles/${ids.diCycle}/documents`).set(await web(DPP)).send({ objectKey: diKey, kind: 'OTHER', title: 'Wrong cover', proposalIds: [ids.mg1] });
    assert.equal(otherProposal.status, 404);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_DOCUMENT_ADDED' } }), 2);
  });

  it('proposal documents: a drawing on 2027-DI-001 (key under its cycle), listed and linked', async () => {
    const key = await putDocument(PROCUREMENT, ids.diCycle, PDF, 'application/pdf', 'Classroom block drawing.pdf');
    const res = await request(app).post(`${N}/proposals/${ids.di1}/documents`).set(await web(PROCUREMENT)).send({ objectKey: key, kind: 'DRAWING', title: 'Classroom block drawing' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const list = await request(app).get(`${N}/proposals/${ids.di1}/documents`).set(await web(DPP));
    assert.deepEqual((list.body.data as Array<{ kind: string }>).map((d) => d.kind), ['DRAWING']);
    const link = await request(app).get(`${N}/proposals/${ids.di1}/documents/${res.body.data.id}/file?format=json`).set(await web(DPP));
    assert.equal(link.status, 200);
    assert.equal(link.body.data.fileName, 'Classroom_block_drawing.pdf');
    // A key of the Kano cycle is not under this proposal's cycle.
    const kanoKey = await putDocument(KANO_DPP, ids.mgCycle, PDF, 'application/pdf', 'kano.pdf');
    const refused = await request(app).post(`${N}/proposals/${ids.di1}/documents`).set(await web(PROCUREMENT)).send({ objectKey: kanoKey, kind: 'PHOTO', title: 'Wrong place' });
    assert.equal(refused.status, 400);
    // kano.procurement@ cannot see the DI proposal.
    assert.equal((await request(app).post(`${N}/proposals/${ids.di1}/documents`).set(await web(KANO_PROCUREMENT)).send({ objectKey: key, kind: 'PHOTO', title: 'x title' })).status, 404);
    // Review fix (wave 2): one uploaded file is one document, and only the current version is replaced.
    const again = await request(app).post(`${N}/proposals/${ids.di2}/documents`).set(await web(PROCUREMENT)).send({ objectKey: key, kind: 'DRAWING', title: 'Same file again' });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error?.code ?? again.body.code, 'NEEDS_DOCUMENT_EXISTS');
    const v2Key = await putDocument(PROCUREMENT, ids.diCycle, PDF, 'application/pdf', 'Classroom block drawing v2.pdf');
    const v2 = await request(app).post(`${N}/proposals/${ids.di1}/documents`).set(await web(PROCUREMENT)).send({ objectKey: v2Key, kind: 'DRAWING', title: 'Classroom block drawing', supersedesId: res.body.data.id });
    assert.equal(v2.status, 201, JSON.stringify(v2.body));
    const staleKey = await putDocument(PROCUREMENT, ids.diCycle, PDF, 'application/pdf', 'Classroom block drawing v2b.pdf');
    const stale = await request(app).post(`${N}/proposals/${ids.di1}/documents`).set(await web(PROCUREMENT)).send({ objectKey: staleKey, kind: 'DRAWING', title: 'From a stale page', supersedesId: res.body.data.id });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error?.code ?? stale.body.code, 'NEEDS_DOCUMENT_SUPERSEDED');
  });

  it('templates (blank per cycle, pre-filled per proposal) and stored version files', async () => {
    const blank = await request(app).get(`${N}/cycles/${ids.diCycle}/template`).set(await web(PROCUREMENT));
    assert.equal(blank.status, 200, blank.text);
    assert.match(String(blank.headers['content-type']), /spreadsheetml/);
    const filled = await request(app).get(`${N}/proposals/${ids.di1}/template`).set(await web(PROCUREMENT));
    assert.equal(filled.status, 200, filled.text);
    const link = await request(app).get(`${N}/proposals/${ids.di1}/versions/1/file?format=json`).set(await web(PROCUREMENT));
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.equal(link.body.data.fileName, 'di-draft-valid.xlsx');
    assert.equal((await request(app).get(`${N}/proposals/${ids.di1}/versions/9/file`).set(await web(PROCUREMENT))).status, 404);
  });
});

describe('needs pipeline N3: carry-forward and closing', () => {
  it('a NOT_SELECTED proposal of 2027 is offered when 2028 opens; carried, it starts at Validation with its version linked', async () => {
    await prisma.needsProposal.update({ where: { id: ids.rateVariance }, data: { status: 'NOT_SELECTED', stage: 'PRIORITISATION', statusReason: 'Below the funding line' } });
    const old = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.rateVariance }, include: { currentVersion: true } });

    const offered = await request(app).get(`${N}/cycles/carry-forward?projectTypeId=${ids.di}&interventionYear=2028`).set(await web(DPP));
    assert.equal(offered.status, 200, JSON.stringify(offered.body));
    assert.deepEqual((offered.body.data as Array<{ reference: string }>).map((c) => c.reference), [old.reference]);
    assert.equal(offered.body.data[0].statusLabel, 'Not funded, carried forward');

    const invalid = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2028, carryForwardProposalIds: [ids.di1] });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.error.code, 'NEEDS_CARRY_FORWARD_INVALID');
    assert.equal(await prisma.needsCycle.count({ where: { interventionYear: 2028 } }), 0, 'nothing written');

    const res = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: ids.di, interventionYear: 2028, carryForwardProposalIds: [ids.rateVariance] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.cycle2028 = res.body.data.id;
    const carried = await prisma.needsProposal.findFirstOrThrow({ where: { cycleId: ids.cycle2028 }, include: { currentVersion: true, flags: true } });
    assert.equal(carried.reference, '2028-DI-001');
    assert.equal(carried.stage, 'VALIDATION');
    assert.equal(carried.status, 'IN_PROGRESS');
    assert.equal(carried.carriedFromId, old.id);
    assert.equal(carried.currentVersion!.number, 1);
    assert.equal(carried.currentVersion!.source, 'CARRY_FORWARD');
    assert.equal(carried.currentVersion!.objectKey, old.currentVersion!.objectKey);
    assert.equal(carried.currentVersion!.sha256, old.currentVersion!.sha256);
    assert.ok(carried.flags.some((f) => f.kind === 'RATE_VARIANCE' && !f.resolvedAt), 'flags re-run');
    assert.equal(await prisma.needsProposalSite.count({ where: { proposalId: carried.id } }), old.currentVersion!.siteCount);
    const after = await prisma.needsProposal.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(after.status, 'NOT_SELECTED');
    assert.equal(after.statusReason, 'Carried forward to 2028-DI-001');

    const detail = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${carried.id}`).set(await web(DPP))).body.data);
    assert.equal(detail.carriedFromReference, old.reference);
    const oldDetail = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${old.id}`).set(await web(DPP))).body.data);
    assert.ok(oldDetail.history.some((h) => h.summary.includes('2028-DI-001')));
    const none = await request(app).get(`${N}/cycles/carry-forward?projectTypeId=${ids.di}&interventionYear=2028`).set(await web(DPP));
    assert.deepEqual(none.body.data, [], 'carried once');
  });

  it('closing a cycle stops uploads (409 NEEDS_CYCLE_NOT_OPEN)', async () => {
    const res = await request(app).post(`${N}/cycles/${ids.cycle2028}/close`).set(await web(DPP)).send({ reason: 'Test' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'CLOSED');
    const upload = await preview(PROCUREMENT, ids.cycle2028, [file('essential-gap')]);
    assert.equal(upload.status, 409);
    assert.equal(upload.body.error.code, 'NEEDS_CYCLE_NOT_OPEN');
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_CYCLE_CLOSED' } }), 1);
  });
});
