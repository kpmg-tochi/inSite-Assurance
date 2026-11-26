/**
 * Client demo updates F.4 (wave 3): contractor flags and decided actions on the seeded UBEC tenant.
 * - The rule (3 accepted reports rating workmanship 3 or below within 60 days) raises one flag when
 *   the third low report is accepted (through `acceptSubmission` + `afterAcceptanceCommitted`, the
 *   hook), notifies `contractors:manage` once and audits it; later low reports join it as evidence.
 * - The daily job `contractor-flags` is registered, claims one run per tenant-day and raises nothing twice.
 * - Decisions (`contractors:manage`): ADDITIONAL_VISITS proposes visits; PAYMENT_HOLD is in effect
 *   (payments summary, 422 without an override reason, PAID_DURING_HOLD with one) until lifted;
 *   DEDUCTION goes to Legal review; NO_FURTHER_ACTION closes the flag (then 409 FLAG_CLOSED).
 * - Register: `openFlagCount` and `flagged=true`.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { formatCalendarDate, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');
let acceptance: typeof import('../modules/visits/visitAcceptance');
let visitCore: typeof import('../modules/visits/visitCore');
let flagsService: typeof import('../modules/contractorFlags/contractorFlags.service');

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const DAY_MS = 86_400_000;

async function web(email = ADMIN) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const withoutNulls = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as Record<string, unknown>;

function withWorkmanship(answers: unknown, value: number) {
  const list = (Array.isArray(answers) ? answers : []) as Array<{ path: string; value: unknown }>;
  const rest = list.filter((a) => a.path !== 's:WORKMANSHIP/workmanship');
  return [...rest, { path: 's:WORKMANSHIP/workmanship', value, comment: null, captures: [] }] as never;
}

/** A monitoring report rated `workmanship` on a visit `daysAgo` days ago, accepted through the real path. */
async function acceptReport(workmanship: number, daysAgo: number): Promise<string> {
  const template = await prisma.visitSubmission.findUniqueOrThrow({ where: { id: ids.template } });
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id: template.visitId } });
  const v = await prisma.visit.create({
    data: {
      ...withoutNulls(visit),
      id: undefined,
      generatorKey: null,
      clientVisitId: null,
      clientCheckInId: null,
      status: 'SUBMITTED',
      // The rule dates a report on its visit.
      plannedDate: zonedCalendarDate(new Date(Date.now() - daysAgo * DAY_MS), 'Africa/Lagos'),
      originalPlannedDate: zonedCalendarDate(new Date(Date.now() - daysAgo * DAY_MS), 'Africa/Lagos'),
    } as never,
  });
  const s = await prisma.visitSubmission.create({
    data: {
      ...withoutNulls(template),
      id: undefined,
      clientSubmissionId: crypto.randomUUID(),
      visitId: v.id,
      status: 'PENDING_APPROVAL',
      approvedAt: undefined,
      answersJson: withWorkmanship(template.answersJson, workmanship),
      confirmedAt: new Date(Date.now() - daysAgo * DAY_MS),
    } as never,
  });
  const outbox: import('../modules/visits/visitAcceptance').AcceptanceOutbox = { emails: [], refreshProjects: new Set() };
  await prisma.$transaction(
    (tx) => acceptance.acceptSubmission(tx, s.id, { actor: visitCore.SYSTEM_VISIT_ACTOR, pushes: [], outbox, notifyOfficer: false }),
    { timeout: 60_000 }
  );
  await acceptance.afterAcceptanceCommitted(outbox);
  return s.id;
}

async function flagsOnProject() {
  return prisma.contractorFlag.findMany({ where: { projectId: ids.project }, include: { actions: true }, orderBy: { raisedAt: 'asc' } });
}

async function decide(body: Record<string, unknown>, email = ADMIN) {
  return request(app).post(`/api/v1/contractor-flags/${ids.flag}/actions`).set(await web(email)).send(body);
}

