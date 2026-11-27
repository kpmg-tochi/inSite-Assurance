import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';
import {
  AppropriationPreviewDtoSchema,
  AppropriationResultDtoSchema,
  NeedsFundingDtoSchema,
  NeedsProcurementPlanDtoSchema,
  NeedsSubmissionDtoSchema,
  formatProjectCode,
  type NeedsSubmissionDto,
} from '@insite/shared';
import { buildFixtureFile } from '../fixtures/needs/generateNeedsFixtures';
import { FIXTURE_SPECS } from '../fixtures/needs/needsFixtureSpecs';
import type { NeedsScenarioContext } from './needsScenarioSteps.n5';

/**
 * Needs pipeline wave 4, Track B: the scenario steps DI-11, DI-12 and MG-07 … MG-10 (funding, BEAP,
 * activation), proven in `routes.needs.n7.test.ts` and wired by the main thread into
 * `routes.needs.scenarios.test.ts`. API only, plus Prisma reads for the assertions. They work on
 * whatever proposals the cycle holds, so they continue from Track A's DI-10 / MG-06 end state:
 *
 * - DI (`ids.diCycle`): at least one proposal at FUNDING, IN_PROGRESS with `approvedAmountNgn` (the
 *   approved portfolio's, e.g. 2027-DI-001); at least one excluded by the approval (NOT_SELECTED,
 *   e.g. 2027-DI-002); the portfolio approved by dpp@ and es@ (so finance@ may confirm the funding).
 * - MG (`ids.mgCycle`, Kano): at least one proposal at FUNDING, IN_PROGRESS (e.g. 2027-MG-KN-001),
 *   uploaded and costed from the `mg-complete-valid` fixture; no BEAP yet.
 *
 * Ids written for later steps: `ids.diProject` (DI-11), `ids.mgProject` (MG-09).
 */

const N = '/api/v1/needs';
const P = '/api/v1/projects';
const FINANCE = 'finance@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const ADMIN = 'admin@ubec.test';
const DPP = 'dpp@ubec.test';
const ES = 'es@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';

type Method = 'get' | 'put' | 'post' | 'patch';

export async function call(ctx: NeedsScenarioContext, email: string, method: Method, path: string, body?: unknown) {
  const req = request(ctx.app)[method](path).set(await ctx.web(email));
  return body === undefined ? req : req.send(body as object);
}

