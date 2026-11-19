/**
 * Phase 7 tests: process configuration and templates, persona-aware briefs, the standards check,
 * report approval chains, the disbursement chain and direct milestone release.
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts). EDO-410 is
 * the seeded M&E-only project (direct milestone release, report approval on); LKK-402 runs the
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
let ai: typeof import('../integrations/azure-openai.service')['azureOpenAiService'];
let rules: typeof import('../modules/standards/standardsRules');
let persona: typeof import('../modules/morning-briefs/briefPersona');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const EDO_POINT = { latitude: 6.3176, longitude: 5.6145 };

const ids = {
  tenant: '',
  edo: '',
  lkk: '',
  edoT1: '',
  edoT2: '',
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
  return shared.calendarDateInTimeZone(new Date(Date.UTC(2025, 5, 1) + periodOffset * 86_400_000), 'UTC');
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
  ({ azureOpenAiService: ai } = await import('../integrations/azure-openai.service'));
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
  const tranches = await prisma.facilityTranche.findMany({ where: { projectId: ids.edo }, orderBy: { trancheNumber: 'asc' } });
  ids.edoT1 = tranches[0].id;
  ids.edoT2 = tranches[1].id;
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
  ai?.setBriefModelOverride(null);
  ai?.setStandardsModelOverride(null);
  await prisma?.$disconnect();
});

describe('Phase 7', { concurrency: false }, () => {
  // -------------------------------------------------------------------------
  describe('process configuration and chains', () => {
    it('defaults to the Phase 3 / Phase 4 behaviour', () => {
      const d = shared.DEFAULT_PROJECT_PROCESS_CONFIG;
      assert.equal(shared.ProjectProcessConfigSchema.parse(d).disbursementMechanism, 'IPC_CLAIM_REQUIRED');
      assert.equal(d.requireReportApproval, false);
      assert.equal(d.enableHoldPoints, true);
      assert.equal(d.allowContractorFieldReporting, true);
    });

    it('accepts the default chains and rejects the wrong shapes', () => {
      assert.deepEqual(shared.validateApprovalChain('REPORT', shared.defaultReportChain()), []);
      assert.deepEqual(shared.validateApprovalChain('DISBURSEMENT', shared.defaultDisbursementChain('IPC_CLAIM_REQUIRED')), []);
      const [cert, release] = shared.defaultDisbursementChain('IPC_CLAIM_REQUIRED');
      const review = { label: 'Credit review', requiredPermissionKey: 'audit:view_ledger', isSystemStep: false, minAmountThresholdNgn: 1000 };
      assert.deepEqual(shared.validateApprovalChain('DISBURSEMENT', [cert, review, release]), []);

      const codes = (steps: Parameters<typeof shared.validateApprovalChain>[1], t: 'REPORT' | 'DISBURSEMENT' = 'DISBURSEMENT') =>
        shared.validateApprovalChain(t, steps).map((i) => i.code);
      assert.ok(codes([release]).includes('CERTIFICATION_STEP_REQUIRED'));
      assert.ok(codes([cert, review]).includes('RELEASE_STEP_REQUIRED'));
      assert.ok(codes([review, cert, release]).includes('CERTIFICATION_STEP_REQUIRED'));
      assert.ok(codes([{ ...cert, minAmountThresholdNgn: 5 }, release]).includes('THRESHOLD_ON_SYSTEM_STEP'));
      assert.ok(codes([{ ...cert, stepOrder: 1 }, { ...release, stepOrder: 3 }]).includes('STEPS_NOT_CONTIGUOUS'));
      assert.ok(codes([], 'REPORT').includes('CHAIN_EMPTY'));
      assert.ok(codes([cert], 'REPORT').includes('SYSTEM_STEP_NOT_ALLOWED'));
      assert.ok(codes([{ ...review, requiredPermissionKey: 'nope:nope' }], 'REPORT').includes('UNKNOWN_PERMISSION'));
    });

    it('seeds three templates and gives every project its own rows', async () => {
      const res = await request(app).get('/api/v1/workflow-templates').set(await web('admin@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.length, 3);
      const edo = await request(app).get(`/api/v1/projects/${ids.edo}/process`).set(await web('verifier@insite.ng'));
      assert.equal(edo.status, 200, JSON.stringify(edo.body));
      assert.equal(edo.body.data.config.disbursementMechanism, 'MILESTONE_DIRECT_DISBURSEMENT');
      assert.equal(edo.body.data.config.requireReportApproval, true);
      assert.equal(edo.body.data.disbursementChain.steps[0].requiredPermissionKey, 'milestone:verify_direct_release');
      const lkk = await request(app).get(`/api/v1/projects/${ids.lkk}/process`).set(await web('monitor@insite.ng'));
      assert.equal(lkk.body.data.config.disbursementMechanism, 'IPC_CLAIM_REQUIRED');
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
      assert.equal(created.body.data.process.config.disbursementMechanism, 'IPC_CLAIM_REQUIRED');

      const templates = (await request(app).get('/api/v1/workflow-templates').set(admin)).body.data as Array<{ id: string; name: string; config: unknown }>;
      const rapid = templates.find((t) => t.name.startsWith('Rapid'))!;
      const applied = await request(app).post(`/api/v1/projects/${draftId}/process/apply-template`).set(admin).send({ templateId: rapid.id });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      assert.equal(applied.body.data.config.disbursementMechanism, 'MILESTONE_DIRECT_DISBURSEMENT');
      assert.equal(applied.body.data.workflowTemplateId, rapid.id);
      const rows = await prisma.approvalStep.count({ where: { projectId: draftId, isActive: true } });
      assert.equal(rows, 3); // report (1) + disbursement (2)

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
      const bad = await request(app)
        .put(`/api/v1/projects/${ids.lkk}/process/chains/DISBURSEMENT`)
        .set(admin)
        .send({ steps: [{ label: 'Only release', requiredPermissionKey: 'tranche:approve_disbursement', isSystemStep: true }] });
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

    it('refuses a mechanism change once valuations or IPCs exist', async () => {
      const lkk = (await request(app).get(`/api/v1/projects/${ids.lkk}/process`).set(await web('admin@insite.ng'))).body.data;
      const res = await request(app)
        .put(`/api/v1/projects/${ids.lkk}/process`)
        .set(await web('admin@insite.ng'))
        .send({ config: { ...lkk.config, disbursementMechanism: 'MILESTONE_DIRECT_DISBURSEMENT' } });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'DISBURSEMENT_MECHANISM_LOCKED');
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

    it('a verifier brief never tells the inspector to build: regenerates once, then falls back', async () => {
      const calls: string[] = [];
      ai.setBriefModelOverride(async (system) => {
        calls.push(system);
        return {
          headline: 'WBS 01.01 target',
          expectedDeliverable: 'Pour 5 m3 of column concrete and install the formwork.',
          reportingChecklist: ['Excavate the footing.', 'Record bags of cement.'],
        };
      });
      try {
        const res = await request(app)
          .post(`/api/v1/projects/${ids.edo}/boq/${ids.edoColumns}/morning-brief`)
          .set(field(ids.edoSession))
          .send({});
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(calls.length, 2);
        assert.match(calls[1], /previous answer/);
        const brief = res.body.data;
        assert.equal(brief.targetPersona, 'INDEPENDENT_VERIFIER');
        assert.equal(brief.generatedByAi, false);
        assert.equal(persona.containsExecutionInstruction(brief), false);
        assert.deepEqual(brief.appliedStandards.map((s: { code: string }) => s.code), ['CONC-SLUMP']);
      } finally {
        ai.setBriefModelOverride(null);
      }
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

    it('uses the provider when available', async () => {
      ai.setStandardsModelOverride(async (params) => ({
        passed: false,
        engine: 'AZURE_OPENAI',
        reasoning: 'stub',
        violations: [
          {
            standardCode: params.standards[0].code,
            standardTitle: params.standards[0].title,
            severity: 'CRITICAL',
            violationSummary: 'Block strength not recorded.',
            requiredRectification: 'Attach the block test certificate.',
          },
        ],
      }));
      try {
        const report = await submit(ids.edoSession, ids.edo, reportBody(ids.edoBlockwork, { summaryText: 'Blockwork rising on the east wing.', reportedQuantity: 40 }));
        await aiCheck.runAiOmissionCheck(report.id);
        const row = await prisma.workdayReport.findUniqueOrThrow({ where: { id: report.id } });
        assert.equal(row.standardsCompliancePassed, false);
        assert.match(row.aiCheckEngine ?? '', /AZURE_OPENAI/);
        const list = await request(app).get(`/api/v1/projects/${ids.edo}/workday-reports`).set(await web('verifier@insite.ng'));
        const dto = list.body.data.find((r: { id: string }) => r.id === report.id);
        assert.equal(dto.standardsViolations[0].standardCode, 'BLOCK-NIS87');
      } finally {
        ai.setStandardsModelOverride(null);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('report approval', () => {
    it('approves at the single default step; only approved reports count as evidence', async () => {
      const report = await submit(ids.edoSession, ids.edo, reportBody(ids.edoBlockwork, { summaryText: 'Blockwork 900 m2 in place, checked.', reportedQuantity: 900 }));
      assert.equal(report.status, 'PENDING_APPROVAL');
      assert.equal(report.currentApprovalStep, 1);
      const evidenceBefore = await provider.getEvidenceForBoqItems(ids.edo, [ids.edoBlockwork], new Date());
      assert.ok(!evidenceBefore.some((e) => e.id === report.id));

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
      const evidenceAfter = await provider.getEvidenceForBoqItems(ids.edo, [ids.edoBlockwork], new Date());
      assert.ok(evidenceAfter.some((e) => e.id === report.id));
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

  // -------------------------------------------------------------------------
  describe('direct milestone release and the disbursement chain', () => {
    it('is refused in the wrong mode either way', async () => {
      const direct = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/milestones/direct-verify`)
        .set(await web('monitor@insite.ng'))
        .send({
          trancheId: crypto.randomUUID(),
          verificationSummary: 'Verified progress on site.',
          lineVerifications: [{ boqItemId: ids.lkkItem, verifiedCumulativePct: 10 }],
          trancheRecommendation: 'SUPPORT_FULL_RELEASE',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(direct.status, 409, JSON.stringify(direct.body));
      assert.equal(direct.body.error.code, 'DISBURSEMENT_MODE_IS_IPC');

      const ipc = await request(app)
        .post(`/api/v1/projects/${ids.edo}/ipcs`)
        .set(await web('admin@insite.ng'))
        .send({
          trancheId: ids.edoT1,
          periodStart: '2025-01-01T00:00:00.000Z',
          periodEnd: '2025-02-01T00:00:00.000Z',
          lineItems: [{ boqItemId: ids.edoBlockwork, claimedCumulativePct: 10 }],
          supportingDocuments: [],
        });
      assert.equal(ipc.status, 409, JSON.stringify(ipc.body));
      assert.equal(ipc.body.error.code, 'DISBURSEMENT_MODE_IS_DIRECT');
    });

    it('runs a full cycle with no IPC: suggestion, bounds, CP block, segregation, release', async () => {
      const verifier = await web('verifier@insite.ng');
      const lender = await web('lender@insite.ng');
      const suggestion = await request(app)
        .get(`/api/v1/projects/${ids.edo}/milestones/direct-verify/suggestion?trancheId=${ids.edoT1}`)
        .set(verifier);
      assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
      const block = suggestion.body.data.items.find((i: { boqItemId: string }) => i.boqItemId === ids.edoBlockwork);
      // 900 m2 approved of 1,800 m2 (the 40 m2 report is still pending approval and does not count).
      assert.equal(block.evidenceQuantity, 900);
      assert.equal(block.maxVerifiablePct, 50);

      const body = (pct: number) => ({
        trancheId: ids.edoT1,
        verificationSummary: 'Blockwork verified against approved inspection reports.',
        lineVerifications: [{ boqItemId: ids.edoBlockwork, verifiedCumulativePct: pct }],
        trancheRecommendation: 'SUPPORT_FULL_RELEASE',
        certifierDigitalSignatureAck: true,
      });
      const tooHigh = await request(app).post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`).set(verifier).send(body(60));
      assert.equal(tooHigh.status, 422, JSON.stringify(tooHigh.body));
      assert.equal(tooHigh.body.error.code, 'VERIFIED_PCT_OUT_OF_BOUNDS');
      const totals = await request(app)
        .post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`)
        .set(verifier)
        .send({ ...body(40), totalCertifiedNgn: 1 });
      assert.equal(totals.status, 201, 'unknown client totals are stripped, never trusted');
      const valuation = totals.body.data.valuation;
      assert.equal(valuation.source, 'MILESTONE_DIRECT');
      assert.equal(valuation.ipcClaimId, null);
      assert.equal(valuation.totalCertifiedNgn, 0.4 * 1_800 * 45_000);
      assert.equal(valuation.approval.currentStepOrder, 2);

      const again = await request(app).post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`).set(verifier).send(body(45));
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'TRANCHE_HAS_OPEN_VERIFICATION');

      const byVerifier = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT1}/decision`)
        .set(verifier)
        .send({ valuationReportId: valuation.id, decision: 'APPROVE_FULL' });
      assert.equal(byVerifier.status, 403);

      await prisma.conditionPrecedent.updateMany({ where: { trancheId: ids.edoT1 }, data: { status: 'PENDING' } });
      const blocked = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT1}/decision`)
        .set(lender)
        .send({ valuationReportId: valuation.id, decision: 'APPROVE_FULL' });
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
      assert.equal(blocked.body.error.code, 'CONDITIONS_PRECEDENT_UNMET');
      await prisma.conditionPrecedent.updateMany({ where: { trancheId: ids.edoT1 }, data: { status: 'SATISFIED' } });

      const released = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT1}/decision`)
        .set(lender)
        .send({ valuationReportId: valuation.id, decision: 'APPROVE_FULL' });
      assert.equal(released.status, 200, JSON.stringify(released.body));
      assert.equal(released.body.data.approvedDisbursementAmountNgn, 0.4 * 1_800 * 45_000);
      const tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.edoT1 } });
      assert.equal(Number(tranche.releasedAmountNgn), 0.4 * 1_800 * 45_000);

      const pdf = await request(app)
        .get(`/api/v1/projects/${ids.edo}/valuations/${valuation.id}/valuation-report.pdf`)
        .set(verifier);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers['content-type'], 'application/pdf');
    });

    it('a third step with a threshold: runs above it, is skipped below it, and a return supersedes', async () => {
      const admin = await web('admin@insite.ng');
      const verifier = await web('verifier@insite.ng');
      const lender = await web('lender@insite.ng');
      const set = await request(app)
        .put(`/api/v1/projects/${ids.edo}/process/chains/DISBURSEMENT`)
        .set(admin)
        .send({
          steps: [
            { label: 'Milestone verification', requiredPermissionKey: 'milestone:verify_direct_release', isSystemStep: true },
            { label: 'Programme director review', requiredPermissionKey: 'projects:view_executive_matrix', minAmountThresholdNgn: 5_000_000 },
            { label: 'Disbursement approval', requiredPermissionKey: 'tranche:approve_disbursement', isSystemStep: true },
          ],
        });
      assert.equal(set.status, 200, JSON.stringify(set.body));

      // Move the roofing item to tranche 2 with approved evidence of 95 m2 (10%).
      await prisma.boqItem.update({ where: { id: ids.edoRoofing }, data: { trancheId: ids.edoT2 } });
      const big = await request(app)
        .post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`)
        .set(verifier)
        .send({
          trancheId: ids.edoT1,
          verificationSummary: 'Further blockwork verified.',
          lineVerifications: [{ boqItemId: ids.edoBlockwork, verifiedCumulativePct: 50 }],
          trancheRecommendation: 'SUPPORT_FULL_RELEASE',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(big.status, 201, JSON.stringify(big.body));
      const v = big.body.data.valuation;
      assert.equal(v.approval.currentStepOrder, 2);
      const early = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT1}/decision`)
        .set(lender)
        .send({ valuationReportId: v.id, decision: 'APPROVE_FULL' });
      assert.equal(early.status, 409);
      assert.equal(early.body.error.code, 'VALUATION_AWAITING_APPROVAL_STEP');

      const reviewed = await request(app)
        .post(`/api/v1/projects/${ids.edo}/valuations/${v.id}/review`)
        .set(admin)
        .send({ decision: 'RETURN', notes: 'Recheck the east wing area.' });
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
      const returned = await prisma.valuationReport.findUniqueOrThrow({ where: { id: v.id } });
      assert.ok(returned.supersededAt);
      const block = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.edoBlockwork } });
      assert.equal(Number(block.cumulativeCertifiedPct), 40);

      const second = await request(app)
        .post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`)
        .set(verifier)
        .send({
          trancheId: ids.edoT1,
          verificationSummary: 'East wing rechecked; blockwork verified.',
          lineVerifications: [{ boqItemId: ids.edoBlockwork, verifiedCumulativePct: 50 }],
          trancheRecommendation: 'SUPPORT_FULL_RELEASE',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const v2 = second.body.data.valuation;
      const approve = await request(app).post(`/api/v1/projects/${ids.edo}/valuations/${v2.id}/review`).set(admin).send({ decision: 'APPROVE' });
      assert.equal(approve.status, 200, JSON.stringify(approve.body));
      const decided = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT1}/decision`)
        .set(lender)
        .send({ valuationReportId: v2.id, decision: 'APPROVE_FULL' });
      assert.equal(decided.status, 200, JSON.stringify(decided.body));

      // Below the threshold: approve a small roofing report and verify 10% (NGN 9.31m > 5m? no: use 5%).
      const small = await submit(ids.edoSession, ids.edo, reportBody(ids.edoRoofing, { reportedQuantity: 40 }));
      await request(app).post(`/api/v1/projects/${ids.edo}/workday-reports/${small.id}/review`).set(verifier).send({ decision: 'APPROVE' });
      await request(app).post(`/api/v1/projects/${ids.edo}/workday-reports/${small.id}/review`).set(admin).send({ decision: 'APPROVE' });
      const low = await request(app)
        .post(`/api/v1/projects/${ids.edo}/milestones/direct-verify`)
        .set(verifier)
        .send({
          trancheId: ids.edoT2,
          verificationSummary: 'Roofing started; small quantity verified.',
          lineVerifications: [{ boqItemId: ids.edoRoofing, verifiedCumulativePct: 4 }],
          trancheRecommendation: 'SUPPORT_FULL_RELEASE',
          certifierDigitalSignatureAck: true,
        });
      assert.equal(low.status, 201, JSON.stringify(low.body));
      // NGN 3.724m is below the 5m threshold: the review step is skipped, straight to release.
      assert.equal(low.body.data.valuation.approval.currentStepOrder, 3);
      assert.equal(low.body.data.valuation.approval.steps[1].state, 'SKIPPED');
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

async function docxWithText(text: string): Promise<Buffer> {
  // jszip ships with mammoth; a minimal .docx is three XML parts.
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
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

  describe('text extraction', () => {
    it('reads plain text, PDF and .docx; images and legacy .doc never get invented text', async () => {
      const { extractDocumentText } = await import('../integrations/textExtractor');
      assert.equal((await extractDocumentText(Buffer.from(SAMPLE), 'text/plain')).status, 'OK');
      const pdf = await extractDocumentText(await pdfWithText(SAMPLE), 'application/pdf');
      assert.equal(pdf.status, 'OK', JSON.stringify(pdf));
      assert.match(pdf.status === 'OK' ? pdf.text : '', /maternity ward/);
      const docx = await extractDocumentText(
        await docxWithText(SAMPLE),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      assert.equal(docx.status, 'OK', JSON.stringify(docx));
      assert.match(docx.status === 'OK' ? docx.text : '', /solar backup/);
      assert.equal((await extractDocumentText(Buffer.from([0xff, 0xd8]), 'image/jpeg')).status, 'NO_TEXT');
      assert.equal((await extractDocumentText(Buffer.from('x'), 'application/msword')).status, 'UNSUPPORTED');
      assert.equal((await extractDocumentText(await pdfWithText(''), 'application/pdf')).status, 'NO_TEXT');
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

    it('stores documents; with no AI provider a readable file stays PENDING and an image is UNAVAILABLE', async () => {
      const verifier = await web('verifier@insite.ng');
      const register = async (bytes: Buffer, mimeType: string) => {
        const objectKey = await webUpload(ids.edo, verifier, bytes, mimeType);
        const res = await request(app).post(`/api/v1/projects/${ids.edo}/needs-assessments`).set(verifier).send({
          title: `Assessment ${mimeType}`,
          documentType: 'FEASIBILITY_STUDY',
          objectKey,
          mimeType,
          byteSize: bytes.length,
          requestAiSummary: true,
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return res.body.data.id as string;
      };
      const pdfId = await register(await pdfWithText(SAMPLE), 'application/pdf');
      const pngId = await register(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'image/png');

      const pdf = await request(app).post(`/api/v1/projects/${ids.edo}/needs-assessments/${pdfId}/summarise`).set(verifier);
      assert.equal(pdf.status, 200, JSON.stringify(pdf.body));
      assert.equal(pdf.body.data.summaryStatus, 'PENDING');
      assert.equal(pdf.body.data.extractedSummaryText, null);
      const png = await request(app).post(`/api/v1/projects/${ids.edo}/needs-assessments/${pngId}/summarise`).set(verifier);
      assert.equal(png.body.data.summaryStatus, 'UNAVAILABLE');
      assert.equal(png.body.data.extractedSummaryText, null);

      const removed = await request(app).delete(`/api/v1/projects/${ids.edo}/needs-assessments/${pngId}`).set(verifier);
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

    it('tranches and CPs off: a draft needs no tranche, and release skips unmet conditions precedent', async () => {
      const admin = await web('admin@insite.ng');
      const created = await request(app).post('/api/v1/projects').set(admin).send({
        name: 'No Tranche Clinic',
        codePrefix: 'NTR-702',
        stateLocation: 'Kwara State',
        totalBudgetNgn: 50_000_000,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const draftId = created.body.data.projectId as string;
      const facilityIssues = (setup: { steps: Array<{ stepId: string; issues: Array<{ code: string }> }> }) =>
        setup.steps.find((s) => s.stepId === 'facility')!.issues.map((i) => i.code);
      assert.ok(facilityIssues(created.body.data).includes('TRANCHE_REQUIRED'));
      const cfg = created.body.data.process.config;
      const off = await request(app).put(`/api/v1/projects/${draftId}/process`).set(admin).send({ config: { ...cfg, enableTranchesAndCps: false } });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      const setup = await request(app).get(`/api/v1/projects/${draftId}/setup`).set(admin);
      assert.ok(!facilityIssues(setup.body.data).includes('TRANCHE_REQUIRED'));

      // EDO-410 tranche 2 has a verification waiting at the release step (earlier test).
      const pending = await prisma.valuationReport.findFirstOrThrow({
        where: { trancheId: ids.edoT2, supersededAt: null },
        orderBy: { certifiedAt: 'desc' },
      });
      await prisma.conditionPrecedent.create({
        data: { trancheId: ids.edoT2, referenceCode: 'CP-09', description: 'Equipment warranty lodged', isMandatoryForRelease: true },
      });
      const lender = await web('lender@insite.ng');
      const blocked = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT2}/decision`)
        .set(lender)
        .send({ valuationReportId: pending.id, decision: 'APPROVE_FULL' });
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
      const edoCfg = (await request(app).get(`/api/v1/projects/${ids.edo}/process`).set(admin)).body.data.config;
      await request(app).put(`/api/v1/projects/${ids.edo}/process`).set(admin).send({ config: { ...edoCfg, enableTranchesAndCps: false } });
      const released = await request(app)
        .post(`/api/v1/projects/${ids.edo}/tranches/${ids.edoT2}/decision`)
        .set(lender)
        .send({ valuationReportId: pending.id, decision: 'APPROVE_FULL' });
      assert.equal(released.status, 200, JSON.stringify(released.body));
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
