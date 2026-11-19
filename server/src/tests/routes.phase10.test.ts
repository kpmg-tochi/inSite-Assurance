/**
 * Phase 10 route tests: construction phases, the public handover endpoints (abuse cases), handover
 * review and snags to tickets, retention arithmetic (three releases and a reversal, multi-prime
 * split), defect tickets (contractor isolation, rectify, verify, reject, reminders), retention
 * release preconditions through the disbursement chain, and the module switches.
 *
 * Fixtures: seeded OGN-501 (handover, modules on), KWR-502 (liability period, 5% retention, two
 * tickets), ABJ-108 (modules off), KAN-210 (multi-prime).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let consoleOutbox: typeof import('../integrations/messaging')['consoleOutbox'];
let jobs: typeof import('../jobs');

const PASSWORD = 'Password123!';
const MONITOR = 'monitor@insite.ng'; // licensed certifier, edit_baseline, handover links, manage defects
const LENDER = 'lender@insite.ng'; // approve disbursement, release escrow, review handover feedback
const LTO = 'lto@insite.ng'; // certify + approve (segregation of duties demo)
const CONTRACTOR = 'contractor@insite.ng'; // contractor org of OGN-501 / KWR-502, manage defects

const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  abj: '',
  ogn: '',
  kwr: '',
  kan: '',
  kwrMain: '',
  kwrOther: '',
  kwrTranche2: '',
  kwrTicket1: '',
  kwrTicket2: '',
  kwrTicket3: '',
  monitorUser: '',
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
const pub = (token: string, path = '') => `/api/v1/public/handover/${token}${path}`;
const tokenOf = (url: string) => url.split('/handover/')[1];
const num = (v: unknown) => Number(v);

async function projectId(code: string) {
  return (await prisma.project.findFirstOrThrow({ where: { codePrefix: code }, select: { id: true } })).id;
}

function lastCode(to: string): string {
  const msg = [...consoleOutbox].reverse().find((m) => m.to === to && m.rendered.subject.includes('Your code'));
  assert.ok(msg, `no code email to ${to}`);
  return /(\d{6})/.exec(msg!.rendered.subject)![1];
}

/** A pre-chain direct valuation (Phase 3 rules) ready for a lender decision. */
async function directValuation(projectIdValue: string, trancheId: string, recommended: number, lines: Array<{ boqItemId: string; verifiedAmountNgn: number }> = []) {
  const verification = await prisma.milestoneVerification.create({
    data: {
      projectId: projectIdValue,
      trancheId,
      verifiedByUserId: ids.monitorUser,
      verificationSummary: 'Test fixture verification',
      lineVerificationsJson: lines,
    },
  });
  return prisma.valuationReport.create({
    data: {
      projectId: projectIdValue,
      trancheId,
      source: 'MILESTONE_DIRECT',
      milestoneVerificationId: verification.id,
      certifiedByUserId: ids.monitorUser,
      trancheRecommendation: 'SUPPORT_FULL_RELEASE',
      recommendedReleaseAmountNgn: recommended,
      recommendedHoldbackAmountNgn: 0,
      totalClaimedNgn: recommended,
      totalCertifiedNgn: recommended,
      executiveCertificationSummary: 'Test fixture valuation',
      certifierFullName: 'Monitor',
      certifierLicenseType: 'QSRBN',
      certifierLicenseNumber: 'T-1',
    },
  });
}

