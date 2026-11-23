import { Prisma } from '@prisma/client';
import {
  AppliedStandard,
  BriefPersona,
  calendarDateInTimeZone,
  GenerateMorningBriefRequest,
  MorningDeliverableBriefDto,
  PlanningTier,
  windowOverlaps,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { getProcessConfig } from '../process/processConfig.service';
import { getReportedProgressByItem } from '../evidence/evidenceProvider';
import { getApplicableStandards, toAppliedStandards } from '../standards/standards.service';
import {
  cadenceSettingsForDate,
  createObligationsForPeriod,
  loadCadenceProject,
  periodKeyForDate,
  PeriodKey,
} from '../cadence/cadence.service';
import {
  itemStreamForPersona,
  loadActiveStreams,
  projectHasStreams,
  StreamRow,
  streamCadenceRow,
  streamPersonas,
} from '../cadence/streams.service';

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; the project's zone defines its day. */
export function getTodayDateString(timeZone: string): string {
  return calendarDateInTimeZone(new Date(), timeZone);
}

/**
 * The project's cadence settings and the period that contains `date` (default: today). Phase 14:
 * with reporting streams, the period of `stream`, or of the first ITEM_REPORTS stream `persona` owes.
 */
async function periodContext(projectId: string, date?: string, opts: { stream?: StreamRow | null; persona?: BriefPersona } = {}) {
  const project = await loadCadenceProject(prisma, projectId);
  const day = date || getTodayDateString(project.timezone);
  const stream = opts.stream ?? (opts.persona ? await itemStreamForPersona(prisma, projectId, opts.persona) : null);
  const settings = cadenceSettingsForDate(stream ? streamCadenceRow(project, stream) : project, day);
  return { project, settings, day, key: periodKeyForDate(settings, day) };
}

type BriefRow = Prisma.MorningDeliverableBriefGetPayload<{ include: { boqItem: true } }>;

function asAppliedStandards(raw: unknown): AppliedStandard[] {
  return Array.isArray(raw)
    ? (raw as AppliedStandard[]).filter((s) => s && typeof s.code === 'string' && typeof s.title === 'string')
    : [];
}

function mapBriefToDto(row: BriefRow, holdPointsEnabled = true): MorningDeliverableBriefDto {
  return {
    id: row.id,
    projectId: row.projectId,
    boqItemId: row.boqItemId,
    wbsCode: row.boqItem.wbsCode,
    wbsDescription: row.boqItem.description,
    workdayDate: row.workdayDate,
    planningTier: (row.planningTier || 'PLAN_A') as PlanningTier,
    headline: row.headline,
    expectedDeliverable: row.expectedDeliverable,
    reportingChecklist: Array.isArray(row.reportingChecklist) ? (row.reportingChecklist as string[]) : [],
    dailyTargetQuantity: row.dailyTargetQuantity ? Number(row.dailyTargetQuantity) : null,
    unit: row.boqItem.unit,
    isHoldPoint: holdPointsEnabled && row.boqItem.isHoldPoint,
    holdPointInstruction: holdPointsEnabled ? row.boqItem.holdPointInstruction ?? null : null,
    generatedByAi: row.generatedByAi,
    targetPersona: row.targetPersona,
    appliedStandards: asAppliedStandards(row.appliedStandardsJson),
    reportingPeriodStart: row.reportingPeriodStart,
    reportingPeriodEnd: row.reportingPeriodEnd,
    dueAt: row.dueAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Who a brief is for (Phase 7 Step 4):
 * - field callers get their own session's persona (contractor executor, else verifier);
 * - with contractor field reporting off, always the verifier;
 * - web callers may ask for either; the default is the contractor brief when contractors report.
 */
export async function resolveBriefPersona(params: {
  projectId: string;
  fieldAgent?: FieldAgentJwtPayload;
  webUser?: WebJwtPayload;
  requested?: BriefPersona | null;
}): Promise<BriefPersona> {
  const config = await getProcessConfig(params.projectId);
  if (!config.allowContractorFieldReporting) return 'INDEPENDENT_VERIFIER';
  if (params.fieldAgent) {
    return params.fieldAgent.fieldPersonaType === 'CONTRACTOR_EXECUTOR' ? 'CONTRACTOR_EXECUTOR' : 'INDEPENDENT_VERIFIER';
  }
  return params.requested ?? 'CONTRACTOR_EXECUTOR';
}

/**
 * Generates (or returns the cached) brief for one WBS item, reporting period and persona.
 * Idempotent per (projectId, boqItemId, reportingPeriodStart, targetPersona). `input.workdayDate`
 * selects the period (default: today in the project zone).
 */
export async function generateOrGetMorningBriefForBoqItem(params: {
  projectId: string;
  boqItemId: string;
  targetPersona: BriefPersona;
  input?: GenerateMorningBriefRequest;
  context?: Awaited<ReturnType<typeof periodContext>>;
  /** Phase 9: PLAN_A for items scheduled in the period, FALLBACK_BACKLOG for fallbacks. */
  planningTier?: PlanningTier;
}): Promise<MorningDeliverableBriefDto> {
  const { projectId, boqItemId, targetPersona } = params;
  const ctx = params.context ?? (await periodContext(projectId, params.input?.workdayDate, { persona: targetPersona }));
  const { key } = ctx;
  const config = await getProcessConfig(projectId);
  const uniqueKey = {
    projectId_boqItemId_reportingPeriodStart_targetPersona: {
      projectId,
      boqItemId,
      reportingPeriodStart: key.periodStart,
      targetPersona,
    },
  };

  const existing = await prisma.morningDeliverableBrief.findUnique({ where: uniqueKey, include: { boqItem: true } });
  if (existing && !params.input?.expectedDeliverableOverride) {
    return mapBriefToDto(existing, config.enableHoldPoints);
  }

  const [project, boqItem, latestReport] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    prisma.boqItem.findFirst({ where: { id: boqItemId, projectId } }),
    prisma.workdayReport.findFirst({
      where: { projectId, wbsItemId: boqItemId },
      orderBy: { createdAt: 'desc' },
      select: { summaryText: true },
    }),
  ]);
  if (!project) throw new AppError('Project not found', 404);
  if (!boqItem) throw new AppError('BOQ/WBS item not found for project', 404);

  // Phase 9: the planned window decides the tier; planningTier PLAN_A on the item is a manual override.
  const tier: PlanningTier =
    params.planningTier ??
    (boqItem.planningTier === 'PLAN_A' || windowOverlaps(boqItem.plannedStartDate, boqItem.plannedEndDate, key.periodStart, key.periodEnd)
      ? 'PLAN_A'
      : 'FALLBACK_BACKLOG');
  const dailyTarget =
    params.input?.dailyTargetQuantity ?? (boqItem.dailyTargetQuantity ? Number(boqItem.dailyTargetQuantity) : null);
  const appliedStandards = toAppliedStandards(await getApplicableStandards(projectId, boqItem.wbsCode));
  const isHoldPoint = config.enableHoldPoints && boqItem.isHoldPoint;

  const generated = await azureOpenAiService.generateMorningDeliverableBrief({
    projectName: project.name,
    wbsCode: boqItem.wbsCode,
    description: boqItem.description,
    unit: boqItem.unit,
    totalQuantity: Number(boqItem.totalQuantity),
    cumulativeCertifiedPct: Number(boqItem.cumulativeCertifiedPct),
    dailyTargetQuantity: dailyTarget,
    expectedDeliverableOverride: params.input?.expectedDeliverableOverride ?? boqItem.expectedDeliverable,
    isHoldPoint,
    holdPointInstruction: isHoldPoint ? boqItem.holdPointInstruction : null,
    previousReportSummary: latestReport?.summaryText ?? null,
    planningTier: tier,
    targetPersona,
    applicableStandards: appliedStandards,
    reportingCadence: ctx.settings.reportingCadence,
    periodStart: key.periodStart,
    periodEnd: key.periodEnd,
  });

  const content = {
    headline: generated.headline,
    expectedDeliverable: generated.expectedDeliverable,
    reportingChecklist: generated.reportingChecklist,
    dailyTargetQuantity: dailyTarget,
    generatedByAi: generated.generatedByAi,
    appliedStandardsJson: appliedStandards as unknown as Prisma.InputJsonValue,
  };
  const saved = await prisma.morningDeliverableBrief.upsert({
    where: uniqueKey,
    create: {
      projectId,
      boqItemId,
      workdayDate: ctx.day,
      reportingPeriodStart: key.periodStart,
      reportingPeriodEnd: key.periodEnd,
      dueAt: key.dueAt,
      targetPersona,
      planningTier: tier,
      ...content,
    },
    update: content,
    include: { boqItem: true },
  });
  return mapBriefToDto(saved, config.enableHoldPoints);
}

/**
 * The personas that report on a project: a contractor brief is generated only when contractors
 * may report and someone could (an active contractor session, join code or provisioned account).
 */
export async function briefPersonasForProject(projectId: string): Promise<BriefPersona[]> {
  const config = await getProcessConfig(projectId);
  const present = async (persona: 'CONTRACTOR_EXECUTOR' | 'INDEPENDENT_VERIFIER') => {
    const [sessions, codes, accounts] = await Promise.all([
      prisma.fieldAgentSession.count({ where: { projectId, isActive: true, fieldPersonaType: persona } }),
      prisma.projectJoinCode.count({ where: { projectId, isActive: true, role: { fieldPersonaType: persona } } }),
      prisma.userProjectAssignment.count({
        where: { projectId, user: { isActive: true, mobileRole: { fieldPersonaType: persona } } },
      }),
    ]);
    return sessions + codes + accounts > 0;
  };
  const personas: BriefPersona[] = [];
  if (await present('INDEPENDENT_VERIFIER')) personas.push('INDEPENDENT_VERIFIER');
  if (config.allowContractorFieldReporting && (await present('CONTRACTOR_EXECUTOR'))) personas.push('CONTRACTOR_EXECUTOR');
  return personas;
}

/**
 * Generates the period's briefs for a project's scheduled (Plan A) items and up to 3 unblocked
 * fallback items, once per persona that reports on the project (or only for `personas`), and
 * creates the period's reporting obligations for the scheduled items.
 */
export async function generateDispatchForProject(
  projectId: string,
  workdayDateInput?: string,
  personas?: BriefPersona[],
  /** Phase 14: dispatch for one ITEM_REPORTS stream (its period, its obligations). */
  stream?: StreamRow | null
): Promise<MorningDeliverableBriefDto[]> {
  if (!stream) {
    // Phase 14: a project with streams dispatches per ITEM_REPORTS stream (INSPECTION streams get no briefs).
    const streams = (await loadActiveStreams(prisma, projectId)).filter((s) => s.kind === 'ITEM_REPORTS');
    if (streams.length > 0 || (await projectHasStreams(prisma, projectId))) {
      const wanted = personas ?? (await briefPersonasForProject(projectId));
      const out: MorningDeliverableBriefDto[] = [];
      for (const s of streams) {
        const owed = (await streamPersonas(prisma, s)).filter((p) => wanted.includes(p));
        if (owed.length) out.push(...(await generateDispatchForProject(projectId, workdayDateInput, owed, s)));
      }
      return out;
    }
  }
  const ctx = await periodContext(projectId, workdayDateInput, { stream: stream ?? null, persona: stream ? undefined : personas?.[0] });
  const targets = await dispatchTargets(projectId, ctx.key);
  const forPersonas = personas ?? (await briefPersonasForProject(projectId));
  const briefs: MorningDeliverableBriefDto[] = [];
  for (const targetPersona of forPersonas) {
    for (const item of targets) {
      briefs.push(
        await generateOrGetMorningBriefForBoqItem({
          projectId,
          boqItemId: item.id,
          targetPersona,
          context: ctx,
          planningTier: item.isScheduled ? 'PLAN_A' : 'FALLBACK_BACKLOG',
        })
      );
    }
  }
  await createObligationsForPeriod({ projectId, key: ctx.key, personas: forPersonas, items: targets, stream: stream ?? null });
  return briefs;
}


/**
 * Items in scope for a period (Phase 9):
 * - scheduled: not done, and the planned window overlaps the period, or ended before it (overdue
 *   work stays due until it is done), or planningTier PLAN_A (manual override);
 * - up to three fallbacks: not done, not scheduled, every predecessor done, and not blocked by a
 *   hold point (when hold points are on) unless marked FALLBACK_BACKLOG; earliest planned start first.
 * "Done" means certified at 100%, or field reports already cover the whole quantity.
 */
export async function dispatchTargets(projectId: string, key: { periodStart: string; periodEnd: string }) {
  const config = await getProcessConfig(projectId);
  const [boqItems, dependencies] = await Promise.all([
    prisma.boqItem.findMany({
      // Phase 13: items of a terminated contractor get no briefs until they move to a replacement.
      where: { projectId, OR: [{ projectContractorId: null }, { projectContractor: { contractStatus: 'ACTIVE' } }] },
      orderBy: { wbsCode: 'asc' },
      select: {
        id: true,
        projectContractorId: true,
        planningTier: true,
        isHoldPoint: true,
        totalQuantity: true,
        cumulativeCertifiedPct: true,
        plannedStartDate: true,
        plannedEndDate: true,
      },
    }),
    prisma.boqItemDependency.findMany({ where: { projectId }, select: { predecessorBoqItemId: true, successorBoqItemId: true } }),
  ]);
  const reported = await getReportedProgressByItem(
    projectId,
    boqItems.map((b) => ({ id: b.id, totalQuantity: Number(b.totalQuantity) }))
  );
  const done = new Set(
    boqItems.filter((b) => Number(b.cumulativeCertifiedPct) >= 100 || (reported.get(b.id) ?? 0) >= 100).map((b) => b.id)
  );
  const open = boqItems.filter((b) => !done.has(b.id));
  const scheduled = open.filter(
    (b) =>
      b.planningTier === 'PLAN_A' ||
      windowOverlaps(b.plannedStartDate, b.plannedEndDate, key.periodStart, key.periodEnd) ||
      (b.plannedEndDate !== null && b.plannedEndDate < key.periodStart)
  );
  const scheduledIds = new Set(scheduled.map((b) => b.id));
  const predecessors = new Map<string, string[]>();
  for (const d of dependencies) {
    predecessors.set(d.successorBoqItemId, [...(predecessors.get(d.successorBoqItemId) ?? []), d.predecessorBoqItemId]);
  }
  const fallbacks = open
    .filter(
      (b) =>
        !scheduledIds.has(b.id) &&
        (predecessors.get(b.id) ?? []).every((p) => done.has(p)) &&
        (b.planningTier === 'FALLBACK_BACKLOG' || !(config.enableHoldPoints && b.isHoldPoint))
    )
    .sort((a, b) => (a.plannedStartDate ?? '9999-12-31').localeCompare(b.plannedStartDate ?? '9999-12-31'))
    .slice(0, 3);
  return [
    ...scheduled.map((b) => ({ id: b.id, projectContractorId: b.projectContractorId, isScheduled: true })),
    ...fallbacks.map((b) => ({ id: b.id, projectContractorId: b.projectContractorId, isScheduled: false })),
  ];
}

/**
 * Briefs for the period containing `workdayDate` (default today) and one persona, ordered Plan A,
 * then fallback backlog, then the pool.
 */
export async function listMorningBriefsForProject(params: {
  projectId: string;
  targetPersona: BriefPersona;
  workdayDate?: string;
}): Promise<MorningDeliverableBriefDto[]> {
  const { key } = await periodContext(params.projectId, params.workdayDate, { persona: params.targetPersona });
  const config = await getProcessConfig(params.projectId);
  const rows = await prisma.morningDeliverableBrief.findMany({
    where: { projectId: params.projectId, reportingPeriodStart: key.periodStart, targetPersona: params.targetPersona },
    include: { boqItem: true },
    orderBy: { createdAt: 'asc' },
  });
  const tierOrder: Record<string, number> = { PLAN_A: 0, FALLBACK_BACKLOG: 1, UNBLOCKED_POOL: 2 };
  return rows
    .map((r) => mapBriefToDto(r, config.enableHoldPoints))
    .sort((a, b) => (tierOrder[a.planningTier] ?? 3) - (tierOrder[b.planningTier] ?? 3));
}

export type { PeriodKey };
