import {
  addDays,
  generateVisitDates,
  isActivationRule,
  isSprintDrivenRule,
  resolveProjectTypeConfig,
  sprintForDate,
  submissionDeadlineFor,
  VISIT_KIND_META,
  VisitPlanContext,
  VisitPlanPreviewDto,
  VisitPlanRule,
  visitGeneratorKey,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { defaultOfficersFor, Db, loadVisitProject, monitoringConfigOf, OfficerInput, projectToday, setVisitAssignees, Tx, VisitActor, visitLabelInSentence } from './visitCore';

/**
 * Redesign R4a (D-R4.11, D-R4.12): the project type's visit plan proposes visits. Generated visits are
 * PROPOSED (the manager publishes them) and carry `generatorKey` = "<rule>:<date>", so running a rule
 * again never duplicates a visit, including one that was moved or cancelled.
 */

export type PlanTrigger =
  /** Activation: every rule that does not wait for a later event. */
  | 'ACTIVATION'
  /** A live sprint save: sprint-driven rules are regenerated (PROPOSED only). */
  | 'SPRINTS_SAVED'
  /** Entering handover (the contractor's completion notice). */
  | 'COMPLETION_NOTICE'
  /** Closing the project. */
  | 'PROJECT_CLOSED'
  /** The visit-deadlines job: one more mobilisation check while mobilisation stays open. */
  | 'MOBILISATION_EXTEND'
  /** The manager's "Generate" (one rule or all). */
  | 'MANUAL';

const PLAN_PROJECT_SELECT = {
  id: true,
  status: true,
  timezone: true,
  workWeekDays: true,
  activatedAt: true,
  kickoffHeldAt: true,
  plannedEndDate: true,
  practicalCompletionDate: true,
  constructionPhase: true,
  constructionPhaseChangedAt: true,
  projectTypeSnapshotJson: true,
} as const;

/** The facts the plan rules read (D-R4.11). */
export async function planContextFor(db: Db, projectId: string, now: Date = new Date()): Promise<{ ctx: VisitPlanContext; mobilised: boolean }> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: PLAN_PROJECT_SELECT });
  if (!p) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const [sprints, milestones] = await Promise.all([
    db.projectSprint.findMany({ where: { projectId }, select: { number: true, startDate: true, endDate: true }, orderBy: { number: 'asc' } }),
    db.projectContractMilestone.findMany({
      where: { projectId, completionMode: { in: ['AUTO_CONTRACTOR_ON_SITE', 'AUTO_FINAL_EVALUATION_APPROVED'] } },
      select: { completionMode: true, anchor: true, dueDate: true, status: true },
    }),
  ]);
  const day = (d: Date | null) => (d ? zonedCalendarDate(d, p.timezone) : null);
  const today = zonedCalendarDate(now, p.timezone);
  const mobilisation = milestones.filter((m) => m.completionMode === 'AUTO_CONTRACTOR_ON_SITE');
  const postClosure = milestones.find((m) => m.completionMode === 'AUTO_FINAL_EVALUATION_APPROVED' && m.anchor === 'PROJECT_CLOSED' && m.dueDate);
  const phase = p.constructionPhase;
  const changed = day(p.constructionPhaseChangedAt);
  return {
    ctx: {
      activationDate: day(p.activatedAt) ?? today,
      kickoffHeldDate: day(p.kickoffHeldAt),
      sprints,
      mobilisationDueDate: mobilisation.map((m) => m.dueDate).filter((d): d is string => Boolean(d)).sort()[0] ?? null,
      plannedEndDate: p.plannedEndDate,
      workWeekDays: p.workWeekDays,
      completionNoticeDate:
        phase === 'HANDOVER_IN_PROGRESS' ? changed : phase === 'ACTIVE_CONSTRUCTION' ? null : (p.practicalCompletionDate ?? changed),
      closedDate: phase === 'COMPLETED_CLOSED' ? changed : null,
      postClosureMilestoneDueDate: postClosure?.dueDate ?? null,
    },
    mobilised: mobilisation.length > 0 && mobilisation.every((m) => m.status === 'DONE' || m.status === 'WAIVED'),
  };
}

function rulesFor(trigger: PlanTrigger, rules: VisitPlanRule[], ruleKey: string | null): VisitPlanRule[] {
  switch (trigger) {
    case 'ACTIVATION':
      return rules.filter(isActivationRule);
    case 'SPRINTS_SAVED':
      return rules.filter(isSprintDrivenRule);
    case 'COMPLETION_NOTICE':
      return rules.filter((r) => r.kind === 'ON_COMPLETION_NOTICE');
    case 'PROJECT_CLOSED':
      return rules.filter((r) => r.kind === 'AFTER_PROJECT_CLOSED');
    case 'MOBILISATION_EXTEND':
      return rules.filter((r) => r.kind === 'EVERY_N_WEEKS_UNTIL_MOBILISED');
    case 'MANUAL':
      return ruleKey ? rules.filter((r) => r.key === ruleKey) : rules;
  }
}

