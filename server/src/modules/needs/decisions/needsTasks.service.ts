import {
  NEEDS_CHAIN_FOR_SUBMISSION,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY,
  NEEDS_STAGE_ORDER,
  deadlineState,
  minimumFieldsFor,
  nextStage,
  stageConfigOf,
  stateByCode,
  type NeedsPipelineConfig,
  type NeedsProposalTask,
  type NeedsStage,
  type NeedsSubmissionKind,
  type NeedsTaskDto,
  type NeedsTaskListQuery,
  type ProposalFlagKind,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { visibleCycleWhere, type CycleRow } from '../needsAccess';
import { deadlinesOf } from '../needsSerializers';
import { cycleConfig, tenantToday } from '../needsSupport';
import { SUBMISSION_INCLUDE, gateForSubmission } from '../submissions/submissions.service';
import { canWriteCycle, holds, liveSubmission, loadRuleFacts, narrowActions, pendingOverride, separationFor, type RuleFacts } from './proposalRules';

/**
 * Needs pipeline wave 3 (A7): the task queue ("Waiting for me", the nav badge; D-N.24) and the
 * proposal page's task list, computed from stage, status, permissions, committee membership and
 * separation of duties (`narrowActions`). Only cycles the viewer can see and write (owning
 * organisation, OPEN) carry tasks.
 *
 * - PROPOSAL_ACTION: one per proposal for the viewer's next step ("Submit for validation", "Validate",
 *   "Correct and resubmit", "Upload the costed version", "Sign off the costing"); an action blocked by
 *   separation of duties becomes "Ask for a separation-of-duties override" (none while the viewer's
 *   request waits). Holders of needs:override_separation get "Authorise a separation-of-duties
 *   override" per open request of another person (id `PROPOSAL_ACTION:<flag id>`).
 * - CONFLICT_DECLARATION: a committee member who has not declared, before finalisation.
 * - SCORE: a declared member holding needs:score while scoring is open, per proposal at
 *   Prioritisation they are not recused from and have no sheet for.
 * - CYCLE: the chair: "Open scoring" once every member has declared and proposals wait; "Finalise
 *   the ranking" while scoring is open or closed.
 * Due dates: the stage's deadline on the cycle (`deadlineState` in the tenant's zone).
 *
 * Wave 4 (Track A) adds, with links to the cycle's `approvals`, `funding` or `procurement` tab:
 * - CYCLE (owning organisation, OPEN cycle): "Submit the portfolio for approval" / "Revise and
 *   resubmit the portfolio" (`CYCLE:<id>:PORTFOLIO`), "Record the funding" (DI, `…:FUNDING`),
 *   "Prepare the BEAP" / "Revise and resubmit the BEAP" (MG, `…:BEAP`); annual proposals only.
 * - APPROVAL_STEP (`APPROVAL_STEP:<submission id>`): any submission in review in a cycle the viewer
 *   can see (any cycle status, any organisation: UBEC reviewers of a State's chain included) whose
 *   current step `gateForSubmission` lets the viewer act on now.
 * - PROPOSAL_ACTION for the requester's out-of-cycle drafts and returned requests (any cycle status).
 * - CYCLE "Assign lots to the funded projects (n)" (`…:LOTS`, DI): converted drafts without a lot.
 */

const lowerFirst = (s: string) => (s.length > 1 && s.split(/\s+/)[0] === s.split(/\s+/)[0].toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1));
const idx = (s: string) => NEEDS_STAGE_ORDER.indexOf(s as NeedsStage);

export const proposalPath = (id: string) => `/app/needs-assessment/proposals/${id}`;
export const cycleTabPath = (cycleId: string, tab: 'proposals' | 'prioritisation' | 'documents') => `/app/needs-assessment?cycle=${cycleId}&tab=${tab}`;

export interface QueueProposal {
  id: string;
  cycleId: string;
  reference: string;
  title: string;
  stage: string;
  status: string;
  currentVersionSource: string | null;
  /** Wave 4: OUT_OF_CYCLE requests carry no stage task (their own routes). */
  route?: string | null;
}

export interface Due {
  dueDate: string | null;
  deadlineState: NeedsTaskDto['deadlineState'];
}

