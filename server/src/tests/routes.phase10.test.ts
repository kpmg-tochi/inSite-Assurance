/**
 * Phase 10 route tests: construction phases, handover responses recorded by staff (review and
 * snags to tickets), defect tickets (staff-only: raise, close with the officer's photos, reopen,
 * reject, reminders), retention settings and the module switches.
 *
 * Redesign R1d: no public handover link (the beneficiary has no login) and no contractor side on
 * defects (the contractor has no login; one contractor per project).
 *
 * Fixtures: seeded OGN-501 (handover, modules on, no response yet), KWR-502 (liability period, 5%
 * retention, DEF-001 assigned and overdue, DEF-002 awaiting verification), ABJ-108 (modules off).
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');

const PASSWORD = 'Password123!';
const MONITOR = 'monitor@insite.ng'; // edit_baseline, record handover responses, manage defects
const LENDER = 'lender@insite.ng'; // review handover feedback; no defect management

const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  abj: '',
  ogn: '',
  kwr: '',
  kwrMain: '',
  kwrTicket1: '',
  kwrTicket2: '',
  kwrTicket3: '',
  monitorUser: '',
  kwrOfficer: '',
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
const num = (v: unknown) => Number(v);

async function projectId(code: string) {
  return (await prisma.project.findFirstOrThrow({ where: { codePrefix: code }, select: { id: true } })).id;
}

/** A capture registered by a field session (the defect close needs the officer's photos). */
async function capture(projectId: string, sessionId: string) {
  const c = await prisma.fieldEvidenceLog.create({
    data: { projectId, fieldSessionId: sessionId, clientCaptureId: crypto.randomUUID(), locationAvailable: false, capturedAtDevice: new Date() },
  });
  return c.clientCaptureId;
}