/**
 * How far ahead a plan is proposed. A project's sprints normally end within it; a longer plan is
 * proposed as the dates come into range (a later sprint save or Generate), so one save never
 * creates an unbounded number of visits.
 */
export const VISIT_PLAN_HORIZON_DAYS = 730;

/** The dates each rule proposes, from `today` to the horizon. */
function plannedDates(rules: VisitPlanRule[], ctx: VisitPlanContext, today: string, opts: { mobilised: boolean; extend: boolean }) {
  const out: Array<{ rule: VisitPlanRule; date: string }> = [];
  const horizon = addDays(today, VISIT_PLAN_HORIZON_DAYS);
  for (const rule of rules) {
    if (rule.kind === 'EVERY_N_WEEKS_UNTIL_MOBILISED' && opts.mobilised) continue;
    let ruleCtx = ctx;
    if (rule.kind === 'EVERY_N_WEEKS_UNTIL_MOBILISED' && opts.extend) {
      // Mobilisation still open: keep one check ahead of today.
      const ahead = addDays(today, 7 * rule.intervalWeeks);
      ruleCtx = { ...ctx, mobilisationDueDate: ctx.mobilisationDueDate && ctx.mobilisationDueDate > ahead ? ctx.mobilisationDueDate : ahead };
    }
    for (const date of generateVisitDates(rule, ruleCtx)) if (date >= today && date <= horizon) out.push({ rule, date });
  }
  return out;
}

export interface ProposeResult {
  createdIds: string[];
  removed: number;
}

/**
 * Proposes the visits the project's type plan calls for. Idempotent on `generatorKey`. On a sprint
 * save, future PROPOSED visits of sprint-driven rules whose date is no longer generated are removed;
 * published visits are never touched (the warnings list them if they now fall outside their sprint).
 */
export async function proposeVisitsFromType(
  tx: Tx,
  projectId: string,
  opts: { trigger: PlanTrigger; ruleKey?: string | null; actor: VisitActor; assignees?: OfficerInput[]; now?: Date }
): Promise<ProposeResult> {
  const now = opts.now ?? new Date();
  const project = await loadVisitProject(tx, projectId);
  if (project.status !== 'ACTIVE') return { createdIds: [], removed: 0 };
  const config = monitoringConfigOf(project.projectTypeSnapshotJson);
  const rules = rulesFor(opts.trigger, config.visitPlan, opts.ruleKey ?? null);
  if (opts.trigger === 'MANUAL' && opts.ruleKey && rules.length === 0) {
    throw new AppError('This project type has no plan rule with that key', 404, 'VISIT_PLAN_RULE_NOT_FOUND');
  }
  if (rules.length === 0) return { createdIds: [], removed: 0 };
  const today = projectToday(project, now);
  const { ctx, mobilised } = await planContextFor(tx, projectId, now);
  const wanted = plannedDates(rules, ctx, today, { mobilised, extend: opts.trigger === 'MOBILISATION_EXTEND' });
  const sprints = await tx.projectSprint.findMany({ where: { projectId }, select: { id: true, number: true, startDate: true, endDate: true } });

  let removed = 0;
  if (opts.trigger === 'SPRINTS_SAVED') {
    const keep = new Set(wanted.map((w) => visitGeneratorKey(w.rule.key, w.date)));
    const prefixes = rules.map((r) => `${r.key}:`);
    const stale = await tx.visit.findMany({
      where: { projectId, status: 'PROPOSED', origin: 'PLAN', plannedDate: { gte: today }, generatorKey: { not: null } },
      select: { id: true, generatorKey: true },
    });
    const drop = stale.filter((v) => prefixes.some((p) => v.generatorKey!.startsWith(p)) && !keep.has(v.generatorKey!)).map((v) => v.id);
    if (drop.length) removed = (await tx.visit.deleteMany({ where: { id: { in: drop } } })).count;
  }

  const existing = new Set(
    (await tx.visit.findMany({ where: { projectId, generatorKey: { not: null } }, select: { generatorKey: true } })).map((v) => v.generatorKey!)
  );
  const officers = opts.assignees && opts.assignees.length ? opts.assignees : await defaultOfficersFor(tx, project);
  const createdIds: string[] = [];
  for (const w of wanted) {
    const key = visitGeneratorKey(w.rule.key, w.date);
    if (existing.has(key)) continue;
    existing.add(key);
    const visit = await tx.visit.create({
      data: {
        projectId,
        visitKind: w.rule.visitKind,
        status: 'PROPOSED',
        origin: 'PLAN',
        generatorKey: key,
        originalPlannedDate: w.date,
        plannedDate: w.date,
        sprintId: sprintForDate(sprints, w.date)?.id ?? null,
        submissionDeadline: submissionDeadlineFor(w.date, config.submissionDeadlineDays),
        createdByUserId: opts.actor.userId,
      },
    });
    await setVisitAssignees(tx, visit.id, officers);
    createdIds.push(visit.id);
  }

  if (createdIds.length || removed) {
    const counts = new Map<string, number>();
    for (const w of wanted) counts.set(w.rule.visitKind, counts.get(w.rule.visitKind) ?? 0);
    const created = await tx.visit.findMany({ where: { id: { in: createdIds } }, select: { visitKind: true } });
    for (const c of created) counts.set(c.visitKind, (counts.get(c.visitKind) ?? 0) + 1);
    const breakdown = [...counts].filter(([, n]) => n > 0).map(([k, n]) => `${n} ${visitLabelInSentence(k)}`).join(', ');
    await recordAuditEvent(tx, {
      projectId,
      actorType: opts.actor.actorType,
      actorId: opts.actor.actorId,
      actorDisplayName: opts.actor.actorDisplayName,
      action: 'VISITS_GENERATED',
      summaryText: `Proposed ${createdIds.length} visit(s) from the visit plan${breakdown ? ` (${breakdown})` : ''}${removed ? `; removed ${removed} proposed visit(s) no longer in the plan` : ''}.`,
      payload: { trigger: opts.trigger, ruleKey: opts.ruleKey ?? null, createdVisitIds: createdIds, removed },
    });
  }
  return { createdIds, removed };
}