export function stageDue(cycle: Pick<CycleRow, 'deadlinesJson'>, stage: string | null, today: string): Due {
  const date = stage ? (deadlinesOf(cycle.deadlinesJson).find((d) => d.key === `stage:${stage}`)?.date ?? null) : null;
  return { dueDate: date, deadlineState: deadlineState(date, today) };
}

/** The label of the viewer's next step on a proposal; null when there is none. */
export function actionLabelFor(user: WebJwtPayload, cycle: CycleRow, config: NeedsPipelineConfig, p: QueueProposal, facts: RuleFacts): string | null {
  const { allowed, blocked } = narrowActions(user, cycle, config, p, facts);
  if (allowed.includes('RESUBMIT')) return 'Correct and resubmit';
  if (allowed.includes('SUBMIT')) {
    const next = nextStage(config, p.stage as NeedsStage);
    return next ? `Submit for ${lowerFirst(stageConfigOf(config, next)?.label ?? next)}` : 'Submit';
  }
  if (allowed.includes('RECORD_VALIDATION')) return 'Validate';
  if (p.stage === 'COSTING' && (allowed.includes('SIGN_OFF_COSTING') || allowed.includes('UPLOAD_COSTED_VERSION'))) {
    return p.currentVersionSource === 'COSTING' ? 'Sign off the costing' : 'Upload the costed version';
  }
  const ask = blocked.find((b) => !pendingOverride(facts.overrides.get(p.id) ?? [], b.separationAction, user.userId));
  if (ask) return 'Ask for a separation-of-duties override';
  return null;
}

/** Every queue task of one proposal for the viewer. */
export function proposalQueueTasks(user: WebJwtPayload, cycle: CycleRow, config: NeedsPipelineConfig, p: QueueProposal, facts: RuleFacts, today: string): NeedsTaskDto[] {
  if (!canWriteCycle(user, cycle) || !NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status as never)) return [];
  const due = stageDue(cycle, p.stage, today);
  const base = { cycleId: cycle.id, proposalId: p.id, submissionId: null, reference: p.reference, title: p.title, stage: p.stage as NeedsStage, ...due, url: proposalPath(p.id) };
  const out: NeedsTaskDto[] = [];
  const label = actionLabelFor(user, cycle, config, p, facts);
  if (label) out.push({ ...base, id: `PROPOSAL_ACTION:${p.id}`, kind: 'PROPOSAL_ACTION', actionLabel: label });
  if (holds(user, NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY)) {
    for (const flag of facts.overrides.get(p.id) ?? []) {
      if (flag.resolvedAt || flag.details.requestedByUserId === user.userId) continue;
      out.push({ ...base, id: `PROPOSAL_ACTION:${flag.id}`, kind: 'PROPOSAL_ACTION', actionLabel: 'Authorise a separation-of-duties override' });
    }
  }
  const committee = facts.committees.get(cycle.id);
  const me = committee?.me;
  if (
    me &&
    committee.state === 'OPEN' &&
    me.conflictDeclaredAt &&
    me.permissionKeys.includes('needs:score') &&
    p.stage === 'PRIORITISATION' &&
    p.status === 'IN_PROGRESS' &&
    !committee.recusedIds.has(p.id) &&
    !committee.myScoredIds.has(p.id)
  ) {
    out.push({ ...base, id: `SCORE:${p.id}`, kind: 'SCORE', actionLabel: 'Score' });
  }
  return out;
}

