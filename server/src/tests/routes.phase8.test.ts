/**
 * Phase 8 route and job tests: cadence-aware briefs and obligations, late and missed reports, the
 * job runner's single-run guarantees, mobilization reminders, attendance alerts and check-in.
 *
 * Uses a project created here ("CAD-801": weekly, Monday to Saturday, due 17:00 Lagos) so the
 * calendar is under test control. Jobs are run with an explicit `now`; report dates are in 2025
 * (past), so the server's "not in the future" check passes.
 * Calendar: 2025-03-03 is a Monday, 2025-03-08 a Saturday, 2025-03-09 a Sunday.
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
let jobs: typeof import('../jobs');
let cadenceJobs: typeof import('../jobs/cadenceJobs');
let messaging: typeof import('../integrations/messaging');
let participants: typeof import('../modules/mobilization/participants.service');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  draft: '',
  items: [] as string[],
  cowRole: '',
  joinCode: '',
  joinCodeText: '',
  session: '',
};
let sitePoint = { latitude: 0, longitude: 0 };

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

function reportBody(wbsItemId: string, workdayDate: string, confirmedAt: string) {
  return {
    clientReportId: crypto.randomUUID(),
    wbsItemId,
    workdayDate,
    reporterTimezone: 'Africa/Lagos',
    summaryText: 'Inspected the work in place and recorded quantities.',
    reportedQuantity: 1,
    unitOfMeasure: 'm3',
    isHoldPointClaimed: false,
    clientCaptureIds: [] as string[],
    textNotes: [],
    submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: confirmedAt },
    confirmedAt,
    confirmedAsFinal: true,
  };
}

async function makeSession(name: string, phone: string) {
  const s = await prisma.fieldAgentSession.create({
    data: {
      projectId: ids.project,
      origin: 'JOIN_CODE',
      joinCodeId: ids.joinCode,
      roleId: ids.cowRole,
      roleNameSnapshot: 'Independent Resident',
      fieldPersonaType: 'INDEPENDENT_VERIFIER',
      agentFullName: name,
      agentPhoneNumber: phone,
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  return s.id;
}

async function ping(sessionId: string, capturedAt: string, pingSource = 'MANUAL_CHECKIN', point = sitePoint) {
  const res = await request(app)
    .post(`/api/v1/projects/${ids.project}/telemetry`)
    .set(field(sessionId))
    .send({ pings: [{ clientPingId: crypto.randomUUID(), ...point, accuracyMeters: 5, isMocked: false, pingSource, capturedAt }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

const auditCount = (action: string) =>
  prisma.auditLog.count({ where: { projectId: ids.project, action: action as never } });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  cadenceJobs = await import('../jobs/cadenceJobs');
  messaging = await import('../integrations/messaging');
  participants = await import('../modules/mobilization/participants.service');
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'EDO-410' } });
  const geofence = edo.geofenceGeoJson as { center?: { latitude: number; longitude: number } };
  sitePoint = geofence.center ?? { latitude: 6.3176, longitude: 5.6145 };

  const project = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Cadence Test Bridge',
      codePrefix: 'CAD-801',
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date('2025-01-01T00:00:00Z'),
      reportingCadence: 'WEEKLY',
      workWeekDays: [1, 2, 3, 4, 5, 6],
      periodStartDayOfWeek: 1,
      workdayStartTime: '08:00',
      workdayEndTime: '17:00',
      timezone: 'Africa/Lagos',
      geofenceMode: edo.geofenceMode,
      geofenceGeoJson: edo.geofenceGeoJson ?? undefined,
      geofenceToleranceMeters: edo.geofenceToleranceMeters,
    },
  });
  ids.project = project.id;
  for (const n of [1, 2, 3]) {
    const item = await prisma.boqItem.create({
      data: {
        projectId: project.id,
        wbsCode: `01.0${n}`,
        section: 'BILL 1',
        description: `Bridge pier ${n} concrete`,
        unit: 'm3',
        totalQuantity: 100,
        rateNgn: 1000,
        budgetedCostNgn: 100000,
        planningTier: 'PLAN_A',
      },
    });
    ids.items.push(item.id);
  }
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'INDEPENDENT_RESIDENT' } });
  ids.cowRole = role.id;
  ids.joinCodeText = 'CAD-801-COW-TEST01';
  const code = await prisma.projectJoinCode.create({ data: { projectId: project.id, roleId: role.id, code: ids.joinCodeText } });
  ids.joinCode = code.id;
  ids.session = await makeSession('Inspector Ada', '+2348030000001');
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: project.id } });

  const draft = await prisma.project.create({
    data: { tenantId: tenant.id, name: 'Cadence Draft', codePrefix: 'CAD-802', status: 'DRAFT', reportingCadence: 'DAILY' },
  });
  ids.draft = draft.id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 8', () => {
  describe('cadence: briefs, obligations, late and missed reports', () => {
    const monday = new Date('2025-03-03T07:30:00Z'); // 08:30 Lagos

    it('dispatches one set of briefs per period even with two runners at once', async () => {
      // Before the period's brief time nothing is dispatched.
      await jobs.runJobOnce('brief-dispatch', new Date('2025-03-03T06:00:00Z'));
      assert.equal(await prisma.morningDeliverableBrief.count({ where: { projectId: ids.project } }), 0);

      // Two "instances": both through the lock, and both bypassing it (the JobRun claim still holds).
      await Promise.all([
        jobs.runJobOnce('brief-dispatch', monday),
        jobs.runJobOnce('brief-dispatch', monday),
        cadenceJobs.runBriefDispatch({ now: monday }),
        cadenceJobs.runBriefDispatch({ now: monday }),
      ]);
      const briefs = await prisma.morningDeliverableBrief.findMany({ where: { projectId: ids.project } });
      assert.equal(briefs.length, 3, 'one verifier brief per scheduled item');
      for (const b of briefs) {
        assert.equal(b.reportingPeriodStart, '2025-03-03');
        assert.equal(b.reportingPeriodEnd, '2025-03-08');
        assert.equal(b.dueAt.toISOString(), '2025-03-08T16:00:00.000Z');
        assert.match(b.expectedDeliverable, /this week/);
      }
      const runs = await prisma.jobRun.count({ where: { jobName: 'brief-dispatch', scopeKey: { startsWith: ids.project } } });
      assert.equal(runs, 1);

      const obligations = await prisma.reportingObligation.findMany({ where: { projectId: ids.project } });
      assert.equal(obligations.length, 3);
      assert.ok(obligations.every((o) => o.reporterScope === 'verifier' && o.status === 'PENDING'));

      // A later tick in the same period does nothing new.
      await jobs.runJobOnce('brief-dispatch', new Date('2025-03-05T10:00:00Z'));
      assert.equal(await prisma.morningDeliverableBrief.count({ where: { projectId: ids.project } }), 3);
    });

    it('lists the period briefs for a field caller and returns the period on the overview', async () => {
      // GET uses "today"; ask for the period that contains a date in it.
      const res = await request(app)
        .get(`/api/v1/projects/${ids.project}/morning-briefs?workdayDate=2025-03-06`)
        .set(field(ids.session));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.length, 3);
      assert.equal(res.body.data[0].reportingPeriodStart, '2025-03-03');
    });

    it('accepts an on-time report, flags a Sunday report late, and marks the missing one missed once', async () => {
      const onTime = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(field(ids.session))
        .send(reportBody(ids.items[0], '2025-03-05', '2025-03-05T12:00:00.000Z'));
      assert.equal(onTime.status, 201, JSON.stringify(onTime.body));
      assert.equal(onTime.body.data.isLateSubmission, false);
      assert.equal(onTime.body.data.reportingPeriodStart, '2025-03-03');
      assert.equal(onTime.body.data.dueAt, '2025-03-08T16:00:00.000Z');

      // A second report on the same item in the same week is refused (one per period).
      const again = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(field(ids.session))
        .send(reportBody(ids.items[0], '2025-03-07', '2025-03-07T12:00:00.000Z'));
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'REPORT_ALREADY_SUBMITTED');

      // After Saturday 17:00 the two unreported obligations are missed.
      const afterDue = new Date('2025-03-08T16:30:00Z');
      await jobs.runJobOnce('overdue-reports', afterDue);
      const status = async (i: number) =>
        (await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: ids.items[i] } })).status;
      assert.equal(await status(0), 'SUBMITTED');
      assert.equal(await status(1), 'MISSED');
      assert.equal(await status(2), 'MISSED');
      assert.equal(await auditCount('REPORT_MISSED'), 2);
      const webNotes = await prisma.webNotification.count({ where: { projectId: ids.project, category: 'REPORT_MISSED' } });
      assert.equal(webNotes, 1, 'one web notification per period and reporter scope');
      const mobileNotes = await prisma.mobileNotification.count({ where: { projectId: ids.project, type: 'REPORT_OVERDUE', fieldSessionId: ids.session } });
      assert.equal(mobileNotes, 1);

      // Running again (or on another instance) changes nothing.
      await Promise.all([jobs.runJobOnce('overdue-reports', afterDue), cadenceJobs.runOverdueReports({ now: afterDue })]);
      assert.equal(await auditCount('REPORT_MISSED'), 2);
      assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'REPORT_MISSED' } }), 1);

      // A Sunday report belongs to the same week: accepted, late, and the obligation becomes LATE.
      const sunday = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(field(ids.session))
        .send(reportBody(ids.items[1], '2025-03-09', '2025-03-09T12:00:00.000Z'));
      assert.equal(sunday.status, 201, JSON.stringify(sunday.body));
      assert.equal(sunday.body.data.isLateSubmission, true);
      assert.equal(sunday.body.data.lateByMinutes, 20 * 60);
      assert.equal(sunday.body.data.reportingPeriodStart, '2025-03-03');
      assert.equal(await status(1), 'LATE');
      assert.equal(await auditCount('REPORT_SUBMITTED_LATE'), 1);
    });

    it('excuses a missed report only with a note, and lists due and overdue obligations', async () => {
      const monitor = await web('monitor@insite.ng');
      const missed = await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: ids.items[2] } });
      const url = `/api/v1/projects/${ids.project}/reporting-obligations/${missed.id}/excuse`;
      const noNote = await request(app).post(url).set(monitor).send({ notes: '' });
      assert.equal(noNote.status, 400);
      const ok = await request(app).post(url).set(monitor).send({ notes: 'Site closed for a public holiday.' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.data.status, 'EXCUSED');
      assert.equal(await auditCount('REPORTING_OBLIGATION_EXCUSED'), 1);

      const due = await request(app).get(`/api/v1/projects/${ids.project}/reporting-obligations?view=due`).set(monitor);
      assert.equal(due.status, 200);
      assert.deepEqual(due.body.data.map((o: { status: string }) => o.status).sort(), ['LATE']);
    });

    it('applies a cadence change on a live project from the next period', async () => {
      const admin = await web('admin@insite.ng');
      const res = await request(app)
        .put(`/api/v1/projects/${ids.project}/setup/reporting`)
        .set(admin)
        .send({ reportingCadence: 'DAILY', workdayStartTime: '08:00', workdayEndTime: '17:00' });
      assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
      const row = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(row.reportingCadence, 'WEEKLY', 'the running period keeps its shape');
      assert.ok(row.pendingCadenceEffectiveFrom, 'the change waits for the next period');
      // Undo: saving the current shape clears the pending change.
      const undo = await request(app)
        .put(`/api/v1/projects/${ids.project}/setup/reporting`)
        .set(admin)
        .send({ reportingCadence: 'WEEKLY', workdayStartTime: '08:00', workdayEndTime: '17:00' });
      assert.ok([200, 201].includes(undo.status), JSON.stringify(undo.body));
      const cleared = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
      assert.equal(cleared.pendingCadenceEffectiveFrom, null);
    });
  });

  describe('mobilization reminders', () => {
    let participantId = '';

    it('pre-registers a participant (roster permission) and audits it', async () => {
      const lender = await web('lender@insite.ng');
      const body = {
        roleId: ids.cowRole,
        fullName: 'Engr. Bola Expected',
        email: 'bola.expected@example.com',
        phoneNumber: '+234 803 000 0099',
        plannedMobilizationDate: '2025-03-13',
      };
      const denied = await request(app).post(`/api/v1/projects/${ids.project}/participants`).set(lender).send(body);
      assert.equal(denied.status, 403);
      const res = await request(app).post(`/api/v1/projects/${ids.project}/participants`).set(await web('monitor@insite.ng')).send(body);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.mobilizationStatus, 'INVITED');
      assert.deepEqual(res.body.data.reminderOffsetsDays, [7, 3, 1]);
      participantId = res.body.data.id;
      assert.equal(await auditCount('PARTICIPANT_PREREGISTERED'), 1);
    });

    it('sends one reminder per offset with the join code, and stops once the participant is ready', async () => {
      messaging.consoleOutbox.length = 0;
      const threeDaysBefore = new Date('2025-03-10T09:00:00Z');
      await Promise.all([
        jobs.runJobOnce('mobilization-reminders', threeDaysBefore),
        jobs.runJobOnce('mobilization-reminders', threeDaysBefore),
      ]);
      await jobs.runJobOnce('mobilization-reminders', threeDaysBefore);
      const sent = messaging.consoleOutbox.filter((m) => m.to === 'bola.expected@example.com');
      assert.equal(sent.length, 1, 'one reminder for the 3-day offset');
      assert.match(sent[0].rendered.text, new RegExp(ids.joinCodeText));
      const stored = await prisma.outboundMessage.findFirstOrThrow({ where: { projectId: ids.project, toAddress: 'bola.expected@example.com' } });
      assert.equal(stored.status, 'SENT');
      assert.doesNotMatch(JSON.stringify(stored.payloadJson), new RegExp(ids.joinCodeText), 'the join code is not kept after delivery');
      assert.equal(await auditCount('PARTICIPANT_REMINDER_SENT'), 1);

      // Two days before is not an offset.
      await jobs.runJobOnce('mobilization-reminders', new Date('2025-03-11T09:00:00Z'));
      assert.equal(messaging.consoleOutbox.filter((m) => m.to === 'bola.expected@example.com').length, 1);

      // The person joins with the same phone number (formatted differently) and is approved: ready.
      const sessionId = await makeSession('Bola Expected', '08030000099');
      await participants.syncParticipantForSession(prisma, sessionId);
      const p = await prisma.expectedProjectParticipant.findUniqueOrThrow({ where: { id: participantId } });
      assert.equal(p.mobilizationStatus, 'READY_FOR_MOBILIZATION');
      assert.equal(p.linkedFieldSessionId, sessionId);

      await jobs.runJobOnce('mobilization-reminders', new Date('2025-03-12T09:00:00Z'));
      assert.equal(messaging.consoleOutbox.filter((m) => m.to === 'bola.expected@example.com').length, 1, 'no reminder once ready');

      // Withdrawn: no attendance alerts for them in the next tests.
      const withdrawn = await request(app)
        .patch(`/api/v1/projects/${ids.project}/participants/${participantId}`)
        .set(await web('monitor@insite.ng'))
        .send({ withdrawn: true });
      assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
      assert.equal(withdrawn.body.data.mobilizationStatus, 'WITHDRAWN');
    });

    it('sends nothing for a draft project or a suspended tenant', async () => {
      const draftParticipant = await prisma.expectedProjectParticipant.create({
        data: {
          projectId: ids.draft,
          roleId: ids.cowRole,
          fullName: 'Draft Person',
          email: 'draft.person@example.com',
          plannedMobilizationDate: '2025-03-13',
          createdByUserId: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insite.ng' } })).id,
        },
      });
      await jobs.runJobOnce('mobilization-reminders', new Date('2025-03-10T10:00:00Z'));
      assert.equal(await prisma.outboundMessage.count({ where: { projectId: ids.draft } }), 0);
      assert.equal(await prisma.jobRun.count({ where: { scopeKey: { startsWith: draftParticipant.id } } }), 0);

      const late = await prisma.expectedProjectParticipant.create({
        data: {
          projectId: ids.project,
          roleId: ids.cowRole,
          fullName: 'Suspended Tenant Person',
          email: 'suspended.person@example.com',
          plannedMobilizationDate: '2025-04-08',
          createdByUserId: draftParticipant.createdByUserId,
        },
      });
      await prisma.tenant.update({ where: { id: ids.tenant }, data: { status: 'SUSPENDED' } });
      try {
        const now = new Date('2025-04-07T09:00:00Z');
        await jobs.runJobOnce('mobilization-reminders', now);
        await jobs.runJobOnce('brief-dispatch', new Date('2025-04-07T08:00:00Z'));
        await jobs.runJobOnce('attendance-check', now);
        assert.equal(await prisma.outboundMessage.count({ where: { toAddress: 'suspended.person@example.com' } }), 0);
        assert.equal(await prisma.morningDeliverableBrief.count({ where: { projectId: ids.project, reportingPeriodStart: '2025-04-07' } }), 0);
        assert.equal(await prisma.siteAttendanceAlert.count({ where: { workdayDate: '2025-04-07' } }), 0);
      } finally {
        await prisma.tenant.update({ where: { id: ids.tenant }, data: { status: 'ACTIVE' } });
        await prisma.expectedProjectParticipant.delete({ where: { id: late.id } });
      }
    });
  });

  describe('attendance alerts and check-in', () => {
    let absentId = '';
    let presentId = '';
    let presentSession = '';

    before(async () => {
      const createdBy = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insite.ng' } })).id;
      const absent = await prisma.expectedProjectParticipant.create({
        data: { projectId: ids.project, roleId: ids.cowRole, fullName: 'Absent Inspector', email: 'absent@example.com', plannedMobilizationDate: '2025-03-17', createdByUserId: createdBy },
      });
      absentId = absent.id;
      presentSession = await makeSession('Present Inspector', '+2348030000555');
      const present = await prisma.expectedProjectParticipant.create({
        data: {
          projectId: ids.project,
          roleId: ids.cowRole,
          fullName: 'Present Inspector',
          phoneNumber: '+2348030000555',
          plannedMobilizationDate: '2025-03-17',
          createdByUserId: createdBy,
        },
      });
      presentId = present.id;
      await participants.syncParticipantForSession(prisma, presentSession);
    });

    it('raises no-show and unverified alerts once for an absent participant, none for one who checked in', async () => {
      // Monday 17th: checks in at 08:30 Lagos inside the geofence.
      await ping(presentSession, '2025-03-17T07:30:00.000Z');
      assert.equal(await auditCount('MANUAL_CHECKIN_RECORDED'), 1);
      const present = await prisma.expectedProjectParticipant.findUniqueOrThrow({ where: { id: presentId } });
      assert.equal(present.mobilizationStatus, 'MOBILIZED_ON_SITE');

      // Before 08:00 + 120 min grace nothing is raised.
      await jobs.runJobOnce('attendance-check', new Date('2025-03-17T08:30:00Z'));
      assert.equal(await prisma.siteAttendanceAlert.count({ where: { projectId: ids.project } }), 0);

      const afterGrace = new Date('2025-03-17T09:30:00Z');
      await Promise.all([jobs.runJobOnce('attendance-check', afterGrace), jobs.runJobOnce('attendance-check', afterGrace)]);
      await jobs.runJobOnce('attendance-check', afterGrace);
      const alerts = await prisma.siteAttendanceAlert.findMany({ where: { projectId: ids.project } });
      assert.deepEqual(
        alerts.map((a) => `${a.participantId === absentId ? 'absent' : 'present'}:${a.alertType}`).sort(),
        ['absent:MOBILIZATION_NO_SHOW', 'absent:UNVERIFIED_AT_MOBILIZATION']
      );
      const absent = await prisma.expectedProjectParticipant.findUniqueOrThrow({ where: { id: absentId } });
      assert.equal(absent.mobilizationStatus, 'NO_SHOW_FLAGGED');
      assert.equal(await auditCount('ATTENDANCE_ALERT_RAISED'), 2);
      assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'ATTENDANCE_ALERT' } }), 2);
    });

    it('raises a missed check-in on a later workday, and not when the qualifying ping is outside the geofence', async () => {
      // Tuesday: the present inspector only pings from far away; that is not a check-in.
      await ping(presentSession, '2025-03-18T07:30:00.000Z', 'FOREGROUND_PRESENCE', { latitude: 9.05, longitude: 7.49 });
      await jobs.runJobOnce('attendance-check', new Date('2025-03-18T09:30:00Z'));
      const missed = await prisma.siteAttendanceAlert.findMany({ where: { projectId: ids.project, workdayDate: '2025-03-18', alertType: 'WORKDAY_MISSED_CHECKIN' } });
      assert.deepEqual(missed.map((a) => a.participantId).sort(), [absentId, presentId].sort());
    });

    it('does not expect daily presence on an inspection-only project', async () => {
      await prisma.project.update({ where: { id: ids.project }, data: { reportingCadence: 'INSPECTION_ONLY' } });
      try {
        await jobs.runJobOnce('attendance-check', new Date('2025-03-19T09:30:00Z'));
        assert.equal(await prisma.siteAttendanceAlert.count({ where: { projectId: ids.project, workdayDate: '2025-03-19' } }), 0);
      } finally {
        await prisma.project.update({ where: { id: ids.project }, data: { reportingCadence: 'WEEKLY' } });
      }
    });

    it('acknowledges, excuses (note required) and resolves alerts, audited', async () => {
      const monitor = await web('monitor@insite.ng');
      const list = await request(app).get(`/api/v1/projects/${ids.project}/attendance-alerts?status=OPEN`).set(monitor);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(list.body.data.length, 4);
      const [a, b] = list.body.data as Array<{ id: string }>;
      const act = (id: string, body: object) =>
        request(app).post(`/api/v1/projects/${ids.project}/attendance-alerts/${id}/action`).set(monitor).send(body);

      assert.equal((await act(a.id, { action: 'ACKNOWLEDGE' })).body.data.status, 'ACKNOWLEDGED');
      const noNote = await act(a.id, { action: 'EXCUSE' });
      assert.equal(noNote.status, 400);
      const excused = await act(a.id, { action: 'EXCUSE', notes: 'Approved leave, cover arranged.' });
      assert.equal(excused.status, 200, JSON.stringify(excused.body));
      assert.equal(excused.body.data.status, 'EXCUSED');
      assert.equal(excused.body.data.resolutionNotes, 'Approved leave, cover arranged.');
      assert.equal((await act(b.id, { action: 'RESOLVE' })).body.data.status, 'RESOLVED');
      assert.equal((await act(b.id, { action: 'ACKNOWLEDGE' })).status, 409);
      assert.equal(await auditCount('ATTENDANCE_ALERT_RESOLVED'), 3);

      const lender = await web('lender@insite.ng');
      const denied = await request(app).post(`/api/v1/projects/${ids.project}/attendance-alerts/${b.id}/action`).set(lender).send({ action: 'RESOLVE' });
      assert.equal(denied.status, 403);
    });

    it("reports today's check-in to the field user", async () => {
      const before = await request(app).get(`/api/v1/projects/${ids.project}/check-in/today`).set(field(ids.session));
      assert.equal(before.status, 200, JSON.stringify(before.body));
      assert.equal(before.body.data.checkedIn, false);
      await ping(ids.session, new Date().toISOString());
      const afterPing = await request(app).get(`/api/v1/projects/${ids.project}/check-in/today`).set(field(ids.session));
      assert.equal(afterPing.body.data.checkedIn, true);
      assert.equal(afterPing.body.data.source, 'MANUAL_CHECKIN');
      assert.equal(afterPing.body.data.lastManualCheckIn.geofenceStatus, 'INSIDE');
    });
  });
});