/** A join-code field session on a project (the origin CHECK needs a join code). */
async function fieldSession(project: string, roleCode: string, persona: 'INDEPENDENT_VERIFIER' | 'CONTRACTOR_EXECUTOR', contractorId: string | null = null) {
  const { createJoinCode } = await import('../modules/projects/joinCodes.service');
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenant, code: roleCode } });
  const p = await prisma.project.findUniqueOrThrow({ where: { id: project } });
  const contractor = contractorId ? await prisma.projectContractor.findUniqueOrThrow({ where: { id: contractorId } }) : null;
  // One active code per project, role and contractor (partial unique index): reuse it when present.
  const code =
    (await prisma.projectJoinCode.findFirst({
      where: { projectId: project, roleId: role.id, projectContractorId: contractorId, isActive: true },
    })) ?? (await createJoinCode(prisma, { projectId: project, codePrefix: p.codePrefix, role, contractor }));
  const s = await prisma.fieldAgentSession.create({
    data: {
      projectId: project,
      origin: 'JOIN_CODE',
      joinCodeId: code.id,
      projectContractorId: contractorId,
      roleId: role.id,
      roleNameSnapshot: role.name,
      fieldPersonaType: persona,
      agentFullName: 'Test field user',
      agentPhoneNumber: '+23480' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  return s.id;
}

async function createLink(project: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/v1/projects/${project}/handover/links`)
    .set(await web(MONITOR))
    .send({
      label: 'Community handover',
      recipientName: 'Chief Ade',
      recipientContact: `rep-${crypto.randomUUID().slice(0, 8)}@example.com`,
      stakeholderType: 'COMMUNITY_REPRESENTATIVE',
      handoverSummary: 'Four boreholes with taps at the market and the school.',
      ...overrides,
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.data.link.id as string, token: tokenOf(res.body.data.url), contact: res.body.data.link.recipientContact as string };
}

async function upload(token: string, session: string, mimeType: string, byteSize: number, put = true) {
  const presign = await request(app)
    .post(pub(token, '/uploads/presign'))
    .set({ Authorization: `Bearer ${session}` })
    .send({ fileName: `file.${mimeType.split('/')[1]}`, mimeType, byteSize });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  if (put) {
    const u = new URL(presign.body.data.uploadUrl);
    const res = await request(app).put(`${u.pathname}${u.search}`).set('Content-Type', mimeType).send(Buffer.alloc(byteSize, 1));
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  return presign.body.data.objectKey as string;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  ({ consoleOutbox } = await import('../integrations/messaging'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();

  ids.abj = await projectId('ABJ-108');
  ids.ogn = await projectId('OGN-501');
  ids.kwr = await projectId('KWR-502');
  ids.kan = await projectId('KAN-210');
  ids.tenant = (await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } })).tenantId;
  ids.monitorUser = (await prisma.user.findUniqueOrThrow({ where: { email: MONITOR } })).id;
  ids.kwrMain = (await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.kwr } })).id;
  const tickets = await prisma.retentionDefectTicket.findMany({ where: { projectId: ids.kwr }, orderBy: { ticketNumber: 'asc' } });
  ids.kwrTicket1 = tickets[0].id;
  ids.kwrTicket2 = tickets[1].id;
  // A second contractor on KWR-502, for isolation.
  const org = await prisma.organization.create({ data: { tenantId: ids.tenant, name: 'Phase10 Electrical Ltd', categories: ['CONTRACTOR'] } });
  ids.kwrOther = (
    await prisma.projectContractor.create({
      data: { projectId: ids.kwr, organizationId: org.id, tradeCategory: 'Electrical', tradeCode: 'ELE' },
    })
  ).id;
  ids.kwrTranche2 = (
    await prisma.facilityTranche.create({
      data: { projectId: ids.kwr, trancheNumber: 2, name: 'Tranche 2 — Final account', allocatedAmountNgn: 50_000_000, targetCompletionPct: 100 },
    })
  ).id;
});

after(async () => {
  delete process.env.RATE_LIMIT_IN_TESTS;
  await prisma?.$disconnect();
});

describe('Phase 10: module switches', () => {
  it('handover and retention endpoints answer 404 when the modules are off', async () => {
    const monitor = await web(MONITOR);
    const lender = await web(LENDER);
    for (const path of ['/phase', '/handover/links', '/defects', '/retention']) {
      const res = await request(app).get(`/api/v1/projects/${ids.abj}${path}`).set(path === '/retention' ? lender : monitor);
      assert.equal(res.status, 404, `${path}: ${JSON.stringify(res.body)}`);
    }
    const release = await request(app)
      .post(`/api/v1/projects/${ids.abj}/retention/release-request`)
      .set(lender)
      .send({ projectContractorId: crypto.randomUUID(), stage: 'FINAL' });
    assert.equal(release.status, 404);
    const link = await request(app).post(`/api/v1/projects/${ids.abj}/handover/links`).set(monitor).send({
      label: 'x1',
      recipientName: 'Someone',
      recipientContact: 'someone@example.com',
      stakeholderType: 'OTHER',
      handoverSummary: 'Ten characters at least.',
    });
    assert.equal(link.status, 404);
  });
});

describe('Phase 10: construction phases', () => {
  it('moves forward with guards, refuses skips, and goes back only with a reason', async () => {
    await prisma.projectProcessConfig.update({ where: { projectId: ids.abj }, data: { enableHandoverModule: true } });
    const monitor = await web(MONITOR);
    const url = `/api/v1/projects/${ids.abj}/phase`;

    const lenderTry = await request(app).post(url).set(await web(LENDER)).send({ to: 'HANDOVER_IN_PROGRESS' });
    assert.equal(lenderTry.status, 403);

    const view = await request(app).get(url).set(monitor);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.data.phase, 'ACTIVE_CONSTRUCTION');
    const toHandover = view.body.data.transitions.find((t: { to: string }) => t.to === 'HANDOVER_IN_PROGRESS');
    if (!toHandover.allowed) {
      assert.equal(toHandover.overridable, true);
      const refused = await request(app).post(url).set(monitor).send({ to: 'HANDOVER_IN_PROGRESS' });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, 'PHASE_CHANGE_NEEDS_OVERRIDE');
      const noReason = await request(app).post(url).set(monitor).send({ to: 'HANDOVER_IN_PROGRESS', overrideUndecided: true });
      assert.equal(noReason.status, 409);
    }
    const moved = await request(app)
      .post(url)
      .set(monitor)
      .send({ to: 'HANDOVER_IN_PROGRESS', overrideUndecided: true, reason: 'Final account claims will follow under handover.' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.data.phase, 'HANDOVER_IN_PROGRESS');

    const skip = await request(app).post(url).set(monitor).send({ to: 'COMPLETED_CLOSED' });
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, 'PHASE_CHANGE_NOT_ALLOWED');
    const noHandover = await request(app).post(url).set(monitor).send({ to: 'RETENTION_PERIOD' });
    assert.equal(noHandover.status, 409, 'needs a reviewed, accepted handover');

    const backNoReason = await request(app).post(url).set(monitor).send({ to: 'ACTIVE_CONSTRUCTION' });
    assert.equal(backNoReason.status, 422);
    const back = await request(app).post(url).set(monitor).send({ to: 'ACTIVE_CONSTRUCTION', reason: 'Snag works still outstanding.' });
    assert.equal(back.status, 200);
    assert.equal(back.body.data.phase, 'ACTIVE_CONSTRUCTION');
    const audits = await prisma.auditLog.count({ where: { projectId: ids.abj, action: 'PROJECT_PHASE_CHANGED' } });
    assert.equal(audits, 2);
  });
});

describe('Phase 10: public handover endpoints', () => {
  let linkA = { id: '', token: '', contact: '' };
  let session = '';
  let otherSession = '';
  let imageKey = '';
  let pdfKey = '';

  it('unknown, malformed, expired and revoked links look identical', async () => {
    const expired = await createLink(ids.ogn, { sendNow: false });
    await prisma.handoverLink.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const revoked = await createLink(ids.ogn, { sendNow: false });
    const revoke = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/links/${revoked.id}/revoke`).set(await web(MONITOR));
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.data.status, 'REVOKED');

    const unknown = crypto.randomBytes(32).toString('base64url');
    const responses = await Promise.all(
      [unknown, 'not-a-token', expired.token, revoked.token].map((t) => request(app).get(pub(t)))
    );
    for (const r of responses) {
      assert.equal(r.status, 404);
      assert.deepEqual(r.body, responses[0].body);
    }
    // Revoked links cannot request codes either.
    assert.equal((await request(app).post(pub(revoked.token, '/otp/request'))).status, 404);
  });

  it('a link shows only what the stakeholder needs and emails the link once', async () => {
    linkA = await createLink(ids.ogn);
    const email = consoleOutbox.find((m) => m.to === linkA.contact);
    assert.ok(email?.rendered.text.includes(linkA.token));
    const info = await request(app).get(pub(linkA.token));
    assert.equal(info.status, 200, JSON.stringify(info.body));
    assert.deepEqual(Object.keys(info.body.data).sort(), [
      'codeDestination',
      'expiresAt',
      'handoverSummary',
      'logoUrl',
      'primaryColorHex',
      'projectLocation',
      'projectName',
      'recipientName',
      'requiresCode',
      'submissionsRemaining',
      'tenantName',
    ]);
    assert.equal(info.body.data.requiresCode, true);
    assert.equal(info.body.data.codeDestination.includes('***@example.com'), true);
    const stored = await prisma.handoverLink.findUniqueOrThrow({ where: { id: linkA.id } });
    assert.notEqual(stored.tokenHash, linkA.token);
    assert.equal(stored.tokenHash.includes(linkA.token), false);
  });

  it('locks the link after five wrong codes until it is re-issued', async () => {
    assert.equal((await request(app).post(pub(linkA.token, '/session'))).status, 409, 'a code is required');
    const sent = await request(app).post(pub(linkA.token, '/otp/request'));
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const code = lastCode(linkA.contact);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 1; i -= 1) {
      const res = await request(app).post(pub(linkA.token, '/otp/verify')).send({ code: wrong });
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.error.details.attemptsRemaining, i);
    }
    const fifth = await request(app).post(pub(linkA.token, '/otp/verify')).send({ code: wrong });
    assert.equal(fifth.status, 423);
    const right = await request(app).post(pub(linkA.token, '/otp/verify')).send({ code });
    assert.equal(right.status, 423, 'locked even with the right code');
    assert.equal((await request(app).post(pub(linkA.token, '/otp/request'))).status, 423);

    const reissued = await request(app)
      .post(`/api/v1/projects/${ids.ogn}/handover/links/${linkA.id}/reissue`)
      .set(await web(MONITOR))
      .send({});
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
    assert.equal((await request(app).get(pub(linkA.token))).status, 404, 'the old token stops working');
    linkA = { id: reissued.body.data.link.id, token: tokenOf(reissued.body.data.url), contact: linkA.contact };
    await request(app).post(pub(linkA.token, '/otp/request'));
    const ok = await request(app).post(pub(linkA.token, '/otp/verify')).send({ code: lastCode(linkA.contact) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    session = ok.body.data.sessionToken;
    // A code works once.
    const reuse = await request(app).post(pub(linkA.token, '/otp/verify')).send({ code: lastCode(linkA.contact) });
    assert.equal(reuse.status, 422);
  });

  it('a handover session token cannot call any other route or another link', async () => {
    const bearer = { Authorization: `Bearer ${session}` };
    assert.equal((await request(app).get(`/api/v1/projects/${ids.ogn}/defects`).set(bearer)).status, 401);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer)).status, 401);
    assert.equal((await request(app).get(`/api/v1/projects/${ids.ogn}/handover/submissions`).set(bearer)).status, 401);

    const other = await createLink(ids.ogn, { requiresOtp: false, sendNow: false });
    const started = await request(app).post(pub(other.token, '/session'));
    assert.equal(started.status, 200);
    otherSession = started.body.data.sessionToken;
    const crossed = await request(app)
      .post(pub(linkA.token, '/uploads/presign'))
      .set({ Authorization: `Bearer ${otherSession}` })
      .send({ fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 });
    assert.equal(crossed.status, 403);
    assert.equal(crossed.body.error.code, 'HANDOVER_SESSION_INVALID');
    const none = await request(app).post(pub(linkA.token, '/uploads/presign')).send({ fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 });
    assert.equal(none.status, 403);
  });

  it('refuses disallowed upload types and oversized files', async () => {
    const bearer = { Authorization: `Bearer ${session}` };
    for (const mimeType of ['text/html', 'application/x-msdownload', 'image/svg+xml', 'application/zip']) {
      const res = await request(app).post(pub(linkA.token, '/uploads/presign')).set(bearer).send({ fileName: 'x', mimeType, byteSize: 100 });
      assert.equal(res.status, 415, mimeType);
    }
    const big = await request(app)
      .post(pub(linkA.token, '/uploads/presign'))
      .set(bearer)
      .send({ fileName: 'big.jpg', mimeType: 'image/jpeg', byteSize: 16 * 1024 * 1024 });
    assert.equal(big.status, 413);
    imageKey = await upload(linkA.token, session, 'image/jpeg', 2048);
    pdfKey = await upload(linkA.token, session, 'application/pdf', 1024);
    assert.equal(imageKey.includes(`/handover/${linkA.id}/`), true);
  });

  it('resumes a large upload: sends only the missing parts and completes once', async () => {
    const bearer = { Authorization: `Bearer ${session}` };
    const PART = 5 * 1024 * 1024;
    const size = PART + 1000;
    const started = await request(app)
      .post(pub(linkA.token, '/uploads/multipart/start'))
      .set(bearer)
      .send({ fileName: 'walkthrough.mp4', mimeType: 'video/mp4', byteSize: size });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.data.partCount, 2);
    const ticket = started.body.data.uploadTicket as string;
    const partUrl = async (n: number) => {
      const res = await request(app).post(pub(linkA.token, '/uploads/multipart/parts')).set(bearer).send({ uploadTicket: ticket, partNumbers: [n] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const u = new URL(res.body.data[0].uploadUrl);
      return `${u.pathname}${u.search}`;
    };

    assert.equal((await request(app).put(await partUrl(1)).send(Buffer.alloc(PART, 2))).status, 200);
    // The connection drops here; on resume the page asks what already arrived.
    const status = await request(app).post(pub(linkA.token, '/uploads/multipart/status')).set(bearer).send({ uploadTicket: ticket });
    assert.deepEqual(status.body.data.uploadedParts, [1]);
    const early = await request(app).post(pub(linkA.token, '/uploads/multipart/complete')).set(bearer).send({ uploadTicket: ticket });
    assert.equal(early.status, 409);
    assert.deepEqual(early.body.error.details.missingParts, [2]);

    const oversized = await request(app).put(await partUrl(2)).send(Buffer.alloc(2000, 3));
    assert.equal(oversized.status, 400, 'a part larger than signed is refused');
    assert.equal((await request(app).put(await partUrl(2)).send(Buffer.alloc(1000, 3))).status, 200);
    const done = await request(app).post(pub(linkA.token, '/uploads/multipart/complete')).set(bearer).send({ uploadTicket: ticket });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.data.objectKey, started.body.data.objectKey);
    const again = await request(app).post(pub(linkA.token, '/uploads/multipart/complete')).set(bearer).send({ uploadTicket: ticket });
    assert.equal(again.status, 200, 'completing twice is harmless');

    const { storageService } = await import('../integrations/storage.service');
    const head = await storageService.headObject(done.body.data.objectKey);
    assert.equal(head?.byteSize, size);
    assert.equal(head?.contentType, 'video/mp4');

    const [body, sig] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), byteSize: 1 })).toString('base64url');
    const tampered = await request(app).post(pub(linkA.token, '/uploads/multipart/status')).set(bearer).send({ uploadTicket: `${forged}.${sig}` });
    assert.equal(tampered.status, 400);
    assert.equal(tampered.body.error.code, 'UPLOAD_TICKET_INVALID');
  });

  it('applies rate limits per link', async () => {
    process.env.RATE_LIMIT_IN_TESTS = '1';
    try {
      const link = await createLink(ids.ogn, { sendNow: false });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await request(app).post(pub(link.token, '/otp/request'))).status);
      assert.deepEqual(statuses, [200, 200, 200, 429]);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });

  it('stores a submission once, neutralises HTML, and only accepts this link\'s uploads', async () => {
    const bearer = { Authorization: `Bearer ${session}` };
    const body = {
      decision: 'ACCEPTED_WITH_SNAGS',
      submitterName: 'Chief Ade <b>Ogun</b>',
      submitterRole: 'Village head',
      feedbackText: '<script>alert(1)</script>Water flows **well**.\n\n- Tap at the school drips',
      snags: [{ title: 'School tap drips', location: 'Primary school', photos: [{ objectKey: imageKey, fileName: 'tap.jpg' }] }],
      attachments: [{ objectKey: pdfKey, fileName: 'minutes.pdf' }],
    };
    const foreign = await request(app)
      .post(pub(linkA.token, '/submit'))
      .set(bearer)
      .send({ ...body, attachments: [{ objectKey: pdfKey.replace(linkA.id, crypto.randomUUID()), fileName: 'x.pdf' }] });
    assert.equal(foreign.status, 400);
    const missingKey = await upload(linkA.token, session, 'application/pdf', 512, false);
    const missing = await request(app).post(pub(linkA.token, '/submit')).set(bearer).send({ ...body, attachments: [{ objectKey: missingKey, fileName: 'x.pdf' }] });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.code, 'UPLOAD_MISSING');
    const noSession = await request(app).post(pub(linkA.token, '/submit')).send(body);
    assert.equal(noSession.status, 403);

    const submitted = await request(app).post(pub(linkA.token, '/submit')).set(bearer).set('User-Agent', 'phase10-test').send(body);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.submissionsRemaining, 0);
    const again = await request(app).post(pub(linkA.token, '/submit')).set(bearer).send(body);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'HANDOVER_SUBMISSION_LIMIT');

    const row = await prisma.handoverSubmission.findUniqueOrThrow({ where: { id: submitted.body.data.submissionId } });
    assert.equal(row.feedbackText.includes('<'), false);
    assert.equal(/script/i.test(row.feedbackText), false);
    assert.equal(row.feedbackText.includes('**well**'), true, 'formatting is kept as text');
    assert.equal(row.submitterName, 'Chief Ade Ogun');
    assert.equal(row.userAgent, 'phase10-test');
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.ogn, action: 'HANDOVER_SUBMITTED' } }), 1);
    assert.equal(await prisma.webNotification.count({ where: { projectId: ids.ogn, category: 'HANDOVER_SUBMITTED' } }), 1);
    // The file sizes and types come from storage, not from the client.
    const attachments = row.attachmentsJson as Array<{ byteSize: number; mimeType: string }>;
    assert.equal(attachments[0].byteSize, 1024);
    assert.equal(attachments[0].mimeType, 'application/pdf');
  });

  it('serves uploads to reviewers only, documents as downloads', async () => {
    const lender = await web(LENDER);
    const image = await request(app).get(`/api/v1/projects/${ids.ogn}/media`).query({ key: imageKey, format: 'json' }).set(lender);
    assert.equal(image.status, 200, JSON.stringify(image.body));
    assert.equal(image.body.data.url.includes('attachment='), false);
    const pdf = await request(app).get(`/api/v1/projects/${ids.ogn}/media`).query({ key: pdfKey, format: 'json' }).set(lender);
    assert.equal(pdf.status, 200);
    const u = new URL(pdf.body.data.url);
    const file = await request(app).get(`${u.pathname}${u.search}`);
    assert.equal(file.status, 200);
    assert.match(String(file.headers['content-disposition']), /^attachment;/);
    // A field session (no handover review permission) cannot fetch stakeholder files.
    const sessionId = await fieldSession(ids.ogn, 'MONITOR_INSPECTOR', 'INDEPENDENT_VERIFIER');
    const denied = await request(app).get(`/api/v1/projects/${ids.ogn}/media`).query({ key: imageKey, format: 'json' }).set(field(sessionId));
    assert.equal(denied.status, 400);
  });

  it('review, snags to tickets in one action, then the liability period starts', async () => {
    const lender = await web(LENDER);
    const monitor = await web(MONITOR);
    const list = await request(app).get(`/api/v1/projects/${ids.ogn}/handover/submissions`).set(lender);
    assert.equal(list.status, 200);
    const sub = list.body.data[0];
    assert.equal(sub.snags.length, 1);
    assert.equal(sub.snags[0].photos[0].objectKey, imageKey);

    const early = await request(app).post(`/api/v1/projects/${ids.ogn}/phase`).set(monitor).send({ to: 'RETENTION_PERIOD' });
    assert.equal(early.status, 409, 'not reviewed yet');

    const reviewed = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/review`).set(lender).send({ notes: 'Accepted; one snag.' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    const twice = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/review`).set(lender).send({});
    assert.equal(twice.status, 409);

    const byLender = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(lender).send({});
    assert.equal(byLender.status, 403, 'creating tickets needs retention:manage_defects');
    const converted = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(monitor).send({ severity: 'LOW' });
    assert.equal(converted.status, 201, JSON.stringify(converted.body));
    assert.deepEqual(converted.body.data, { created: 1, skipped: 0 });
    const repeat = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(monitor).send({});
    assert.deepEqual(repeat.body.data, { created: 0, skipped: 1 });
    const tickets = await request(app).get(`/api/v1/projects/${ids.ogn}/defects`).set(monitor);
    assert.equal(tickets.body.data.length, 1);
    assert.equal(tickets.body.data[0].status, 'ASSIGNED');
    assert.deepEqual(tickets.body.data[0].snagPhotoKeys, [imageKey]);

    const started = await request(app).post(`/api/v1/projects/${ids.ogn}/phase`).set(monitor).send({ to: 'RETENTION_PERIOD' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.data.phase, 'RETENTION_PERIOD');
    assert.ok(started.body.data.practicalCompletionDate);
    assert.ok(started.body.data.retentionEndDate > started.body.data.practicalCompletionDate);
    assert.equal((await request(app).get(pub(linkA.token))).status, 404, 'links stop working after handover');
  });
});