export async function ok(ctx: NeedsScenarioContext, email: string, method: Method, path: string, body?: unknown, status = 200) {
  const res = await call(ctx, email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function refused(ctx: NeedsScenarioContext, email: string, method: Method, path: string, body: unknown, status: number, code: string) {
  const res = await call(ctx, email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error.code, code, JSON.stringify(res.body));
  return res.body.error;
}

/** Presign, PUT and register a small PDF as a cycle document through a route family (`…/funding/documents` …). */
export async function fileCycleDocument(ctx: NeedsScenarioContext, email: string, base: string, kind: string, title: string, proposalIds: string[] = []): Promise<string> {
  const pdf = Buffer.from(`%PDF-1.4\n% ${title} ${crypto.randomUUID()}\n%%EOF\n`);
  const presign = await ok(ctx, email, 'post', `${base}/presign`, { fileName: `${title}.pdf`, mimeType: 'application/pdf', byteSize: pdf.length });
  const target = new URL(presign.uploadUrl);
  const put = await request(ctx.app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const doc = await ok(ctx, email, 'post', base, { objectKey: presign.objectKey, kind, title, proposalIds }, 201);
  return doc.id as string;
}

export async function download(ctx: NeedsScenarioContext, email: string, path: string): Promise<Buffer> {
  const res = await request(ctx.app)
    .get(path)
    .set(await ctx.web(email))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200, String(res.body));
  assert.match(String(res.headers['content-type']), /spreadsheetml/);
  return res.body as Buffer;
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function atFunding(ctx: NeedsScenarioContext, cycleId: string) {
  return ctx.prisma.needsProposal.findMany({ where: { cycleId, stage: 'FUNDING', status: 'IN_PROGRESS', route: 'ANNUAL' }, orderBy: { sequence: 'asc' } });
}

async function statusLabel(ctx: NeedsScenarioContext, email: string, proposalId: string): Promise<string> {
  return (await ok(ctx, email, 'get', `${N}/proposals/${proposalId}`)).statusLabel as string;
}

// ---------------------------------------------------------------------------
// Direct Intervention
// ---------------------------------------------------------------------------

/**
 * DI-11: finance@ records the budget submission (with the acknowledgement) and imports the
 * appropriated schedule downloaded from the cycle (pre-filled at the approved amounts): every
 * proposal at Funding converts; the proposals the approval excluded read "Not funded, carried forward".
 */
export async function stepDI11(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.diCycle;
  const funded = await atFunding(ctx, cycleId);
  assert.ok(funded.length >= 1, 'a proposal waits at Funding');
  const excluded = await ctx.prisma.needsProposal.findMany({ where: { cycleId, status: 'NOT_SELECTED' } });
  assert.ok(excluded.length >= 1, 'the approval excluded a proposal');

  const before = NeedsFundingDtoSchema.parse(await ok(ctx, FINANCE, 'get', `${N}/cycles/${cycleId}/funding`));
  assert.equal(before.fundingGate, 'APPROPRIATION');
  assert.equal(before.canRecord, true);
  assert.equal(before.cannotConfirmReason, null);
  assert.deepEqual(before.awaiting.map((a) => a.reference), funded.map((p) => p.reference));

  const ackId = await fileCycleDocument(ctx, FINANCE, `${N}/cycles/${cycleId}/funding/documents`, 'BUDGET_SUBMISSION_ACKNOWLEDGEMENT', 'Ministry acknowledgement of the budget submission');
  const total = funded.reduce((s, p) => s + Number(p.approvedAmountNgn), 0);
  const record = await ok(ctx, FINANCE, 'post', `${N}/cycles/${cycleId}/funding/budget-submission`, { submittedOn: '2026-12-10', amountNgn: total, acknowledgementDocumentId: ackId }, 201);
  assert.equal(record.kind, 'BUDGET_SUBMISSION');
  assert.equal(record.documentId, ackId);

  const file = await download(ctx, FINANCE, `${N}/cycles/${cycleId}/funding/appropriation/template`);
  const body = { fileName: 'Appropriated schedule.xlsx', fileBase64: file.toString('base64') };
  const preview = AppropriationPreviewDtoSchema.parse(await ok(ctx, FINANCE, 'post', `${N}/cycles/${cycleId}/funding/appropriation/preview`, body));
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.equal(preview.totals.matched, funded.length);
  assert.deepEqual(preview.notFunded, []);

  const result = AppropriationResultDtoSchema.parse(
    await ok(ctx, FINANCE, 'post', `${N}/cycles/${cycleId}/funding/appropriation/confirm`, { ...body, sha256: sha(file), appropriatedOn: '2027-01-20' }, 201)
  );
  assert.deepEqual(result.converted.map((c) => c.reference), funded.map((p) => p.reference));
  for (const p of funded) {
    const after = await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: p.id }, include: { project: true } });
    assert.equal(after.status, 'CONVERTED');
    assert.equal(after.project?.origin, 'NEEDS_PIPELINE');
    assert.equal(Number(after.fundedAmountNgn), Number(p.approvedAmountNgn));
  }
  for (const p of excluded) assert.equal(await statusLabel(ctx, FINANCE, p.id), 'Not funded, carried forward');
  const list = await ctx.prisma.approvedList.findUniqueOrThrow({ where: { id: result.approvedListId }, include: { rows: { include: { projects: true } } } });
  assert.equal(list.kind, 'DI_SCHEDULE');
  assert.equal(list.rows.length, funded.length);
  assert.ok(list.rows.every((r) => r.projects.length === 1));
  ctx.ids.diProject = result.converted[0].projectId;
}

/**
 * DI-12: the draft carries the proposal's sites, units (one per proposed breakdown row), BoQ lines and
 * funded budget, origin NEEDS_PIPELINE and its approved-list row; procurement@ assigns a lot (code
 * LOT n BATCH 1); a DI draft created without an origin cannot be activated (409 PROJECT_ORIGIN_REQUIRED).
 */
