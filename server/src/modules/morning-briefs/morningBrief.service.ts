import {
  calendarDateInTimeZone,
  GenerateMorningBriefRequest,
  MorningDeliverableBriefDto,
  PlanningTier,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { AppError } from '../../middleware/error.middleware';

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; the project's zone defines its day. */
export function getTodayDateString(timeZone: string): string {
  return calendarDateInTimeZone(new Date(), timeZone);
}

async function projectTimeZone(projectId: string): Promise<string> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { timezone: true } });
  return p?.timezone ?? 'Africa/Lagos';
}

function mapBriefToDto(row: any): MorningDeliverableBriefDto {
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
    reportingChecklist: Array.isArray(row.reportingChecklist)
      ? (row.reportingChecklist as string[])
      : [],
    dailyTargetQuantity: row.dailyTargetQuantity
      ? Number(row.dailyTargetQuantity)
      : null,
    unit: row.boqItem.unit,
    isHoldPoint: row.boqItem.isHoldPoint,
    holdPointInstruction: row.boqItem.holdPointInstruction ?? null,
    generatedByAi: row.generatedByAi,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Generates (or returns existing) Morning Deliverable Brief for a single WBS/BOQ item
 * on the given workdayDate. Idempotent per (projectId, boqItemId, workdayDate).
 */
export async function generateOrGetMorningBriefForBoqItem(params: {
  projectId: string;
  boqItemId: string;
  input?: GenerateMorningBriefRequest;
}): Promise<MorningDeliverableBriefDto> {
  const workdayDate = params.input?.workdayDate || getTodayDateString(await projectTimeZone(params.projectId));

  const existing = await prisma.morningDeliverableBrief.findUnique({
    where: {
      projectId_boqItemId_workdayDate: {
        projectId: params.projectId,
        boqItemId: params.boqItemId,
        workdayDate,
      },
    },
    include: {
      boqItem: true,
    },
  });

  if (existing && !params.input?.expectedDeliverableOverride) {
    return mapBriefToDto(existing);
  }

  const [project, boqItem, latestReport] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, name: true },
    }),
    prisma.boqItem.findFirst({
      where: { id: params.boqItemId, projectId: params.projectId },
    }),
    prisma.workdayReport.findFirst({
      where: { projectId: params.projectId, wbsItemId: params.boqItemId },
      orderBy: { createdAt: 'desc' },
      select: { summaryText: true },
    }),
  ]);

  if (!project) throw new AppError('Project not found', 404);
  if (!boqItem) throw new AppError('BOQ/WBS item not found for project', 404);

  const dailyTarget =
    params.input?.dailyTargetQuantity ??
    (boqItem.dailyTargetQuantity ? Number(boqItem.dailyTargetQuantity) : null);

  const generated = await azureOpenAiService.generateMorningDeliverableBrief({
    projectName: project.name,
    wbsCode: boqItem.wbsCode,
    description: boqItem.description,
    unit: boqItem.unit,
    totalQuantity: Number(boqItem.totalQuantity),
    cumulativeCertifiedPct: Number(boqItem.cumulativeCertifiedPct),
    dailyTargetQuantity: dailyTarget,
    expectedDeliverableOverride:
      params.input?.expectedDeliverableOverride ?? boqItem.expectedDeliverable,
    isHoldPoint: boqItem.isHoldPoint,
    holdPointInstruction: boqItem.holdPointInstruction,
    previousReportSummary: latestReport?.summaryText ?? null,
    planningTier: boqItem.planningTier || (boqItem.isScheduledToday ? 'PLAN_A' : 'UNBLOCKED_POOL'),
  });

  const saved = await prisma.morningDeliverableBrief.upsert({
    where: {
      projectId_boqItemId_workdayDate: {
        projectId: params.projectId,
        boqItemId: params.boqItemId,
        workdayDate,
      },
    },
    create: {
      projectId: params.projectId,
      boqItemId: params.boqItemId,
      workdayDate,
      planningTier:
        boqItem.planningTier ||
        (boqItem.isScheduledToday ? 'PLAN_A' : 'FALLBACK_BACKLOG'),
      headline: generated.headline,
      expectedDeliverable: generated.expectedDeliverable,
      reportingChecklist: generated.reportingChecklist,
      dailyTargetQuantity: dailyTarget,
      generatedByAi: generated.generatedByAi,
    },
    update: {
      headline: generated.headline,
      expectedDeliverable: generated.expectedDeliverable,
      reportingChecklist: generated.reportingChecklist,
      dailyTargetQuantity: dailyTarget,
      generatedByAi: generated.generatedByAi,
    },
    include: { boqItem: true },
  });

  return mapBriefToDto(saved);
}

/**
 * Generates daily morning briefs for a project's Plan A items and up to 3 unblocked
 * Fallback (Workable Backlog) items.
 */
export async function generateDailyDispatchForProject(
  projectId: string,
  workdayDateInput?: string
): Promise<MorningDeliverableBriefDto[]> {
  const workdayDate = workdayDateInput || getTodayDateString(await projectTimeZone(projectId));
  const boqItems = await prisma.boqItem.findMany({
    where: {
      projectId,
      cumulativeCertifiedPct: { lt: 100 },
    },
    orderBy: [{ isScheduledToday: 'desc' }, { wbsCode: 'asc' }],
  });

  const planA = boqItems.filter(
    (b) => b.planningTier === 'PLAN_A' || b.isScheduledToday
  );
  // Up to 3 constraint-free fallback items (not blocked by a hold point)
  const fallbacks = boqItems
    .filter(
      (b) =>
        !planA.some((p) => p.id === b.id) &&
        (b.planningTier === 'FALLBACK_BACKLOG' || !b.isHoldPoint)
    )
    .slice(0, 3);

  const targets = [...planA, ...fallbacks];
  const briefs: MorningDeliverableBriefDto[] = [];

  for (const item of targets) {
    const brief = await generateOrGetMorningBriefForBoqItem({
      projectId,
      boqItemId: item.id,
      input: { workdayDate },
    });
    briefs.push(brief);
  }

  return briefs;
}

/**
 * Lists Morning Deliverable Briefs for a project on a given date,
 * ordered by PLAN_A first, then FALLBACK_BACKLOG, then UNBLOCKED_POOL.
 */
export async function listMorningBriefsForProject(params: {
  projectId: string;
  workdayDate?: string;
}): Promise<MorningDeliverableBriefDto[]> {
  const workdayDate = params.workdayDate || getTodayDateString(await projectTimeZone(params.projectId));

  const rows = await prisma.morningDeliverableBrief.findMany({
    where: {
      projectId: params.projectId,
      workdayDate,
    },
    include: { boqItem: true },
    orderBy: { createdAt: 'asc' },
  });

  const tierOrder: Record<string, number> = {
    PLAN_A: 0,
    FALLBACK_BACKLOG: 1,
    UNBLOCKED_POOL: 2,
  };

  return rows
    .map(mapBriefToDto)
    .sort(
      (a, b) =>
        (tierOrder[a.planningTier] ?? 3) - (tierOrder[b.planningTier] ?? 3)
    );
}