describe('Phase 10: retention accrual', () => {
  const decisionUrl = () => `/api/v1/projects/${ids.kwr}/tranches/${ids.kwrTranche2}/decision`;

  it('withholds retention on three releases and reverses it with a reversal', async () => {
    const lender = await web(LENDER);
    const v1 = await directValuation(ids.kwr, ids.kwrTranche2, 10_000_000);
    const d1 = await request(app).post(decisionUrl()).set(lender).send({ valuationReportId: v1.id, decision: 'APPROVE_FULL' });
    assert.equal(d1.status, 200, JSON.stringify(d1.body));
    assert.equal(d1.body.data.retentionWithheldNgn, 500_000);
    assert.equal(d1.body.data.netReleasedNgn, 9_500_000);

    const v2 = await directValuation(ids.kwr, ids.kwrTranche2, 3_333_333.33);
    const d2 = await request(app).post(decisionUrl()).set(lender).send({ valuationReportId: v2.id, decision: 'APPROVE_FULL' });
    assert.equal(d2.body.data.retentionWithheldNgn, 166_666.67);

    const v3 = await directValuation(ids.kwr, ids.kwrTranche2, 2_000_000);
    const d3 = await request(app)
      .post(decisionUrl())
      .set(lender)
      .send({ valuationReportId: v3.id, decision: 'APPROVE_WITH_HOLDBACK', approvedDisbursementAmountNgn: 1_000_000.01 });
    assert.equal(d3.status, 200, JSON.stringify(d3.body));
    assert.equal(d3.body.data.retentionWithheldNgn, 50_000);
    assert.equal(d3.body.data.netReleasedNgn, 950_000.01);

    let project = await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } });
    assert.equal(num(project.retentionHeldNgn), 13_216_666.67);
    assert.equal(num(project.disbursedToDateNgn), 251_116_666.67);

    const reversed = await request(app)
      .post(`/api/v1/projects/${ids.kwr}/tranche-decisions/${d2.body.data.id}/reverse`)
      .set(lender)
      .send({ reason: 'Valuation 2 raised against the wrong account.' });
    assert.equal(reversed.status, 201, JSON.stringify(reversed.body));
    assert.equal(reversed.body.data.retentionWithheldNgn, -166_666.67);

    project = await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } });
    const main = await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.kwrMain } });
    const tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.kwrTranche2 } });
    assert.equal(num(project.retentionHeldNgn), 13_050_000);
    assert.equal(num(main.retentionHeldNgn), 13_050_000);
    assert.equal(num(project.disbursedToDateNgn), 247_950_000.01);
    assert.equal(num(tranche.releasedAmountNgn), 11_000_000.01, 'the tranche records the full approved amount');
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.kwr, action: 'RETENTION_WITHHELD' } }), 1 + 3);

    const pdf = await request(app).get(`/api/v1/projects/${ids.kwr}/valuations/${v1.id}/valuation-report.pdf`).set(lender);
    assert.equal(pdf.status, 200);
  });

  it('splits retention per contractor in multi-prime', async () => {
    await prisma.projectProcessConfig.update({ where: { projectId: ids.kan }, data: { enableRetentionModule: true } });
    await prisma.project.update({ where: { id: ids.kan }, data: { retentionPercentage: 10, retentionDurationMonths: 12 } });
    const items = await prisma.boqItem.findMany({ where: { projectId: ids.kan, projectContractorId: { not: null } }, orderBy: { wbsCode: 'asc' } });
    const a = items[0];
    const b = items.find((i) => i.projectContractorId !== a.projectContractorId)!;
    assert.ok(b, 'KAN-210 has items of two contractors');
    const tranche = await prisma.facilityTranche.create({
      data: { projectId: ids.kan, trancheNumber: 99, name: 'Test tranche', allocatedAmountNgn: 10_000_000, targetCompletionPct: 100 },
    });
    const v = await directValuation(ids.kan, tranche.id, 1_000_000, [
      { boqItemId: a.id, verifiedAmountNgn: 600_000 },
      { boqItemId: b.id, verifiedAmountNgn: 400_000 },
    ]);
    const before = await prisma.project.findUniqueOrThrow({ where: { id: ids.kan } });
    const res = await request(app)
      .post(`/api/v1/projects/${ids.kan}/tranches/${tranche.id}/decision`)
      .set(await web(LENDER))
      .send({ valuationReportId: v.id, decision: 'APPROVE_FULL' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.retentionWithheldNgn, 100_000);
    const [ca, cb] = await Promise.all([
      prisma.projectContractor.findUniqueOrThrow({ where: { id: a.projectContractorId! } }),
      prisma.projectContractor.findUniqueOrThrow({ where: { id: b.projectContractorId! } }),
    ]);
    assert.equal(num(ca.retentionHeldNgn), 60_000);
    assert.equal(num(cb.retentionHeldNgn), 40_000);
    const after = await prisma.project.findUniqueOrThrow({ where: { id: ids.kan } });
    assert.equal(num(after.retentionHeldNgn), 100_000);
    assert.equal(num(after.disbursedToDateNgn) - num(before.disbursedToDateNgn), 900_000);
  });
});