/** The committee's cycle-level tasks for the viewer. */
export function cycleQueueTasks(user: WebJwtPayload, cycle: CycleRow, cycleTitle: string, waitingAtPrioritisation: number, facts: RuleFacts, today: string): NeedsTaskDto[] {
  const committee = facts.committees.get(cycle.id);
  if (!committee || !canWriteCycle(user, cycle) || committee.state === 'FINALISED') return [];
  const me = committee.me;
  if (!me) return [];
  const base = { cycleId: cycle.id, proposalId: null, submissionId: null, reference: null, title: cycleTitle, stage: 'PRIORITISATION' as NeedsStage, ...stageDue(cycle, 'PRIORITISATION', today), url: cycleTabPath(cycle.id, 'prioritisation') };
  const out: NeedsTaskDto[] = [];
  if (!me.conflictDeclaredAt) out.push({ ...base, id: `CONFLICT_DECLARATION:${cycle.id}`, kind: 'CONFLICT_DECLARATION', actionLabel: 'Declare conflicts of interest' });
  if (me.role === 'CHAIR') {
    if (committee.state === 'NOT_OPEN' && waitingAtPrioritisation > 0 && committee.members.length > 0 && committee.members.every((m) => m.conflictDeclaredAt) &&
      // Review fix (wave 3): opening also needs a quorum of members who score (as the committee service checks).
      committee.members.filter((m) => m.permissionKeys.includes('needs:score')).length >= cycleConfig(cycle).rubric.quorum
    ) {
      out.push({ ...base, id: `CYCLE:${cycle.id}`, kind: 'CYCLE', actionLabel: 'Open scoring' });
    } else if (committee.state === 'OPEN' || committee.state === 'CLOSED') {
      out.push({ ...base, id: `CYCLE:${cycle.id}`, kind: 'CYCLE', actionLabel: 'Finalise the ranking' });
    }
  }
  return out;
}

export function cycleTitleOf(typeName: string, cycle: Pick<CycleRow, 'interventionYear' | 'stateCode'>): string {
  const state = cycle.stateCode ? stateByCode(cycle.stateCode)?.name : null;
  return `${typeName} ${cycle.interventionYear}${state ? `, ${state}` : ''}`;
}

const DEADLINE_ORDER = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2, UPCOMING: 3, NOT_SET: 4 } as const;

// ---------------------------------------------------------------------------
// Wave 4 (Track A): approval, funding, BEAP and lot tasks
// ---------------------------------------------------------------------------

export const needsTabPath = (cycleId: string, tab: 'approvals' | 'funding' | 'procurement') => `/app/needs-assessment?cycle=${cycleId}&tab=${tab}`;

/**
 * The owning organisation's cycle work after the ranking (open cycle, the viewer's permission):
 * submit (or revise) the portfolio once the ranking is final and annual proposals wait at Approval
 * with no portfolio in review or approved; record the funding (Direct Intervention) or prepare the
 * BEAP (Matching Grants, while no BEAP is in review or approved) while annual proposals wait at Funding.
 */
export function fundingCycleTasks(
  user: WebJwtPayload,
  cycle: CycleRow,
  config: NeedsPipelineConfig,
  cycleTitle: string,
  proposals: ReadonlyArray<{ stage: string; status: string; route: string }>,
  facts: RuleFacts,
  today: string
): NeedsTaskDto[] {
  if (!canWriteCycle(user, cycle)) return [];
  const annual = proposals.filter((p) => p.route === 'ANNUAL' && p.status === 'IN_PROGRESS');
  const atApproval = annual.filter((p) => p.stage === 'APPROVAL').length;
  const atFunding = annual.filter((p) => p.stage === 'FUNDING').length;
  const submissions = facts.submissions?.get(cycle.id) ?? [];
  const base = { cycleId: cycle.id, proposalId: null, reference: null, title: cycleTitle };
  const out: NeedsTaskDto[] = [];
  if (atApproval > 0 && cycle.rankingFinalisedAt && holds(user, 'needs:submit_portfolio') && !liveSubmission(facts, cycle.id, 'PORTFOLIO')) {
    const returned = submissions.find((s) => s.kind === 'PORTFOLIO' && s.status === 'RETURNED') ?? null;
    out.push({
      ...base,
      id: `CYCLE:${cycle.id}:PORTFOLIO`,
      kind: 'CYCLE',
      submissionId: returned?.id ?? null,
      actionLabel: returned ? 'Revise and resubmit the portfolio' : 'Submit the portfolio for approval',
      stage: 'APPROVAL',
      ...stageDue(cycle, 'APPROVAL', today),
      url: needsTabPath(cycle.id, 'approvals'),
    });
  }
  if (atFunding > 0 && config.fundingGate === 'APPROPRIATION' && holds(user, 'needs:record_funding')) {
    out.push({ ...base, id: `CYCLE:${cycle.id}:FUNDING`, kind: 'CYCLE', submissionId: null, actionLabel: 'Record the funding', stage: 'FUNDING', ...stageDue(cycle, 'FUNDING', today), url: needsTabPath(cycle.id, 'funding') });
  }
  if (atFunding > 0 && config.fundingGate === 'BEAP_APPROVAL' && holds(user, 'needs:prepare_beap') && !liveSubmission(facts, cycle.id, 'BEAP')) {
    const pending = submissions.find((s) => s.kind === 'BEAP' && (s.status === 'RETURNED' || s.status === 'DRAFT')) ?? null;
    out.push({
      ...base,
      id: `CYCLE:${cycle.id}:BEAP`,
      kind: 'CYCLE',
      submissionId: pending?.id ?? null,
      actionLabel: pending?.status === 'RETURNED' ? 'Revise and resubmit the BEAP' : 'Prepare the BEAP',
      stage: 'FUNDING',
      ...stageDue(cycle, 'FUNDING', today),
      url: needsTabPath(cycle.id, 'funding'),
    });
  }
  return out;
}

