import { Prisma } from '@prisma/client';
import { StandardsViolationItem, WorkdayAiCheckStatus } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { dispatchReportQueryBundle } from '../wbs-chat/wbsChat.service';
import { createWebNotification } from '../notifications/notifications.service';
import { recordAuditEvent } from '../audit/audit.service';
import { getProcessConfig } from '../process/processConfig.service';
import { getApplicableStandards } from '../standards/standards.service';
import { evaluateStandardsByRules } from '../standards/standardsRules';

/**
 * Post-submission report checks (Phase 4, extended in Phase 7). Run after the submit response has
 * been sent, never in the request path, so a slow model cannot make the device time out and retry.
 *
 * According to the project's process configuration:
 * - the omission check (hold-point and checklist proof), and
 * - the standards check against the standards that apply to the item: AI when available, the
 *   rule-based evaluator otherwise; when neither can decide, `standardsCompliancePassed` stays null.
 *
 * State: PENDING -> RUNNING -> DONE | FAILED. SKIPPED for staged reports (set back to PENDING when
 * the server releases them). A sweep picks up anything the in-process scheduler missed.
 */

/** Statuses whose report is accepted (possibly still going through approval) and so is checked. */
const CHECKABLE_STATUSES = ['CONFIRMED', 'PENDING_APPROVAL', 'APPROVED_COMPLETED'] as const;

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

type ReportForCheck = Prisma.WorkdayReportGetPayload<{
  include: {
    boqItem: { select: { wbsCode: true; description: true; unit: true; isHoldPoint: true; holdPointInstruction: true } };
    captures: { include: { mediaAttachments: { select: { mediaType: true } } } };
  };
}>;

function textNotesOf(report: ReportForCheck): string[] {
  return Array.isArray(report.textNotes)
    ? (report.textNotes as Array<{ text?: unknown }>)
        .map((n) => (typeof n?.text === 'string' ? n.text : null))
        .filter((t): t is string => Boolean(t))
    : [];
}

interface StandardsOutcome {
  passed: boolean | null;
  violations: StandardsViolationItem[];
  reasoning: string | null;
  engine: string | null;
}

async function runStandardsCheck(report: ReportForCheck): Promise<StandardsOutcome> {
  const standards = await getApplicableStandards(report.projectId, report.boqItem.wbsCode);
  if (standards.length === 0) {
    // Nothing to check: left null ("not checked") with no extra reasoning text.
    return { passed: null, violations: [], reasoning: null, engine: null };
  }
  const usable = report.captures.filter((c) => c.integrityPassed);
  const captureTypes = usable.map((c) => c.mediaAttachments[0]?.mediaType ?? 'UNKNOWN');
  const reportText = [
    report.summaryText,
    report.delaysOrBlockers ?? '',
    ...textNotesOf(report),
    ...usable.map((c) => c.caption ?? ''),
    ...usable.map((c) => c.transcript ?? ''),
  ]
    .filter((t) => t.trim().length > 0)
    .join('\n');
  const ruleStandards = standards.map((s) => ({
    code: s.code,
    title: s.title,
    specificationText: s.specificationText,
    isMandatory: s.isMandatory,
  }));

  const ai = await azureOpenAiService.evaluateReportAgainstStandards({
    wbsCode: report.boqItem.wbsCode,
    wbsDescription: report.boqItem.description,
    unit: report.unitOfMeasure || report.boqItem.unit,
    reportedQuantity: Number(report.reportedQuantity),
    standards: ruleStandards,
    reportText,
    captureTypes,
  });
  if (ai) return { passed: ai.passed, violations: ai.violations, reasoning: ai.reasoning, engine: ai.engine };

  const rules = evaluateStandardsByRules(ruleStandards, {
    text: reportText,
    captureMediaTypes: captureTypes,
    reportedQuantity: Number(report.reportedQuantity),
  });
  return { passed: rules.passed, violations: rules.violations, reasoning: rules.reasoning, engine: rules.decided ? 'RULES' : null };
}