describe('Phase 10: defect tickets', () => {
  it('contractors see and update only their own tickets', async () => {
    const monitor = await web(MONITOR);
    const created = await request(app).post(`/api/v1/projects/${ids.kwr}/defects`).set(monitor).send({
      title: 'Street light not working',
      description: 'Pole 14 does not light at night.',
      projectContractorId: ids.kwrOther,
      severity: 'LOW',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.reference, 'DEF-003');
    ids.kwrTicket3 = created.body.data.id;

    const contractor = await web(CONTRACTOR);
    const own = await request(app).get(`/api/v1/projects/${ids.kwr}/defects`).set(contractor);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(own.body.data.map((t: { id: string }) => t.id).sort(), [ids.kwrTicket1, ids.kwrTicket2].sort());
    assert.equal((await request(app).get(`/api/v1/projects/${ids.kwr}/defects/${ids.kwrTicket3}`).set(contractor)).status, 404);
    const foreign = await request(app).post(`/api/v1/projects/${ids.kwr}/defects/${ids.kwrTicket3}/rectify`).set(contractor).send({ notes: 'Fixed it.' });
    assert.equal(foreign.status, 404);
    const raise = await request(app).post(`/api/v1/projects/${ids.kwr}/defects`).set(contractor).send({ title: 'Own ticket', description: 'Should not be allowed' });
    assert.equal(raise.status, 403);
  });

  it('sends an overdue reminder once a day', async () => {
    const ok = await jobs.runJobOnce('defect-reminders');
    assert.equal(ok, true);
    await jobs.runJobOnce('defect-reminders');
    const reminders = await prisma.webNotification.findMany({ where: { projectId: ids.kwr, category: 'DEFECT_TICKET', title: { contains: 'overdue' } } });
    // One monitoring-side summary and one reminder aimed at the liable contractor, once per day.
    assert.equal(reminders.length, 2);
    const summary = reminders.find((r) => r.hideFromProjectContractors)!;
    const own = reminders.find((r) => r.targetOrganizationId)!;
    assert.match(summary.description, /DEF-001/);
    assert.match(own.description, /DEF-001/);
    const main = await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.kwrMain } });
    assert.equal(own.targetOrganizationId, main.organizationId);
    // The contractor sees its own reminder, not the monitoring summary.
    const seen = await request(app).get(`/api/v1/projects/${ids.kwr}/web-notifications`).set(await web(CONTRACTOR));
    const titles = (seen.body.data as Array<{ title: string }>).map((n) => n.title);
    assert.equal(titles.includes(own.title), true);
    assert.equal(titles.includes(summary.title), false);
  });

  it('rectify, reopen with a reason, rectify again, verify and close', async () => {
    const contractor = await web(CONTRACTOR);
    const monitor = await web(MONITOR);
    const url = (t: string, action: string) => `/api/v1/projects/${ids.kwr}/defects/${t}/${action}`;

    const fake = await request(app).post(url(ids.kwrTicket1, 'rectify')).set(contractor).send({ captureIds: [crypto.randomUUID()] });
    assert.equal(fake.status, 422);
    assert.equal(fake.body.error.code, 'CAPTURES_NOT_FOUND');
    const fixed = await request(app).post(url(ids.kwrTicket1, 'rectify')).set(contractor).send({ notes: 'Headwall rebuilt and cured.' });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body.data.status, 'RECTIFIED_PENDING_VERIFICATION');

    const selfVerify = await request(app).post(url(ids.kwrTicket1, 'verify')).set(contractor).send({ decision: 'CLOSE' });
    assert.equal(selfVerify.status, 403);
    const noReason = await request(app).post(url(ids.kwrTicket1, 'verify')).set(monitor).send({ decision: 'REOPEN' });
    assert.equal(noReason.status, 400);
    const reopened = await request(app).post(url(ids.kwrTicket1, 'verify')).set(monitor).send({ decision: 'REOPEN', notes: 'Still seeping at the wing wall.' });
    assert.equal(reopened.body.data.status, 'ASSIGNED');
    assert.equal(reopened.body.data.reopenCount, 1);

    await request(app).post(url(ids.kwrTicket1, 'rectify')).set(contractor).send({ notes: 'Wing wall sealed.' });
    const closed = await request(app).post(url(ids.kwrTicket1, 'verify')).set(monitor).send({ decision: 'CLOSE', notes: 'Dry after rain.' });
    assert.equal(closed.body.data.status, 'VERIFIED_CLOSED');
    const closed2 = await request(app).post(url(ids.kwrTicket2, 'verify')).set(monitor).send({ decision: 'CLOSE' });
    assert.equal(closed2.body.data.status, 'VERIFIED_CLOSED');
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.kwr, action: 'DEFECT_TICKET_CLOSED' } }), 2);
  });

  it('field sessions after construction may only do defect work', async () => {
    const sid = await fieldSession(ids.kwr, 'CONTRACTOR_ENGINEER', 'CONTRACTOR_EXECUTOR', ids.kwrMain);
    const s = { id: sid };
    const list = await request(app).get(`/api/v1/projects/${ids.kwr}/defects`).set(field(s.id));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.data.map((t: { id: string }) => t.id).sort(), [ids.kwrTicket1, ids.kwrTicket2].sort());
    const report = await request(app).post(`/api/v1/projects/${ids.kwr}/workday-reports`).set(field(s.id)).send({});
    assert.equal(report.status, 409);
    assert.equal(report.body.error.code, 'PROJECT_CONSTRUCTION_ENDED');
    const dispatch = await request(app).post(`/api/v1/projects/${ids.kwr}/morning-briefs/dispatch`).set(await web(MONITOR)).send({});
    assert.equal(dispatch.status, 409);
  });
});