export async function stepDI12(ctx: NeedsScenarioContext): Promise<void> {
  const projectId = ctx.ids.diProject;
  const project = await ctx.prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { sites: true, facilityUnits: true, boqItems: true, needsProposal: { include: { currentVersion: true, breakdownRows: true, cycle: true } } },
  });
  const proposal = project.needsProposal!;
  assert.equal(project.status, 'DRAFT');
  assert.equal(project.origin, 'NEEDS_PIPELINE');
  assert.equal(project.codePrefix, proposal.reference, 'the reference is the code until a lot is assigned');
  assert.equal(project.sites.length, proposal.currentVersion!.siteCount);
  assert.equal(project.facilityUnits.length, proposal.breakdownRows.filter((r) => Number(r.proposedQuantity) > 0).length);
  assert.equal(project.boqItems.length, proposal.currentVersion!.boqLineCount);
  assert.equal(Number(project.totalBudgetNgn), Number(proposal.fundedAmountNgn));
  const link = await ok(ctx, ADMIN, 'get', `${P}/${projectId}/approved-list-row`);
  assert.equal(link.rowRef, proposal.reference);
  assert.equal(link.kind, 'DI_SCHEDULE');
  assert.equal(link.mismatch.flagged, false);

  const cycleId = ctx.ids.diCycle;
  const plan = NeedsProcurementPlanDtoSchema.parse(await ok(ctx, PROCUREMENT, 'get', `${N}/cycles/${cycleId}/procurement-plan`));
  assert.equal(plan.canPlan, true);
  assert.equal(plan.rows.find((r) => r.projectId === projectId)?.lotId, null);
  const after = NeedsProcurementPlanDtoSchema.parse(
    await ok(ctx, PROCUREMENT, 'post', `${N}/cycles/${cycleId}/procurement-plan/lots`, { items: [{ projectId, lotChoice: { newLotTitle: 'Renovation and furnishing of primary schools' } }] })
  );
  const row = after.rows.find((r) => r.projectId === projectId)!;
  assert.equal(row.batchNumber, 1);
  assert.ok(row.lotNumber);
  assert.equal(row.projectCode, `LOT ${row.lotNumber} BATCH 1`);
  const coded = await ctx.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assert.equal(coded.codePrefix, `${proposal.cycle.interventionYear}-LOT-${row.lotNumber}-BATCH-1`);

  // A manual draft of a pipeline programme has no origin: it cannot go live.
  const di = await ctx.prisma.projectType.findFirstOrThrow({ where: { tenantId: ctx.tenantId, code: 'CENTRAL' } });
  const created = await ok(ctx, ADMIN, 'post', P, { name: 'Draft without an origin', codePrefix: 'NOO-101', stateLocation: 'Kano', totalBudgetNgn: 10_000_000, projectTypeId: di.id }, 201);
  await refused(ctx, ADMIN, 'post', `${P}/${created.projectId}/activate`, {}, 409, 'PROJECT_ORIGIN_REQUIRED');
}

// ---------------------------------------------------------------------------
// Matching Grants
// ---------------------------------------------------------------------------

const lotTitle = (year: number) => `Kano ${year} classrooms and WASH`;

async function beap(ctx: NeedsScenarioContext, email: string, cycleId: string): Promise<NeedsSubmissionDto> {
  return NeedsSubmissionDtoSchema.parse(await ok(ctx, email, 'get', `${N}/cycles/${cycleId}/beap`));
}

/** MG-07: kano.dpp@ builds the BEAP (lot, procurement method and dates per proposal; counterpart declared, evidence later) and submits it. */
export async function stepMG07(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const cycle = await ctx.prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const funded = await atFunding(ctx, cycleId);
  assert.ok(funded.length >= 1, 'a proposal waits at Funding');
  const items = funded.map((p) => ({
    proposalId: p.id,
    included: true,
    lotTitle: lotTitle(cycle.interventionYear),
    procurementMethod: 'OPEN_COMPETITIVE_BIDDING',
    plannedStartDate: `${cycle.interventionYear}-02-01`,
    plannedEndDate: `${cycle.interventionYear}-09-30`,
  }));
  const draft = NeedsSubmissionDtoSchema.parse(await ok(ctx, KANO_DPP, 'put', `${N}/cycles/${cycleId}/beap`, { items, counterpartDeclaredNgn: 25_000_000 }));
  assert.equal(draft.status, 'DRAFT');
  const incomplete = await refused(ctx, KANO_DPP, 'post', `${N}/cycles/${cycleId}/beap/submit`, {}, 422, 'NEEDS_BEAP_INCOMPLETE');
  assert.ok((incomplete.details.problems as Array<{ field: string }>).some((p) => p.field === 'narrativeDocumentId'));

  const narrativeId = await fileCycleDocument(ctx, KANO_DPP, `${N}/cycles/${cycleId}/beap/documents`, 'BEAP', `Kano ${cycle.interventionYear} BEAP narrative`, funded.map((p) => p.id));
  await ok(ctx, KANO_DPP, 'put', `${N}/cycles/${cycleId}/beap`, { items, narrativeDocumentId: narrativeId, counterpartDeclaredNgn: 25_000_000 });
  const submitted = NeedsSubmissionDtoSchema.parse(await ok(ctx, KANO_DPP, 'post', `${N}/cycles/${cycleId}/beap/submit`, {}));
  assert.equal(submitted.status, 'IN_REVIEW');
  assert.equal(submitted.counterpartDeclaredNgn, 25_000_000);
  assert.equal(submitted.counterpartEvidenceDocumentId, null);
  assert.equal(submitted.steps.find((s) => s.state === 'CURRENT')?.label, 'UBEC Physical Planning review');
  assert.ok(submitted.items.every((i) => i.lotTitle && i.procurementMethod && i.plannedStartDate && i.plannedEndDate));
  // UBEC sees the submitted BEAP.
  assert.equal((await beap(ctx, DPP, cycleId)).canAct, true);
}

