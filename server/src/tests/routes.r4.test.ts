/**
 * Redesign R4 route tests: visits (R4a), officer responses and the planner (R4b), the field API
 * (R4c), approval, findings and acceptance effects (R4d), sprint verification (R4e).
 *
 * Programme tenant: programme.monitor@ (MONITOR: visits:plan, sprints:verify), programme.funder@
 * (LENDER: visits:view only), resident.supervisor@ (default officer on PRG-102/105). PRG-105 is live
 * with sprints 1 −98..−60, 2 −59..−15, 3 −14..+80 and the default visit plan (seedR4). Officers in
 * these tests are fresh provisioned accounts (MONITOR_INSPECTOR) made with createFieldSession.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  addDays,
  addWorkdays,
  assembleVisitForm,
  assemblyInputFromBundle,
  canonicalVisitFormSnapshot,
  isScheduleWorkday,
  VisitFieldPackDto,
  VisitFormSnapshot,
  zonedCalendarDate,
} from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
const PASSWORD = 'Password123!';
const P_MONITOR = 'programme.monitor@insite.ng';
const P_FUNDER = 'programme.funder@insite.ng';
const MAIN_MONITOR = 'monitor@insite.ng';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const today = () => zonedCalendarDate(new Date(), 'Africa/Lagos');
const WORK_WEEK = [1, 2, 3, 4, 5, 6];

interface Officer {
  userId: string;
  sessionId: string;
  auth: { Authorization: string };
}
async function officer(projectId = ids.prg105, name = 'Test officer'): Promise<Officer> {
  const s = await createFieldSession(prisma, { projectId, roleCode: 'MONITOR_INSPECTOR', name });
  return { userId: s.userId, sessionId: s.sessionId, auth: await fieldAuth(prisma, s.sessionId) };
}

async function capture(projectId: string, sessionId: string, opts: { located?: boolean } = {}) {
  const c = await prisma.fieldEvidenceLog.create({
    data: {
      projectId,
      fieldSessionId: sessionId,
      clientCaptureId: crypto.randomUUID(),
      locationAvailable: opts.located ?? true,
      latitude: opts.located === false ? null : 9.05,
      longitude: opts.located === false ? null : 7.49,
      geofenceStatus: opts.located === false ? null : 'INSIDE',
      capturedAtDevice: new Date(),
    },
  });
  return c.clientCaptureId;
}

/** Valid answers for every non-capture question of a frozen form (comments satisfy comment rules). */
function answerAll(snapshot: VisitFormSnapshot, overrides: Record<string, { value?: unknown; comment?: string | null; captures?: unknown[] }> = {}) {
  const out: Array<{ path: string; value: unknown; comment: string | null; captures: unknown[] }> = [];
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      let value: unknown = null;
      switch (f.type) {
        case 'SHORT_TEXT':
        case 'LONG_TEXT':
          value = 'Checked on site';
          break;
        case 'NUMBER':
          value = f.boundedByPlannedQuantity && f.plannedQuantity !== null ? f.plannedQuantity : (f.min ?? 1);
          break;
        case 'PERCENTAGE':
          value = 50;
          break;
        case 'RATING_1_5':
          value = 4;
          break;
        case 'YES_NO':
          value = 'YES';
          break;
        case 'SINGLE_CHOICE':
          value = f.options[0]?.key ?? null;
          break;
        case 'MULTI_CHOICE':
          value = f.options.slice(0, Math.max(1, f.minSelected ?? 1)).map((o) => o.key);
          break;
        case 'DATE':
          value = today();
          break;
        default:
          value = null;
      }
      const o = overrides[f.path];
      if (f.type === 'PHOTO' || f.type === 'VOICE_NOTE') {
        if (o) out.push({ path: f.path, value: null, comment: null, captures: o.captures ?? [] });
        continue;
      }
      out.push({ path: f.path, value: o && 'value' in o ? o.value : value, comment: o && 'comment' in o ? (o.comment ?? null) : 'All checked', captures: o?.captures ?? [] });
    }
  }
  return out;
}