async function pay(body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/v1/projects/${ids.project}/payments`)
    .set(await web())
    .send({ kind: 'INTERIM', paidOn: zonedCalendarDate(new Date(), 'Africa/Lagos'), grossAmountNgn: 1_000, reference: `PV-${crypto.randomUUID().slice(0, 8)}`, ...body });
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  acceptance = await import('../modules/visits/visitAcceptance');
  visitCore = await import('../modules/visits/visitCore');
  flagsService = await import('../modules/contractorFlags/contractorFlags.service');
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  // The default rule, written out so the test does not depend on the seed's settings.
  const settings = (tenant.contractorPerformanceJson ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { contractorPerformanceJson: { ...settings, flagRule: { enabled: true, reportCount: 3, workmanshipAtOrBelow: 3, withinDays: 60 } } },
  });

  // A live UBEC project with one contractor, an accepted report and no flag yet.
  const candidates = await prisma.visitSubmission.findMany({
    where: { status: 'APPROVED', project: { tenantId: tenant.id, status: 'ACTIVE', contractors: { some: { contractStatus: 'ACTIVE' } }, contractorFlags: { none: {} } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, projectId: true },
  });
  const pick = candidates.find(Boolean);
  assert.ok(pick, 'the seed has an accepted monitoring report on a live, unflagged UBEC project');
  ids.template = pick!.id;
  ids.project = pick!.projectId;
  const engagements = await prisma.projectContractor.findMany({ where: { projectId: ids.project }, orderBy: { createdAt: 'asc' } });
  await prisma.projectContractor.deleteMany({ where: { projectId: ids.project, id: { not: engagements[0].id } } });
  ids.org = engagements[0].organizationId;
  // Earlier reports on the project rate workmanship 5, so only this test's reports count.
  for (const s of await prisma.visitSubmission.findMany({ where: { projectId: ids.project, status: 'APPROVED' } })) {
    await prisma.visitSubmission.update({ where: { id: s.id }, data: { answersJson: withWorkmanship(s.answersJson, 5) } });
  }
});

describe('client demo F.4: contractor flags', () => {
  it('raises one flag when the third low report is accepted, notifies once, and merges later evidence', async () => {
    await acceptReport(2, 30);
    await acceptReport(3, 20);
    assert.equal((await flagsOnProject()).length, 0, 'two low reports do not meet the rule');

    ids.third = await acceptReport(1, 5);
    let flags = await flagsOnProject();
    assert.equal(flags.length, 1);
    const flag = flags[0];
    ids.flag = flag.id;
    assert.equal(flag.status, 'OPEN');
    assert.equal(flag.organizationId, ids.org);
    assert.deepEqual(flag.ruleJson, { reportCount: 3, workmanshipAtOrBelow: 3, withinDays: 60 });
    const evidence = flag.evidenceJson as Array<{ visitSubmissionId: string; workmanship: number; label: string; date: string }>;
    assert.equal(evidence.length, 3);
    assert.equal(evidence[0].visitSubmissionId, ids.third, 'newest first');
    assert.ok(evidence[0].label.endsWith(` of ${formatCalendarDate(evidence[0].date)}`), 'date and label both use the visit date');
    assert.equal(evidence[0].date, zonedCalendarDate(new Date(Date.now() - 5 * DAY_MS), 'Africa/Lagos'));

    const notes = await prisma.webNotification.findMany({ where: { projectId: ids.project, category: 'CONTRACTOR_FLAGGED' } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].targetPermissionKey, 'contractors:manage');
    assert.equal(notes[0].actionUrl, `/app/contractors/${ids.org}?flag=${flag.id}`);
    assert.match(notes[0].title, /: contractor flagged$/);
    assert.match(notes[0].description, /3 monitoring reports rated workmanship 3 or below in 60 days/);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'CONTRACTOR_FLAG_RAISED' } }), 1);

    // A fourth low report joins the open flag; a good one does not.
    await acceptReport(2, 1);
    await acceptReport(5, 1);
    flags = await flagsOnProject();
    assert.equal(flags.length, 1);
    assert.equal((flags[0].evidenceJson as unknown[]).length, 4);
    assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'CONTRACTOR_FLAGGED' } }), 1);
  });

  it('registers the contractor-flags job, one run per tenant-day, raising nothing twice', async () => {
    assert.ok(jobs.registeredJobs().some((j) => j.name === 'contractor-flags'));
    const now = new Date();
    assert.equal(await jobs.runJobOnce('contractor-flags', now), true);
    const today = zonedCalendarDate(now, 'Africa/Lagos');
    const run = await prisma.jobRun.findUnique({ where: { jobName_scopeKey: { jobName: 'contractor-flags', scopeKey: `${ids.tenant}:${today}` } } });
    assert.equal(run?.status, 'DONE');
    assert.equal((await flagsOnProject()).length, 1);
  });

  it('lists the flag for the register, the project and the contractor, with openFlagCount and flagged=true', async () => {
    const list = await request(app).get('/api/v1/contractor-flags').query({ status: 'OPEN' }).set(await web());
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = list.body.data.find((f: { id: string }) => f.id === ids.flag);
    assert.ok(row);
    assert.equal(row.canDecide, true);
    assert.equal(row.evidence.length, 4);
    assert.match(row.summary, /^4 monitoring reports rated workmanship 3 or below in 60 days/);

    const one = await request(app).get(`/api/v1/contractor-flags/${ids.flag}`).set(await web());
    assert.equal(one.status, 200);
    assert.equal(one.body.data.projectId, ids.project);
    assert.equal((await request(app).get('/api/v1/contractor-flags/not-a-uuid').set(await web())).status, 404);

    // Detail for a project reader without the register keys: only while the project is visible to them.
    const users = await prisma.user.findMany({
      where: { tenantId: ids.tenant, isActive: true, role: { surface: { not: 'MOBILE' } } },
      select: { id: true, email: true, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const reader = users.find((u) => {
      const keys = u.role.rolePermissions.map((p) => p.permission.key);
      return !['contractors:view_register', 'contractors:manage', 'projects:view_all_tenant', 'projects:view_organization_tree'].some((k) => keys.includes(k));
    });
    assert.ok(reader, 'a web user who sees assigned projects only, without the register keys');
    await prisma.userProjectAssignment.deleteMany({ where: { userId: reader!.id, projectId: ids.project } });
    assert.equal((await request(app).get(`/api/v1/contractor-flags/${ids.flag}`).set(await web(reader!.email))).status, 404);
    assert.equal((await request(app).get('/api/v1/contractor-flags').set(await web(reader!.email))).status, 403);
    await prisma.userProjectAssignment.create({ data: { userId: reader!.id, projectId: ids.project } });
    const asReader = await request(app).get(`/api/v1/contractor-flags/${ids.flag}`).set(await web(reader!.email));
    assert.equal(asReader.status, 200, JSON.stringify(asReader.body));
    assert.equal(asReader.body.data.canDecide, false);
    const readerProject = await request(app).get(`/api/v1/projects/${ids.project}/contractor-flags`).set(await web(reader!.email));
    assert.equal(readerProject.status, 200, JSON.stringify(readerProject.body));

    const project = await request(app).get(`/api/v1/projects/${ids.project}/contractor-flags`).set(await web());
    assert.equal(project.status, 200, JSON.stringify(project.body));
    assert.deepEqual(
      project.body.data.map((f: { id: string }) => f.id),
      [ids.flag]
    );

    const flagged = await request(app).get('/api/v1/contractors').query({ flagged: 'true' }).set(await web());
    assert.equal(flagged.status, 200);
    const contractor = flagged.body.data.find((c: { id: string }) => c.id === ids.org);
    assert.ok(contractor, 'the flagged contractor is listed');
    assert.equal(contractor.openFlagCount, 1);
    assert.ok(flagged.body.data.every((c: { openFlagCount: number }) => c.openFlagCount > 0));
    const detail = await request(app).get(`/api/v1/contractors/${ids.org}`).set(await web());
    assert.equal(detail.body.data.openFlagCount, 1);
  });

  it('refuses decisions without contractors:manage (403)', async () => {
    const users = await prisma.user.findMany({
      where: { tenantId: ids.tenant, isActive: true, role: { surface: { not: 'MOBILE' } } },
      select: { email: true, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const outsider = users.find((u) => !u.role.rolePermissions.some((p) => p.permission.key === 'contractors:manage'));
    assert.ok(outsider, 'a web user without contractors:manage');
    const res = await decide({ kind: 'FORMAL_WARNING', reason: 'Repeated poor workmanship' }, outsider!.email);
    assert.equal(res.status, 403);
  });

  it('ADDITIONAL_VISITS proposes visits on working days from next week', async () => {
    const missing = await decide({ kind: 'ADDITIONAL_VISITS', reason: 'Closer supervision needed' });
    assert.equal(missing.status, 400);
    const res = await decide({ kind: 'ADDITIONAL_VISITS', reason: 'Closer supervision needed', visitCount: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const action = res.body.data.actions.find((a: { kind: string }) => a.kind === 'ADDITIONAL_VISITS');
    assert.equal(action.status, 'RECORDED');
    assert.equal(action.visitIds.length, 2);
    const visits = await prisma.visit.findMany({ where: { id: { in: action.visitIds } }, orderBy: { plannedDate: 'asc' } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project }, select: { timezone: true, workWeekDays: true } });
    const today = zonedCalendarDate(new Date(), project.timezone);
    assert.equal(visits.length, 2);
    for (const v of visits) {
      assert.equal(v.status, 'PROPOSED');
      assert.equal(v.visitKind, 'ROUTINE');
      assert.ok(v.plannedDate > today);
      const dow = new Date(`${v.plannedDate}T00:00:00Z`).getUTCDay() || 7;
      assert.ok(project.workWeekDays.includes(dow), 'on a working day');
    }
    assert.notEqual(visits[0].plannedDate, visits[1].plannedDate);
    const badKind = await decide({ kind: 'ADDITIONAL_VISITS', reason: 'Closer supervision needed', visitCount: 1, visitKind: 'MOBILISATION_CHECK' });
    assert.equal(badKind.status, 422);
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'CONTRACTOR_FLAG_ACTION_DECIDED' } }));
  });

  it('PAYMENT_HOLD shows on the payments summary, needs an override reason, flags the payment, and lifts', async () => {
    const res = await decide({ kind: 'PAYMENT_HOLD', reason: 'Hold until the defective works are redone' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const hold = res.body.data.actions.find((a: { kind: string }) => a.kind === 'PAYMENT_HOLD');
    assert.equal(hold.status, 'IN_EFFECT');
    const second = await decide({ kind: 'PAYMENT_HOLD', reason: 'A second hold on the same work' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'PAYMENT_HOLD_ACTIVE');

    const summary = await request(app).get(`/api/v1/projects/${ids.project}/payments`).set(await web());
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.data.paymentHold.actionId, hold.id);
    assert.equal(summary.body.data.paymentHold.flagId, ids.flag);

    const refused = await pay();
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'PAYMENT_HOLD_OVERRIDE_REQUIRED');
    const paid = await pay({ holdOverrideReason: 'Works certified before the hold', description: 'Interim payment' });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.ok(paid.body.data.exceptions.includes('PAID_DURING_HOLD'));
    assert.match(paid.body.data.description, /^Interim payment · Paid during payment hold: Works certified before the hold$/);
    const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'PAYMENT_RECORDED' }, orderBy: { seq: 'desc' } });
    assert.equal(((audit!.payload as Record<string, unknown>).paymentHold as Record<string, unknown>).overrideReason, 'Works certified before the hold');
    assert.ok(await prisma.webNotification.findFirst({ where: { projectId: ids.project, category: 'PAYMENT_EXCEPTION', description: { contains: 'payment hold' } } }));

    const lift = await request(app)
      .post(`/api/v1/contractor-flags/${ids.flag}/actions/${hold.id}/lift`)
      .set(await web())
      .send({ reason: 'Defective works redone and checked' });
    assert.equal(lift.status, 200, JSON.stringify(lift.body));
    assert.equal(lift.body.data.actions.find((a: { id: string }) => a.id === hold.id).status, 'LIFTED');
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'CONTRACTOR_FLAG_ACTION_LIFTED' } }));
    const again = await request(app).post(`/api/v1/contractor-flags/${ids.flag}/actions/${hold.id}/lift`).set(await web()).send({ reason: 'Lift it twice' });
    assert.equal(again.status, 409);

    const after = await request(app).get(`/api/v1/projects/${ids.project}/payments`).set(await web());
    assert.equal(after.body.data.paymentHold, null);
    const normal = await pay();
    assert.equal(normal.status, 201, JSON.stringify(normal.body));
    assert.ok(!normal.body.data.exceptions.includes('PAID_DURING_HOLD'));
  });

  it('DEDUCTION is sent to Legal review with its amount and clause', async () => {
    const res = await decide({ kind: 'DEDUCTION', reason: 'Liquidated damages for the late roof', deductionAmountNgn: 250_000, clause: 'GCC 49.1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const action = res.body.data.actions.find((a: { kind: string }) => a.kind === 'DEDUCTION');
    assert.equal(action.status, 'SENT_TO_LEGAL_REVIEW');
    assert.deepEqual(action.params, { deductionAmountNgn: 250_000, clause: 'GCC 49.1' });
    assert.equal(res.body.data.status, 'OPEN');
  });

  it('NO_FURTHER_ACTION closes the flag; a closed flag takes no decision and is not raised again', async () => {
    const res = await decide({ kind: 'NO_FURTHER_ACTION', reason: 'Contractor replaced the site engineer; works now acceptable' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'CLOSED');
    assert.equal(res.body.data.closeReason, 'Contractor replaced the site engineer; works now acceptable');
    assert.ok(res.body.data.closedAt);
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'CONTRACTOR_FLAG_CLOSED' } }));

    const late = await decide({ kind: 'FORMAL_WARNING', reason: 'Too late for this one' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'FLAG_CLOSED');

    assert.equal(await flagsService.evaluateContractorFlags(ids.tenant, new Date()), 0);
    assert.equal((await flagsOnProject()).length, 1, 'the closed flag\'s reports do not raise a new one');
    const register = await request(app).get(`/api/v1/contractors/${ids.org}`).set(await web());
    assert.equal(register.body.data.openFlagCount, 0);
  });
});
