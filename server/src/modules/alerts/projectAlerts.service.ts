import { Prisma } from '@prisma/client';
import {
  evaluateProjectAlerts,
  parseProjectAlertState,
  PROJECT_ALERT_META,
  zonedCalendarDate,
  formatProjectCodeWithYear,
  type ProjectAlertEvaluation,
  type ProjectAlertFacts,
  type ProjectAlertKey,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { sendPushToMobileUser } from '../../integrations/push.service';
import { createMobileNotification, createWebNotification } from '../notifications/notifications.service';
import { monitoringConfigOf } from '../visits/visitCore';

/**
 * UBEC IRL early-warning alerts (portal output 5). `syncProjectAlerts` evaluates the rules in
 * `@insite/shared` (`evaluateProjectAlerts`) for one project and keeps `Project.alertStateJson`
 * (`{ [alertKey]: ISO time raised }`) in step: a newly active alert is claimed with a conditional
 * jsonb update (so two runs never send it twice) and notified once; an alert whose condition
 * cleared loses its key, so a later occurrence alerts again. DELAYED keeps the Phase 9 flag
 * `scheduleBehindAlertedAt` as its claim, so the behind notification is still sent once.
 *
 * Recipients (web notifications aim at a permission on the project):
 * - DELAYED → `sprints:view_status` (category SCHEDULE_BEHIND, unchanged);
 * - STALLED → `findings:receive_escalations` (PROJECT_STALLED), plus the field officers;
 * - SITE_UPDATE_OVERDUE → `visits:plan` (SITE_UPDATE_OVERDUE), plus the field officers;
 * - SPEND_AHEAD_OF_PROGRESS → `payments:view` (SPEND_AHEAD_OF_PROGRESS).
 * Field officers = the project's default visit officers, the assignees of its open visits and every
 * account with an active field session on it: one broadcast mobile notification on the project
 * (metadata.alertKey) and a push per officer (`OPEN_PROJECT`, sent after the commit).
 */

const ALERT_PROJECT_SELECT = {
  id: true,
  codePrefix: true,
  name: true,
  status: true,
  constructionPhase: true,
  timezone: true,
  projectTypeSnapshotJson: true,
  scheduleStatus: true,
  scheduleBehindAlertedAt: true,
  activatedAt: true,
  createdAt: true,
  certifiedProgressPct: true,
  importedProgressPct: true,
  contractSumNgn: true,
  disbursedToDateNgn: true,
  alertStateJson: true,
  defaultVisitOfficerIds: true,
} satisfies Prisma.ProjectSelect;
type AlertProject = Prisma.ProjectGetPayload<{ select: typeof ALERT_PROJECT_SELECT }>;

/** Visits whose officers still have work on the project. */
const OPEN_VISIT_STATUSES = ['PROPOSED', 'PLANNED', 'IN_PROGRESS', 'RETURNED'] as const;

/** The facts the rules need, read in a fixed number of queries. */
export async function loadProjectAlertFacts(project: AlertProject, now: Date): Promise<ProjectAlertFacts> {
  const projectId = project.id;
  const [firstSprint, unitCount, lineCount, lastAccepted, progressEvents, paymentCount] = await Promise.all([
    prisma.projectSprint.findFirst({ where: { projectId }, orderBy: { startDate: 'asc' }, select: { startDate: true } }),
    prisma.facilityUnit.count({ where: { projectId } }),
    prisma.boqItem.count({ where: { projectId } }),
    prisma.visitSubmission.findFirst({
      where: { projectId, status: 'APPROVED' },
      orderBy: { visit: { plannedDate: 'desc' } },
      select: { visit: { select: { plannedDate: true } } },
    }),
    // Written by acceptSubmission when a visit raised unit progress (payload.progressIncrease.asOf).
    prisma.auditLog.findMany({ where: { projectId, action: 'VISIT_UPDATED' }, select: { payload: true } }),
    prisma.projectPayment.count({ where: { projectId, voidedAt: null } }),
  ]);
  let lastProgressIncreaseDate: string | null = null;
  for (const e of progressEvents) {
    const asOf = (e.payload as { progressIncrease?: { asOf?: unknown } } | null)?.progressIncrease?.asOf;
    if (typeof asOf === 'string' && (!lastProgressIncreaseDate || asOf > lastProgressIncreaseDate)) lastProgressIncreaseDate = asOf;
  }
  // Imported projects (bulk register import) show the reported % complete until their scope is added.
  const progressPct = lineCount === 0 && project.importedProgressPct !== null ? Number(project.importedProgressPct) : Number(project.certifiedProgressPct);
  return {
    today: zonedCalendarDate(now, project.timezone),
    status: project.status,
    constructionPhase: project.constructionPhase,
    scheduleStatus: project.scheduleStatus,
    activatedDate: zonedCalendarDate(project.activatedAt ?? project.createdAt, project.timezone),
    firstSprintStartDate: firstSprint?.startDate ?? null,
    hasUnits: unitCount > 0,
    lastProgressIncreaseDate,
    lastAcceptedVisitDate: lastAccepted?.visit.plannedDate ?? null,
    progressPct,
    contractSumNgn: project.contractSumNgn === null ? null : Number(project.contractSumNgn),
    netPaidNgn: Number(project.disbursedToDateNgn),
    paymentCount,
  };
}

interface AlertCopy {
  title: string;
  description: string;
  actionUrl: string;
  mobile?: { title: string; message: string };
}

function copyFor(p: AlertProject, e: ProjectAlertEvaluation, behindUnitCount: number | undefined): AlertCopy {
  // Read across projects and years: "LOT 4 BATCH 1 (2026)", never the stored "2026-LOT-4-BATCH-1".
  const code = formatProjectCodeWithYear(p.codePrefix);
  switch (e.key) {
    case 'DELAYED':
      return {
        title: `${code} is behind schedule`,
        description:
          behindUnitCount !== undefined
            ? `${p.name}: ${behindUnitCount} facility unit(s) due by a work phase that has ended are not complete.`
            : `${p.name}: facility units due by a work phase that has ended are not complete.`,
        actionUrl: `/app/projects/${p.id}/scope`,
      };
    case 'STALLED':
      return {
        title: `${code} has stalled`,
        description: `${p.name}: no accepted monitoring report has recorded progress for ${e.days} days (alert after ${e.limit}).`,
        actionUrl: `/app/projects/${p.id}/scope`,
        mobile: {
          title: `${code}: no progress for ${e.days} days`,
          message: `No accepted monitoring report on ${code} has recorded progress for ${e.days} days. Record what you see on site at your next monitoring visit.`,
        },
      };
    case 'SITE_UPDATE_OVERDUE':
      return {
        title: `${code}: monitoring overdue`,
        description: `${p.name}: no monitoring report has been accepted for ${e.days} days (alert after ${e.limit}). Plan or complete a monitoring visit.`,
        actionUrl: `/app/projects/${p.id}/visits`,
        mobile: {
          title: `${code}: monitoring overdue`,
          message: `No monitoring report on ${code} has been accepted for ${e.days} days. Submit your next monitoring report, or record an ad hoc monitoring visit.`,
        },
      };
    case 'SPEND_AHEAD_OF_PROGRESS':
      return {
        title: `${code}: paid ahead of work done`,
        description: `${p.name}: ${e.spendPct}% of the contract sum is paid against ${e.progressPct}% complete, ${e.gapPoints} points ahead (alert above ${e.limit}).`,
        actionUrl: `/app/projects/${p.id}/payments`,
      };
  }
}

/** Test hook: replaces the push sender (tests run with PUSH_PROVIDER blanked). */
let pushSender: typeof sendPushToMobileUser = sendPushToMobileUser;
export function setAlertPushSender(fn: typeof sendPushToMobileUser | null): void {
  pushSender = fn ?? sendPushToMobileUser;
}

type PushQueue = Array<{ userId: string; title: string; body: string; projectId: string; alertKey: ProjectAlertKey }>;

async function fieldOfficerIds(tx: Prisma.TransactionClient, p: AlertProject): Promise<string[]> {
  const [assignees, sessions] = await Promise.all([
    tx.visitAssignee.findMany({ where: { visit: { projectId: p.id, status: { in: [...OPEN_VISIT_STATUSES] } } }, select: { userId: true } }),
    tx.fieldAgentSession.findMany({ where: { projectId: p.id, isActive: true, revokedAt: null }, select: { userId: true } }),
  ]);
  return [...new Set([...p.defaultVisitOfficerIds, ...assignees.map((a) => a.userId), ...sessions.map((s) => s.userId)])];
}

/** Claims and notifies one alert. Returns false when it was already active (nothing sent). */
async function raiseAlert(p: AlertProject, e: ProjectAlertEvaluation, now: Date, pushes: PushQueue, behindUnitCount?: number): Promise<boolean> {
  const key = e.key;
  const meta = PROJECT_ALERT_META[key];
  const iso = now.toISOString();
  return prisma.$transaction(async (tx) => {
    if (key === 'DELAYED') {
      // Phase 9 flag is the claim, so the behind notification still goes out once per occurrence.
      const claimed = await tx.project.updateMany({ where: { id: p.id, scheduleBehindAlertedAt: null }, data: { scheduleBehindAlertedAt: now } });
      if (claimed.count === 0) return false;
      await tx.$executeRaw`UPDATE "Project" SET "alertStateJson" = COALESCE("alertStateJson", '{}'::jsonb) || jsonb_build_object(${key}::text, ${iso}::text) WHERE id = ${p.id}::uuid`;
    } else {
      const claimed = await tx.$executeRaw`UPDATE "Project" SET "alertStateJson" = COALESCE("alertStateJson", '{}'::jsonb) || jsonb_build_object(${key}::text, ${iso}::text) WHERE id = ${p.id}::uuid AND ("alertStateJson" -> ${key}::text) IS NULL`;
      if (claimed === 0) return false;
    }
    const copy = copyFor(p, e, behindUnitCount);
    await createWebNotification(tx, {
      projectId: p.id,
      targetPermissionKey: meta.notifyPermission,
      category: meta.webCategory,
      title: copy.title,
      description: copy.description,
      actionUrl: copy.actionUrl,
      metadata: { alertKey: key, days: e.days ?? null, limit: e.limit ?? null, spendPct: e.spendPct ?? null, progressPct: e.progressPct ?? null, ...(behindUnitCount !== undefined ? { behindUnitCount } : {}) },
    });
    if (meta.notifiesFieldOfficers && copy.mobile) {
      // A broadcast on the project: every field account on it sees it, including officers who sign in later.
      await createMobileNotification(tx, {
        projectId: p.id,
        fieldSessionId: null,
        type: 'PROJECT_ALERT',
        actionType: 'NONE',
        title: copy.mobile.title,
        message: copy.mobile.message,
        metadata: { alertKey: key },
      });
      for (const userId of await fieldOfficerIds(tx, p)) pushes.push({ userId, title: copy.mobile.title, body: copy.mobile.message, projectId: p.id, alertKey: key });
    }
    return true;
  });
}

async function clearAlert(p: AlertProject, key: ProjectAlertKey): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Project" SET "alertStateJson" = "alertStateJson" - ${key}::text WHERE id = ${p.id}::uuid`;
    if (key === 'DELAYED') await tx.project.update({ where: { id: p.id }, data: { scheduleBehindAlertedAt: null } });
  });
}