/**
 * MG-08: dpp@ comments on the first proposal and returns the BEAP; kano.dpp@ uploads a revised needs
 * assessment for it (source BEAP_REVISION: it stays at Funding, its costed amount and the BEAP item
 * follow the new total) and resubmits.
 */
export async function stepMG08(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const current = await beap(ctx, DPP, cycleId);
  const [first, ...rest] = current.items;
  const reviewed = NeedsSubmissionDtoSchema.parse(
    await ok(ctx, DPP, 'post', `${N}/cycles/${cycleId}/beap/review-items`, {
      items: [
        { proposalId: first.proposalId, outcome: 'COMMENTED', comment: 'The magnetic boards are priced above the market: revise the BoQ.' },
        ...rest.map((i) => ({ proposalId: i.proposalId, outcome: 'ACCEPTED', comment: null })),
      ],
    })
  );
  assert.equal(reviewed.items[0].reviewOutcome, 'COMMENTED');
  const returned = NeedsSubmissionDtoSchema.parse(await ok(ctx, DPP, 'post', `${N}/cycles/${cycleId}/beap/actions`, { decision: 'RETURN', notes: 'Revise the BoQ of the commented proposal and resubmit.' }));
  assert.equal(returned.status, 'RETURNED');

  // The revision: a new version of the commented proposal (cheaper boards).
  const cycle = await ctx.prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const spec = structuredClone(FIXTURE_SPECS.find((s) => s.name === 'mg-complete-valid')!);
  spec.project.interventionYear = cycle.interventionYear;
  spec.lines = spec.lines.map((l) => (l.itemCode === 'BRD-MAG' ? { ...l, rate: Math.round(l.rate * 0.9) } : l));
  const file = await buildFixtureFile(spec);
  const files = [{ fileName: 'Bebeji Garko BEAP revision.xlsx', fileBase64: file.toString('base64'), proposalId: first.proposalId }];
  const preview = await ok(ctx, KANO_DPP, 'post', `${N}/cycles/${cycleId}/uploads/preview`, { files });
  assert.equal(preview.files[0].status, 'VALID', JSON.stringify(preview.files[0].issues));
  await ok(ctx, KANO_DPP, 'post', `${N}/cycles/${cycleId}/uploads/confirm`, { files: files.map((f) => ({ ...f, sha256: sha(file) })) }, 201);
  const p = await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: first.proposalId }, include: { currentVersion: true } });
  assert.deepEqual([p.stage, p.status, p.currentVersion!.source], ['FUNDING', 'IN_PROGRESS', 'BEAP_REVISION'], 'a BEAP revision reopens no stage');
  assert.equal(Number(p.costedAmountNgn), Number(p.currentVersion!.costedTotalNgn));

  const resubmitted = NeedsSubmissionDtoSchema.parse(await ok(ctx, KANO_DPP, 'post', `${N}/cycles/${cycleId}/beap/submit`, {}));
  assert.equal(resubmitted.status, 'IN_REVIEW');
  const item = resubmitted.items.find((i) => i.proposalId === first.proposalId)!;
  assert.equal(item.amountNgn, Number(p.currentVersion!.costedTotalNgn), 'the item follows the revision');
  assert.equal(item.currentVersionNumber, p.currentVersion!.number);
  assert.equal(item.reviewOutcome, 'COMMENTED', "UBEC's comment stays on the item");
}