const response = (over: Record<string, unknown> = {}) => ({
  stakeholderType: 'COMMUNITY_REPRESENTATIVE',
  decision: 'ACCEPTED_WITH_SNAGS',
  submitterName: 'Chief Ade',
  submitterRole: 'Village head',
  feedbackText: 'We accept the boreholes. <script>alert(1)</script> Tap 2 drips.',
  snags: [{ title: 'Tap 2 drips', location: 'Market borehole', description: 'The tap on the right drips.' }],
  attest: true,
  ...over,
});

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();

  ids.abj = await projectId('ABJ-108');
  ids.ogn = await projectId('OGN-501');
  ids.kwr = await projectId('KWR-502');
  ids.tenant = (await prisma.project.findUniqueOrThrow({ where: { id: ids.kwr } })).tenantId;
  ids.monitorUser = (await prisma.user.findUniqueOrThrow({ where: { email: MONITOR } })).id;
  ids.kwrMain = (await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.kwr } })).id;
  const tickets = await prisma.retentionDefectTicket.findMany({ where: { projectId: ids.kwr }, orderBy: { ticketNumber: 'asc' } });
  ids.kwrTicket1 = tickets[0].id;
  ids.kwrTicket2 = tickets[1].id;
  // An M&E officer's field account on KWR-502 (Monitor Inspector: manages defects).
  ids.kwrOfficer = (await createFieldSession(prisma, { projectId: ids.kwr, roleCode: 'MONITOR_INSPECTOR', name: 'Officer Kemi' })).sessionId;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 10: module switches', () => {
  it('handover and retention endpoints answer 404 when the modules are off', async () => {
    const monitor = await web(MONITOR);
    const lender = await web(LENDER);
    for (const path of ['/phase', '/handover/submissions', '/defects', '/retention']) {
      const res = await request(app).get(`/api/v1/projects/${ids.abj}${path}`).set(path === '/retention' ? lender : monitor);
      assert.equal(res.status, 404, `${path}: ${JSON.stringify(res.body)}`);
    }
    const recorded = await request(app).post(`/api/v1/projects/${ids.abj}/handover/submissions`).set(monitor).send(response());
    assert.equal(recorded.status, 404);
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

describe('Phase 10: handover responses recorded by staff (R1d)', () => {
  let submissionId = '';

  it('records the beneficiary response from the signed copy: permission, phase, attestation, sanitised text', async () => {
    const monitor = await web(MONITOR);
    const url = `/api/v1/projects/${ids.ogn}/handover/submissions`;

    const byLender = await request(app).post(url).set(await web(LENDER)).send(response());
    assert.equal(byLender.status, 403, 'recording needs handover:record_response');
    const noAttest = await request(app).post(url).set(monitor).send(response({ attest: false }));
    assert.equal(noAttest.status, 400);
    const noSnags = await request(app).post(url).set(monitor).send(response({ snags: [] }));
    assert.equal(noSnags.status, 400, 'accepted with snags needs a snag');
    const rejectNoReason = await request(app).post(url).set(monitor).send(response({ decision: 'REJECTED', feedbackText: 'no', snags: [] }));
    assert.equal(rejectNoReason.status, 400, 'a rejection needs a reason');

    // ABJ-108 has the handover module on (construction phases test) but is back in construction.
    const notInHandover = await request(app).post(`/api/v1/projects/${ids.abj}/handover/submissions`).set(monitor).send(response());
    assert.equal(notInHandover.status, 409, JSON.stringify(notInHandover.body));
    assert.equal(notInHandover.body.error.code, 'PROJECT_NOT_IN_HANDOVER');

    const res = await request(app).post(url).set(monitor).send(response());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    submissionId = res.body.data.id;
    assert.equal(res.body.data.decision, 'ACCEPTED_WITH_SNAGS');
    assert.equal(res.body.data.stakeholderType, 'COMMUNITY_REPRESENTATIVE');
    assert.ok(res.body.data.recordedByName);
    assert.equal(res.body.data.reviewedAt, null);
    assert.equal(res.body.data.snags.length, 1);
    assert.equal(res.body.data.snags[0].defectTicketId, null);
    assert.equal('photos' in res.body.data.snags[0], false);
    assert.equal(res.body.data.feedbackText.includes('<script>'), false, 'markup is neutralised');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.ogn, action: 'HANDOVER_RECORDED' } });
    assert.equal(audit.actorId, ids.monitorUser);
    const note = await prisma.webNotification.findFirstOrThrow({ where: { projectId: ids.ogn, category: 'HANDOVER_RECORDED' } });
    assert.equal(note.targetPermissionKey, 'handover:review_feedback');
  });

  it('review, snags to tickets in one action (no contractor picker), then the liability period starts', async () => {
    const lender = await web(LENDER);
    const monitor = await web(MONITOR);
    const list = await request(app).get(`/api/v1/projects/${ids.ogn}/handover/submissions`).set(lender);
    assert.equal(list.status, 200);
    const sub = list.body.data.find((s: { id: string }) => s.id === submissionId);
    assert.equal(sub.snags.length, 1);
    const recorderList = await request(app).get(`/api/v1/projects/${ids.ogn}/handover/submissions`).set(monitor);
    assert.equal(recorderList.status, 200, 'recorders see the responses too');

    const early = await request(app).post(`/api/v1/projects/${ids.ogn}/phase`).set(monitor).send({ to: 'RETENTION_PERIOD' });
    assert.equal(early.status, 409, 'not reviewed yet');

    // R7: the monitor recorded it and holds handover:review_feedback too, but may not review it.
    const bySelf = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/review`).set(monitor).send({ notes: 'Fine.' });
    assert.equal(bySelf.status, 409, JSON.stringify(bySelf.body));
    assert.equal(bySelf.body.error.code, 'SAME_PERSON_REVIEW');
    assert.equal(bySelf.body.error.message, 'You recorded this handover response, so another officer must review it.');
    const untouched = await prisma.handoverSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    assert.equal(untouched.reviewedAt, null);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.ogn, action: 'HANDOVER_REVIEWED' } }), 0);

    // A different user with the permission reviews it.
    const reviewed = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/review`).set(lender).send({ notes: 'Accepted; one snag.' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.ok(reviewed.body.data.reviewedAt);
    const twice = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/review`).set(lender).send({});
    assert.equal(twice.status, 409);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.ogn, action: 'HANDOVER_REVIEWED' } }), 1);

    const byLender = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(lender).send({});
    assert.equal(byLender.status, 403, 'creating tickets needs defects:manage');
    const converted = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(monitor).send({ severity: 'LOW' });
    assert.equal(converted.status, 201, JSON.stringify(converted.body));
    assert.deepEqual(converted.body.data, { created: 1, skipped: 0 });
    const repeat = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions/${sub.id}/defects`).set(monitor).send({});
    assert.deepEqual(repeat.body.data, { created: 0, skipped: 1 });
    const tickets = await request(app).get(`/api/v1/projects/${ids.ogn}/defects`).set(monitor);
    assert.equal(tickets.body.data.length, 1);
    assert.equal(tickets.body.data[0].status, 'ASSIGNED');
    assert.equal(tickets.body.data[0].sourceHandoverSubmissionId, sub.id);
    const ognContractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: ids.ogn } });
    assert.equal(tickets.body.data[0].projectContractorId, ognContractor.id, 'raised against the project contractor');

    const started = await request(app).post(`/api/v1/projects/${ids.ogn}/phase`).set(monitor).send({ to: 'RETENTION_PERIOD' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.data.phase, 'RETENTION_PERIOD');
    assert.ok(started.body.data.practicalCompletionDate);
    assert.ok(started.body.data.retentionEndDate > started.body.data.practicalCompletionDate);
    const late = await request(app).post(`/api/v1/projects/${ids.ogn}/handover/submissions`).set(monitor).send(response());
    assert.equal(late.status, 409, 'no responses once the handover is over');
  });

  it('the public handover router is gone', async () => {
    const res = await request(app).get('/api/v1/public/handover/some-token');
    assert.equal(res.status, 404);
    const links = await request(app).get(`/api/v1/projects/${ids.kwr}/handover/links`).set(await web(MONITOR));
    assert.equal(links.status, 404);
  });
});