const SUBMISSION_NOUN: Record<string, string> = { PORTFOLIO: 'the portfolio', BEAP: 'the BEAP', OUT_OF_CYCLE: 'the out-of-cycle request' };

/** "Review the portfolio", "Approve the BEAP", "Approve the out-of-cycle request". */
export function approvalStepLabel(kind: string, step: { requiredPermissionKey: string }): string {
  const verb = /:review_/.test(step.requiredPermissionKey) ? 'Review' : 'Approve';
  return `${verb} ${SUBMISSION_NOUN[kind] ?? 'the submission'}`;
}

/**
 * Every submission (portfolio, BEAP, out-of-cycle) of a cycle the viewer can see, in review, whose
 * current step the viewer may act on now (`gateForSubmission`: permission, separation of duties,
 * organisation scope, the UBEC rule). Reaches UBEC reviewers outside the owning organisation and
 * closed container cycles.
 */
async function approvalStepTasks(user: WebJwtPayload, query: NeedsTaskListQuery, today: string): Promise<NeedsTaskDto[]> {
  const submissions = await prisma.needsSubmission.findMany({
    where: { status: 'IN_REVIEW', cycle: { AND: [visibleCycleWhere(user), query.cycleId ? { id: query.cycleId } : {}] } },
    include: { ...SUBMISSION_INCLUDE, cycle: { include: { projectType: { select: { name: true } } } } },
    orderBy: { submittedAt: 'asc' },
  });
  if (!submissions.length) return [];
  const steps = await prisma.needsApprovalStep.findMany({ where: { cycleId: { in: [...new Set(submissions.map((s) => s.cycleId))] }, isActive: true }, orderBy: { stepOrder: 'asc' } });
  const out: NeedsTaskDto[] = [];
  for (const s of submissions) {
    const chainType = NEEDS_CHAIN_FOR_SUBMISSION[s.kind as NeedsSubmissionKind];
    const chain = steps.filter((x) => x.cycleId === s.cycleId && x.chainType === chainType && x.version === s.chainVersion);
    const current = chain.find((x) => x.stepOrder === s.currentStepOrder);
    if (!current || !holds(user, current.requiredPermissionKey)) continue;
    const gate = await gateForSubmission(prisma, user, s, s.cycle, chain);
    if (!gate.allowed) continue;
    const stage: NeedsStage = s.kind === 'BEAP' ? 'FUNDING' : 'APPROVAL';
    const chainDue = deadlinesOf(s.cycle.deadlinesJson).find((d) => d.key === `chain:${chainType}:${current.stepOrder}`)?.date ?? null;
    const due = chainDue ? { dueDate: chainDue, deadlineState: deadlineState(chainDue, today) } : stageDue(s.cycle, stage, today);
    const item = s.kind === 'OUT_OF_CYCLE' ? (s.items[0]?.proposal ?? null) : null;
    out.push({
      id: `APPROVAL_STEP:${s.id}`,
      kind: 'APPROVAL_STEP',
      cycleId: s.cycleId,
      proposalId: item?.id ?? null,
      submissionId: s.id,
      reference: item?.reference ?? null,
      title: item ? item.title : cycleTitleOf(s.cycle.projectType.name, s.cycle),
      actionLabel: approvalStepLabel(s.kind, current),
      stage,
      ...due,
      url: needsTabPath(s.cycleId, 'approvals'),
    });
  }
  return out;
}