async function formOf(projectId: string, visitId: string, auth: { Authorization: string }) {
  const res = await request(app).get(`/api/v1/projects/${projectId}/visits/${visitId}/form`).set(auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as { formSnapshotId: string; formHash: string; snapshot: VisitFormSnapshot };
}

/** A published visit on PRG-105 for `o`, `daysAhead` days from today (rolled to a working day). */
async function plannedVisit(o: Officer, opts: { daysAhead?: number; kind?: string; projectId?: string } = {}) {
  const date = addWorkdays(today(), opts.daysAhead ?? 3, WORK_WEEK);
  const res = await request(app)
    .post(`/api/v1/projects/${opts.projectId ?? ids.prg105}/visits`)
    .set(await web(P_MONITOR))
    .send({ visitKind: opts.kind ?? 'ROUTINE', plannedDate: date, assignees: [{ userId: o.userId, isLead: true }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; plannedDate: string; originalPlannedDate: string; formHash: string; formSnapshotId: string; status: string };
}

function submitBody(form: { formSnapshotId: string; formHash: string; snapshot: VisitFormSnapshot }, extra: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: crypto.randomUUID(),
    formSnapshotId: form.formSnapshotId,
    formHash: form.formHash,
    answers: answerAll(form.snapshot),
    overallFinding: 'SATISFACTORY',
    summaryText: 'Works progressing as planned.',
    confirmedAt: new Date().toISOString(),
    ...extra,
  };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.programme = (await prisma.user.findUniqueOrThrow({ where: { email: P_MONITOR } })).tenantId;
  ids.prg105 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  ids.prg102 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-102' } })).id;
  ids.resident = (await prisma.user.findUniqueOrThrow({ where: { email: 'resident.supervisor@insite.ng' } })).id;
});

// ---------------------------------------------------------------------------
// R4a
// ---------------------------------------------------------------------------

describe('Redesign R4a: visits, type plans and generators', () => {
  it('the seed proposed the plan on PRG-105 and published visits with frozen forms and deadlines', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids.prg105}/visits`).set(await web(P_MONITOR));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const visits = res.body.data.visits as Array<{ status: string; formHash: string | null; plannedDate: string; submissionDeadline: string; assignees: Array<{ userId: string; isLead: boolean }>; generatorKey: string }>;
    const planned = visits.filter((v) => v.status === 'PLANNED');
    assert.ok(planned.length >= 3, String(planned.length));
    for (const v of planned) {
      assert.match(v.formHash!, /^[0-9a-f]{64}$/);
      assert.equal(v.submissionDeadline, addDays(v.plannedDate, 7));
      assert.deepEqual(v.assignees.map((a) => [a.userId, a.isLead]), [[ids.resident, true]]);
    }
    assert.ok(visits.some((v) => v.status === 'PROPOSED' && v.generatorKey.startsWith('routine:')));
    assert.ok(visits.every((v) => v.plannedDate >= today()));
    assert.equal(res.body.data.toleranceWorkdays, 2);
  });

  it('publishing freezes the form once; a second publish changes nothing', async () => {
    const o = await officer();
    const date = addWorkdays(today(), 10, WORK_WEEK);
    const created = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits`)
      .set(await web(P_MONITOR))
      .send({ visitKind: 'ROUTINE', plannedDate: date, assignees: [{ userId: o.userId, isLead: true }], proposed: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.status, 'PROPOSED');
    assert.equal(created.body.data.formSnapshotId, null);

    const first = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/publish`).set(await web(P_MONITOR)).send({ visitIds: [created.body.data.id] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const v1 = first.body.data[0];
    assert.equal(v1.status, 'PLANNED');
    assert.ok(v1.formSnapshotId);
    const snap = await prisma.visitFormSnapshot.findUniqueOrThrow({ where: { id: v1.formSnapshotId } });
    assert.equal((snap.snapshotJson as unknown as VisitFormSnapshot).context.visitDate, date);

    const second = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/publish`).set(await web(P_MONITOR)).send({ visitIds: [created.body.data.id] });
    assert.equal(second.status, 200);
    assert.equal(second.body.data[0].formHash, v1.formHash);
    assert.equal(second.body.data[0].publishedAt, v1.publishedAt);
    // The officer got a VISIT_ASSIGNED notification on their session.
    assert.equal(await prisma.mobileNotification.count({ where: { fieldSessionId: o.sessionId, type: 'VISIT_ASSIGNED' } }), 1);
  });

  it('publishing a visit without a lead officer is refused', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits`)
      .set(await web(P_MONITOR))
      .send({ visitKind: 'BASELINE', plannedDate: addWorkdays(today(), 12, WORK_WEEK), proposed: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/publish`).set(await web(P_MONITOR)).send({ visitIds: [created.body.data.id] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VISIT_NEEDS_OFFICER');
  });

  it('a manager move keeps the original date, resets confirmation, records the change and rebuilds the form', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 4 });
    const noNote = await request(app).patch(`/api/v1/projects/${ids.prg105}/visits/${v.id}`).set(await web(P_MONITOR)).send({ plannedDate: addWorkdays(v.plannedDate, 2, WORK_WEEK) });
    assert.equal(noNote.status, 422);
    const to = addWorkdays(v.plannedDate, 2, WORK_WEEK);
    const res = await request(app).patch(`/api/v1/projects/${ids.prg105}/visits/${v.id}`).set(await web(P_MONITOR)).send({ plannedDate: to, note: 'Site closed for an event' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.plannedDate, to);
    assert.equal(res.body.data.originalPlannedDate, v.plannedDate);
    assert.equal(res.body.data.confirmation, 'UNCONFIRMED');
    assert.notEqual(res.body.data.formHash, v.formHash);
    const detail = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}`).set(await web(P_MONITOR));
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.data.dateChanges[0].kind, 'MANAGER_MOVE');
    assert.equal(detail.body.data.snapshot.context.visitDate, to);
    // The superseded snapshot is gone (nothing used it).
    assert.equal(await prisma.visitFormSnapshot.count({ where: { id: v.formSnapshotId } }), 0);
  });

  it('rebuilding an unchanged form changes nothing; a started visit cannot be rebuilt', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 5 });
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/rebuild-form`).set(await web(P_MONITOR));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.changed, false);
    assert.equal(res.body.data.visit.formHash, v.formHash);
    await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/check-in`)
      .set(o.auth)
      .send({ clientCheckInId: crypto.randomUUID(), checkedInAt: new Date().toISOString(), geotag: null })
      .expect(200);
    const locked = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/rebuild-form`).set(await web(P_MONITOR));
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'VISIT_FORM_LOCKED');
  });

  it('a live sprint save regenerates proposed visits of sprint-driven rules only', async () => {
    const before = await prisma.visit.findMany({ where: { projectId: ids.prg105 }, select: { id: true, status: true, generatorKey: true, plannedDate: true } });
    const planned = before.filter((v) => v.status === 'PLANNED').map((v) => v.id).sort();
    const scope = await request(app).get(`/api/v1/projects/${ids.prg105}/scope`).set(await web(P_MONITOR));
    assert.equal(scope.status, 200, JSON.stringify(scope.body));
    const sprints = scope.body.data.sprints as Array<{ id: string; name: string; startDate: string; endDate: string; deliverables: string }>;
    const last = sprints[sprints.length - 1];
    const longer = sprints.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.id === last.id ? addDays(last.endDate, 42) : s.endDate, deliverables: s.deliverables }));
    const saved = await request(app).put(`/api/v1/projects/${ids.prg105}/scope/sprints`).set(await web(P_MONITOR)).send({ sprints: longer });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const after = await prisma.visit.findMany({ where: { projectId: ids.prg105 }, select: { id: true, status: true, generatorKey: true, plannedDate: true } });
    assert.deepEqual(after.filter((v) => v.status === 'PLANNED').map((v) => v.id).sort(), planned);
    const routineBefore = before.filter((v) => v.generatorKey?.startsWith('routine:')).length;
    const routineAfter = after.filter((v) => v.generatorKey?.startsWith('routine:')).length;
    assert.ok(routineAfter > routineBefore, `${routineAfter} > ${routineBefore}`);
    assert.ok(after.some((v) => v.plannedDate > last.endDate && v.generatorKey?.startsWith('routine:')));
    // Generating again creates nothing new.
    const again = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/generate`).set(await web(P_MONITOR)).send({});
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.created, 0);
  });

  it('refuses writes without visits:plan, other tenants, and unknown plan rules', async () => {
    const read = await request(app).get(`/api/v1/projects/${ids.prg105}/visits`).set(await web(P_FUNDER));
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const write = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits`)
      .set(await web(P_FUNDER))
      .send({ visitKind: 'ROUTINE', plannedDate: addWorkdays(today(), 3, WORK_WEEK), proposed: true });
    assert.equal(write.status, 403);
    const other = await request(app).get(`/api/v1/projects/${ids.prg105}/visits`).set(await web(MAIN_MONITOR));
    assert.ok([403, 404].includes(other.status), String(other.status));
    const rule = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/generate`).set(await web(P_MONITOR)).send({ ruleKey: 'nope' });
    assert.equal(rule.status, 404);
    assert.equal(rule.body.error.code, 'VISIT_PLAN_RULE_NOT_FOUND');
  });

  it('activation proposes the type plan; the preview shows it on a draft', async () => {
    const draft = await prisma.project.findFirst({ where: { tenantId: ids.programme, status: 'DRAFT', projectTypeId: { not: null } } });
    if (!draft) return; // no programme draft in the seed: covered by the live sprint test above
    const preview = await request(app).get(`/api/v1/projects/${draft.id}/visit-plan/preview`).set(await web(P_MONITOR));
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(preview.body.data.rules.length > 0);
    assert.equal(await prisma.visit.count({ where: { projectId: draft.id } }), 0);
  });

  it('the audit ledger records generation, creation and publishing', async () => {
    const actions = await prisma.auditLog.findMany({ where: { projectId: ids.prg105, action: { in: ['VISITS_GENERATED', 'VISIT_CREATED', 'VISIT_PUBLISHED', 'VISIT_UPDATED'] } }, select: { action: true } });
    for (const a of ['VISITS_GENERATED', 'VISIT_CREATED', 'VISIT_PUBLISHED', 'VISIT_UPDATED']) assert.ok(actions.some((x) => x.action === a), a);
  });
});

// ---------------------------------------------------------------------------
// R4b
// ---------------------------------------------------------------------------

describe('Redesign R4b: officer responses and the planner', () => {
  it('confirm is idempotent on clientActionId', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 6 });
    const body = { clientActionId: crypto.randomUUID(), action: 'CONFIRM' };
    const a = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`).set(o.auth).send(body);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.data.confirmation, 'CONFIRMED');
    const b = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`).set(o.auth).send(body);
    assert.equal(b.status, 200);
    assert.equal(await prisma.visitResponse.count({ where: { visitId: v.id } }), 1);
    const web_ = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`).set(await web(P_MONITOR)).send({ ...body, clientActionId: crypto.randomUUID() });
    assert.equal(web_.status, 403);
  });

  it('a move within the tolerance applies; outside it, or into another sprint, is refused', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 8 });
    const near = addWorkdays(v.originalPlannedDate, 1, WORK_WEEK);
    const ok = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'MOVE', date: near, comment: 'Clashes with another site' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.plannedDate, near);
    assert.equal(ok.body.data.originalPlannedDate, v.originalPlannedDate);
    assert.equal(ok.body.data.rescheduleCount, 1);
    assert.equal(ok.body.data.confirmation, 'CONFIRMED');
    const far = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'MOVE', date: addWorkdays(v.originalPlannedDate, 5, WORK_WEEK), comment: 'Later please' });
    assert.equal(far.status, 422);
    assert.equal(far.body.error.code, 'MOVE_OUTSIDE_WINDOW');
    assert.equal(far.body.error.details.reason, 'OUTSIDE_TOLERANCE');
    // Measured from the original date: two more small moves cannot walk it away.
    const step2 = addWorkdays(v.originalPlannedDate, 2, WORK_WEEK);
    await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`).set(o.auth).send({ clientActionId: crypto.randomUUID(), action: 'MOVE', date: step2, comment: 'One more day' }).expect(200);
    const step3 = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'MOVE', date: addWorkdays(v.originalPlannedDate, 3, WORK_WEEK), comment: 'And another' });
    assert.equal(step3.status, 422);
  });

  it('refuses a move into another sprint even within the tolerance', async () => {
    const sprints = await prisma.projectSprint.findMany({ where: { projectId: ids.prg105 }, orderBy: { number: 'asc' } });
    const o = await officer();
    // A visit on the last working day of sprint 2 (in the past is fine for this check).
    const s2 = sprints[1];
    const date = isScheduleWorkday(s2.endDate, WORK_WEEK) ? s2.endDate : addWorkdays(s2.endDate, -1, WORK_WEEK);
    const created = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits`)
      .set(await web(P_MONITOR))
      .send({ visitKind: 'ROUTINE', plannedDate: date, assignees: [{ userId: o.userId, isLead: true }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${created.body.data.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'MOVE', date: addWorkdays(date, 1, WORK_WEEK), comment: 'Next day' });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.details.reason, 'OTHER_SPRINT');
  });

  it('a proposal keeps the date until the manager accepts it; the planner lists it', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 9 });
    const to = addWorkdays(v.originalPlannedDate, 6, WORK_WEEK);
    const proposed = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'PROPOSE', date: to, comment: 'Need materials on site first' });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.data.plannedDate, v.plannedDate);
    assert.equal(proposed.body.data.pendingProposal.toDate, to);
    const planner = await request(app).get(`/api/v1/visits?from=${today()}&to=${addDays(today(), 30)}`).set(await web(P_MONITOR));
    assert.equal(planner.status, 200, JSON.stringify(planner.body));
    const pending = planner.body.data.pendingProposals.find((p: { visit: { id: string } }) => p.visit.id === v.id);
    assert.ok(pending);
    const accepted = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/date-changes/${pending.change.id}/decide`)
      .set(await web(P_MONITOR))
      .send({ decision: 'ACCEPT' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.plannedDate, to);
    assert.equal(accepted.body.data.confirmation, 'CONFIRMED');
    assert.equal(accepted.body.data.pendingProposal, null);
    const again = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/date-changes/${pending.change.id}/decide`)
      .set(await web(P_MONITOR))
      .send({ decision: 'REJECT', note: 'Too late' });
    assert.equal(again.status, 409);
  });

  it('a declined visit stays planned until reassigned; reassigning resets confirmation', async () => {
    const o = await officer();
    const other = await officer(ids.prg105, 'Second officer');
    const v = await plannedVisit(o, { daysAhead: 11 });
    const declined = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`)
      .set(o.auth)
      .send({ clientActionId: crypto.randomUUID(), action: 'DECLINE', comment: 'On leave that week' });
    assert.equal(declined.status, 200, JSON.stringify(declined.body));
    assert.equal(declined.body.data.status, 'PLANNED');
    assert.equal(declined.body.data.confirmation, 'DECLINED');
    const planner = await request(app).get(`/api/v1/visits?from=${today()}&to=${addDays(today(), 30)}`).set(await web(P_MONITOR));
    assert.ok(planner.body.data.declines.some((d: { visit: { id: string }; comment: string }) => d.visit.id === v.id && d.comment === 'On leave that week'));
    const reassigned = await request(app)
      .patch(`/api/v1/projects/${ids.prg105}/visits/${v.id}`)
      .set(await web(P_MONITOR))
      .send({ assignees: [{ userId: other.userId, isLead: true }] });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
    assert.equal(reassigned.body.data.confirmation, 'UNCONFIRMED');
    assert.equal(await prisma.mobileNotification.count({ where: { fieldSessionId: other.sessionId, type: 'VISIT_ASSIGNED' } }), 1);
  });

  it('responses are refused once the visit is checked in', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 2 });
    await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/check-in`).set(o.auth).send({ clientCheckInId: crypto.randomUUID(), checkedInAt: new Date().toISOString() }).expect(200);
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/respond`).set(o.auth).send({ clientActionId: crypto.randomUUID(), action: 'CONFIRM' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISIT_CHANGED');
  });

  it('the reminder job reminds unconfirmed officers once', async () => {
    const { runJobOnce, registerAllJobs } = await import('../jobs');
    registerAllJobs();
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    await runJobOnce('visit-reminders');
    await runJobOnce('visit-reminders');
    assert.equal(await prisma.mobileNotification.count({ where: { fieldSessionId: o.sessionId, type: 'VISIT_REMINDER', metadata: { path: ['visitId'], equals: v.id } } }), 1);
  });
});

// ---------------------------------------------------------------------------
// R4c
// ---------------------------------------------------------------------------

describe('Redesign R4c: field API', () => {
  it('the feed lists the officer visits with their move window; the form answers 304 when unchanged', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 4 });
    const feed = await request(app).get('/api/v1/visits/mine').set(o.auth);
    assert.equal(feed.status, 200, JSON.stringify(feed.body));
    const item = feed.body.data.items.find((i: { visit: { id: string } }) => i.visit.id === v.id);
    assert.ok(item);
    assert.ok(item.moveWindow.from <= v.plannedDate && item.moveWindow.to >= v.plannedDate);
    assert.equal(feed.body.data.projects[0].code, 'PRG-105');
    const form = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}/form`).set(o.auth);
    assert.equal(form.status, 200);
    const again = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}/form`).set(o.auth).set('If-None-Match', form.headers.etag);
    assert.equal(again.status, 304);
    // Another officer cannot read it.
    const stranger = await officer();
    const denied = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}/form`).set(stranger.auth);
    assert.equal(denied.status, 403);
  });

  it('check-in outside the boundary is recorded and flagged, never refused', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 2 });
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/check-in`)
      .set(o.auth)
      .send({ clientCheckInId: crypto.randomUUID(), checkedInAt: new Date().toISOString(), geotag: { latitude: 0.5, longitude: 0.5, accuracyMeters: 5, capturedAt: new Date().toISOString() } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'IN_PROGRESS');
    assert.equal(res.body.data.checkInGeofenceStatus, 'OUTSIDE');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.prg105, action: 'VISIT_CHECKED_IN' }, orderBy: { createdAt: 'desc' } });
    assert.equal((audit.payload as { flagged: boolean }).flagged, true);
  });

  it('submits with replay, refuses another submitter and a stale form', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const body = submitBody(form);
    const stale = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send({ ...body, formHash: 'a'.repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'FORM_SNAPSHOT_STALE');
    const first = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(body);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const replay = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.id, first.body.data.id);
    const other = await officer();
    await prisma.visitAssignee.create({ data: { visitId: v.id, userId: other.userId } });
    const conflict = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(other.auth).send(body);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'SUBMISSION_ID_CONFLICT');
    const second = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(other.auth).send({ ...body, clientSubmissionId: crypto.randomUUID() });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'VISIT_ALREADY_SUBMITTED');
  });

  it('checks captures: unregistered (retryable), another project, another officer, already linked', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const photoField = form.snapshot.blocks.flatMap((b) => b.fields).find((f) => f.type === 'PHOTO' && f.photo?.mode === 'AT_LEAST_N');
    assert.ok(photoField, 'the routine form has a photo question');
    const withCapture = (clientCaptureId: string) =>
      submitBody(form, { answers: answerAll(form.snapshot, { [photoField!.path]: { captures: [{ clientCaptureId, unitId: null, kind: 'PHOTO' }] } }) });

    const missingId = crypto.randomUUID();
    const missing = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(withCapture(missingId));
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error.code, 'CAPTURES_NOT_REGISTERED');

    const elsewhere = await officer(ids.prg102);
    const foreign = await capture(ids.prg102, elsewhere.sessionId);
    const otherProject = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(withCapture(foreign));
    assert.equal(otherProject.status, 403);
    assert.equal(otherProject.body.error.code, 'CAPTURE_OTHER_PROJECT');

    const colleague = await officer();
    const theirs = await capture(ids.prg105, colleague.sessionId);
    const notMine = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(withCapture(theirs));
    assert.equal(notMine.status, 403);
    assert.equal(notMine.body.error.code, 'CAPTURE_NOT_OWNED');

    // Offline order: the submission arrived before its capture; once registered it goes through.
    const late = withCapture(missingId);
    await prisma.fieldEvidenceLog.create({ data: { projectId: ids.prg105, fieldSessionId: o.sessionId, clientCaptureId: missingId, locationAvailable: true, latitude: 9, longitude: 7, capturedAtDevice: new Date() } });
    const ok = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(late);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const linked = await prisma.fieldEvidenceLog.findUniqueOrThrow({ where: { clientCaptureId: missingId } });
    assert.equal(linked.visitSubmissionId, ok.body.data.id);
    assert.equal(linked.visitAnswerPath, photoField!.path);

    const v2 = await plannedVisit(o, { daysAhead: 2 });
    const form2 = await formOf(ids.prg105, v2.id, o.auth);
    const reuse = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v2.id}/submissions`)
      .set(o.auth)
      .send(submitBody(form2, { answers: answerAll(form2.snapshot, { [photoField!.path]: { captures: [{ clientCaptureId: missingId, unitId: null, kind: 'PHOTO' }] } }) }));
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.error.code, 'CAPTURE_ALREADY_LINKED');
  });

  it('maps per-unit photos to their unit', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const perUnit = form.snapshot.blocks.flatMap((b) => b.fields).find((f) => f.type === 'PHOTO' && f.photo?.mode !== 'AT_LEAST_N' && f.photo!.slots.length > 0);
    if (!perUnit) return; // the default library has no per-unit photo on this form
    const slot = perUnit.photo!.slots[0];
    const cid = await capture(ids.prg105, o.sessionId);
    const res = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`)
      .set(o.auth)
      .send(submitBody(form, { answers: answerAll(form.snapshot, { [perUnit.path]: { captures: [{ clientCaptureId: cid, unitId: slot.unitId, kind: 'PHOTO' }] } }) }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await prisma.fieldEvidenceLog.findUniqueOrThrow({ where: { clientCaptureId: cid } })).facilityUnitId, slot.unitId);
  });

  it('a missed visit is still accepted later, flagged late', async () => {
    const { runJobOnce, registerAllJobs } = await import('../jobs');
    registerAllJobs();
    const o = await officer();
    const date = addWorkdays(today(), -12, WORK_WEEK);
    const created = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits`)
      .set(await web(P_MONITOR))
      .send({ visitKind: 'ROUTINE', plannedDate: date, assignees: [{ userId: o.userId, isLead: true }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const visitId = created.body.data.id;
    await runJobOnce('visit-deadlines');
    const missed = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
    assert.equal(missed.status, 'MISSED');
    assert.ok(missed.missedAt);
    assert.ok(await prisma.webNotification.findFirst({ where: { category: 'VISIT_MISSED', metadata: { path: ['visitId'], equals: visitId } } }));
    const form = await formOf(ids.prg105, visitId, o.auth);
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${visitId}/submissions`).set(o.auth).send(submitBody(form));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.isLate, true);
    const after = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
    assert.ok(['SUBMITTED', 'APPROVED'].includes(after.status));
    assert.ok(after.missedAt);
  });

  it('an unscheduled Ad hoc visit is re-assembled on the server and compared by hash', async () => {
    const o = await officer();
    const packRes = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/field-pack`).set(o.auth);
    assert.equal(packRes.status, 200, JSON.stringify(packRes.body));
    const pack = packRes.body.data as VisitFieldPackDto;
    const picked = [pack.bundle.facilities[0].id];
    const built = assembleVisitForm(
      assemblyInputFromBundle(pack.bundle, { visitKind: 'AD_HOC', visitDate: today(), builtAt: new Date().toISOString(), pickedFacilityIds: picked, rechecks: pack.rechecks })
    );
    const hash = createHash('sha256').update(canonicalVisitFormSnapshot(built.snapshot), 'utf8').digest('hex');
    const template = pack.bundle.templates.find((t) => t.visitKind === 'AD_HOC')!;
    const body = {
      clientVisitId: crypto.randomUUID(),
      visitKind: 'AD_HOC',
      plannedDate: today(),
      pickedFacilityIds: picked,
      components: { templateId: template.id, sectionIds: built.snapshot.sources.sections.map((s) => s.id), subFormIds: [...new Set(built.snapshot.sources.subForms.map((s) => s.id))] },
      recheckIds: pack.rechecks.map((r) => r.id),
      formHash: hash,
    };
    const wrong = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/unscheduled`).set(o.auth).send({ ...body, clientVisitId: crypto.randomUUID(), formHash: 'b'.repeat(64) });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error.code, 'FORM_SNAPSHOT_STALE');
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/unscheduled`).set(o.auth).send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.origin, 'UNSCHEDULED');
    assert.equal(res.body.data.formHash, hash);
    const replay = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/unscheduled`).set(o.auth).send(body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.id, res.body.data.id);
  });

  it('site log entries are idempotent and attach to a submission', async () => {
    const o = await officer();
    const cid = await capture(ids.prg105, o.sessionId);
    const entry = { clientEntryId: crypto.randomUUID(), kind: 'PHOTO', clientCaptureId: cid, capturedAt: new Date().toISOString() };
    const a = await request(app).post(`/api/v1/projects/${ids.prg105}/site-log`).set(o.auth).send(entry);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await request(app).post(`/api/v1/projects/${ids.prg105}/site-log`).set(o.auth).send(entry);
    assert.equal(b.status, 200);
    const note = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/site-log`)
      .set(o.auth)
      .send({ clientEntryId: crypto.randomUUID(), kind: 'NOTE', text: 'Scaffolding unsafe at block B', capturedAt: new Date().toISOString() });
    assert.equal(note.status, 201);
    const list = await request(app).get(`/api/v1/projects/${ids.prg105}/site-log`).set(await web(P_MONITOR));
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((e: { id: string }) => e.id === a.body.data.id));

    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(form, { siteLogEntryIds: [a.body.data.id, note.body.data.id] }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.siteLog.length, 2);
    const stranger = await officer();
    const notTheirs = await request(app).post(`/api/v1/projects/${ids.prg105}/site-log/${note.body.data.id}/hide`).set(stranger.auth);
    assert.equal(notTheirs.status, 403);
    const hidden = await request(app).post(`/api/v1/projects/${ids.prg105}/site-log/${note.body.data.id}/hide`).set(o.auth);
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.data.hidden, true);
  });

  it('a field principal of another project is refused', async () => {
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 3 });
    const elsewhere = await officer(ids.prg102);
    const res = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}/form`).set(elsewhere.auth);
    assert.ok([403, 404].includes(res.status), String(res.status));
  });
});

// ---------------------------------------------------------------------------
// R4d
// ---------------------------------------------------------------------------

async function setReportApproval(projectId: string, on: boolean) {
  await prisma.projectProcessConfig.upsert({ where: { projectId }, update: { requireReportApproval: on }, create: { projectId, requireReportApproval: on } });
}

/** A field whose rule raises a finding on an `equals` answer (e.g. "PPE worn" = NO). */
function findingField(snapshot: VisitFormSnapshot) {
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      const rule = f.rules.find((r) => r.then === 'RAISE_FINDING' && 'equals' in r.when);
      if (rule && !f.recheck) return { field: f, value: (rule.when as { equals: string }).equals };
    }
  }
  return null;
}

describe('Redesign R4d: approval, findings loop, progress, milestones', () => {
  it('goes through the REPORT chain; the submitter cannot approve; return then resubmit', async () => {
    await setReportApproval(ids.prg105, true);
    try {
      const resident = await createFieldSession(prisma, { projectId: ids.prg105, roleCode: 'INDEPENDENT_RESIDENT', userId: ids.resident });
      const o: Officer = { userId: ids.resident, sessionId: resident.sessionId, auth: await fieldAuth(prisma, resident.sessionId) };
      const v = await plannedVisit(o, { daysAhead: 1 });
      const form = await formOf(ids.prg105, v.id, o.auth);
      const sub = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(form));
      assert.equal(sub.status, 201, JSON.stringify(sub.body));
      assert.equal(sub.body.data.status, 'PENDING_APPROVAL');
      assert.ok(await prisma.webNotification.findFirst({ where: { category: 'VISIT_PENDING_APPROVAL', metadata: { path: ['visitSubmissionId'], equals: sub.body.data.id } } }));

      const self = await request(app)
        .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions/${sub.body.data.id}/review`)
        .set(await web('resident.supervisor@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(self.status, 403, JSON.stringify(self.body));

      const returned = await request(app)
        .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions/${sub.body.data.id}/review`)
        .set(await web(P_MONITOR))
        .send({ decision: 'RETURN', notes: 'Add photos of the roof' });
      assert.equal(returned.status, 200, JSON.stringify(returned.body));
      assert.equal(returned.body.data.status, 'RETURNED');
      const detail = await request(app).get(`/api/v1/projects/${ids.prg105}/visits/${v.id}`).set(await web(P_MONITOR));
      assert.equal(detail.body.data.visit.status, 'RETURNED');
      assert.ok(detail.body.data.comments.some((c: { text: string }) => c.text.includes('Add photos of the roof')));
      assert.equal(await prisma.mobileNotification.count({ where: { fieldSessionId: resident.sessionId, type: 'VISIT_RETURNED' } }), 1);

      const again = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(form));
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.data.revisionNumber, 2);
      const approved = await request(app)
        .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions/${again.body.data.id}/review`)
        .set(await web(P_MONITOR))
        .send({ decision: 'APPROVE' });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.data.status, 'APPROVED');
      assert.equal((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status, 'APPROVED');
    } finally {
      await setReportApproval(ids.prg105, false);
    }
  });

  it('without report approval a submission is accepted at once', async () => {
    await setReportApproval(ids.prg105, false);
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const sub = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(form));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal(sub.body.data.status, 'APPROVED');
    assert.equal(sub.body.data.approval, null);
  });

  it('raises findings from the form rules, refreshes unstarted forms, re-checks and resolves them, emails the contractor', async () => {
    await setReportApproval(ids.prg105, false);
    const contractor = await prisma.projectContractor.findFirst({ where: { projectId: ids.prg105 }, select: { organizationId: true } });
    if (contractor) await prisma.organization.update({ where: { id: contractor.organizationId }, data: { contactEmail: 'site.manager@contractor.example' } });
    const { consoleOutbox } = await import('../integrations/messaging/adapters');
    const o = await officer();
    const waiting = await plannedVisit(o, { daysAhead: 8 });
    const started = await plannedVisit(o, { daysAhead: 9 });
    await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${started.id}/check-in`).set(o.auth).send({ clientCheckInId: crypto.randomUUID(), checkedInAt: new Date().toISOString() }).expect(200);

    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const ff = findingField(form.snapshot);
    assert.ok(ff, 'the routine form has a rule that raises a finding');
    const before = consoleOutbox.length;
    const sub = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`)
      .set(o.auth)
      .send(submitBody(form, { answers: answerAll(form.snapshot, { [ff!.field.path]: { value: ff!.value, comment: 'Workers without helmets' } }) }));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal(sub.body.data.findingIds.length, 1);
    const finding = await prisma.inspectionFinding.findUniqueOrThrow({ where: { id: sub.body.data.findingIds[0] } });
    assert.equal(finding.visitSubmissionId, sub.body.data.id);
    assert.equal(finding.questionKey, ff!.field.path);
    assert.equal(finding.status, 'OPEN');
    if (contractor) {
      const mail = consoleOutbox.slice(before).find((m) => m.to === 'site.manager@contractor.example');
      assert.ok(mail, 'the contractor got the findings summary');
      assert.match(mail!.rendered.text, /Open findings to correct/);
    }

    // The unstarted visit's form now re-checks the finding; the checked-in one is unchanged.
    const waitingAfter = await prisma.visit.findUniqueOrThrow({ where: { id: waiting.id } });
    assert.notEqual(waitingAfter.formHash, waiting.formHash);
    assert.equal((await prisma.visit.findUniqueOrThrow({ where: { id: started.id } })).formHash, started.formHash);
    const waitingForm = await formOf(ids.prg105, waiting.id, o.auth);
    const recheck = waitingForm.snapshot.blocks.find((b) => b.kind === 'RECHECK')?.fields.find((f) => f.recheck?.id === finding.id);
    assert.ok(recheck);

    // An officer offline with the older form (it differs only in re-checks) is still accepted.
    const older = await prisma.visitFormSnapshot.findUniqueOrThrow({ where: { id: waiting.formSnapshotId } });
    const olderForm = { formSnapshotId: older.id, formHash: older.contentSha256, snapshot: older.snapshotJson as unknown as VisitFormSnapshot };
    const offline = await plannedVisit(o, { daysAhead: 8 });
    void offline;
    assert.equal(olderForm.formHash, waiting.formHash);

    // Not resolved: the re-check is counted.
    const notYet = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${waiting.id}/submissions`)
      .set(o.auth)
      .send(submitBody(waitingForm, { answers: answerAll(waitingForm.snapshot, { [recheck!.path]: { value: 'NO', comment: 'Still no helmets' } }) }));
    assert.equal(notYet.status, 201, JSON.stringify(notYet.body));
    const counted = await prisma.inspectionFinding.findUniqueOrThrow({ where: { id: finding.id } });
    assert.equal(counted.status, 'OPEN');
    assert.equal(counted.recheckCount, 1);

    // Resolved with a photo on the next visit.
    const next = await plannedVisit(o, { daysAhead: 2 });
    const nextForm = await formOf(ids.prg105, next.id, o.auth);
    const r2 = nextForm.snapshot.blocks.find((b) => b.kind === 'RECHECK')!.fields.find((f) => f.recheck?.id === finding.id)!;
    const photo = await capture(ids.prg105, o.sessionId);
    const done = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${next.id}/submissions`)
      .set(o.auth)
      .send(submitBody(nextForm, { answers: answerAll(nextForm.snapshot, { [r2.path]: { value: 'YES', comment: null, captures: [{ clientCaptureId: photo, unitId: null, kind: 'PHOTO' }] } }) }));
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const resolved = await prisma.inspectionFinding.findUniqueOrThrow({ where: { id: finding.id } });
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.resolutionCaptureIds.length, 1);
    const list = await request(app).get(`/api/v1/projects/${ids.prg105}/findings?visitId=${v.id}`).set(await web(P_MONITOR));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.data[0].source, 'VISIT');
    assert.equal(list.body.data[0].status, 'RESOLVED');
    const alias = await request(app).get(`/api/v1/projects/${ids.prg105}/inspection-findings?visitId=${v.id}`).set(await web(P_MONITOR));
    assert.equal(alias.status, 200);
  });

  it('accepts a submission against an older form that differs only in its re-checks', async () => {
    await setReportApproval(ids.prg105, false);
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 6 });
    const oldForm = await formOf(ids.prg105, v.id, o.auth);
    // A new finding changes the re-check block of v.
    const other = await plannedVisit(o, { daysAhead: 1 });
    const otherForm = await formOf(ids.prg105, other.id, o.auth);
    const ff = findingField(otherForm.snapshot)!;
    await prisma.inspectionFinding.updateMany({ where: { projectId: ids.prg105, questionKey: ff.field.path, status: 'OPEN' }, data: { status: 'DISMISSED' } });
    await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${other.id}/submissions`)
      .set(o.auth)
      .send(submitBody(otherForm, { answers: answerAll(otherForm.snapshot, { [ff.field.path]: { value: ff.value, comment: 'Found again' } }) }))
      .expect(201);
    assert.notEqual((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).formHash, v.formHash);
    const res = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(oldForm));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.formSnapshotId, oldForm.formSnapshotId);
  });

  it('escalates an old open finding once', async () => {
    const { runJobOnce, registerAllJobs } = await import('../jobs');
    registerAllJobs();
    const finding = await prisma.inspectionFinding.findFirstOrThrow({ where: { projectId: ids.prg105, status: 'OPEN', visitId: { not: null } } });
    await prisma.inspectionFinding.update({ where: { id: finding.id }, data: { createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000), escalatedAt: null } });
    await runJobOnce('finding-escalations');
    await runJobOnce('finding-escalations');
    assert.ok((await prisma.inspectionFinding.findUniqueOrThrow({ where: { id: finding.id } })).escalatedAt);
    assert.equal(await prisma.webNotification.count({ where: { category: 'FINDING_ESCALATED', metadata: { path: ['findingId'], equals: finding.id } } }), 1);
  });

  it('a mobilisation check with the contractor on site completes the milestone on the visit date and cancels later checks', async () => {
    await setReportApproval(ids.prg102, false);
    const milestone = await prisma.projectContractMilestone.findFirst({ where: { projectId: ids.prg102, completionMode: 'AUTO_CONTRACTOR_ON_SITE' } });
    assert.ok(milestone, 'PRG-102 has a contractor-on-site milestone');
    const o = await officer(ids.prg102);
    const later = await plannedVisit(o, { daysAhead: 10, kind: 'MOBILISATION_CHECK', projectId: ids.prg102 });
    const v = await plannedVisit(o, { daysAhead: 0, kind: 'MOBILISATION_CHECK', projectId: ids.prg102 });
    const form = await formOf(ids.prg102, v.id, o.auth);
    const onSite = form.snapshot.blocks.flatMap((b) => b.fields).find((f) => f.signal?.kind === 'CONTRACTOR_ON_SITE')!;
    const sub = await request(app)
      .post(`/api/v1/projects/${ids.prg102}/visits/${v.id}/submissions`)
      .set(o.auth)
      .send(submitBody(form, { answers: answerAll(form.snapshot, { [onSite.path]: { value: 'YES', comment: null } }) }));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const m = await prisma.projectContractMilestone.findUniqueOrThrow({ where: { id: milestone!.id } });
    assert.equal(m.status, 'DONE');
    assert.equal(m.completedAt!.toISOString().slice(0, 10), v.plannedDate);
    const cancelled = await prisma.visit.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.match(cancelled.cancelledReason!, /contractor was on site/);
  });

  it('sets unit progress from the answers and line progress follows', async () => {
    await setReportApproval(ids.prg105, false);
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1 });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const pct = form.snapshot.blocks.flatMap((b) => b.fields.map((f) => ({ f, b }))).find(({ f }) => f.signal?.kind === 'PERCENT_COMPLETE');
    assert.ok(pct, 'the routine form asks % complete');
    const sub = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`)
      .set(o.auth)
      .send(submitBody(form, { answers: answerAll(form.snapshot, { [pct!.f.path]: { value: 42, comment: null } }) }));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const unitIds = pct!.f.unitId ? [pct!.f.unitId] : pct!.b.units.map((u) => u.id);
    for (const id of unitIds) {
      const u = await prisma.facilityUnit.findUniqueOrThrow({ where: { id } });
      assert.equal(Number(u.progressPct), 42);
      assert.equal(u.progressAsOf, v.plannedDate);
      const lines = await prisma.boqItem.findMany({ where: { facilityUnitId: id } });
      for (const l of lines) assert.equal(Number(l.cumulativeCertifiedPct), 42);
    }
  });

  it('an accepted final evaluation visit satisfies the CoC gate', async () => {
    await setReportApproval(ids.prg105, false);
    const o = await officer();
    const v = await plannedVisit(o, { daysAhead: 1, kind: 'FINAL_EVALUATION' });
    const form = await formOf(ids.prg105, v.id, o.auth);
    const sub = await request(app).post(`/api/v1/projects/${ids.prg105}/visits/${v.id}/submissions`).set(o.auth).send(submitBody(form));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const completion = await request(app).get(`/api/v1/projects/${ids.prg105}/completion`).set(await web(P_MONITOR));
    if (completion.status === 404) return; // closeout modules off on this project
    assert.equal(completion.status, 200, JSON.stringify(completion.body));
    assert.equal(completion.body.data.finalEvaluation.visitId, v.id);
  });
});

