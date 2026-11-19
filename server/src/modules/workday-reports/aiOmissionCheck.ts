import { WorkdayAiCheckStatus } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { dispatchReportQueryBundle } from '../wbs-chat/wbsChat.service';

/**
 * Post-submission omission check (Phase 4). Runs after the submit response has been sent, never in
 * the request path, so a slow model cannot make the device time out and retry.
 *
 * State: PENDING -> RUNNING -> DONE | FAILED. SKIPPED for staged reports (set back to PENDING when
 * the server releases them). A sweep picks up anything the in-process scheduler missed.
 */

type Scheduler = (reportId: string) => void;

const defaultScheduler: Scheduler = (reportId) => {
  setImmediate(() => {
    runAiOmissionCheck(reportId).catch((error) => {
      console.error('[aiOmissionCheck] check failed', reportId, error);
    });
  });
};

let scheduler: Scheduler = defaultScheduler;

/** Tests replace the scheduler to run checks deterministically. */
export function setAiOmissionCheckScheduler(next: Scheduler | null): void {
  scheduler = next ?? defaultScheduler;
}

export function scheduleAiOmissionCheck(reportId: string): void {
  scheduler(reportId);
}

export async function runAiOmissionCheck(reportId: string): Promise<WorkdayAiCheckStatus | null> {
  const claimed = await prisma.workdayReport.updateMany({
    where: { id: reportId, aiCheckStatus: 'PENDING', status: 'CONFIRMED' },
    data: { aiCheckStatus: 'RUNNING' },
  });
  if (claimed.count === 0) {
    const current = await prisma.workdayReport.findUnique({
      where: { id: reportId },
      select: { aiCheckStatus: true },
    });
    return current?.aiCheckStatus ?? null;
  }

  try {
    const report = await prisma.workdayReport.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        boqItem: {
          select: { wbsCode: true, description: true, unit: true, isHoldPoint: true, holdPointInstruction: true },
        },
        captures: { include: { mediaAttachments: { select: { mediaType: true } } } },
      },
    });
    const brief = await prisma.morningDeliverableBrief.findFirst({
      where: { projectId: report.projectId, boqItemId: report.wbsItemId, workdayDate: report.workdayDate },
      select: { reportingChecklist: true },
    });
    const textNotes = Array.isArray(report.textNotes)
      ? (report.textNotes as Array<{ text?: unknown }>)
          .map((n) => (typeof n?.text === 'string' ? n.text : null))
          .filter((t): t is string => Boolean(t))
      : [];

    const result = await azureOpenAiService.evaluateWorkdayReportOmissions({
      wbsCode: report.boqItem.wbsCode,
      wbsDescription: report.boqItem.description,
      unit: report.unitOfMeasure || report.boqItem.unit,
      summaryText: report.summaryText,
      reportedQuantity: Number(report.reportedQuantity),
      isHoldPoint: report.boqItem.isHoldPoint,
      holdPointInstruction: report.boqItem.holdPointInstruction,
      isHoldPointClaimed: report.isHoldPointClaimed,
      morningChecklist: Array.isArray(brief?.reportingChecklist) ? (brief.reportingChecklist as string[]) : [],
      captures: report.captures
        .filter((c) => c.integrityPassed)
        .map((c) => ({ mediaType: c.mediaAttachments[0]?.mediaType ?? 'UNKNOWN', caption: c.caption })),
      textNotes,
      delaysOrBlockers: report.delaysOrBlockers,
    });

    await prisma.$transaction(async (tx) => {
      await tx.workdayReport.update({
        where: { id: reportId },
        data: {
          aiCheckStatus: 'DONE',
          aiCheckEngine: result.engine,
          aiReasoning: result.aiReasoning,
        },
      });
      if (result.hasUnexplainedOmission && result.omissionPayload) {
        await dispatchReportQueryBundle(tx, {
          projectId: report.projectId,
          boqItemId: report.wbsItemId,
          wbsCode: report.boqItem.wbsCode,
          workdayReportId: report.id,
          fieldSessionId: report.reporterSessionId,
          source: 'AI_OMISSION_CHECK',
          aiOmissionPayload: result.omissionPayload,
        });
      }
    });
    return 'DONE';
  } catch (error) {
    console.error('[aiOmissionCheck] marking FAILED', reportId, error);
    await prisma.workdayReport.update({ where: { id: reportId }, data: { aiCheckStatus: 'FAILED' } });
    return 'FAILED';
  }
}

const STUCK_RUNNING_MS = 10 * 60 * 1000;

/** Runs every PENDING check older than `minAgeMs`, and requeues checks stuck in RUNNING. */
export async function sweepPendingAiOmissionChecks(minAgeMs = 60 * 1000): Promise<number> {
  const now = Date.now();
  await prisma.workdayReport.updateMany({
    where: { aiCheckStatus: 'RUNNING', updatedAt: { lt: new Date(now - STUCK_RUNNING_MS) } },
    data: { aiCheckStatus: 'PENDING' },
  });
  const pending = await prisma.workdayReport.findMany({
    where: { aiCheckStatus: 'PENDING', status: 'CONFIRMED', updatedAt: { lt: new Date(now - minAgeMs) } },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  for (const r of pending) {
    await runAiOmissionCheck(r.id);
  }
  return pending.length;
}

export function startAiOmissionCheckSweep(intervalSeconds: number): () => void {
  if (intervalSeconds <= 0) return () => undefined;
  const timer = setInterval(() => {
    sweepPendingAiOmissionChecks().catch((error) => console.error('[aiOmissionCheck] sweep failed', error));
  }, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