describe('Phase 10: retention release', () => {
  const base = () => `/api/v1/projects/${ids.kwr}/retention`;

  it('releases half at practical completion through the chain, with segregation of duties', async () => {
    const lender = await web(LENDER);
    const lto = await web(LTO);
    const early = await request(app).post(`${base()}/release-request`).set(lender).send({ projectContractorId: ids.kwrMain, stage: 'FINAL' });
    assert.equal(early.status, 409, 'before the end date');
    assert.equal(early.body.error.code, 'RETENTION_RELEASE_PRECONDITIONS_UNMET');

    const req1 = await request(app).post(`${base()}/release-request`).set(lender).send({ projectContractorId: ids.kwrMain, stage: 'COMPLETION' });
    assert.equal(req1.status, 201, JSON.stringify(req1.body));
    assert.equal(req1.body.data.amountNgn, 6_525_000);
    const dup = await request(app).post(`${base()}/release-request`).set(lender).send({ projectContractorId: ids.kwrMain, stage: 'COMPLETION' });
    assert.equal(dup.status, 409);

    const byLender = await request(app).post(`${base()}/release-requests/${req1.body.data.id}/certify`).set(lender).send({
      executiveCertificationSummary: 'Practical completion reached; half of retention due.',
      certifierDigitalSignatureAck: true,
    });
    assert.equal(byLender.status, 403);
    const certified = await request(app).post(`${base()}/release-requests/${req1.body.data.id}/certify`).set(lto).send({
      executiveCertificationSummary: 'Practical completion reached; half of retention due.',
      certifierDigitalSignatureAck: true,
    });
    assert.equal(certified.status, 200, JSON.stringify(certified.body));
    const valuation = certified.body.data.valuation;
    assert.equal(valuation.source, 'RETENTION_RELEASE');
    assert.equal(valuation.approval.currentStepOrder, 2);

    const self = await request(app).post(`${base()}/valuations/${valuation.id}/decision`).set(lto).send({ decision: 'APPROVE_FULL' });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'SEGREGATION_OF_DUTIES');
    const released = await request(app).post(`${base()}/valuations/${valuation.id}/decision`).set(lender).send({ decision: 'APPROVE_FULL' });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.data.retentionWithheldNgn, 0);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } });
    assert.equal(num(project.retentionHeldNgn), 6_525_000);
    assert.equal(num(project.retentionReleasedNgn), 6_525_000);
    assert.equal(num(project.disbursedToDateNgn), 254_475_000.01);
    const tranche = await prisma.facilityTranche.findUniqueOrThrow({ where: { id: ids.kwrTranche2 } });
    assert.equal(num(tranche.releasedAmountNgn), 11_000_000.01, 'retention releases never touch a tranche');
    const summary = await request(app).get(base()).set(lender);
    const main = summary.body.data.contractors.find((c: { projectContractorId: string }) => c.projectContractorId === ids.kwrMain);
    assert.equal(main.stages.find((s: { stage: string }) => s.stage === 'COMPLETION').allowed, false);
  });

  it('final release needs the period to end and no open ticket, re-checked at release', async () => {
    const lender = await web(LENDER);
    const monitor = await web(MONITOR);
    await prisma.project.update({ where: { id: ids.kwr }, data: { retentionEndDate: '2020-01-01' } });
    const req2 = await request(app).post(`${base()}/release-request`).set(lender).send({ projectContractorId: ids.kwrMain, stage: 'FINAL' });
    assert.equal(req2.status, 201, JSON.stringify(req2.body));
    assert.equal(req2.body.data.amountNgn, 6_525_000);
    const certified = await request(app).post(`${base()}/release-requests/${req2.body.data.id}/certify`).set(monitor).send({
      executiveCertificationSummary: 'Liability period over; defects closed.',
      certifierDigitalSignatureAck: true,
    });
    assert.equal(certified.status, 200, JSON.stringify(certified.body));

    const late = await request(app).post(`/api/v1/projects/${ids.kwr}/defects`).set(monitor).send({
      title: 'Drain blocked',
      description: 'Side drain blocked with silt near km 2.',
    });
    assert.equal(late.status, 201);
    const blocked = await request(app).post(`${base()}/valuations/${certified.body.data.valuation.id}/decision`).set(lender).send({ decision: 'APPROVE_FULL' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'RETENTION_RELEASE_PRECONDITIONS_UNMET');
    const rejected = await request(app)
      .post(`/api/v1/projects/${ids.kwr}/defects/${late.body.data.id}/reject`)
      .set(monitor)
      .send({ reason: 'Routine maintenance, not a defect.' });
    assert.equal(rejected.body.data.status, 'REJECTED_NOT_A_DEFECT');

    const released = await request(app).post(`${base()}/valuations/${certified.body.data.valuation.id}/decision`).set(lender).send({ decision: 'APPROVE_FULL' });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } });
    assert.equal(num(project.retentionHeldNgn), 0);
    assert.equal(num(project.retentionReleasedNgn), 13_050_000);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.kwr, action: 'RETENTION_RELEASED' } }), 2);

    const closed = await request(app).post(`/api/v1/projects/${ids.kwr}/phase`).set(monitor).send({ to: 'COMPLETED_CLOSED' });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.data.phase, 'COMPLETED_CLOSED');
  });
});

