/**
 * Phase 7 tests: process configuration and templates, persona-aware briefs, the standards check,
 * and report approval chains (redesign R1b removed the disbursement chain and direct milestone release).
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts). EDO-410 is
 * the seeded M&E-only project (report approval on); LKK-402 runs the
 * default Phase 3 process.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type Shared = typeof import('@insite/shared');

let app: Express;
let prisma: PrismaClientType;
let shared: Shared;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let aiCheck: typeof import('../modules/workday-reports/aiOmissionCheck');
let provider: typeof import('../modules/evidence/evidenceProvider');
let rules: typeof import('../modules/standards/standardsRules');
let persona: typeof import('../modules/morning-briefs/briefPersona');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const EDO_POINT = { latitude: 6.3176, longitude: 5.6145 };

const ids = {
  tenant: '',
  edo: '',
  lkk: '',
  edoColumns: '',
  edoBlockwork: '',
  edoRoofing: '',
  edoSession: '',
  edoSession2: '',
  lkkContractorSession: '',
  lkkItem: '',
};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

let periodOffset = 0;
function nextPeriod(): string {
  periodOffset += 1;
  // EDO-410 reports weekly (Phase 8): step a week at a time so each report has its own period.
  // 2025-06-04 is a Wednesday, so every date is a workday before the Saturday due time.
  return shared.calendarDateInTimeZone(new Date(Date.UTC(2025, 5, 4) + periodOffset * 7 * 86_400_000), 'UTC');
}

function reportBody(wbsItemId: string, overrides: Record<string, unknown> = {}, point = EDO_POINT) {
  const workdayDate = (overrides.workdayDate as string | undefined) ?? nextPeriod();
  return {
    clientReportId: crypto.randomUUID(),
    wbsItemId,
    workdayDate,
    reporterTimezone: 'Africa/Lagos',
    summaryText: 'Inspected the work in place and recorded quantities.',
    reportedQuantity: 0,
    unitOfMeasure: 'm2',
    isHoldPointClaimed: false,
    clientCaptureIds: [] as string[],
    textNotes: [],
    submissionGeotag: { ...point, accuracyMeters: 5, isMocked: false, capturedAt: `${workdayDate}T11:59:00.000Z` },
    confirmedAt: `${workdayDate}T12:00:00.000Z`,
    confirmedAsFinal: true,
    ...overrides,
  };
}

async function submit(sessionId: string, projectId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/projects/${projectId}/workday-reports`).set(field(sessionId)).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; status: string; currentApprovalStep: number; approvalChainVersion: number | null };
}

async function makeSession(projectId: string, roleCode: string, name: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: roleCode } });
  const joinCode = await prisma.projectJoinCode.findFirstOrThrow({ where: { projectId, roleId: role.id, isActive: true } });
  const s = await prisma.fieldAgentSession.create({
    data: {
      projectId,
      origin: 'JOIN_CODE',
      joinCodeId: joinCode.id,
      roleId: role.id,
      roleNameSnapshot: role.name,
      fieldPersonaType: role.fieldPersonaType,
      assuranceWeight: role.assuranceWeight,
      agentFullName: name,
      agentPhoneNumber: '+2348000000000',
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  return s.id;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  shared = await import('@insite/shared');
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  aiCheck = await import('../modules/workday-reports/aiOmissionCheck');
  provider = await import('../modules/evidence/evidenceProvider');
  rules = await import('../modules/standards/standardsRules');
  persona = await import('../modules/morning-briefs/briefPersona');
  const { createApp } = await import('../app');
  app = createApp();
  aiCheck.setAiOmissionCheckScheduler(() => undefined);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const project = (code: string) =>
    prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } }).then((p) => p.id);
  ids.edo = await project('EDO-410');
  ids.lkk = await project('LKK-402');
  const item = (wbs: string) => prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.edo, wbsCode: wbs } }).then((b) => b.id);
  ids.edoColumns = await item('01.01');
  ids.edoBlockwork = await item('01.02');
  ids.edoRoofing = await item('01.03');
  ids.edoSession = await makeSession(ids.edo, 'INDEPENDENT_RESIDENT', 'M&E Officer Ada');
  ids.edoSession2 = await makeSession(ids.edo, 'INDEPENDENT_RESIDENT', 'M&E Officer Bisi');
  ids.lkkContractorSession = (
    await prisma.fieldAgentSession.findFirstOrThrow({
      where: { projectId: ids.lkk, fieldPersonaType: 'CONTRACTOR_EXECUTOR', assuranceStatus: 'APPROVED' },
    })
  ).id;
  ids.lkkItem = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.lkk }, orderBy: { wbsCode: 'asc' } })).id;
});

after(async () => {
  aiCheck?.setAiOmissionCheckScheduler(null);
  await prisma?.$disconnect();
});

describe('Phase 7', { concurrency: false }, () => {
  // -------------------------------------------------------------------------
  describe('process configuration and chains', () => {
    it('defaults to the Phase 3 / Phase 4 behaviour', () => {
      const d = shared.DEFAULT_PROJECT_PROCESS_CONFIG;
      assert.equal('disbursementMechanism' in shared.ProjectProcessConfigSchema.parse(d), false, 'redesign R1b: no disbursement');
      assert.equal(d.requireReportApproval, false);
      assert.equal(d.enableHoldPoints, true);
      assert.equal(d.allowContractorFieldReporting, true);
    });

    it('accepts the default chains and rejects the wrong shapes', () => {
      assert.deepEqual(shared.validateApprovalChain('REPORT', shared.defaultReportChain()), []);
      const [approve] = shared.defaultReportChain();
      const review = { label: 'Second review', requiredPermissionKey: 'audit:view_ledger', isSystemStep: false };
      assert.deepEqual(shared.validateApprovalChain('REPORT', [approve, review]), []);

      const codes = (steps: Parameters<typeof shared.validateApprovalChain>[1]) =>
        shared.validateApprovalChain('REPORT', steps).map((i) => i.code);
      assert.ok(codes([{ ...approve, minAmountThresholdNgn: 5 }]).includes('THRESHOLD_NOT_ALLOWED'));
      assert.ok(codes([{ ...approve, stepOrder: 1 }, { ...review, stepOrder: 3 }]).includes('STEPS_NOT_CONTIGUOUS'));
      assert.ok(codes([]).includes('CHAIN_EMPTY'));
      assert.ok(codes([{ ...approve, isSystemStep: true }]).includes('SYSTEM_STEP_NOT_ALLOWED'));
      assert.ok(codes([{ ...review, requiredPermissionKey: 'nope:nope' }]).includes('UNKNOWN_PERMISSION'));
    });

    it('seeds three templates and gives every project its own rows', async () => {
      const res = await request(app).get('/api/v1/workflow-templates').set(await web('admin@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.length, 3);
      const edo = await request(app).get(`/api/v1/projects/${ids.edo}/process`).set(await web('verifier@insite.ng'));
      assert.equal(edo.status, 200, JSON.stringify(edo.body));
      assert.equal(edo.body.data.config.requireReportApproval, true);
      assert.equal(edo.body.data.config.allowContractorFieldReporting, false);
      assert.equal(edo.body.data.disbursementChain, undefined);
      const lkk = await request(app).get(`/api/v1/projects/${ids.lkk}/process`).set(await web('monitor@insite.ng'));
      assert.equal(lkk.body.data.config.requireReportApproval, false);
    });

    it('copies a template into a draft; later template edits do not change the project', async () => {
      const admin = await web('admin@insite.ng');
      const created = await request(app).post('/api/v1/projects').set(admin).send({
        name: 'Template Test Clinic',
        codePrefix: 'TPL-701',
        stateLocation: 'Oyo State',
        totalBudgetNgn: 100_000_000,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const draftId = created.body.data.projectId as string;
      // A new draft gets the tenant default template.
      assert.equal(created.body.data.process.config.allowContractorFieldReporting, true);

      const templates = (await request(app).get('/api/v1/workflow-templates').set(admin)).body.data as Array<{ id: string; name: string; config: unknown }>;
      const rapid = templates.find((t) => t.name.startsWith('Lightweight'))!;
      const applied = await request(app).post(`/api/v1/projects/${draftId}/process/apply-template`).set(admin).send({ templateId: rapid.id });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      assert.equal(applied.body.data.config.allowContractorFieldReporting, false);
      assert.equal(applied.body.data.workflowTemplateId, rapid.id);
      const rows = await prisma.approvalStep.count({ where: { projectId: draftId, isActive: true } });
      assert.equal(rows, 1); // the report chain

      const edited = await request(app)
        .put(`/api/v1/workflow-templates/${rapid.id}`)
        .set(admin)
        .send({
          name: rapid.name,
          isDefault: false,
          config: {
            ...(rapid.config as Record<string, unknown>),
            process: { ...(rapid.config as { process: Record<string, unknown> }).process, requireReportApproval: true, enableHoldPoints: false },
          },
        });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      const after = await request(app).get(`/api/v1/projects/${draftId}/process`).set(admin);
      assert.equal(after.body.data.config.requireReportApproval, false);
      assert.equal(after.body.data.config.enableHoldPoints, true);
    });

    it('chain edits write a new version and refuse invalid chains', async () => {
      const admin = await web('admin@insite.ng');
      const gone = await request(app)
        .put(`/api/v1/projects/${ids.lkk}/process/chains/DISBURSEMENT`)
        .set(admin)
        .send({ steps: [{ label: 'QS approval', requiredPermissionKey: 'reports:approve_completion' }] });
      assert.equal(gone.status, 404, 'redesign R1b: the disbursement chain no longer exists');
      const bad = await request(app)
        .put(`/api/v1/projects/${ids.lkk}/process/chains/REPORT`)
        .set(admin)
        .send({ steps: [{ label: 'System step', requiredPermissionKey: 'reports:approve_completion', isSystemStep: true }] });
      assert.equal(bad.status, 422, JSON.stringify(bad.body));

      const before = (await request(app).get(`/api/v1/projects/${ids.lkk}/process`).set(admin)).body.data;
      const ok = await request(app)
        .put(`/api/v1/projects/${ids.lkk}/process/chains/REPORT`)
        .set(admin)
        .send({ steps: [{ label: 'QS approval', requiredPermissionKey: 'reports:approve_completion' }] });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.data.reportChain.version, before.reportChain.version + 1);
      assert.ok(await prisma.approvalStep.findFirst({ where: { projectId: ids.lkk, chainType: 'REPORT', version: before.reportChain.version, isActive: false } }));
    });

  });

  // -------------------------------------------------------------------------
  describe('persona-aware briefs', () => {
    it('detects execution instructions aimed at the reader', () => {
      const yes = { headline: 'WBS 01.01', expectedDeliverable: 'Pour the column concrete today.', reportingChecklist: ['Photograph it.', 'Record it.'] };
      const also = { headline: 'x', expectedDeliverable: 'You must install the roof sheets.', reportingChecklist: ['a', 'b'] };
      const no = { headline: 'Inspect WBS 01.01', expectedDeliverable: 'Verify the concrete poured today.', reportingChecklist: ['Witness the slump test.', 'Measure the cover.'] };
      assert.equal(persona.containsExecutionInstruction(yes), true);
      assert.equal(persona.containsExecutionInstruction(also), true);
      assert.equal(persona.containsExecutionInstruction(no), false);
    });

    it('a verifier brief never tells the inspector to build', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.edo}/boq/${ids.edoColumns}/morning-brief`)
        .set(field(ids.edoSession))
        .send({});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const brief = res.body.data;
      assert.equal(brief.targetPersona, 'INDEPENDENT_VERIFIER');
      assert.equal(brief.generatedByAi, false);
      assert.equal(persona.containsExecutionInstruction(brief), false);
      assert.deepEqual(brief.appliedStandards.map((s: { code: string }) => s.code), ['CONC-SLUMP']);
    });

    it('a contractor brief lists its standards; the two personas are cached separately', async () => {
      await prisma.projectStandardSpecification.create({
        data: {
          projectId: ids.lkk,
          code: 'HSE-SITE',
          title: 'Site safety',
          category: 'SAFETY_ENVIRONMENT',
          specificationText: 'Workers on site wear PPE at all times.',
          applicableWbsCodes: [],
          isMandatory: false,
          createdByUserId: (await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } })).id,
        },
      });
      const contractor = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/boq/${ids.lkkItem}/morning-brief`)
        .set(field(ids.lkkContractorSession))
        .send({});
      assert.equal(contractor.status, 201, JSON.stringify(contractor.body));
      assert.equal(contractor.body.data.targetPersona, 'CONTRACTOR_EXECUTOR');
      assert.ok(contractor.body.data.reportingChecklist.some((l: string) => l.includes('HSE-SITE')));
      assert.deepEqual(contractor.body.data.appliedStandards.map((s: { code: string }) => s.code), ['HSE-SITE']);

      const verifier = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/boq/${ids.lkkItem}/morning-brief?persona=INDEPENDENT_VERIFIER`)
        .set(await web('monitor@insite.ng'))
        .send({ targetPersona: 'INDEPENDENT_VERIFIER' });
      assert.equal(verifier.status, 201, JSON.stringify(verifier.body));
      assert.equal(verifier.body.data.targetPersona, 'INDEPENDENT_VERIFIER');
      assert.notEqual(verifier.body.data.id, contractor.body.data.id);
      const rows = await prisma.morningDeliverableBrief.count({ where: { projectId: ids.lkk, boqItemId: ids.lkkItem } });
      assert.equal(rows, 2);
    });

    it('forces the verifier brief when contractor reporting is off, and skips contractor dispatch', async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${ids.edo}/morning-briefs?persona=CONTRACTOR_EXECUTOR`)
        .set(await web('verifier@insite.ng'));
      assert.equal(res.status, 200);
      for (const b of res.body.data) assert.equal(b.targetPersona, 'INDEPENDENT_VERIFIER');
      const { briefPersonasForProject } = await import('../modules/morning-briefs/morningBrief.service');
      assert.deepEqual(await briefPersonasForProject(ids.edo), ['INDEPENDENT_VERIFIER']);
    });
  });

  // -------------------------------------------------------------------------
  describe('standards check', () => {
    it('rule-based evaluator flags an out-of-tolerance value and a missing test', () => {
      const standards = [
        { code: 'CONC-SLUMP', title: 'Slump', specificationText: 'Slump 75 ± 25 mm for structural concrete.', isMandatory: true },
        { code: 'CONC-CUBE', title: 'Cubes', specificationText: 'Cast cube samples for each pour and attach the lab cube test certificate.', isMandatory: false },
      ];
      const out = rules.evaluateStandardsByRules(standards, { text: 'Poured columns. Slump 140 mm.', captureMediaTypes: [], reportedQuantity: 5 });
      assert.equal(out.decided, true);
      assert.equal(out.passed, false);
      assert.deepEqual(out.violations.map((v) => `${v.standardCode}:${v.severity}`).sort(), ['CONC-CUBE:WARNING', 'CONC-SLUMP:CRITICAL']);

      const ok = rules.evaluateStandardsByRules(standards, { text: 'Slump 80mm, 6 cubes cast.', captureMediaTypes: [], reportedQuantity: 5 });
      assert.equal(ok.passed, true);
      const undecided = rules.evaluateStandardsByRules(
        [{ code: 'GEN', title: 'General', specificationText: 'Follow the approved drawings.', isMandatory: true }],
        { text: 'Done.', captureMediaTypes: [], reportedQuantity: 1 }
      );
      assert.equal(undecided.passed, null);
    });

    it('a failing report gets an AI_STANDARDS_CHECK query, a web notification and an audit entry (rules engine)', async () => {
      const report = await submit(ids.edoSession, ids.edo, reportBody(ids.edoColumns, {
        summaryText: 'Witnessed the column pour. Slump 140 mm measured on the first batch.',
        reportedQuantity: 5,
        unitOfMeasure: 'm3',
      }));
      assert.equal(report.status, 'PENDING_APPROVAL');
      assert.equal(await aiCheck.runAiOmissionCheck(report.id), 'DONE');
      const row = await prisma.workdayReport.findUniqueOrThrow({ where: { id: report.id } });
      assert.equal(row.standardsCompliancePassed, false);
      const query = await prisma.reportQuery.findFirstOrThrow({ where: { workdayReportId: report.id, source: 'AI_STANDARDS_CHECK' } });
      assert.ok(Array.isArray(query.standardsViolationsPayload));
      assert.ok(await prisma.webNotification.findFirst({ where: { projectId: ids.edo, category: 'STANDARDS_VIOLATION_FLAGGED' } }));
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.edo, action: 'STANDARDS_VIOLATION_FLAGGED' } }));
    });
  });

  // -------------------------------------------------------------------------
  describe('report approval', () => {
    it('approves at the single default step; only approved reports count towards progress', async () => {
      const report = await submit(ids.edoSession, ids.edo, reportBody(ids.edoBlockwork, { summaryText: 'Blockwork 900 m2 in place, checked.', reportedQuantity: 900 }));
      assert.equal(report.status, 'PENDING_APPROVAL');
      assert.equal(report.currentApprovalStep, 1);
      const blockwork = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.edoBlockwork } });
      const progressOf = async () =>
        (await provider.getReportedProgressByItem(ids.edo, [{ id: blockwork.id, totalQuantity: Number(blockwork.totalQuantity) }])).get(blockwork.id) ?? 0;
      const before = await progressOf();

      const wrong = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('lender@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(wrong.status, 403, JSON.stringify(wrong.body));
      assert.equal(wrong.body.error.code, 'NOT_STEP_APPROVER');

      const ok = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.data.status, 'APPROVED_COMPLETED');
      assert.equal(ok.body.data.approval.completed, true);
      assert.ok((await progressOf()) > before, 'the approved report counts');
      const item = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.edoBlockwork } });
      assert.equal(Number(item.cumulativeCertifiedPct), Math.round((await progressOf()) * 100) / 100, 'progress refreshed on approval');
    });

    it('a two-step chain advances, refuses the same user on consecutive steps, and completes', async () => {
      const admin = await web('admin@insite.ng');
      const set = await request(app)
        .put(`/api/v1/projects/${ids.edo}/process/chains/REPORT`)
        .set(admin)
        .send({
          steps: [
            { label: 'M&E officer review', requiredPermissionKey: 'reports:approve_completion' },
            { label: 'Programme manager sign-off', requiredPermissionKey: 'reports:approve_completion' },
          ],
        });
      assert.equal(set.status, 200, JSON.stringify(set.body));

      const report = await submit(ids.edoSession, ids.edo, reportBody(ids.edoRoofing, { reportedQuantity: 100 }));
      const step1 = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(step1.status, 200, JSON.stringify(step1.body));
      assert.equal(step1.body.data.status, 'PENDING_APPROVAL');
      assert.equal(step1.body.data.currentApprovalStep, 2);

      const same = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(same.status, 403, JSON.stringify(same.body));
      assert.equal(same.body.error.code, 'SAME_USER_CONSECUTIVE_STEPS');

      const step2 = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(admin)
        .send({ decision: 'APPROVE' });
      assert.equal(step2.status, 200, JSON.stringify(step2.body));
      assert.equal(step2.body.data.status, 'APPROVED_COMPLETED');
    });

    it('a return raises a query; the revision re-enters at step 1 on the same chain version', async () => {
      const report = await submit(ids.edoSession2, ids.edo, reportBody(ids.edoRoofing, { reportedQuantity: 50 }));
      const noNotes = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'RETURN' });
      assert.equal(noNotes.status, 400);

      const returned = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'RETURN', notes: 'Add the roof sheet gauge and photos.' });
      assert.equal(returned.status, 200, JSON.stringify(returned.body));
      assert.equal(returned.body.data.status, 'RETURNED_FOR_REVISION');
      const query = await prisma.reportQuery.findFirstOrThrow({ where: { workdayReportId: report.id, status: 'OPEN' } });

      const original = await prisma.workdayReport.findUniqueOrThrow({ where: { id: report.id } });
      const revised = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/revalidate`)
        .set(field(ids.edoSession2))
        .send({
          clientReportId: crypto.randomUUID(),
          reportQueryId: query.id,
          reporterTimezone: 'Africa/Lagos',
          summaryText: 'Roof sheets 0.55mm gauge, photos attached.',
          clientCaptureIds: [],
          textNotes: [],
          submissionGeotag: { ...EDO_POINT, accuracyMeters: 5, isMocked: false, capturedAt: new Date().toISOString() },
          confirmedAt: new Date().toISOString(),
          confirmedAsFinal: true,
        });
      assert.equal(revised.status, 201, JSON.stringify(revised.body));
      assert.equal(revised.body.data.status, 'PENDING_APPROVAL');
      assert.equal(revised.body.data.currentApprovalStep, 1);
      assert.equal(revised.body.data.approvalChainVersion, original.approvalChainVersion);

      const stale = await request(app)
        .post(`/api/v1/projects/${ids.edo}/workday-reports/${report.id}/review`)
        .set(await web('verifier@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(stale.status, 409);
    });
  });
});

// ---------------------------------------------------------------------------
// Gap closure: settings side effects, standards documents and text extraction
// ---------------------------------------------------------------------------

async function webUpload(projectId: string, headers: Record<string, string>, bytes: Buffer, mimeType: string) {
  const presign = await request(app)
    .post(`/api/v1/projects/${projectId}/evidence/presign`)
    .set(headers)
    .send({ mediaType: 'PROJECT_DOCUMENT', fileName: 'doc.bin', mimeType, byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const url = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(url.pathname + url.search).set('Content-Type', mimeType).send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return presign.body.data.objectKey as string;
}

async function pdfWithText(text: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    if (text) doc.text(text);
    doc.end();
  });
}

describe('Phase 7 gap closure', { concurrency: false }, () => {
  const ogn = { id: '', contractorSession: '', holdItem: '' };
  const OGN_POINT = { latitude: 6.951, longitude: 3.4 };
  const SAMPLE = 'The Ikpoba Hill community needs a maternity ward, clean water and solar backup for the cold chain.';

  before(async () => {
    ogn.id = (await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'OGN-305' } })).id;
    ogn.contractorSession = await makeSession(ogn.id, 'CONTRACTOR_ENGINEER', 'Contractor Engr Femi');
    ogn.holdItem = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: ogn.id }, orderBy: { wbsCode: 'asc' } })).id;
    await prisma.boqItem.update({
      where: { id: ogn.holdItem },
      data: { isHoldPoint: true, holdPointInstruction: 'Inspect sub-base before asphalt' },
    });
  });

  describe('standards and needs-assessment documents', () => {
    it('creates, refuses a duplicate code, updates and deletes a standard; field users can read', async () => {
      const verifier = await web('verifier@insite.ng');
      const created = await request(app).post(`/api/v1/projects/${ids.edo}/standards`).set(verifier).send({
        code: 'ROOF-01',
        title: 'Roof sheet gauge',
        category: 'MATERIAL_QUALITY',
        specificationText: 'Roof sheet thickness minimum 0.55 mm.',
        applicableWbsCodes: ['01.03'],
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const dup = await request(app).post(`/api/v1/projects/${ids.edo}/standards`).set(verifier).send({
        code: 'ROOF-01',
        title: 'Again',
        category: 'MATERIAL_QUALITY',
        specificationText: 'Duplicate code test text.',
      });
      assert.equal(dup.status, 409);
      const lender = await request(app).post(`/api/v1/projects/${ids.edo}/standards`).set(await web('lender@insite.ng')).send({
        code: 'X-1',
        title: 'Not allowed',
        category: 'GENERAL_SPECIFICATION',
        specificationText: 'Lender cannot add standards.',
      });
      assert.equal(lender.status, 403);
      const updated = await request(app)
        .patch(`/api/v1/projects/${ids.edo}/standards/${created.body.data.id}`)
        .set(verifier)
        .send({ isMandatory: false });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(updated.body.data.isMandatory, false);
      const fieldList = await request(app).get(`/api/v1/projects/${ids.edo}/standards`).set(field(ids.edoSession));
      assert.equal(fieldList.status, 200);
      assert.ok(fieldList.body.data.some((s: { code: string }) => s.code === 'ROOF-01'));
      const removed = await request(app).delete(`/api/v1/projects/${ids.edo}/standards/${created.body.data.id}`).set(verifier);
      assert.equal(removed.status, 200);
      assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.edo, action: 'PROJECT_STANDARD_DELETED' } }));
    });

    it('stores a needs-assessment document and deletes it', async () => {
      const verifier = await web('verifier@insite.ng');
      const bytes = await pdfWithText(SAMPLE);
      const objectKey = await webUpload(ids.edo, verifier, bytes, 'application/pdf');
      const res = await request(app).post(`/api/v1/projects/${ids.edo}/needs-assessments`).set(verifier).send({
        title: 'Assessment PDF',
        documentType: 'FEASIBILITY_STUDY',
        objectKey,
        mimeType: 'application/pdf',
        byteSize: bytes.length,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.title, 'Assessment PDF');
      const removed = await request(app).delete(`/api/v1/projects/${ids.edo}/needs-assessments/${res.body.data.id}`).set(verifier);
      assert.equal(removed.status, 200);
    });
  });

  describe('settings side effects', () => {
    it('contractor reporting off: needs confirmation, deactivates codes, refuses contractor reports, forces verifier briefs; on again reissues codes', async () => {
      const admin = await web('admin@insite.ng');
      const current = (await request(app).get(`/api/v1/projects/${ogn.id}/process`).set(admin)).body.data;
      assert.ok(current.activeContractorJoinCodeCount > 0);
      const off = { ...current.config, allowContractorFieldReporting: false };
      const unconfirmed = await request(app).put(`/api/v1/projects/${ogn.id}/process`).set(admin).send({ config: off });
      assert.equal(unconfirmed.status, 409);
      assert.equal(unconfirmed.body.error.code, 'CONFIRMATION_REQUIRED');
      const confirmed = await request(app)
        .put(`/api/v1/projects/${ogn.id}/process`)
        .set(admin)
        .send({ config: off, confirmDeactivateContractorCodes: true });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(confirmed.body.data.activeContractorJoinCodeCount, 0);

      const refused = await request(app)
        .post(`/api/v1/projects/${ogn.id}/workday-reports`)
        .set(field(ogn.contractorSession))
        .send(reportBody(ogn.holdItem, { unitOfMeasure: 'm2' }, OGN_POINT));
      assert.equal(refused.status, 403, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, 'CONTRACTOR_FIELD_REPORTING_DISABLED');

      const brief = await request(app)
        .post(`/api/v1/projects/${ogn.id}/boq/${ogn.holdItem}/morning-brief`)
        .set(field(ogn.contractorSession))
        .send({});
      assert.equal(brief.status, 201, JSON.stringify(brief.body));
      assert.equal(brief.body.data.targetPersona, 'INDEPENDENT_VERIFIER');

      const on = await request(app)
        .put(`/api/v1/projects/${ogn.id}/process`)
        .set(admin)
        .send({ config: { ...off, allowContractorFieldReporting: true } });
      assert.equal(on.status, 200, JSON.stringify(on.body));
      assert.ok(on.body.data.activeContractorJoinCodeCount > 0);
    });

    it('identity assurance off: an unverified contractor report is accepted, not staged', async () => {
      const admin = await web('admin@insite.ng');
      await prisma.fieldAgentSession.update({ where: { id: ogn.contractorSession }, data: { assuranceStatus: 'PENDING_APPROVAL' } });
      const config = (await request(app).get(`/api/v1/projects/${ogn.id}/process`).set(admin)).body.data.config;
      const staged = await submit(ogn.contractorSession, ogn.id, reportBody(ogn.holdItem, { unitOfMeasure: 'm2' }, OGN_POINT));
      assert.equal(staged.status, 'STAGED_UNVERIFIED');
      const off = await request(app)
        .put(`/api/v1/projects/${ogn.id}/process`)
        .set(admin)
        .send({ config: { ...config, enableContractorIdentityAssurance: false } });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      const accepted = await submit(ogn.contractorSession, ogn.id, reportBody(ogn.holdItem, { unitOfMeasure: 'm2' }, OGN_POINT));
      assert.equal(accepted.status, 'CONFIRMED');
    });

    it('hold points off: briefs show no hold point', async () => {
      const admin = await web('admin@insite.ng');
      const config = (await request(app).get(`/api/v1/projects/${ogn.id}/process`).set(admin)).body.data.config;
      const before = await request(app)
        .post(`/api/v1/projects/${ogn.id}/boq/${ogn.holdItem}/morning-brief`)
        .set(admin)
        .send({ targetPersona: 'CONTRACTOR_EXECUTOR' });
      assert.equal(before.status, 201, JSON.stringify(before.body));
      assert.equal(before.body.data.isHoldPoint, true);
      await request(app).put(`/api/v1/projects/${ogn.id}/process`).set(admin).send({ config: { ...config, enableHoldPoints: false } });
      const after = await request(app)
        .post(`/api/v1/projects/${ogn.id}/boq/${ogn.holdItem}/morning-brief`)
        .set(admin)
        .send({ targetPersona: 'CONTRACTOR_EXECUTOR' });
      assert.equal(after.body.data.isHoldPoint, false);
      assert.equal(after.body.data.holdPointInstruction, null);
    });

    it('a provisioned contractor account does not see a project with contractor reporting off', async () => {
      const admin = await web('admin@insite.ng');
      const role = await prisma.role.update({
        where: { tenantId_code: { tenantId: ids.tenant, code: 'CONTRACTOR_ENGINEER' } },
        data: { onboardingMode: 'PROVISIONED_ACCOUNT', requiresIdentityAssurance: false },
      });
      const user = await prisma.user.update({ where: { email: 'contractor@insite.ng' }, data: { mobileRoleId: role.id } });
      await prisma.userProjectAssignment.upsert({
        where: { userId_projectId: { userId: user.id, projectId: ogn.id } },
        create: { userId: user.id, projectId: ogn.id },
        update: {},
      });
      const { invalidateUserAuthCache } = await import('../middleware/auth.middleware');
      invalidateUserAuthCache(user.id);
      const login = async () => {
        const { publicKey } = crypto.generateKeyPairSync('ed25519');
        const x = publicKey.export({ format: 'jwk' }).x as string;
        const res = await request(app).post('/api/v1/auth/mobile/login').send({
          email: 'contractor@insite.ng',
          password: PASSWORD,
          deviceId: crypto.randomUUID(),
          devicePublicKey: Buffer.from(x, 'base64url').toString('base64'),
          devicePublicKeyAlg: 'ED25519',
        });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return (res.body.data.projects as Array<{ codePrefix: string }>).map((p) => p.codePrefix);
      };
      assert.ok((await login()).includes('OGN-305'));
      const cfg = (await request(app).get(`/api/v1/projects/${ogn.id}/process`).set(admin)).body.data.config;
      const off = await request(app)
        .put(`/api/v1/projects/${ogn.id}/process`)
        .set(admin)
        .send({ config: { ...cfg, allowContractorFieldReporting: false }, confirmDeactivateContractorCodes: true });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.ok(!(await login()).includes('OGN-305'));
    });
  });
});