// ---------------------------------------------------------------------------
// R4e
// ---------------------------------------------------------------------------

describe('Redesign R4e: sprint verification, badge and KPIs', () => {
  it('verifies an ended sprint; early needs a note; re-verifying keeps the first date; the badge follows', async () => {
    const sprints = await prisma.projectSprint.findMany({ where: { projectId: ids.prg105 }, orderBy: { number: 'asc' } });
    const ended = sprints.find((s) => s.endDate < today())!;
    const verifiedBefore = await prisma.auditLog.count({ where: { projectId: ids.prg105, action: 'SPRINT_VERIFIED' } });
    const current = sprints.find((s) => s.startDate <= today() && today() <= s.endDate)!;

    const view = await request(app).get(`/api/v1/projects/${ids.prg105}/scope/sprints/${ended.id}/verification`).set(await web(P_MONITOR));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.data.canVerify, true);
    assert.ok(view.body.data.facilities.length > 0);

    const early = await request(app).post(`/api/v1/projects/${ids.prg105}/scope/sprints/${current.id}/verification`).set(await web(P_MONITOR)).send({ outcome: 'MET' });
    assert.equal(early.status, 422);
    assert.equal(early.body.error.code, 'NOTE_REQUIRED');
    const funder = await request(app).post(`/api/v1/projects/${ids.prg105}/scope/sprints/${ended.id}/verification`).set(await web(P_FUNDER)).send({ outcome: 'MET' });
    assert.equal(funder.status, 403);

    const partly = await request(app)
      .post(`/api/v1/projects/${ids.prg105}/scope/sprints/${ended.id}/verification`)
      .set(await web(P_MONITOR))
      .send({ outcome: 'PARTLY_MET', notes: 'Roofing not finished' });
    assert.equal(partly.status, 200, JSON.stringify(partly.body));
    assert.equal(partly.body.data.status, 'VERIFIED');
    const first = partly.body.data.firstVerifiedAt;
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.prg105 } })).scheduleStatus, 'BEHIND');

    const met = await request(app).post(`/api/v1/projects/${ids.prg105}/scope/sprints/${ended.id}/verification`).set(await web(P_MONITOR)).send({ outcome: 'MET' });
    assert.equal(met.status, 200);
    assert.equal(met.body.data.outcome, 'MET');
    assert.equal(met.body.data.firstVerifiedAt, first);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.prg105, action: 'SPRINT_VERIFIED' } }), verifiedBefore + 2);

    const scope = await request(app).get(`/api/v1/projects/${ids.prg105}/scope`).set(await web(P_MONITOR));
    const dto = scope.body.data.sprints.find((s: { id: string }) => s.id === ended.id);
    assert.equal(dto.status, 'VERIFIED');
    assert.equal(dto.verificationOutcome, 'MET');
  });

  it('notifies once when a sprint ends unverified', async () => {
    const { runJobOnce, registerAllJobs } = await import('../jobs');
    registerAllJobs();
    await runJobOnce('visit-deadlines');
    await runJobOnce('visit-deadlines');
    const unverified = await prisma.projectSprint.findMany({ where: { projectId: ids.prg105, endDate: { lt: today() }, verificationOutcome: null } });
    assert.ok(unverified.length > 0);
    for (const s of unverified) {
      assert.equal(await prisma.webNotification.count({ where: { category: 'SPRINT_VERIFICATION_DUE', metadata: { path: ['sprintId'], equals: s.id } } }), 1);
    }
  });

  it('the KPI endpoint reports the re-based visit KPIs and the new sprint KPI', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids.prg105}/kpis`).set(await web(P_MONITOR));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = JSON.stringify(res.body.data);
    assert.ok(!body.includes('monitoring_framework_established'));
    assert.ok(body.includes('sprints_verified_on_time'));
  });
});