describe('Phase 10: defect tickets (staff-only, R1c/R1d)', () => {
  it('staff raise tickets against the project contractor; others cannot; there is no rectify step', async () => {
    const monitor = await web(MONITOR);
    const created = await request(app).post(`/api/v1/projects/${ids.kwr}/defects`).set(monitor).send({
      title: 'Street light not working',
      description: 'Pole 14 does not light at night.',
      severity: 'LOW',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.reference, 'DEF-003');
    assert.equal(created.body.data.projectContractorId, ids.kwrMain);
    assert.equal(created.body.data.status, 'ASSIGNED');
    assert.equal('rectify' in created.body.data.actions, false);
    assert.equal('evidenceCapturedBy' in created.body.data, false);
    ids.kwrTicket3 = created.body.data.id;
    // Nothing is aimed at the contractor (no login).
    assert.equal(await prisma.webNotification.count({ where: { projectId: ids.kwr, category: 'DEFECT_TICKET', targetOrganizationId: { not: null } } }), 0);

    const byLender = await request(app).post(`/api/v1/projects/${ids.kwr}/defects`).set(await web(LENDER)).send({ title: 'Lender ticket', description: 'Should not be allowed' });
    assert.equal(byLender.status, 403);
    const rectify = await request(app).post(`/api/v1/projects/${ids.kwr}/defects/${ids.kwrTicket1}/rectify`).set(monitor).send({ notes: 'Fixed it.' });
    assert.equal(rectify.status, 404);
  });

  it('sends an overdue reminder once a day, to staff only', async () => {
    const ok = await jobs.runJobOnce('defect-reminders');
    assert.equal(ok, true);
    await jobs.runJobOnce('defect-reminders');
    const reminders = await prisma.webNotification.findMany({ where: { projectId: ids.kwr, category: 'DEFECT_TICKET', title: { contains: 'overdue' } } });
    assert.equal(reminders.length, 1, 'one staff summary per day');
    assert.match(reminders[0].description, /DEF-001/);
    assert.equal(reminders[0].targetOrganizationId, null);
    assert.equal(reminders[0].targetPermissionKey, 'defects:manage');
  });

  it('the web cannot close an open ticket; the officer closes it on site with photos; awaiting tickets reopen with a reason', async () => {
    const monitor = await web(MONITOR);
    const url = (t: string, action: string) => `/api/v1/projects/${ids.kwr}/defects/${t}/${action}`;

    const webView = await request(app).get(`/api/v1/projects/${ids.kwr}/defects/${ids.kwrTicket1}`).set(monitor);
    assert.equal(webView.status, 200, JSON.stringify(webView.body));
    assert.equal(webView.body.data.actions.verify.allowed, false);
    assert.match(webView.body.data.actions.verify.reason, /field app/);
    const noPhotos = await request(app).post(url(ids.kwrTicket1, 'verify')).set(monitor).send({ decision: 'CLOSE', notes: 'Looks fine.' });
    assert.equal(noPhotos.status, 422);
    assert.equal(noPhotos.body.error.code, 'VERIFICATION_EVIDENCE_REQUIRED');
    const reopenOpen = await request(app).post(url(ids.kwrTicket1, 'verify')).set(monitor).send({ decision: 'REOPEN', notes: 'Not waiting for anything' });
    assert.equal(reopenOpen.status, 409);
    assert.equal(reopenOpen.body.error.code, 'DEFECT_TICKET_NOT_RECTIFIED');

    const fieldView = await request(app).get(`/api/v1/projects/${ids.kwr}/defects/${ids.kwrTicket1}`).set(await field(ids.kwrOfficer));
    assert.equal(fieldView.status, 200, JSON.stringify(fieldView.body));
    assert.equal(fieldView.body.data.actions.verify.allowed, true, 'the officer on site may close it');
    const fake = await request(app).post(url(ids.kwrTicket1, 'verify')).set(await field(ids.kwrOfficer)).send({ decision: 'CLOSE', captureIds: [crypto.randomUUID()] });
    assert.equal(fake.status, 422);
    assert.equal(fake.body.error.code, 'CAPTURES_NOT_FOUND');
    const photo = await capture(ids.kwr, ids.kwrOfficer);
    const closed = await request(app)
      .post(url(ids.kwrTicket1, 'verify'))
      .set(await field(ids.kwrOfficer))
      .send({ decision: 'CLOSE', notes: 'Headwall rebuilt; dry after rain.', captureIds: [photo] });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.data.status, 'VERIFIED_CLOSED');
    assert.equal(closed.body.data.verificationCaptures[0].clientCaptureId, photo);

    // DEF-002 was reported fixed before R1d and awaits verification.
    const noReason = await request(app).post(url(ids.kwrTicket2, 'verify')).set(monitor).send({ decision: 'REOPEN' });
    assert.equal(noReason.status, 400);
    const reopened = await request(app).post(url(ids.kwrTicket2, 'verify')).set(monitor).send({ decision: 'REOPEN', notes: 'Still seeping at the wing wall.' });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.status, 'ASSIGNED');
    assert.equal(reopened.body.data.reopenCount, 1);

    const rejected = await request(app).post(url(ids.kwrTicket3, 'reject')).set(monitor).send({ reason: 'The light is on the council network.' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.data.status, 'REJECTED_NOT_A_DEFECT');
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.kwr, action: 'DEFECT_TICKET_CLOSED' } }), 2);
  });

  it('field sessions after construction may only do defect work', async () => {
    const list = await request(app).get(`/api/v1/projects/${ids.kwr}/defects`).set(await field(ids.kwrOfficer));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.data.map((t: { id: string }) => t.id).sort(), [ids.kwrTicket1, ids.kwrTicket2, ids.kwrTicket3].sort());
    // R5f: workday reports are gone; an incident report is another non-defect field write.
    const incident = await request(app).post(`/api/v1/projects/${ids.kwr}/incidents`).set(await field(ids.kwrOfficer)).send({});
    assert.equal(incident.status, 409);
    assert.equal(incident.body.error.code, 'PROJECT_CONSTRUCTION_ENDED');
  });
});

describe('Phase 10: retention settings', () => {
  it('saves retention on the facility step and requires a liability period', async () => {
    const monitor = await web(MONITOR);
    const setup = await request(app).get(`/api/v1/projects/${ids.ogn}/setup`).set(monitor);
    assert.equal(setup.status, 200);
    const missing = await request(app)
      .put(`/api/v1/projects/${ids.ogn}/setup/facility`)
      .set(monitor)
      .send({ retention: { retentionPercentage: 7.5, retentionDurationMonths: null } });
    assert.equal(missing.status, 422, JSON.stringify(missing.body));
    const saved = await request(app)
      .put(`/api/v1/projects/${ids.ogn}/setup/facility`)
      .set(monitor)
      .send({ retention: { retentionPercentage: 7.5, retentionDurationMonths: 6, retentionReleaseAtCompletionPct: 0 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.ogn } });
    assert.equal(num(project.retentionPercentage), 7.5);
    assert.equal(project.retentionDurationMonths, 6);
  });
});