describe('Phase 10: retention settings', () => {
  it('saves retention on the facility step and requires a liability period', async () => {
    const monitor = await web(MONITOR);
    const setup = await request(app).get(`/api/v1/projects/${ids.ogn}/setup`).set(monitor);
    assert.equal(setup.status, 200);
    const tranches = setup.body.data.facility.tranches.map((t: Record<string, unknown>) => ({
      id: t.id,
      trancheNumber: t.trancheNumber,
      name: t.name,
      allocatedAmountNgn: t.allocatedAmountNgn,
      targetCompletionPct: t.targetCompletionPct,
      conditionsPrecedent: [],
    }));
    const missing = await request(app)
      .put(`/api/v1/projects/${ids.ogn}/setup/facility`)
      .set(monitor)
      .send({ tranches, retention: { retentionPercentage: 7.5, retentionDurationMonths: null } });
    assert.equal(missing.status, 422, JSON.stringify(missing.body));
    const saved = await request(app)
      .put(`/api/v1/projects/${ids.ogn}/setup/facility`)
      .set(monitor)
      .send({ tranches, retention: { retentionPercentage: 7.5, retentionDurationMonths: 6, retentionReleaseAtCompletionPct: 0 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.ogn } });
    assert.equal(num(project.retentionPercentage), 7.5);
    assert.equal(project.retentionDurationMonths, 6);
  });
});