export async function runAiOmissionCheck(reportId: string): Promise<WorkdayAiCheckStatus | null> {
  const claimed = await prisma.workdayReport.updateMany({
    where: { id: reportId, aiCheckStatus: 'PENDING', status: { in: [...CHECKABLE_STATUSES] } },
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
    const config = await getProcessConfig(report.projectId);
    const holdPoint = config.enableHoldPoints && report.boqItem.isHoldPoint;
    const persona = report.reporterPersonaType === 'CONTRACTOR_EXECUTOR' ? 'CONTRACTOR_EXECUTOR' : 'INDEPENDENT_VERIFIER';

    const omission = config.enableAiOmissionCheck
      ? await (async () => {
          const brief =
            (await prisma.morningDeliverableBrief.findFirst({
              where: { projectId: report.projectId, boqItemId: report.wbsItemId, workdayDate: report.workdayDate, targetPersona: persona },
              select: { reportingChecklist: true },
            })) ??
            (await prisma.morningDeliverableBrief.findFirst({
              where: { projectId: report.projectId, boqItemId: report.wbsItemId, workdayDate: report.workdayDate },
              select: { reportingChecklist: true },
            }));
          return azureOpenAiService.evaluateWorkdayReportOmissions({
            wbsCode: report.boqItem.wbsCode,
            wbsDescription: report.boqItem.description,
            unit: report.unitOfMeasure || report.boqItem.unit,
            summaryText: report.summaryText,
            reportedQuantity: Number(report.reportedQuantity),
            isHoldPoint: holdPoint,
            holdPointInstruction: holdPoint ? report.boqItem.holdPointInstruction : null,
            isHoldPointClaimed: holdPoint && report.isHoldPointClaimed,
            morningChecklist: Array.isArray(brief?.reportingChecklist) ? (brief.reportingChecklist as string[]) : [],
            captures: report.captures
              .filter((c) => c.integrityPassed)
              .map((c) => ({ mediaType: c.mediaAttachments[0]?.mediaType ?? 'UNKNOWN', caption: c.caption })),
            textNotes: textNotesOf(report),
            delaysOrBlockers: report.delaysOrBlockers,
          });
        })()
      : null;

    const standards: StandardsOutcome = config.enableAiStandardsCheck
      ? await runStandardsCheck(report)
      : { passed: null, violations: [], reasoning: null, engine: null };

    const engines = [omission?.engine, standards.engine].filter((e): e is string => Boolean(e));
    const reasoning = [omission?.aiReasoning, standards.reasoning].filter((r): r is string => Boolean(r)).join(' ');

    await prisma.$transaction(async (tx) => {
      await tx.workdayReport.update({
        where: { id: reportId },
        data: {
          aiCheckStatus: 'DONE',
          aiCheckEngine: engines.length ? [...new Set(engines)].join('+') : null,
          aiReasoning: reasoning || null,
          standardsCompliancePassed: standards.passed,
          standardsViolationsJson: standards.violations as unknown as Prisma.InputJsonValue,
        },
      });
      if (omission?.hasUnexplainedOmission && omission.omissionPayload) {
        await dispatchReportQueryBundle(tx, {
          projectId: report.projectId,
          boqItemId: report.wbsItemId,
          wbsCode: report.boqItem.wbsCode,
          workdayReportId: report.id,
          fieldSessionId: report.reporterSessionId,
          source: 'AI_OMISSION_CHECK',
          aiOmissionPayload: omission.omissionPayload,
        });
      }
      if (standards.passed === false) {
        await dispatchReportQueryBundle(tx, {
          projectId: report.projectId,
          boqItemId: report.wbsItemId,
          wbsCode: report.boqItem.wbsCode,
          workdayReportId: report.id,
          fieldSessionId: report.reporterSessionId,
          source: 'AI_STANDARDS_CHECK',
          standardsViolations: standards.violations,
        });
        const codes = [...new Set(standards.violations.map((v) => v.standardCode))];
        await createWebNotification(tx, {
          projectId: report.projectId,
          targetPermissionKey: 'reports:view_all',
          category: 'STANDARDS_VIOLATION_FLAGGED',
          title: `Standards issue · WBS ${report.boqItem.wbsCode}`,
          description: `The ${report.workdayDate} report does not show that ${codes.join(', ')} ${codes.length === 1 ? 'was' : 'were'} met. A query was sent to the reporter.`,
          actionUrl: `/app/projects/${report.projectId}/audit?tab=presence&wbsItemId=${report.wbsItemId}&reportId=${report.id}`,
          metadata: { workdayReportId: report.id, wbsItemId: report.wbsItemId, standardCodes: codes },
        });
        await recordAuditEvent(tx, {
          projectId: report.projectId,
          actorType: 'AI_SYSTEM',
          actorId: standards.engine === 'AZURE_OPENAI' ? 'AZURE_OPENAI:standards-check' : 'RULES_ENGINE:standards-check',
          actorDisplayName: standards.engine === 'AZURE_OPENAI' ? 'Azure OpenAI standards check' : 'Rules engine standards check',
          action: 'STANDARDS_VIOLATION_FLAGGED',
          summaryText: `WBS ${report.boqItem.wbsCode} report for ${report.workdayDate} failed the standards check (${codes.join(', ')}).`,
          payload: { workdayReportId: report.id, engine: standards.engine, violations: standards.violations },
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
    where: { aiCheckStatus: 'PENDING', status: { in: [...CHECKABLE_STATUSES] }, updatedAt: { lt: new Date(now - minAgeMs) } },
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