/** The requester's out-of-cycle drafts and returned requests (any cycle status; the owning organisation). */
async function outOfCycleRequesterTasks(user: WebJwtPayload, query: NeedsTaskListQuery): Promise<NeedsTaskDto[]> {
  if (!holds(user, 'needs:submit')) return [];
  const rows = await prisma.needsProposal.findMany({
    where: {
      route: 'OUT_OF_CYCLE',
      status: { in: ['DRAFT', 'RETURNED'] },
      cycle: { AND: [visibleCycleWhere(user), user.isPlatformSuperAdmin ? {} : { owningOrganizationId: user.organizationId }, query.cycleId ? { id: query.cycleId } : {}] },
    },
    select: { id: true, cycleId: true, reference: true, title: true, status: true },
    orderBy: { sequence: 'asc' },
  });
  return rows.map((p) => ({
    id: `PROPOSAL_ACTION:${p.id}`,
    kind: 'PROPOSAL_ACTION' as const,
    cycleId: p.cycleId,
    proposalId: p.id,
    submissionId: null,
    reference: p.reference,
    title: p.title,
    actionLabel: p.status === 'RETURNED' ? 'Correct and resubmit the out-of-cycle request' : 'Submit the out-of-cycle request',
    stage: 'APPROVAL' as const,
    dueDate: null,
    deadlineState: 'NOT_SET' as const,
    url: needsTabPath(p.cycleId, 'approvals'),
  }));
}

/** Direct Intervention: converted drafts without a lot (`procurement:plan_lots`, the owning organisation, any cycle status). */
async function lotTasks(user: WebJwtPayload, query: NeedsTaskListQuery): Promise<NeedsTaskDto[]> {
  if (!holds(user, 'procurement:plan_lots')) return [];
  const projects = await prisma.project.findMany({
    where: {
      tenantId: user.tenantId,
      status: 'DRAFT',
      lotId: null,
      needsProposal: { is: { cycle: { AND: [visibleCycleWhere(user), user.isPlatformSuperAdmin ? {} : { owningOrganizationId: user.organizationId }, query.cycleId ? { id: query.cycleId } : {}] } } },
    },
    select: { needsProposal: { select: { cycle: { include: { projectType: { select: { name: true } } } } } } },
  });
  const byCycle = new Map<string, { cycle: CycleRow & { projectType: { name: string } }; count: number }>();
  for (const p of projects) {
    const cycle = p.needsProposal?.cycle;
    if (!cycle || cycleConfig(cycle).fundingGate !== 'APPROPRIATION') continue;
    const entry = byCycle.get(cycle.id) ?? { cycle, count: 0 };
    entry.count += 1;
    byCycle.set(cycle.id, entry);
  }
  return [...byCycle.values()].map(({ cycle, count }) => ({
    id: `CYCLE:${cycle.id}:LOTS`,
    kind: 'CYCLE' as const,
    cycleId: cycle.id,
    proposalId: null,
    submissionId: null,
    reference: null,
    title: cycleTitleOf(cycle.projectType.name, cycle),
    actionLabel: `Assign lots to the funded projects (${count})`,
    stage: null,
    dueDate: null,
    deadlineState: 'NOT_SET' as const,
    url: needsTabPath(cycle.id, 'procurement'),
  }));
}

