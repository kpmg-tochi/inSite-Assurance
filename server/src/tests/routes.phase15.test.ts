/**
 * Phase 15 route tests: Certificate of Completion (final evaluation gate, slot rules and
 * organisation scope, one slot per person, beneficiary recorded by staff, issuance side effects,
 * revoke rules), the three CoC gates on and off (liability period, final payment, closure), the
 * handover certificate, the closure checklist (evaluation, manual items, waivers, close and archive
 * gates), the post-closure evaluation milestone, contractor rating visibility, lessons, and the
 * closure pack (expected entries, manifest hashes, a verified audit chain).
 *
 * Uses projects created here (dates relative to today; the services read the clock). Redesign R5f:
 * final and post-closure evaluations are accepted visits (the legacy Phase 14 inspections are gone).
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { addDays, nextWorkdayOnOrAfter, zonedCalendarDate, type VisitFormSnapshot } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let storage: typeof import('../integrations/storage.service');
let pack: typeof import('../modules/completion/closurePack.service');
let zipReader: typeof import('../utils/zipWriter');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const queuedPacks: string[] = [];
const ids = {
  tenant: '',
  project: '', // P15-500: typed, every gate on
  open: '', // P15-501: no project type (gates off)
  retention: '', // P15-502: FINAL_PAYMENT gate only, already in its liability period
  ownerOrg: '',
  otherOrg: '',
  main: '',
  item1: '',
  item2: '',
};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const url = (path: string, projectId = ids.project) => `/api/v1/projects/${projectId}${path}`;
const auditCount = (action: string, projectId = ids.project) => prisma.auditLog.count({ where: { projectId, action: action as never } });

async function completion(email = 'monitor@insite.ng') {
  const res = await request(app).get(url('/completion')).set(await web(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function phase(to: string, projectId = ids.project, extra: Record<string, unknown> = {}) {
  return request(app).post(url('/phase', projectId)).set(await web('monitor@insite.ng')).send({ to, ...extra });
}

/** Uploads a file through the real presign; returns its object key. */
async function upload(email: string, projectId = ids.project) {
  const body = Buffer.from(`%PDF-1.4 signed paper copy ${crypto.randomUUID()}`);
  const presign = await request(app)
    .post(url('/evidence/presign', projectId))
    .set(await web(email))
    .send({ mediaType: 'PROJECT_DOCUMENT', fileName: 'signed.pdf', mimeType: 'application/pdf', byteSize: body.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  await storage.storageService.putLocalObject(presign.body.data.objectKey, body, 'application/pdf');
  return presign.body.data.objectKey as string;
}

/**
 * Redesign R1b: payments are made outside the platform and recorded. The FINAL_PAYMENT gate no
 * longer refuses; a final payment recorded without an issued certificate is flagged instead.
 */
async function recordPaymentOf(kind: 'INTERIM' | 'FINAL' | 'RETENTION_RELEASE', projectId = ids.project, amount = 10_000) {
  const res = await request(app)
    .post(url('/payments', projectId))
    .set(await web('lender@insite.ng'))
    .send({ kind, paidOn: today, grossAmountNgn: amount, reference: `PV-${kind}-${crypto.randomUUID().slice(0, 6)}` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.exceptions as string[];
}

/** Valid answers for every non-capture question of a frozen visit form. */
function answerAll(snapshot: VisitFormSnapshot) {
  const out: Array<{ path: string; value: unknown; comment: string | null; captures: unknown[] }> = [];
  for (const b of snapshot.blocks) {
    for (const field of b.fields) {
      if (field.type === 'PHOTO' || field.type === 'VOICE_NOTE') continue;
      const value =
        field.type === 'SHORT_TEXT' || field.type === 'LONG_TEXT'
          ? 'Checked on site'
          : field.type === 'NUMBER'
            ? field.boundedByPlannedQuantity && field.plannedQuantity !== null
              ? field.plannedQuantity
              : (field.min ?? 1)
            : field.type === 'PERCENTAGE'
              ? 100
              : field.type === 'RATING_1_5'
                ? 4
                : field.type === 'YES_NO'
                  ? 'YES'
                  : field.type === 'SINGLE_CHOICE'
                    ? (field.options[0]?.key ?? null)
                    : field.type === 'MULTI_CHOICE'
                      ? field.options.slice(0, Math.max(1, field.minSelected ?? 1)).map((o) => o.key)
                      : field.type === 'DATE'
                        ? today
                        : null;
      out.push({ path: field.path, value, comment: 'All checked', captures: [] });
    }
  }
  return out;
}

/**
 * An evaluation visit planned by the monitor, submitted by a field officer and accepted (report
 * approval is off on these projects, so acceptance is immediate). Returns the visit id.
 */
async function acceptedEvaluation(visitKind: 'FINAL_EVALUATION' | 'POST_CLOSURE_EVALUATION', summaryText: string) {
  const officer = await createFieldSession(prisma, { projectId: ids.project, roleCode: 'MONITOR_INSPECTOR', name: `Evaluator ${visitKind}` });
  const auth = await fieldAuth(prisma, officer.sessionId);
  const planned = await request(app)
    .post(url('/visits'))
    .set(await web('monitor@insite.ng'))
    .send({ visitKind, plannedDate: nextWorkdayOnOrAfter(today, [1, 2, 3, 4, 5, 6]), assignees: [{ userId: officer.userId, isLead: true }] });
  assert.equal(planned.status, 201, JSON.stringify(planned.body));
  const visitId = planned.body.data.id as string;
  const form = await request(app).get(url(`/visits/${visitId}/form`)).set(auth);
  assert.equal(form.status, 200, JSON.stringify(form.body));
  const { formSnapshotId, formHash, snapshot } = form.body.data as { formSnapshotId: string; formHash: string; snapshot: VisitFormSnapshot };
  const submitted = await request(app)
    .post(url(`/visits/${visitId}/submissions`))
    .set(auth)
    .send({ clientSubmissionId: crypto.randomUUID(), formSnapshotId, formHash, answers: answerAll(snapshot), overallFinding: 'SATISFACTORY', summaryText, confirmedAt: new Date().toISOString() });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
  assert.equal(visit.status, 'APPROVED', 'accepted at once without report approval');
  return visitId;
}

/** An accepted handover response, reviewed through the real route (issues the handover certificate). */
async function acceptHandover(projectId: string) {
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  // R1d: recorded by staff from the signed copy (no public link).
  const submission = await prisma.handoverSubmission.create({
    data: {
      projectId,
      stakeholderType: 'END_USER',
      recordedByUserId: monitor.id,
      decision: 'ACCEPTED_WITH_SNAGS',
      submitterName: 'Mrs Bello',
      submitterRole: 'Head teacher',
      feedbackText: 'We accept the works; the classroom door needs fixing.',
      snagsJson: [{ title: 'Door', location: 'Block A', description: 'The classroom door sticks.' }],
    },
  });
  return request(app)
    .post(url(`/handover/submissions/${submission.id}/review`, projectId))
    .set(await web('monitor@insite.ng'))
    .send({ notes: 'Snag noted for the liability period.' });
}

function snapshot(config: unknown) {
  return {
    projectTypeId: crypto.randomUUID(),
    code: 'P15_TEST',
    name: 'Phase 15 test type',
    colour: null,
    version: 1,
    workflowTemplateId: null,
    config,
    appliedAt: new Date().toISOString(),
  };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  storage = await import('../integrations/storage.service');
  pack = await import('../modules/completion/closurePack.service');
  zipReader = await import('../utils/zipWriter');
  pack.setClosurePackScheduler((id) => queuedPacks.push(id));
  const { createApp } = await import('../app');
  app = createApp();
  const { ProjectTypeConfigSchema } = await import('@insite/shared');
  const { syncContractMilestones } = await import('../modules/contracts/milestones.service');
  const { provisionDefaultDocumentTypes } = await import('../modules/documents/documentTypes.service');

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  await provisionDefaultDocumentTypes(prisma, tenant.id);
  const role = (code: string) => prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code } });
  const orgAdmin = await role('ORGANIZATION_ADMIN');
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insite.ng' } });
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  const lender = await prisma.user.findUniqueOrThrow({ where: { email: 'lender@insite.ng' } });
  // R1d: contractors have no login and the seed has no contractor user. The organisation-side
  // branches (ratings, lessons, documents) still exist until R4/R6, so a user in the contractor's
  // organisation is made here with the old contractor permissions to keep covering them.
  const contractorOrg = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: { startsWith: 'Julius & Sons' } } });
  const contractorStaffRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Contractor staff (test)',
      code: 'P15_CONTRACTOR_STAFF',
      surface: 'WEB',
      rolePermissions: {
        create: ['projects:view_assigned', 'boq:view', 'documents:view', 'documents:upload', 'inspections:view', 'retention:manage_defects'].map(
          (key) => ({ permission: { connect: { key } } })
        ),
      },
    },
  });
  const contractorUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'contractor@insite.ng',
      passwordHash: admin.passwordHash,
      fullName: 'Contractor staff',
      roleId: contractorStaffRole.id,
      organizationId: contractorOrg.id,
    },
  });

  ids.ownerOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'P15 Owner Authority', categories: ['CLIENT_OWNER'] } })).id;
  ids.otherOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'P15 Other Authority', categories: ['CLIENT_OWNER'] } })).id;
  const mkUser = (email: string, fullName: string, organizationId: string) =>
    prisma.user.create({ data: { tenantId: tenant.id, email, passwordHash: admin.passwordHash, fullName, roleId: orgAdmin.id, organizationId } });
  const exec1 = await mkUser('p15.planning@insite.ng', 'Head of Physical Planning', ids.ownerOrg);
  const exec2 = await mkUser('p15.me@insite.ng', 'Head of M&E', ids.ownerOrg);
  const exec3 = await mkUser('p15.other@insite.ng', 'Other Executive', ids.otherOrg);

  const closedConfig = ProjectTypeConfigSchema.parse({
    contractMilestones: [
      {
        key: 'post-closure-evaluation',
        label: 'Post-closure evaluation',
        anchor: 'PROJECT_CLOSED',
        offsetValue: 14,
        completionMode: 'AUTO_FINAL_EVALUATION_APPROVED',
        responsibleScope: 'MONITOR',
      },
    ],
    closure: {
      requireFinalEvaluationBeforeCoc: true,
      requireCocFor: ['HANDOVER_TO_RETENTION', 'FINAL_PAYMENT', 'PROJECT_CLOSE'],
      handoverDueDaysAfterCoc: 7,
      beforeClose: [
        { key: 'coc-filed', label: 'Certificate of Completion filed', kind: 'DOCUMENT_TYPE', documentTypeCode: 'COMPLETION_CERTIFICATE' },
        { key: 'ratings', label: 'Contractors rated', kind: 'CONTRACTOR_RATINGS' },
        { key: 'lessons', label: 'Lessons published', kind: 'LESSONS_LEARNED' },
        { key: 'as-built', label: 'As-built drawings received', kind: 'MANUAL' },
      ],
      beforeArchive: [
        { key: 'post-evaluation', label: 'Post-closure evaluation done', kind: 'CONTRACT_MILESTONE', milestoneKey: 'post-closure-evaluation' },
        { key: 'audit', label: 'Archiving and audit sign-off', kind: 'AUDIT_SIGNOFF' },
      ],
    },
  });

  const mkProject = async (code: string, name: string, snap: unknown) => {
    const p = await prisma.project.create({
      data: {
        tenantId: tenant.id,
        name,
        codePrefix: code,
        stateLocation: 'Lagos State',
        status: 'ACTIVE',
        activatedAt: new Date(),
        timezone: 'Africa/Lagos',
        totalBudgetNgn: 1_000_000,
        owningOrganizationId: ids.ownerOrg,
        monitorOrganizationId: monitor.organizationId,
        lenderOrganizationId: lender.organizationId,
        projectTypeSnapshotJson: (snap ?? undefined) as never,
        processConfig: {
          create: {
            enableHandoverModule: true,
            enableRetentionModule: true,
          },
        },
        beneficiaries: { create: { name: 'Lagos Model School', beneficiaryType: 'SCHOOL', isPrimary: true } },
      },
    });
    for (const u of [monitor, lender, contractorUser, exec1, exec2, exec3]) {
      await prisma.userProjectAssignment.create({ data: { userId: u.id, projectId: p.id } });
    }
    const main = await prisma.projectContractor.create({
      data: { projectId: p.id, organizationId: contractorUser.organizationId, tradeCategory: 'Civil works', tradeCode: 'CIV' },
    });
    return { p, main };
  };

  const { p, main } = await mkProject('P15-500', 'Completion Test School', snapshot(closedConfig));
  ids.project = p.id;
  ids.main = main.id;
  for (const n of [1, 2]) {
    const item = await prisma.boqItem.create({
      data: {
        projectId: p.id,
        wbsCode: `0${n}.01`,
        section: 'BILL 1',
        description: `Block ${n}`,
        unit: 'm2',
        totalQuantity: 100,
        rateNgn: 5000,
        budgetedCostNgn: 500_000,
      },
    });
    if (n === 1) ids.item1 = item.id;
    else ids.item2 = item.id;
  }
  await prisma.$transaction((tx) => syncContractMilestones(tx, p.id));

  ids.open = (await mkProject('P15-501', 'No Type School', null)).p.id;
  const retentionConfig = ProjectTypeConfigSchema.parse({ closure: { requireCocFor: ['FINAL_PAYMENT'] } });
  const r = await mkProject('P15-502', 'Liability Period School', snapshot(retentionConfig));
  ids.retention = r.p.id;
  await prisma.project.update({
    where: { id: r.p.id },
    data: {
      constructionPhase: 'RETENTION_PERIOD',
      practicalCompletionDate: addDays(today, -200),
      retentionStartDate: addDays(today, -200),
      retentionEndDate: addDays(today, -10),
      retentionPercentage: 5,
      retentionHeldNgn: 50_000,
    },
  });
});

