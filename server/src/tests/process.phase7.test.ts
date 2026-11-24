/**
 * Phase 7 tests: process configuration, templates and chains, standards and needs-assessment
 * documents (redesign R1b removed the disbursement chain; R5f removed workday reports, the standards
 * check and hold points: report approval is exercised on visits in routes.r4).
 *
 * Runs against a disposable database rebuilt from migrations (see helpers/testDb.ts). EDO-410 is
 * the seeded M&E-only project (report approval on); LKK-402 runs the
 * default Phase 3 process.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type Shared = typeof import('@insite/shared');

let app: Express;
let prisma: PrismaClientType;
let shared: Shared;

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};

const ids = {
  tenant: '',
  edo: '',
  lkk: '',
  edoSession: '',
};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => fieldAuth(prisma, sessionId);

async function makeSession(projectId: string, roleCode: string, name: string) {
  return (await createFieldSession(prisma, { projectId, roleCode, name, phoneNumber: '+2348000000000' })).sessionId;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  shared = await import('@insite/shared');
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const project = (code: string) =>
    prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: code } }).then((p) => p.id);
  ids.edo = await project('EDO-410');
  ids.lkk = await project('LKK-402');
  ids.edoSession = await makeSession(ids.edo, 'INDEPENDENT_RESIDENT', 'M&E Officer Ada');
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 7', { concurrency: false }, () => {
  // -------------------------------------------------------------------------
  describe('process configuration and chains', () => {
    it('defaults to the Phase 3 / Phase 4 behaviour', () => {
      const d = shared.DEFAULT_PROJECT_PROCESS_CONFIG;
      assert.equal('disbursementMechanism' in shared.ProjectProcessConfigSchema.parse(d), false, 'redesign R1b: no disbursement');
      assert.equal(d.requireReportApproval, false);
      // Redesign R5f: no hold-point or report-check switches.
      assert.equal('enableHoldPoints' in (d as Record<string, unknown>), false);
      assert.equal('enableAiOmissionCheck' in (d as Record<string, unknown>), false);
      // Redesign R1d: no contractor field reporting or identity check switches.
      const parsed = shared.ProjectProcessConfigSchema.parse(d) as Record<string, unknown>;
      assert.equal('allowContractorFieldReporting' in parsed, false);
      assert.equal('enableContractorIdentityAssurance' in parsed, false);
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
      assert.equal('allowContractorFieldReporting' in edo.body.data.config, false, 'R1d: no contractor reporting switch');
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
      // A new draft gets the tenant default template (no default here: the defaults apply).
      assert.equal(created.body.data.process.config.requireReportApproval, false);
      assert.equal('enableContractorIdentityAssurance' in created.body.data.process.config, false);

      const templates = (await request(app).get('/api/v1/workflow-templates').set(admin)).body.data as Array<{ id: string; name: string; config: unknown }>;
      const rapid = templates.find((t) => t.name.startsWith('Lightweight'))!;
      const applied = await request(app).post(`/api/v1/projects/${draftId}/process/apply-template`).set(admin).send({ templateId: rapid.id });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      assert.equal(applied.body.data.workflowTemplateId, rapid.id);
      assert.equal(applied.body.data.workflowTemplateName, rapid.name);
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
            process: { ...(rapid.config as { process: Record<string, unknown> }).process, requireReportApproval: true, enableHandoverModule: true },
          },
        });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      const after = await request(app).get(`/api/v1/projects/${draftId}/process`).set(admin);
      assert.equal(after.body.data.config.requireReportApproval, false);
      assert.equal(after.body.data.config.enableHandoverModule, false);
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
  const SAMPLE = 'The Ikpoba Hill community needs a maternity ward, clean water and solar backup for the cold chain.';

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
      const fieldList = await request(app).get(`/api/v1/projects/${ids.edo}/standards`).set(await field(ids.edoSession));
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
});