export async function listTasks(user: WebJwtPayload, query: NeedsTaskListQuery): Promise<NeedsTaskDto[]> {
  const today = await tenantToday(user.tenantId);
  const out: NeedsTaskDto[] = [];
  const cycles = await prisma.needsCycle.findMany({
    where: {
      AND: [visibleCycleWhere(user), { status: 'OPEN' }, user.isPlatformSuperAdmin ? {} : { owningOrganizationId: user.organizationId }, query.cycleId ? { id: query.cycleId } : {}],
    },
    include: { projectType: { select: { name: true } } },
    orderBy: [{ interventionYear: 'desc' }, { createdAt: 'asc' }],
  });
  if (cycles.length) {
    const proposals = await prisma.needsProposal.findMany({
      where: { cycleId: { in: cycles.map((c) => c.id) }, status: { in: [...NEEDS_OPEN_PROPOSAL_STATUSES] } },
      select: { id: true, cycleId: true, reference: true, title: true, stage: true, status: true, route: true, currentVersion: { select: { source: true } } },
      orderBy: { sequence: 'asc' },
    });
    const facts = await loadRuleFacts(prisma, user, cycles, proposals.map((p) => p.id));
    for (const cycle of cycles) {
      const config = cycleConfig(cycle);
      const mine = proposals.filter((p) => p.cycleId === cycle.id);
      const title = cycleTitleOf(cycle.projectType.name, cycle);
      out.push(...cycleQueueTasks(user, cycle, title, mine.filter((p) => p.stage === 'PRIORITISATION' && p.status === 'IN_PROGRESS').length, facts, today));
      out.push(...fundingCycleTasks(user, cycle, config, title, mine, facts, today));
      for (const p of mine) out.push(...proposalQueueTasks(user, cycle, config, { ...p, currentVersionSource: p.currentVersion?.source ?? null }, facts, today));
    }
  }
  out.push(...(await approvalStepTasks(user, query, today)));
  out.push(...(await outOfCycleRequesterTasks(user, query)));
  out.push(...(await lotTasks(user, query)));
  return out.sort(
    (a, b) =>
      DEADLINE_ORDER[a.deadlineState] - DEADLINE_ORDER[b.deadlineState] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      (a.reference ?? '').localeCompare(b.reference ?? '') ||
      a.id.localeCompare(b.id)
  );
}

export async function countTasks(user: WebJwtPayload): Promise<{ count: number }> {
  return { count: (await listTasks(user, {})).length };
}

// ---------------------------------------------------------------------------
// The proposal page's task list (GOV.UK pattern)
// ---------------------------------------------------------------------------

export interface PageTaskFacts {
  flags: Array<{ id: string; kind: string; resolvedAt: Date | null; detailsJson?: unknown }>;
  drawingCount: number;
  currentVersionSource: string | null;
  /** A validation record on the current version. */
  hasRecordOnCurrent: boolean;
}

