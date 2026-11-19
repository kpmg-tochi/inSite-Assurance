import { Prisma } from '@prisma/client';
import {
  AppliedStandard,
  BriefPersona,
  calendarDateInTimeZone,
  GenerateMorningBriefRequest,
  MorningDeliverableBriefDto,
  PlanningTier,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { getProcessConfig } from '../process/processConfig.service';
import { getApplicableStandards, toAppliedStandards } from '../standards/standards.service';
import {
  cadenceSettingsForDate,
  createObligationsForPeriod,
  loadCadenceProject,
  periodKeyForDate,
  PeriodKey,
} from '../cadence/cadence.service';

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; the project's zone defines its day. */
export function getTodayDateString(timeZone: string): string {
  return calendarDateInTimeZone(new Date(), timeZone);
}

/** The project's cadence settings and the period that contains `date` (default: today). */
async function periodContext(projectId: string, date?: string) {
  const project = await loadCadenceProject(prisma, projectId);
  const day = date || getTodayDateString(project.timezone);
  const settings = cadenceSettingsForDate(project, day);
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
}): Promise<MorningDeliverableBriefDto> {
  const { projectId, boqItemId, targetPersona } = params;
  const ctx = params.context ?? (await periodContext(projectId, params.input?.workdayDate));
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
    planningTier: boqItem.planningTier || (boqItem.isScheduledToday ? 'PLAN_A' : 'UNBLOCKED_POOL'),
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
      planningTier: boqItem.planningTier || (boqItem.isScheduledToday ? 'PLAN_A' : 'FALLBACK_BACKLOG'),
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
  personas?: BriefPersona[]
): Promise<MorningDeliverableBriefDto[]> {
  const ctx = await periodContext(projectId, workdayDateInput);
  const targets = await dispatchTargets(projectId);
  const forPersonas = personas ?? (await briefPersonasForProject(projectId));
  const briefs: MorningDeliverableBriefDto[] = [];
  for (const targetPersona of forPersonas) {
    for (const item of targets) {
      briefs.push(await generateOrGetMorningBriefForBoqItem({ projectId, boqItemId: item.id, targetPersona, context: ctx }));
    }
  }
  await createObligationsForPeriod({ projectId, key: ctx.key, personas: forPersonas, items: targets });
  return briefs;
}


/**
 * Items in scope for a period. `isScheduledToday` and `planningTier` still decide this until
 * Phase 9 adds planned dates; read the flag as "scheduled this period".
 */
async function dispatchTargets(projectId: string) {
  const config = await getProcessConfig(projectId);
  const boqItems = await prisma.boqItem.findMany({
    where: { projectId, cumulativeCertifiedPct: { lt: 100 } },
    orderBy: [{ isScheduledToday: 'desc' }, { wbsCode: 'asc' }],
  });
  // "Scheduled this period" (isScheduledToday is the Phase 4 name of the flag).
  const planA = boqItems.filter((b) => b.planningTier === 'PLAN_A' || b.isScheduledToday);
  // Up to 3 constraint-free fallback items (not blocked by a hold point, when hold points are on).
  const fallbacks = boqItems
    .filter(
      (b) =>
        !planA.some((p) => p.id === b.id) &&
        (b.planningTier === 'FALLBACK_BACKLOG' || !(config.enableHoldPoints && b.isHoldPoint))
    )
    .slice(0, 3);
  return [
    ...planA.map((b) => ({ id: b.id, projectContractorId: b.projectContractorId, isScheduled: true })),
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
  const { key } = await periodContext(params.projectId, params.workdayDate);
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