after(async () => {
  pack?.setClosurePackScheduler(null);
  await prisma?.$disconnect();
});

describe('Phase 15', () => {
  it('drafting needs an approved final evaluation when the type says so', async () => {
    const res = await request(app).post(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: today });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'FINAL_EVALUATION_REQUIRED');
    assert.equal(res.body.error.details.linkTo, `/app/projects/${ids.project}/visits`, 'R4d: the gate links to visits');

    const visitId = await acceptedEvaluation('FINAL_EVALUATION', 'All works complete and to specification.');
    const c = await completion();
    assert.equal(c.finalEvaluation.visitId, visitId);
    assert.equal(c.canDraft, true);
  });

  it('drafts the certificate with the type slots; one live certificate per project; the future is refused', async () => {
    const future = await request(app).post(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: addDays(today, 3) });
    assert.equal(future.status, 422);
    const res = await request(app).post(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: today });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cert = res.body.data.certificate;
    assert.equal(cert.certificateNumber, 'COC-P15-500-01');
    assert.equal(cert.status, 'DRAFT');
    assert.deepEqual(cert.slots.map((s: { key: string }) => s.key), ['head-physical-planning', 'head-me', 'beneficiary']);
    assert.ok(cert.scopeSummary.includes('Completion Test School'));
    const again = await request(app).post(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: today });
    assert.equal(again.status, 409);
    assert.equal(await auditCount('COC_DRAFTED'), 1);
  });

  it('liability period and final payment gates refuse without an issued certificate', async () => {
    assert.equal((await phase('HANDOVER_IN_PROGRESS')).status, 200);
    const p = await request(app).get(url('/phase')).set(await web('monitor@insite.ng'));
    const toRetention = p.body.data.transitions.find((t: { to: string }) => t.to === 'RETENTION_PERIOD');
    assert.equal(toRetention.allowed, false);
    assert.match(toRetention.reason, /Certificate of Completion/);
    const move = await phase('RETENTION_PERIOD');
    assert.equal(move.status, 409);
    assert.match(move.body.error.message, /Certificate of Completion/);

    assert.deepEqual(await recordPaymentOf('FINAL'), ['FINAL_BEFORE_COC']);
    assert.deepEqual(await recordPaymentOf('INTERIM'), []);
  });

  it('slot rules: permission, organisation scope, one slot per person, no edits once signing starts', async () => {
    const other = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.other@insite.ng')).send({ slotKey: 'head-physical-planning' });
    assert.equal(other.status, 403, JSON.stringify(other.body));
    assert.match(other.body.error.message, /owning organisation/);
    const monitor = await request(app).post(url('/completion/certificate/sign')).set(await web('monitor@insite.ng')).send({ slotKey: 'head-me' });
    assert.equal(monitor.status, 403);
    const contractor = await request(app).post(url('/completion/certificate/sign')).set(await web('contractor@insite.ng')).send({ slotKey: 'head-me' });
    assert.equal(contractor.status, 403);

    const first = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.planning@insite.ng')).send({ slotKey: 'head-physical-planning' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.certificate.status, 'PENDING_SIGNATURES');
    const twice = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.planning@insite.ng')).send({ slotKey: 'head-me' });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'COC_ALREADY_SIGNED_ANOTHER_SLOT');
    const taken = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.me@insite.ng')).send({ slotKey: 'head-physical-planning' });
    assert.equal(taken.status, 409);
    const edit = await request(app).put(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: addDays(today, -1) });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'COC_NOT_DRAFT');
    const beneficiaryViaSign = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.me@insite.ng')).send({ slotKey: 'beneficiary' });
    assert.equal(beneficiaryViaSign.status, 409);
    assert.equal(beneficiaryViaSign.body.error.code, 'COC_BENEFICIARY_SLOT');
  });

  it('the last signature (beneficiary recorded by staff) issues the certificate with its side effects', async () => {
    const second = await request(app).post(url('/completion/certificate/sign')).set(await web('p15.me@insite.ng')).send({ slotKey: 'head-me' });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const noAttest = await request(app)
      .post(url('/completion/certificate/beneficiary'))
      .set(await web('monitor@insite.ng'))
      .send({ slotKey: 'beneficiary', beneficiaryName: 'Mrs Bello', beneficiaryRole: 'Head teacher', objectKey: await upload('monitor@insite.ng'), attest: false });
    assert.equal(noAttest.status, 400);
    const res = await request(app)
      .post(url('/completion/certificate/beneficiary'))
      .set(await web('monitor@insite.ng'))
      .send({ slotKey: 'beneficiary', beneficiaryName: 'Mrs Bello', beneficiaryRole: 'Head teacher', objectKey: await upload('monitor@insite.ng'), attest: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const c = res.body.data;
    assert.equal(c.certificate.status, 'ISSUED');
    assert.ok(c.certificate.documentId);
    const beneficiary = c.certificate.slots.find((s: { key: string }) => s.key === 'beneficiary').signature;
    assert.equal(beneficiary.signerName, 'Mrs Bello');
    assert.ok(beneficiary.evidenceDocumentId);

    const doc = await prisma.projectDocument.findUniqueOrThrow({ where: { id: c.certificate.documentId }, include: { signOffs: true, documentType: true, versions: true } });
    assert.equal(doc.documentType.code, 'COMPLETION_CERTIFICATE');
    assert.equal(doc.signOffs.length, 2, 'the two staff signatories sign off the generated PDF');
    const evidence = await prisma.projectDocumentVersion.findFirstOrThrow({ where: { documentId: beneficiary.evidenceDocumentId } });
    assert.equal(evidence.note, 'beneficiary signed copy');
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
    assert.equal(project.practicalCompletionDate, today);
    assert.equal(c.handoverCeremony.dueDate, addDays(today, 7));
    assert.equal(await auditCount('COC_ISSUED'), 1);
    assert.equal(await auditCount('COC_SIGNED'), 3);
    const notified = await prisma.webNotification.findMany({ where: { projectId: ids.project, category: 'COMPLETION_CERTIFICATE' } });
    const contractorOrg = (await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } })).organizationId;
    assert.ok(notified.some((n) => n.targetOrganizationId === ids.ownerOrg));
    assert.ok(notified.some((n) => n.targetOrganizationId === contractorOrg));

    const pdf = await request(app).get(url('/completion/certificate/pdf')).set(await web('monitor@insite.ng'));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(crypto.createHash('sha256').update(pdf.body as Buffer).digest('hex'), doc.versions[0].sha256, 'serves the stored issued PDF');
  });

  it('with the certificate the gates open (final payment, liability period only waits on the handover)', async () => {
    assert.deepEqual(await recordPaymentOf('FINAL'), []);
    const p = await request(app).get(url('/phase')).set(await web('monitor@insite.ng'));
    const toRetention = p.body.data.transitions.find((t: { to: string }) => t.to === 'RETENTION_PERIOD');
    assert.equal(toRetention.allowed, false);
    assert.match(toRetention.reason, /stakeholder must accept/);
  });

  it('revoking needs the permission and a reason, reopens dependent milestones; a new certificate can be issued', async () => {
    const noPerm = await request(app).post(url('/completion/certificate/revoke')).set(await web('monitor@insite.ng')).send({ reason: 'Scope summary misses block B.' });
    assert.equal(noPerm.status, 403);
    const res = await request(app).post(url('/completion/certificate/revoke')).set(await web('p15.planning@insite.ng')).send({ reason: 'Scope summary misses block B.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.certificate, null);
    assert.equal(res.body.data.revoked.length, 1);
    assert.equal(res.body.data.handoverCeremony.dueDate, null, 'the ceremony has no date without a certificate');
    const old = await prisma.projectDocument.findUniqueOrThrow({ where: { id: res.body.data.revoked[0].documentId } });
    assert.equal(old.isArchived, true);
    assert.deepEqual(await recordPaymentOf('FINAL'), ['FINAL_BEFORE_COC']);

    const draft = await request(app).post(url('/completion/certificate')).set(await web('monitor@insite.ng')).send({ completionDate: today, scopeSummary: 'Blocks A and B of the school, all external works and the borehole.' });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.data.certificate.certificateNumber, 'COC-P15-500-02');
    for (const [email, slotKey] of [['p15.planning@insite.ng', 'head-physical-planning'], ['p15.me@insite.ng', 'head-me']]) {
      const s = await request(app).post(url('/completion/certificate/sign')).set(await web(email)).send({ slotKey });
      assert.equal(s.status, 200, JSON.stringify(s.body));
    }
    const b = await request(app)
      .post(url('/completion/certificate/beneficiary'))
      .set(await web('monitor@insite.ng'))
      .send({ slotKey: 'beneficiary', beneficiaryName: 'Mrs Bello', beneficiaryRole: 'Head teacher', objectKey: await upload('monitor@insite.ng'), attest: true });
    assert.equal(b.body.data.certificate.status, 'ISSUED');
  });

  it('an accepted handover issues the handover certificate, completes the ceremony and locks the certificate', async () => {
    const res = await acceptHandover(ids.project);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const c = await completion();
    assert.ok(c.handoverCertificateDocumentId);
    assert.equal(c.handoverCeremony.status, 'DONE');
    assert.equal(await auditCount('HANDOVER_CERTIFICATE_ISSUED'), 1);
    const doc = await prisma.projectDocument.findUniqueOrThrow({ where: { id: c.handoverCertificateDocumentId }, include: { documentType: true, signOffs: true } });
    assert.equal(doc.documentType.code, 'HANDOVER_CERTIFICATE');
    assert.equal(doc.signOffs.length, 1);
    const revoke = await request(app).post(url('/completion/certificate/revoke')).set(await web('p15.planning@insite.ng')).send({ reason: 'Trying after the handover.' });
    assert.equal(revoke.status, 409);
    assert.equal(revoke.body.error.code, 'COC_REVOKE_AFTER_HANDOVER');
    const move = await phase('RETENTION_PERIOD');
    assert.equal(move.status, 200, JSON.stringify(move.body));
    assert.equal(move.body.data.practicalCompletionDate, today, 'keeps the date the certificate set');
  });

  it('gates off: a project without a type reaches its liability period and closes without a certificate', async () => {
    assert.equal((await phase('HANDOVER_IN_PROGRESS', ids.open)).status, 200);
    assert.equal((await acceptHandover(ids.open)).status, 200);
    assert.equal((await phase('RETENTION_PERIOD', ids.open)).status, 200);
    const close = await phase('COMPLETED_CLOSED', ids.open);
    assert.equal(close.status, 200, JSON.stringify(close.body));
  });

  it('a retention release without an issued certificate is recorded and flagged', async () => {
    // The liability period ended 10 days ago and no defect is open: only the certificate is missing.
    assert.deepEqual(await recordPaymentOf('RETENTION_RELEASE', ids.retention, 20_000), ['RETENTION_RELEASE_BEFORE_COC']);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.retention } });
    assert.equal(Number(project.retentionHeldNgn), 30_000);
    assert.equal(Number(project.retentionReleasedNgn), 20_000);
  });

  it('closure checklist: items evaluated live; closing waits on the pending items', async () => {
    const res = await request(app).get(url('/closure')).set(await web('monitor@insite.ng'));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const items = res.body.data.beforeClose as Array<{ key: string; status: string; detail: string | null; canComplete: boolean }>;
    assert.equal(res.body.data.generated, true);
    assert.equal(items.find((i) => i.key === 'coc-filed')!.status, 'DONE');
    assert.equal(items.find((i) => i.key === 'ratings')!.status, 'PENDING');
    assert.match(items.find((i) => i.key === 'ratings')!.detail!, /0 of 1/);
    assert.equal(items.find((i) => i.key === 'as-built')!.canComplete, true);
    const close = await phase('COMPLETED_CLOSED');
    assert.equal(close.status, 409);
    assert.match(close.body.error.message, /closure item/);
  });

  it('ratings: one per stage per rater, every criterion, hidden from the contractor unless shared', async () => {
    const h = await web('monitor@insite.ng');
    const criteria = (await request(app).get(url('/contractor-ratings')).set(h)).body.data.criteria as Array<{ key: string }>;
    assert.equal(criteria.length, 5);
    const missing = await request(app).post(url('/contractor-ratings')).set(h).send({ projectContractorId: ids.main, stage: 'COMPLETION', criteria: [{ key: 'time', score: 4 }] });
    assert.equal(missing.status, 422);
    const scores = criteria.map((c, i) => ({ key: c.key, score: [4, 5, 3, 4, 4][i] }));
    const rated = await request(app).post(url('/contractor-ratings')).set(h).send({ projectContractorId: ids.main, stage: 'COMPLETION', criteria: scores });
    assert.equal(rated.status, 201, JSON.stringify(rated.body));
    assert.equal(rated.body.data.contractors[0].ratings[0].overallScore, 4);
    const again = await request(app).post(url('/contractor-ratings')).set(h).send({ projectContractorId: ids.main, stage: 'COMPLETION', criteria: scores });
    assert.equal(again.body.error.code, 'RATING_ALREADY_RECORDED');
    const postClosure = await request(app).post(url('/contractor-ratings')).set(h).send({ projectContractorId: ids.main, stage: 'POST_CLOSURE', criteria: scores });
    assert.equal(postClosure.body.error.code, 'RATING_STAGE_NOT_OPEN');

    const contractor = await web('contractor@insite.ng');
    assert.equal((await request(app).get(url('/contractor-ratings')).set(contractor)).status, 404);
    const contractorOrg = (await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } })).organizationId;
    const own = await request(app).get(`/api/v1/closure/organizations/${contractorOrg}/ratings`).set(contractor);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.data.ratingCount, 0, 'not shared on this project');
    const monitorView = await request(app).get(`/api/v1/closure/organizations/${contractorOrg}/ratings`).set(h);
    assert.equal(monitorView.body.data.ratingCount, 1);
    assert.equal(monitorView.body.data.perCriterion.find((c: { key: string }) => c.key === 'quality').average, 5);
    assert.equal(await auditCount('CONTRACTOR_RATED'), 1);
  });

  it('lessons: drafts stay with the team; a shared, published lesson reaches the contractor and the library', async () => {
    const h = await web('monitor@insite.ng');
    const created = await request(app).post(url('/lessons')).set(h).send({
      category: 'HANDOVER',
      title: 'Book the handover ceremony with the CoC',
      description: 'The ceremony date was only agreed after the certificate, which cost a week.',
      recommendation: 'Agree the ceremony date when the certificate is drafted.',
      stage: 'HANDOVER',
      tags: ['Handover', 'scheduling'],
      sharedWithContractor: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const contractor = await web('contractor@insite.ng');
    assert.equal((await request(app).get(url('/lessons')).set(contractor)).body.data.length, 0);
    const pub = await request(app).post(url(`/lessons/${created.body.data.id}/publish`)).set(h);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.equal((await request(app).get(url('/lessons')).set(contractor)).body.data.length, 1);
    assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'LESSON_SHARED' } }), 1);
    const library = await request(app).get('/api/v1/closure/lessons?category=HANDOVER&tag=handover').set(h);
    assert.equal(library.status, 200);
    assert.equal(library.body.data.length, 1);
    assert.equal((await request(app).get('/api/v1/closure/lessons?q=nothing-like-this').set(h)).body.data.length, 0);
    assert.equal((await request(app).get('/api/v1/closure/lessons').set(contractor)).status, 403);
  });

  it('manual items by permission, no waiving the audit sign-off; closing freezes items and dates the post-closure evaluation', async () => {
    const as = await request(app).post(url('/closure/before-close/as-built/complete')).set(await web('contractor@insite.ng')).send({});
    assert.equal(as.status, 403);
    const done = await request(app).post(url('/closure/before-close/as-built/complete')).set(await web('monitor@insite.ng')).send({ notes: 'Received on USB.' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const waiveAudit = await request(app).post(url('/closure/before-archive/audit/waive')).set(await web('monitor@insite.ng')).send({ reason: 'No auditor available.' });
    assert.equal(waiveAudit.body.error.code, 'CLOSURE_AUDIT_NOT_WAIVABLE');

    const close = await phase('COMPLETED_CLOSED');
    assert.equal(close.status, 200, JSON.stringify(close.body));
    const frozen = await prisma.closureChecklistItemState.findMany({ where: { projectId: ids.project, list: 'BEFORE_CLOSE' } });
    assert.ok(frozen.every((s) => s.status === 'DONE'));
    const m = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: ids.project, key: 'post-closure-evaluation' } });
    assert.equal(m.dueDate, addDays(today, 14));
  });

  it('archiving waits on the post-closure evaluation and the audit sign-off', async () => {
    const archive = async () => request(app).post(url('/archive')).set(await web('admin@insite.ng')).send({ reason: 'Closed and audited.' });
    const blocked = await archive();
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, 'CLOSURE_ITEMS_PENDING');
    const notAuditor = await request(app).post(url('/closure/before-archive/audit/complete')).set(await web('monitor@insite.ng')).send({});
    assert.equal(notAuditor.status, 403);
    const audit = await request(app).post(url('/closure/before-archive/audit/complete')).set(await web('lender@insite.ng')).send({ notes: 'Audit file complete.' });
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.equal(await auditCount('CLOSURE_AUDIT_SIGNED'), 1);
    assert.equal((await archive()).status, 409);

    // The post-closure evaluation: an accepted post-closure evaluation visit completes the dated milestone.
    await acceptedEvaluation('POST_CLOSURE_EVALUATION', 'Post-closure evaluation: facility in use, no defects.');
    const m = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: ids.project, key: 'post-closure-evaluation' } });
    assert.equal(m.status, 'DONE');
    const ok = await archive();
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('the closure pack (from the archived project) holds the expected entries and a verified chain', async () => {
    const contractor = await request(app).post(url('/closure-pack')).set(await web('contractor@insite.ng'));
    assert.equal(contractor.status, 403);
    const res = await request(app).post(url('/closure-pack')).set(await web('monitor@insite.ng'));
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'QUEUED');
    const busy = await request(app).post(url('/closure-pack')).set(await web('monitor@insite.ng'));
    assert.equal(busy.body.error.code, 'CLOSURE_PACK_IN_PROGRESS');
    assert.equal(queuedPacks.length, 1);
    await pack.runClosurePackExport(queuedPacks[0]);

    const list = await request(app).get(url('/closure-pack')).set(await web('monitor@insite.ng'));
    const exp = list.body.data[0];
    assert.equal(exp.status, 'DONE', JSON.stringify(exp));
    assert.equal(exp.chainVerified, true);
    const version = await prisma.projectDocumentVersion.findFirstOrThrow({ where: { documentId: exp.documentId } });
    const zip = (await storage.storageService.getObjectBuffer(version.objectKey, 200 * 1024 * 1024))!;
    assert.equal(crypto.createHash('sha256').update(zip).digest('hex'), version.sha256);
    const files = zipReader.readZip(zip);
    const names = [...files.keys()];
    for (const expected of ['index.pdf', 'manifest.json', 'audit/audit-ledger.csv', 'audit/chain-verification.json']) assert.ok(names.includes(expected), expected);
    assert.ok(names.some((n) => n.startsWith('certificates/Certificate of Completion COC-P15-500-02')), names.join('\n'));
    assert.ok(names.some((n) => n.startsWith('certificates/Handover certificate')));
    assert.ok(names.some((n) => n.startsWith('visits/') && n.includes('final_evaluation')), names.join('\n'));
    assert.ok(!names.some((n) => n.includes('COC-P15-500-01-')), 'the revoked certificate is archived and left out');
    const verification = JSON.parse(files.get('audit/chain-verification.json')!.toString('utf8'));
    assert.equal(verification.chainIntegrityVerified, true);
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
    for (const e of manifest.entries as Array<{ path: string; sha256: string | null }>) {
      if (!e.sha256) continue;
      assert.equal(crypto.createHash('sha256').update(files.get(e.path)!).digest('hex'), e.sha256, e.path);
    }
    const csv = files.get('audit/audit-ledger.csv')!.toString('utf8');
    assert.ok(csv.includes('COC_ISSUED') && csv.includes('PROJECT_ARCHIVED'));
    assert.equal(await auditCount('CLOSURE_PACK_EXPORTED'), 1);
    // Contractors never see the closure file.
    const hidden = await request(app).get(url(`/documents/${exp.documentId}`)).set(await web('contractor@insite.ng'));
    assert.equal(hidden.status, 404);
  });
});