export function proposalPageTasks(
  user: WebJwtPayload,
  cycle: CycleRow,
  config: NeedsPipelineConfig,
  p: QueueProposal,
  facts: RuleFacts,
  page: PageTaskFacts
): NeedsProposalTask[] {
  const tasks: NeedsProposalTask[] = [];
  const open = NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status as never);
  const writable = canWriteCycle(user, cycle);
  const { allowed, blocked } = narrowActions(user, cycle, config, p, facts);
  const stage = p.stage as NeedsStage;
  const at = (s: NeedsStage) => idx(stage) === idx(s);
  const past = (s: NeedsStage) => idx(stage) > idx(s);
  const sepOk = (action: 'VALIDATE' | 'COST') => separationFor(facts, p, action, user.userId).check.allowed;

  const flagTask = (kind: ProposalFlagKind, key: string, label: string, permission: string, sep: 'VALIDATE' | 'COST', blocksStage: NeedsStage) => {
    const flags = page.flags.filter((f) => f.kind === kind);
    if (!flags.length) return;
    const todo = flags.some((f) => !f.resolvedAt);
    const canAct = todo && open && writable && holds(user, permission) && !past(blocksStage) && sepOk(sep);
    tasks.push({ key, label, status: todo ? (open ? 'TODO' : 'NOT_NEEDED') : 'DONE', mine: canAct });
  };
  flagTask('DUPLICATE', 'resolve-duplicate', 'Resolve possible duplicate', 'needs:validate', 'VALIDATE', 'VALIDATION');
  flagTask('ESSENTIAL_FACILITY_GAP', 'justify-essential-gap', 'Justify essential-facility gap', 'needs:validate', 'VALIDATE', 'VALIDATION');

  const drawingsNeeded = minimumFieldsFor(config, stage).includes('DRAWINGS');
  if (drawingsNeeded) {
    const done = page.drawingCount > 0;
    tasks.push({ key: 'upload-drawings', label: 'Upload drawings', status: done ? 'DONE' : open ? 'TODO' : 'NOT_NEEDED', mine: !done && open && writable && holds(user, 'needs:submit') });
  }

  // Leaving the first stage.
  const first = config.stages[0]?.stage;
  const afterFirst = first ? nextStage(config, first) : null;
  if (first && afterFirst) {
    const submitted = p.stage !== first;
    const blockedByDrawings = !submitted && drawingsNeeded && page.drawingCount === 0;
    tasks.push({
      key: 'submit',
      label: `Submit for ${lowerFirst(stageConfigOf(config, afterFirst)?.label ?? afterFirst)}`,
      status: submitted ? 'DONE' : !open ? 'NOT_NEEDED' : blockedByDrawings ? 'BLOCKED' : 'TODO',
      mine: !submitted && allowed.includes('SUBMIT'),
    });
  }

  if (p.status === 'RETURNED') {
    tasks.push({ key: 'correct-and-resubmit', label: 'Correct and resubmit', status: 'TODO', mine: allowed.includes('RESUBMIT') });
  }

  if (idx(stage) >= idx('VALIDATION')) {
    const done = past('VALIDATION') || (at('VALIDATION') && page.hasRecordOnCurrent);
    tasks.push({
      key: 'record-validation',
      label: 'Record the validation',
      status: done ? 'DONE' : open ? 'TODO' : 'NOT_NEEDED',
      mine: !done && allowed.includes('RECORD_VALIDATION'),
    });
  }

  if (config.stages.some((s) => s.stage === 'DESIGN') && idx(stage) >= idx('DESIGN')) {
    const done = past('DESIGN');
    const label = `Submit for ${lowerFirst(stageConfigOf(config, nextStage(config, 'DESIGN') ?? 'COSTING')?.label ?? 'costing')}`;
    tasks.push({ key: 'submit-design', label, status: done ? 'DONE' : open ? 'TODO' : 'NOT_NEEDED', mine: !done && at('DESIGN') && allowed.includes('SUBMIT') });
  }

  if (idx(stage) >= idx('COSTING')) {
    flagTask('RATE_VARIANCE', 'acknowledge-rate-variance', 'Acknowledge rate variance', 'needs:cost', 'COST', 'COSTING');
    flagTask('CEILING_EXCEEDED', 'acknowledge-ceiling', 'Acknowledge cost ceiling', 'needs:cost', 'COST', 'COSTING');
    const sm = page.flags.filter((f) => f.kind === 'MISSING_SUPERVISION_LINE');
    if (sm.length) {
      const todo = sm.some((f) => !f.resolvedAt);
      tasks.push({
        key: 'correct-supervision-line',
        label: 'Add the supervision and monitoring line',
        status: todo ? (open ? 'TODO' : 'NOT_NEEDED') : 'DONE',
        mine: todo && allowed.includes('UPLOAD_COSTED_VERSION'),
      });
    }
    const costedDone = past('COSTING') || page.currentVersionSource === 'COSTING';
    tasks.push({
      key: 'upload-costed-version',
      label: 'Upload the costed version',
      status: costedDone ? 'DONE' : open ? 'TODO' : 'NOT_NEEDED',
      mine: !costedDone && allowed.includes('UPLOAD_COSTED_VERSION'),
    });
    const signedOff = past('COSTING');
    tasks.push({
      key: 'sign-off-costing',
      label: 'Sign off the costing',
      status: signedOff ? 'DONE' : !open ? 'NOT_NEEDED' : page.currentVersionSource === 'COSTING' ? 'TODO' : 'BLOCKED',
      mine: !signedOff && page.currentVersionSource === 'COSTING' && allowed.includes('SIGN_OFF_COSTING'),
    });
  }

  // Separation of duties: the viewer's blocked step, and the requests others wait on.
  for (const b of blocked) {
    const pending = pendingOverride(facts.overrides.get(p.id) ?? [], b.separationAction, user.userId);
    if (tasks.some((t) => t.key === `override-${b.separationAction}`)) continue;
    tasks.push({
      key: `override-${b.separationAction}`,
      label: pending ? 'Separation-of-duties override requested' : 'Ask for a separation-of-duties override',
      status: pending ? 'BLOCKED' : 'TODO',
      mine: !pending,
    });
  }
  if (open && writable && holds(user, NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY)) {
    for (const flag of facts.overrides.get(p.id) ?? []) {
      if (flag.resolvedAt || flag.details.requestedByUserId === user.userId) continue;
      tasks.push({ key: `authorise-override-${flag.id}`, label: `Authorise a separation-of-duties override (${flag.details.requestedByName})`, status: 'TODO', mine: true });
    }
  }
  return tasks;
}