export interface ProjectAlertSyncResult {
  active: ProjectAlertKey[];
  raised: ProjectAlertKey[];
  cleared: ProjectAlertKey[];
}

/**
 * Evaluates the project's alerts (all, or `keys` only) and brings the stored state in step:
 * raises (and notifies) newly active alerts and clears inactive ones. Projects that are not
 * ACTIVE evaluate every alert as inactive, so their keys are cleared; `clearOnly` treats every
 * alert as inactive (projects outside the job's scope, e.g. of a suspended tenant).
 */
export async function syncProjectAlerts(
  projectId: string,
  now: Date = new Date(),
  opts: { keys?: ProjectAlertKey[]; behindUnitCount?: number; clearOnly?: boolean } = {}
): Promise<ProjectAlertSyncResult> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: ALERT_PROJECT_SELECT });
  const result: ProjectAlertSyncResult = { active: [], raised: [], cleared: [] };
  if (!p) return result;
  const config = monitoringConfigOf(p.projectTypeSnapshotJson).alerts;
  const facts = await loadProjectAlertFacts(p, now);
  const state = parseProjectAlertState(p.alertStateJson);
  const pushes: PushQueue = [];
  const evaluations = evaluateProjectAlerts(facts, config).map((e) => (opts.clearOnly ? { ...e, active: false } : e));
  for (const e of evaluations) {
    if (opts.keys && !opts.keys.includes(e.key)) continue;
    const stored = e.key === 'DELAYED' ? Boolean(p.scheduleBehindAlertedAt) || Boolean(state.DELAYED) : Boolean(state[e.key]);
    if (e.active) {
      result.active.push(e.key);
      if (e.key === 'DELAYED' && p.scheduleBehindAlertedAt && !state.DELAYED) {
        // Alerted before the alert state existed: record it without sending again.
        const iso = p.scheduleBehindAlertedAt.toISOString();
        await prisma.$executeRaw`UPDATE "Project" SET "alertStateJson" = COALESCE("alertStateJson", '{}'::jsonb) || jsonb_build_object('DELAYED'::text, ${iso}::text) WHERE id = ${p.id}::uuid`;
        continue;
      }
      if (e.key === 'DELAYED' ? !p.scheduleBehindAlertedAt : !stored) {
        if (await raiseAlert(p, e, now, pushes, opts.behindUnitCount)) result.raised.push(e.key);
      }
    } else if (stored) {
      await clearAlert(p, e.key);
      result.cleared.push(e.key);
    }
  }
  for (const push of pushes) {
    await pushSender(push.userId, {
      title: push.title,
      body: push.body,
      data: { actionType: 'OPEN_PROJECT', projectId: push.projectId, alertKey: push.alertKey },
    }).catch((error) => console.warn('[alerts] push failed:', error));
  }
  return result;
}

/** One line for the JobRun detail. */
export function describeAlertSync(r: ProjectAlertSyncResult): string {
  const parts = [`active: ${r.active.join(', ') || 'none'}`];
  if (r.raised.length) parts.push(`raised: ${r.raised.join(', ')}`);
  if (r.cleared.length) parts.push(`cleared: ${r.cleared.join(', ')}`);
  return parts.join('; ');
}
