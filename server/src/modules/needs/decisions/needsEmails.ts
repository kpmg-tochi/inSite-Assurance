import { stateByCode, type NeedsPipelineConfig, type NeedsStage } from '@insite/shared';
import { env } from '../../../config/env';
import { prisma } from '../../../config/prisma';
import { sendMessage } from '../../../integrations/messaging';
import type { NeedsTaskNoticeData } from '../../../integrations/messaging/templates';
import type { CycleRow } from '../needsAccess';

/**
 * Needs pipeline wave 3 (A7, D-N.24): the pipeline's emails (template NEEDS_TASK_NOTICE, channel
 * EMAIL, no project). Sent after the transaction commits; a failed send is logged, never fails the
 * request or the job.
 * - RETURNED: to the uploaders of the returned proposals' current versions (active users), one email
 *   per person listing their proposals and the reason.
 * - WAITING: when proposals arrive at a stage, to the active users of the owning organisation whose
 *   role holds that stage's actor permission (not the person who moved them), one email per person.
 * - DUE_SOON / OVERDUE: the `needs-deadlines` job, to the same stage actors.
 */

export interface NoticeProposal {
  reference: string;
  title: string;
}

export async function cycleLabel(cycle: Pick<CycleRow, 'projectTypeId' | 'interventionYear' | 'stateCode'>): Promise<string> {
  const type = await prisma.projectType.findUnique({ where: { id: cycle.projectTypeId }, select: { name: true } });
  const state = cycle.stateCode ? stateByCode(cycle.stateCode)?.name : null;
  return `${type?.name ?? 'Needs assessment'} ${cycle.interventionYear}${state ? `, ${state}` : ''}`;
}

export const cycleUrl = (cycleId: string, tab = 'proposals') => `${env.WEB_APP_BASE_URL}/app/needs-assessment?cycle=${cycleId}&tab=${tab}`;
export const proposalUrl = (proposalId: string) => `${env.WEB_APP_BASE_URL}/app/needs-assessment/proposals/${proposalId}`;

/** Active users of the owning organisation whose role holds `permissionKey`. */
export async function stageActors(cycle: Pick<CycleRow, 'tenantId' | 'owningOrganizationId'>, permissionKey: string) {
  return prisma.user.findMany({
    where: {
      tenantId: cycle.tenantId,
      organizationId: cycle.owningOrganizationId,
      isActive: true,
      role: { rolePermissions: { some: { permission: { key: permissionKey } } } },
    },
    select: { id: true, email: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
}

async function send(tenantId: string, to: { email: string; fullName: string }, data: Omit<NeedsTaskNoticeData, 'recipientName'>) {
  try {
    await sendMessage({ tenantId, projectId: null, channel: 'EMAIL', to: to.email, templateKey: 'NEEDS_TASK_NOTICE', data: { ...data, recipientName: to.fullName } });
  } catch (error) {
    console.error('[needs emails] sending failed', error);
  }
}

const stageLabelOf = (config: NeedsPipelineConfig, stage: NeedsStage) => config.stages.find((s) => s.stage === stage)?.label ?? stage;

/** WAITING / DUE_SOON / OVERDUE to the actors of `stage`; nothing when the stage names no actor. */
export async function emailStageActors(params: {
  cycle: CycleRow;
  config: NeedsPipelineConfig;
  stage: NeedsStage;
  kind: 'WAITING' | 'DUE_SOON' | 'OVERDUE';
  proposals: NoticeProposal[];
  dueDate?: string | null;
  excludeUserId?: string | null;
}): Promise<number> {
  const permission = params.config.stages.find((s) => s.stage === params.stage)?.actorPermissionKey;
  if (!permission) return 0;
  const people = (await stageActors(params.cycle, permission)).filter((u) => u.id !== params.excludeUserId);
  if (!people.length) return 0;
  const label = await cycleLabel(params.cycle);
  const url = cycleUrl(params.cycle.id);
  for (const person of people) {
    await send(params.cycle.tenantId, person, {
      kind: params.kind,
      cycleLabel: label,
      stageLabel: stageLabelOf(params.config, params.stage),
      proposals: params.proposals,
      reason: null,
      dueDate: params.dueDate ?? null,
      url,
    });
  }
  return people.length;
}

/** RETURNED to the uploader of each returned proposal's current version (one email per person). */
export async function emailReturned(params: {
  cycle: CycleRow;
  config: NeedsPipelineConfig;
  stage: NeedsStage;
  items: Array<{ proposalId: string; reference: string; title: string; reason: string | null; uploaderUserId: string | null }>;
}): Promise<number> {
  const byUser = new Map<string, typeof params.items>();
  for (const item of params.items) {
    if (!item.uploaderUserId) continue;
    byUser.set(item.uploaderUserId, [...(byUser.get(item.uploaderUserId) ?? []), item]);
  }
  if (!byUser.size) return 0;
  const users = await prisma.user.findMany({ where: { id: { in: [...byUser.keys()] }, tenantId: params.cycle.tenantId, isActive: true }, select: { id: true, email: true, fullName: true } });
  const label = await cycleLabel(params.cycle);
  for (const u of users) {
    const items = byUser.get(u.id)!;
    const reasons = [...new Set(items.map((i) => i.reason).filter((r): r is string => Boolean(r)))];
    await send(params.cycle.tenantId, u, {
      kind: 'RETURNED',
      cycleLabel: label,
      stageLabel: stageLabelOf(params.config, params.stage),
      proposals: items.map((i) => ({ reference: i.reference, title: i.title })),
      reason: reasons.length === 1 ? reasons[0] : reasons.length ? items.map((i) => `${i.reference}: ${i.reason ?? ''}`).join('; ') : null,
      dueDate: null,
      url: items.length === 1 ? proposalUrl(items[0].proposalId) : cycleUrl(params.cycle.id),
    });
  }
  return users.length;
}