/**
 * What the type plan would propose (D-R4.39): for a draft as if it were activated today; for a live
 * project from today on, marking dates that already have a visit. Nothing is written.
 */
export async function previewVisitPlan(projectId: string, now: Date = new Date()): Promise<VisitPlanPreviewDto> {
  const project = await loadVisitProject(prisma, projectId);
  const type = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const assumptions: string[] = [];
  if (!type) return { rules: [], items: [], laterRules: [], assumptions: ['The project has no project type, so there is no monitoring plan.'] };
  const rules = type.monitoring.visitPlan;
  const today = projectToday(project, now);
  const { ctx, mobilised } = await planContextFor(prisma, projectId, now);
  if (project.status === 'DRAFT') assumptions.push(`Dates assume the project is activated today (${today}).`);
  if (ctx.sprints.length === 0) assumptions.push('The project has no work phases yet: monitoring visits tied to work phases are dated from the planned end date, if any.');
  if (!ctx.mobilisationDueDate) assumptions.push('Mobilisation checks run every interval until the contractor is on site; the mobilisation milestone has no due date yet.');
  const active = rules.filter((r) => (project.status === 'DRAFT' ? isActivationRule(r) : true));
  const existing = new Set(
    (await prisma.visit.findMany({ where: { projectId, generatorKey: { not: null } }, select: { generatorKey: true } })).map((v) => v.generatorKey!)
  );
  const items = plannedDates(active, ctx, today, { mobilised, extend: false })
    .map((w) => ({ ruleKey: w.rule.key, visitKind: w.rule.visitKind, date: w.date, exists: existing.has(visitGeneratorKey(w.rule.key, w.date)) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ruleKey.localeCompare(b.ruleKey));
  const laterRules = rules
    .filter((r) => r.kind === 'ON_COMPLETION_NOTICE' || r.kind === 'AFTER_PROJECT_CLOSED')
    .filter((r) => !items.some((i) => i.ruleKey === r.key))
    .map((r) => `${VISIT_KIND_META[r.visitKind].label}: ${r.kind === 'ON_COMPLETION_NOTICE' ? 'proposed on the completion notice' : 'proposed when the project is closed'}`);
  return { rules, items, laterRules, assumptions };
}

/** After a sprint save: proposed visits take the sprint of their date (published ones keep theirs, D-R4.12). */
export async function realignProposedVisitSprints(tx: Tx, projectId: string): Promise<void> {
  const [sprints, visits] = await Promise.all([
    tx.projectSprint.findMany({ where: { projectId }, select: { id: true, startDate: true, endDate: true } }),
    tx.visit.findMany({ where: { projectId, status: 'PROPOSED' }, select: { id: true, plannedDate: true, sprintId: true } }),
  ]);
  for (const v of visits) {
    const sprintId = sprintForDate(sprints, v.plannedDate)?.id ?? null;
    if (sprintId !== v.sprintId) await tx.visit.update({ where: { id: v.id }, data: { sprintId } });
  }
}

/** Runs the plan for a trigger in its own transaction (callers outside a transaction, e.g. hooks after commit). */
export async function proposeVisitsAfterCommit(projectId: string, trigger: PlanTrigger, actor: VisitActor): Promise<ProposeResult> {
  return prisma.$transaction((tx) => proposeVisitsFromType(tx, projectId, { trigger, actor }));
}