describe('Phase 10: aimed defect notifications and monitor-captured evidence', () => {
  const ogn = { main: '', other: '', otherOrg: '', mainSession: '', otherSession: '', verifierSession: '' };

  before(async () => {
    ogn.main = (await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.ogn, isMainContractor: true } })).id;
    const org = await prisma.organization.create({ data: { tenantId: ids.tenant, name: 'Phase10 Pumps Ltd', categories: ['CONTRACTOR'] } });
    ogn.otherOrg = org.id;
    ogn.other = (
      await prisma.projectContractor.create({ data: { projectId: ids.ogn, organizationId: org.id, tradeCategory: 'Pumps', tradeCode: 'PMP' } })
    ).id;
    ogn.mainSession = await fieldSession(ids.ogn, 'CONTRACTOR_ENGINEER', 'CONTRACTOR_EXECUTOR', ogn.main);
    ogn.otherSession = await fieldSession(ids.ogn, 'CONTRACTOR_ENGINEER', 'CONTRACTOR_EXECUTOR', ogn.other);
    ogn.verifierSession = await fieldSession(ids.ogn, 'MONITOR_INSPECTOR', 'INDEPENDENT_VERIFIER');
  });

  const mobileTitles = async (sessionId: string) =>
    (await prisma.mobileNotification.findMany({ where: { projectId: ids.ogn, fieldSessionId: sessionId } })).map((n) => n.title);

  it('an assignment reaches only the liable contractor (its web users and its join-code sessions)', async () => {
    const raised = await request(app).post(`/api/v1/projects/${ids.ogn}/defects`).set(await web(MONITOR)).send({
      title: 'Pump house door jammed',
      description: 'The pump house door does not close.',
      projectContractorId: ogn.other,
    });
    assert.equal(raised.status, 201, JSON.stringify(raised.body));
    const ref = raised.body.data.reference as string;

    assert.equal((await mobileTitles(ogn.otherSession)).some((t) => t.startsWith(ref)), true, 'the other contractor\'s device is told');
    assert.equal((await mobileTitles(ogn.mainSession)).some((t) => t.startsWith(ref)), false, 'the main contractor\'s device is not');
    const forOther = await prisma.mobileNotification.findFirstOrThrow({ where: { fieldSessionId: ogn.otherSession, title: { startsWith: ref } } });
    assert.equal(forOther.type, 'DEFECT_UPDATE');
    assert.equal(forOther.actionType, 'OPEN_DEFECTS');

    // contractor@ belongs to the main contractor's organisation: it sees its own snag ticket's
    // assignment but not the other contractor's.
    const seen = await request(app).get(`/api/v1/projects/${ids.ogn}/web-notifications`).set(await web(CONTRACTOR));
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    const titles = (seen.body.data as Array<{ title: string }>).map((n) => n.title);
    assert.equal(titles.some((t) => t.startsWith(ref)), false);
    assert.equal(titles.some((t) => t.startsWith('DEF-001 assigned')), true);
  });

  it('"fixed: verify" goes to the monitoring side and verifier devices, never to contractors', async () => {
    const tickets = await request(app).get(`/api/v1/projects/${ids.ogn}/defects`).set(await web(CONTRACTOR));
    const own = tickets.body.data.find((t: { reference: string }) => t.reference === 'DEF-001');
    const fixed = await request(app)
      .post(`/api/v1/projects/${ids.ogn}/defects/${own.id}/rectify`)
      .set(await web(CONTRACTOR))
      .send({ notes: 'Washer replaced on tap 2.' });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));

    const monitorSeen = await request(app).get(`/api/v1/projects/${ids.ogn}/web-notifications`).set(await web(MONITOR));
    assert.equal((monitorSeen.body.data as Array<{ title: string }>).some((n) => n.title === 'DEF-001 fixed: verify the repair'), true);
    const contractorSeen = await request(app).get(`/api/v1/projects/${ids.ogn}/web-notifications`).set(await web(CONTRACTOR));
    assert.equal((contractorSeen.body.data as Array<{ title: string }>).some((n) => n.title === 'DEF-001 fixed: verify the repair'), false);
    assert.equal((await mobileTitles(ogn.verifierSession)).includes('DEF-001 fixed: verify the repair'), true);
    assert.equal((await mobileTitles(ogn.mainSession)).includes('DEF-001 fixed: verify the repair'), false);
  });

  it('with contractor field reporting off, the verifier captures the evidence and may close from Assigned', async () => {
    await prisma.projectProcessConfig.update({ where: { projectId: ids.ogn }, data: { allowContractorFieldReporting: false } });
    try {
      const monitor = await web(MONITOR);
      const raised = await request(app).post(`/api/v1/projects/${ids.ogn}/defects`).set(monitor).send({
        title: 'Tank overflow pipe loose',
        description: 'The overflow pipe on tank 3 is loose.',
        projectContractorId: ogn.main,
      });
      assert.equal(raised.status, 201);
      const ticket = raised.body.data;
      assert.equal(ticket.evidenceCapturedBy, 'MONITOR');
      assert.equal(ticket.actions.verify.allowed, false, 'web cannot close without site photos');

      const fieldView = await request(app).get(`/api/v1/projects/${ids.ogn}/defects/${ticket.id}`).set(field(ogn.verifierSession));
      assert.equal(fieldView.status, 200, JSON.stringify(fieldView.body));
      assert.equal(fieldView.body.data.actions.verify.allowed, true, 'a verifier on site may close it');

      const noPhotos = await request(app)
        .post(`/api/v1/projects/${ids.ogn}/defects/${ticket.id}/verify`)
        .set(monitor)
        .send({ decision: 'CLOSE', notes: 'Looks fine.' });
      assert.equal(noPhotos.status, 422);
      assert.equal(noPhotos.body.error.code, 'VERIFICATION_EVIDENCE_REQUIRED');

      const capture = await prisma.fieldEvidenceLog.create({
        data: {
          projectId: ids.ogn,
          fieldSessionId: ogn.verifierSession,
          clientCaptureId: crypto.randomUUID(),
          locationAvailable: false,
          capturedAtDevice: new Date(),
        },
      });
      const closed = await request(app)
        .post(`/api/v1/projects/${ids.ogn}/defects/${ticket.id}/verify`)
        .set(field(ogn.verifierSession))
        .send({ decision: 'CLOSE', notes: 'Pipe re-clamped; seen on site.', captureIds: [capture.clientCaptureId] });
      assert.equal(closed.status, 200, JSON.stringify(closed.body));
      assert.equal(closed.body.data.status, 'VERIFIED_CLOSED');
      assert.equal(closed.body.data.verificationCaptures[0].clientCaptureId, capture.clientCaptureId);
      const closedNote = await prisma.mobileNotification.findFirst({ where: { fieldSessionId: ogn.mainSession, title: `${ticket.reference} closed` } });
      assert.ok(closedNote, 'the liable contractor is told the defect is closed');
    } finally {
      await prisma.projectProcessConfig.update({ where: { projectId: ids.ogn }, data: { allowContractorFieldReporting: true } });
    }
  });
});