/** MG-09: dpp@ approves its review step, es@ approves for Executive Management; the proposals convert (owner Kano SUBEB, lot and batch from the BEAP). */
export async function stepMG09(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const cycle = await ctx.prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const advanced = NeedsSubmissionDtoSchema.parse(await ok(ctx, DPP, 'post', `${N}/cycles/${cycleId}/beap/actions`, { decision: 'APPROVE', notes: null }));
  assert.equal(advanced.steps.find((s) => s.state === 'CURRENT')?.label, 'UBEC Executive Management approval');
  const approved = NeedsSubmissionDtoSchema.parse(await ok(ctx, ES, 'post', `${N}/cycles/${cycleId}/beap/actions`, { decision: 'APPROVE', notes: 'Approved by Executive Management.' }));
  assert.equal(approved.status, 'APPROVED');

  const included = approved.items.filter((i) => i.included);
  const lotNumbers = new Set(included.map((i) => i.lotNumber));
  assert.equal(lotNumbers.size, 1, 'one lot title, one lot');
  assert.deepEqual(included.map((i) => i.batchNumber), included.map((_, k) => k + 1));
  for (const item of included) {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: item.projectId! }, include: { owningOrganization: true, lot: true } });
    assert.equal(project.origin, 'NEEDS_PIPELINE');
    assert.equal(project.owningOrganizationId, cycle.owningOrganizationId, 'owned by the SUBEB');
    assert.match(project.owningOrganization!.name, /Kano/);
    assert.equal(project.codePrefix, `${cycle.interventionYear}-LOT-${item.lotNumber}-BATCH-${item.batchNumber}`);
    assert.equal(item.projectCode, formatProjectCode(project.codePrefix));
    assert.equal(project.lot?.title, lotTitle(cycle.interventionYear));
    assert.equal(Number(project.totalBudgetNgn), item.amountNgn);
  }
  const list = await ctx.prisma.approvedList.findFirstOrThrow({ where: { tenantId: ctx.tenantId, kind: 'MG_BEAP', interventionYear: cycle.interventionYear, stateCode: cycle.stateCode }, include: { rows: { include: { projects: true } } } });
  assert.equal(list.rows.length, included.length);
  assert.ok(list.rows.every((r) => r.projects.length === 1));
  ctx.ids.mgProject = included[0].projectId!;
}

/**
 * Completes a converted draft's setup through the API (what the converted draft still lacks after
 * conversion: a contractor, the contract dates, a work phase with every unit on it, the team and a
 * visit officer, a located boundary). Used by MG-10 so activation can succeed.
 */
