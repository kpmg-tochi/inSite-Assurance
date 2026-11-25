/**
 * UBEC IRL early-warning alerts (portal output 5): the `project-alerts` job raises DELAYED, STALLED,
 * SITE_UPDATE_OVERDUE and SPEND_AHEAD_OF_PROGRESS once per occurrence into `Project.alertStateJson`,
 * notifies the right web users (and the field officers on their phones for the field alerts),
 * clears an alert when its condition clears, reads thresholds from the project's type snapshot, and
 * the project rows and the Overview carry the active alerts.
 *
 * PRG-105 (Direct Intervention, seeded): BEHIND, one baseline visit accepted months ago, no visit
 * since that raised unit progress, one interim payment, no contract sum. Its seeded alert state is
 * reset first so the job's first run is observed.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import type { Prisma } from '@prisma/client';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');
let audit: typeof import('../modules/audit/audit.service');

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const ME_OFFICER = 'me.officer@ubec.test';
const INDEPENDENT = 'independent.me@ubec.test';
const SUPERVISOR = 'resident.supervisor@ubec.test';
const ALERT_CATEGORIES = ['SCHEDULE_BEHIND', 'PROJECT_STALLED', 'SITE_UPDATE_OVERDUE', 'SPEND_AHEAD_OF_PROGRESS'];
const DAY = 24 * 3600 * 1000;
const t0 = new Date();
const day = (n: number) => new Date(t0.getTime() + n * DAY);

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const pushes: Array<{ userId: string; title: string; data: Record<string, unknown> }> = [];
let projectId = '';
let supervisorId = '';
let supervisorSession = '';

async function alertState(): Promise<Record<string, string>> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { alertStateJson: true } });
  return p.alertStateJson as Record<string, string>;
}
async function webAlerts(category?: string) {
  return prisma.webNotification.findMany({ where: { projectId, category: category ?? { in: ALERT_CATEGORIES } }, orderBy: { createdAt: 'asc' } });
}
async function mobileAlerts() {
  const rows = await prisma.mobileNotification.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  return rows.filter((r) => (r.metadata as { alertKey?: string }).alertKey);
}
async function setTypeAlerts(alerts: Record<string, unknown>) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { projectTypeSnapshotJson: true } });
  const snap = (p.projectTypeSnapshotJson ?? {}) as { config?: { monitoring?: Record<string, unknown> } };
  const config = snap.config ?? {};
  const next = { ...snap, config: { ...config, monitoring: { ...(config.monitoring ?? {}), alerts } } };
  await prisma.project.update({ where: { id: projectId }, data: { projectTypeSnapshotJson: next as unknown as Prisma.InputJsonValue } });
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  audit = await import('../modules/audit/audit.service');
  const alerts = await import('../modules/alerts/projectAlerts.service');
  alerts.setAlertPushSender(async (userId, message) => {
    pushes.push({ userId, title: message.title, data: message.data });
    return 1;
  });
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  const p = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'PRG-105' } });
  projectId = p.id;
  assert.equal(p.scheduleStatus, 'BEHIND', 'seed: PRG-105 is behind');
  assert.equal(p.contractSumNgn, null, 'seed: PRG-105 has no contract sum');
  await prisma.project.update({ where: { id: projectId }, data: { alertStateJson: {}, scheduleBehindAlertedAt: null } });
  await prisma.webNotification.deleteMany({ where: { projectId, category: { in: ALERT_CATEGORIES } } });
  for (const m of await mobileAlerts()) await prisma.mobileNotification.delete({ where: { id: m.id } });

  const supervisor = await prisma.user.findFirstOrThrow({ where: { email: SUPERVISOR } });
  supervisorId = supervisor.id;
  assert.ok(p.defaultVisitOfficerIds.includes(supervisorId), 'seed: the resident supervisor is the default visit officer');
  const existing = await prisma.fieldAgentSession.findFirst({ where: { projectId, userId: supervisorId, isActive: true, revokedAt: null } });
  supervisorSession = existing
    ? existing.id
    : (await createFieldSession(prisma, { projectId, userId: supervisorId, roleCode: 'INDEPENDENT_RESIDENT' })).sessionId;
});

after(async () => {
  const alerts = await import('../modules/alerts/projectAlerts.service');
  alerts.setAlertPushSender(null);
  await prisma.$disconnect();
});

describe('UBEC IRL early-warning alerts', () => {
  it('raises each active alert once, to the right recipients, with links to web pages', async () => {
    await jobs.runJobOnce('project-alerts', t0);
    const state = await alertState();
    assert.deepEqual(Object.keys(state).sort(), ['DELAYED', 'SITE_UPDATE_OVERDUE', 'STALLED']);

    const byCategory = new Map((await webAlerts()).map((n) => [n.category, n]));
    assert.equal(byCategory.size, 3);
    assert.equal(byCategory.get('SCHEDULE_BEHIND')?.targetPermissionKey, 'sprints:view_status');
    assert.equal(byCategory.get('SCHEDULE_BEHIND')?.actionUrl, `/app/projects/${projectId}/scope`);
    assert.equal(byCategory.get('PROJECT_STALLED')?.targetPermissionKey, 'findings:receive_escalations');
    assert.equal(byCategory.get('PROJECT_STALLED')?.actionUrl, `/app/projects/${projectId}/scope`);
    assert.equal(byCategory.get('SITE_UPDATE_OVERDUE')?.targetPermissionKey, 'visits:plan');
    assert.equal(byCategory.get('SITE_UPDATE_OVERDUE')?.actionUrl, `/app/projects/${projectId}/visits`);
    assert.match(byCategory.get('SITE_UPDATE_OVERDUE')!.title, /PRG-105: monitoring overdue/);

    // Field officers: one broadcast per field alert, and a push per officer that opens the project.
    const mobile = await mobileAlerts();
    assert.deepEqual(mobile.map((m) => (m.metadata as { alertKey: string }).alertKey).sort(), ['SITE_UPDATE_OVERDUE', 'STALLED']);
    for (const m of mobile) {
      assert.equal(m.fieldSessionId, null);
      assert.equal(m.actionType, 'NONE');
    }
    const supervisorPushes = pushes.filter((x) => x.userId === supervisorId);
    assert.deepEqual(supervisorPushes.map((x) => x.data.alertKey).sort(), ['SITE_UPDATE_OVERDUE', 'STALLED']);
    for (const x of supervisorPushes) assert.deepEqual([x.data.actionType, x.data.projectId], ['OPEN_PROJECT', projectId]);

    const field = await request(app).get(`/api/v1/projects/${projectId}/notifications`).set(await fieldAuth(prisma, supervisorSession));
    assert.equal(field.status, 200, JSON.stringify(field.body));
    const fieldAlerts = (field.body.data as Array<{ metadata: { alertKey?: string }; isRead: boolean }>).filter((n) => n.metadata.alertKey);
    assert.equal(fieldAlerts.length, 2);
    assert.ok(fieldAlerts.every((n) => !n.isRead));

    // Web recipients by permission.
    const seen = async (email: string) => {
      const res = await request(app).get(`/api/v1/projects/${projectId}/web-notifications`).set(await web(email));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return new Set((res.body.data as Array<{ category: string }>).map((n) => n.category).filter((c) => ALERT_CATEGORIES.includes(c)));
    };
    assert.deepEqual([...(await seen(ME_OFFICER))].sort(), ['PROJECT_STALLED', 'SCHEDULE_BEHIND', 'SITE_UPDATE_OVERDUE']);
    assert.deepEqual([...(await seen(INDEPENDENT))].sort(), ['SCHEDULE_BEHIND'], 'no visits:plan or escalations');
  });

  it('does not alert again while the conditions stay active', async () => {
    const before = (await webAlerts()).length;
    const mobileBefore = (await mobileAlerts()).length;
    const raisedAt = await alertState();
    await jobs.runJobOnce('project-alerts', t0); // same day: the JobRun is taken
    await jobs.runJobOnce('project-alerts', day(1));
    await jobs.runJobOnce('schedule-variance', day(1)); // the behind alert shares the state
    assert.equal((await webAlerts()).length, before);
    assert.equal((await mobileAlerts()).length, mobileBefore);
    assert.deepEqual(await alertState(), raisedAt, 'raised times are kept');
    const runs = await prisma.jobRun.count({ where: { jobName: 'project-alerts', scopeKey: { startsWith: projectId } } });
    assert.equal(runs, 2, 'one JobRun per project-day');
  });

  it('raises spend ahead of progress for payment viewers, clears it when the condition clears, and raises it again', async () => {
    // 59,850,000 paid against a 50,000,000 contract sum: 119.7% paid against ~80% complete.
    await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: 50_000_000 } });
    await jobs.runJobOnce('project-alerts', day(2));
    assert.ok((await alertState()).SPEND_AHEAD_OF_PROGRESS);
    const spend = await webAlerts('SPEND_AHEAD_OF_PROGRESS');
    assert.equal(spend.length, 1);
    assert.equal(spend[0].targetPermissionKey, 'payments:view');
    assert.equal(spend[0].actionUrl, `/app/projects/${projectId}/payments`);
    assert.equal((spend[0].metadata as { spendPct: number }).spendPct, 119.7);
    assert.equal((await mobileAlerts()).filter((m) => (m.metadata as { alertKey: string }).alertKey === 'SPEND_AHEAD_OF_PROGRESS').length, 0, 'not a field alert');

    // Rows and the Overview carry the active alerts; spend only for payment viewers.
    const overview = await request(app).get(`/api/v1/projects/${projectId}/overview`).set(await web(ADMIN));
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.deepEqual(overview.body.data.activeAlerts, ['DELAYED', 'STALLED', 'SITE_UPDATE_OVERDUE', 'SPEND_AHEAD_OF_PROGRESS']);
    assert.ok(overview.body.data.alertRaisedAt.SPEND_AHEAD_OF_PROGRESS);
    const officerOverview = await request(app).get(`/api/v1/projects/${projectId}/overview`).set(await web(ME_OFFICER));
    assert.deepEqual(officerOverview.body.data.activeAlerts, ['DELAYED', 'STALLED', 'SITE_UPDATE_OVERDUE']);
    const list = await request(app).get('/api/v1/projects').set(await web(ADMIN));
    assert.equal(list.status, 200);
    const row = (list.body.data as Array<{ id: string; activeAlerts: string[] }>).find((r) => r.id === projectId)!;
    assert.deepEqual(row.activeAlerts, ['DELAYED', 'STALLED', 'SITE_UPDATE_OVERDUE', 'SPEND_AHEAD_OF_PROGRESS']);
    const portfolio = await request(app).get('/api/v1/projects/portfolio/overview').set(await web(ADMIN));
    assert.equal(portfolio.status, 200, JSON.stringify(portfolio.body));
    const pin = (portfolio.body.data.projects as Array<{ id: string; activeAlerts: string[] }>).find((r) => r.id === projectId)!;
    assert.ok(pin.activeAlerts.includes('SPEND_AHEAD_OF_PROGRESS'));
    const withAlerts = (portfolio.body.data.projects as Array<{ activeAlerts: string[] }>).filter((r) => r.activeAlerts.length > 0).length;
    assert.equal(portfolio.body.data.kpis.projectsWithAlertsCount, withAlerts);
    assert.ok(withAlerts >= 1);

    // The condition clears: the key goes, nothing is sent.
    await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: 1_000_000_000 } });
    await jobs.runJobOnce('project-alerts', day(3));
    assert.equal((await alertState()).SPEND_AHEAD_OF_PROGRESS, undefined);
    assert.equal((await webAlerts('SPEND_AHEAD_OF_PROGRESS')).length, 1);

    // A later occurrence alerts again.
    await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: 50_000_000 } });
    await jobs.runJobOnce('project-alerts', day(4));
    assert.equal((await webAlerts('SPEND_AHEAD_OF_PROGRESS')).length, 2);
  });

  it('clears STALLED once an accepted visit has raised unit progress', async () => {
    const today = (await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } })).timezone;
    const { zonedCalendarDate } = await import('@insite/shared');
    // What acceptSubmission records when a visit raises a unit's progress (visitAcceptance.ts, step 3).
    await audit.recordAuditEvent(prisma, {
      projectId,
      actorType: 'SYSTEM',
      actorId: 'visits',
      actorDisplayName: 'InSite (visits)',
      action: 'VISIT_UPDATED',
      summaryText: 'Test: a routine visit raised the progress of 1 facility unit(s).',
      payload: { progressIncrease: { asOf: zonedCalendarDate(day(5), today), units: [] } },
    });
    await jobs.runJobOnce('project-alerts', day(5));
    const state = await alertState();
    assert.equal(state.STALLED, undefined);
    assert.ok(state.SITE_UPDATE_OVERDUE, 'an audit entry is not an accepted visit');
  });

  it('reads thresholds and switches from the type snapshot', async () => {
    await setTypeAlerts({ siteUpdateOverdue: { days: 180 }, spendAheadOfProgress: { enabled: false } });
    await jobs.runJobOnce('project-alerts', day(6));
    assert.deepEqual(Object.keys(await alertState()).sort(), ['DELAYED']);

    await setTypeAlerts({ siteUpdateOverdue: { days: 14 }, spendAheadOfProgress: { enabled: false }, delayed: { enabled: false } });
    await jobs.runJobOnce('project-alerts', day(7));
    const state = await alertState();
    assert.deepEqual(Object.keys(state).sort(), ['SITE_UPDATE_OVERDUE']);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).scheduleBehindAlertedAt, null);
    assert.equal((await webAlerts('SITE_UPDATE_OVERDUE')).length, 2, 'raised again after it cleared');
  });

  it('drops the alerts of a project that is no longer active', async () => {
    const archived = await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-242' } });
    assert.equal(archived.status, 'ARCHIVED');
    await prisma.project.update({ where: { id: archived.id }, data: { alertStateJson: { STALLED: t0.toISOString() } } });
    await jobs.runJobOnce('project-alerts', day(8));
    const after = await prisma.project.findUniqueOrThrow({ where: { id: archived.id } });
    assert.deepEqual(after.alertStateJson, {});
  });
});