export async function completeConvertedDraftSetup(ctx: NeedsScenarioContext, projectId: string, as = ADMIN): Promise<void> {
  const url = (s: string) => `${P}/${projectId}${s}`;
  let dto = await ok(ctx, as, 'get', url('/setup'));
  const year = new Date().getUTCFullYear();
  const sprints = await ok(ctx, as, 'put', url('/scope/sprints'), { sprints: [{ name: 'Work phase 1', startDate: `${year + 1}-02-01`, endDate: `${year + 1}-08-31` }] });
  const sprintId = (sprints.sprints as Array<{ id: string }>)[0].id;
  const scope = await ok(ctx, as, 'get', url('/scope'));
  for (const unit of scope.units as Array<{ id: string }>) {
    await ok(ctx, as, 'patch', url(`/scope/units/${unit.id}`), { startSprintId: sprintId, endSprintId: sprintId });
  }
  const users = await ctx.prisma.user.findMany({ where: { email: { in: [ADMIN, 'resident.supervisor@ubec.test'] } } });
  const adminId = users.find((u) => u.email === ADMIN)!.id;
  const residentId = users.find((u) => u.email === 'resident.supervisor@ubec.test')!.id;
  const site = (dto.sites?.sites ?? []) as Array<{ latitude: number | null; longitude: number | null }>;
  const located = site.find((s) => s.latitude !== null && s.longitude !== null);
  const monitor = await ctx.prisma.organization.findFirstOrThrow({ where: { tenantId: ctx.tenantId, name: 'Independent M&E Consultants (COREN-certified)' } });
  const bodies: Record<string, unknown> = {
    parties: {
      owningOrganizationId: dto.parties.owningOrganization?.id ?? null,
      monitorOrganization: { id: monitor.id },
      lenderOrganization: dto.parties.lenderOrganization ? { id: dto.parties.lenderOrganization.id } : null,
      beneficiaries: (dto.parties.beneficiaries as Array<{ id: string; name: string }>).map((b) => ({ id: b.id, name: b.name, beneficiaryType: 'SCHOOL', isPrimary: true })),
    },
    basics: {
      name: dto.basics.name,
      codePrefix: dto.basics.codePrefix,
      stateLocation: dto.basics.stateLocation,
      lgaLocation: dto.basics.lgaLocation,
      totalBudgetNgn: dto.basics.totalBudgetNgn,
    },
    site: {
      geofence: dto.site.geofence ?? {
        mode: 'RADIAL',
        center: { latitude: located?.latitude ?? 11.67, longitude: located?.longitude ?? 8.26 },
        radiusMeters: 150,
      },
      geofenceToleranceMeters: null,
      timezone: 'Africa/Lagos',
    },
    contractor: {
      contractors: [{ organization: { name: `Funding gate test contractor ${crypto.randomUUID().slice(0, 8)}` }, tradeCategory: 'Building works', tradeCode: 'BLD', plannedCompletionDate: `${year + 1}-08-31` }],
    },
    contract: {
      contractReference: `CT/${projectId.slice(0, 8)}`,
      contractAwardDate: `${year + 1}-01-10`,
      contractSignedDate: `${year + 1}-01-15`,
      contractSumNgn: dto.basics.totalBudgetNgn,
      kickoffDate: `${year + 1}-01-20`,
    },
    team: { userIds: [adminId, residentId] },
  };
  for (const step of ['project', 'contract', 'scope', 'team']) {
    const wizard = (dto.wizardSteps as Array<{ id: string; sectionIds: string[] }>).find((w) => w.id === step)!;
    for (const sectionId of wizard.sectionIds) {
      const section = (dto.steps as Array<{ stepId: string; complete: boolean; required: boolean }>).find((s) => s.stepId === sectionId);
      if (section?.complete && !bodies[sectionId]) continue;
      if (sectionId === 'visits') await ok(ctx, as, 'put', url('/visit-officers'), { userIds: [residentId] });
      if (sectionId === 'scope' || sectionId === 'sites') continue;
      const res = await call(ctx, as, 'put', url(`/setup/${sectionId}`), (bodies[sectionId] ?? (sectionId === 'visits' ? { workWeekDays: [1, 2, 3, 4, 5] } : {})) as object);
      if (res.status !== 200 && !section?.required) continue;
      assert.equal(res.status, 200, `${sectionId}: ${JSON.stringify(res.body)}`);
      dto = res.body.data;
    }
  }
  dto = await ok(ctx, as, 'get', url('/setup'));
  const open = (dto.steps as Array<{ stepId: string; complete: boolean; required: boolean; issues: unknown[] }>).filter((s) => s.required && !s.complete);
  assert.deepEqual(open, [], 'every required section is complete');
}

/** MG-10: activation is refused until the State's counterpart evidence is recorded on the BEAP; then it goes live. */
export async function stepMG10(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const projectId = ctx.ids.mgProject;
  await completeConvertedDraftSetup(ctx, projectId);
  await refused(ctx, ADMIN, 'post', `${P}/${projectId}/activate`, {}, 409, 'COUNTERPART_EVIDENCE_REQUIRED');

  const evidenceId = await fileCycleDocument(ctx, KANO_DPP, `${N}/cycles/${cycleId}/beap/documents`, 'COUNTERPART_EVIDENCE', 'Kano counterpart funds: bank confirmation');
  const recorded = NeedsSubmissionDtoSchema.parse(
    await ok(ctx, KANO_DPP, 'put', `${N}/cycles/${cycleId}/beap/counterpart`, { counterpartDeclaredNgn: 25_000_000, counterpartEvidenceDocumentId: evidenceId })
  );
  assert.equal(recorded.status, 'APPROVED');
  assert.equal(recorded.counterpartEvidenceDocumentId, evidenceId);
  assert.ok(recorded.counterpartRecordedAt);

  const activated = await ok(ctx, ADMIN, 'post', `${P}/${projectId}/activate`, {});
  assert.equal(activated.status, 'ACTIVE');
}
