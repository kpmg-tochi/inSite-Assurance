import { Prisma } from '@prisma/client';
import { ChecklistSectionsSchema, StandardsViolationItem, validateInspectionAnswers, WorkdayAiCheckStatus } from '@insite/shared';
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

// ---------------------------------------------------------------------------
// Phase 14: inspection mode
// ---------------------------------------------------------------------------

const inspectionDefaultScheduler: Scheduler = (inspectionId) => {
  setImmediate(() => {
    runInspectionOmissionCheck(inspectionId).catch((error) => {
      console.error('[aiOmissionCheck] inspection check failed', inspectionId, error);
    });
  });
};
let inspectionScheduler: Scheduler = inspectionDefaultScheduler;

/** Tests replace the scheduler to run inspection checks deterministically. */
export function setInspectionCheckScheduler(next: Scheduler | null): void {
  inspectionScheduler = next ?? inspectionDefaultScheduler;
}

export function scheduleInspectionOmissionCheck(inspectionId: string): void {
  inspectionScheduler(inspectionId);
}

/**
 * Inspection mode of the omission check: flags checklist items that need a photo and have none
 * (photo required, or required on fail and answered as a fail). Deterministic, so the engine is
 * always RULES (no model call and no fabricated text). Flags are stored on the inspection and the
 * monitoring side is notified. Runs off the request path.
 */
export async function runInspectionOmissionCheck(inspectionId: string): Promise<WorkdayAiCheckStatus | null> {
  const claimed = await prisma.siteInspectionReport.updateMany({
    where: { id: inspectionId, aiCheckStatus: 'PENDING' },
    data: { aiCheckStatus: 'RUNNING' },
  });
  if (claimed.count === 0) return null;
  try {
    const r = await prisma.siteInspectionReport.findUniqueOrThrow({
      where: { id: inspectionId },
      include: { template: { select: { sectionsJson: true } }, captures: { select: { checklistItemKey: true, integrityPassed: true } } },
    });
    const sections = ChecklistSectionsSchema.parse(r.template.sectionsJson);
    const answers = (Array.isArray(r.answersJson) ? r.answersJson : []) as Array<{ itemKey: string; value: unknown; comment?: string | null }>;
    // Only photos actually linked to the item count (a claimed id that never linked does not).
    const photosByItem = new Map<string, number>();
    for (const c of r.captures) if (c.checklistItemKey) photosByItem.set(c.checklistItemKey, (photosByItem.get(c.checklistItemKey) ?? 0) + 1);
    const check = validateInspectionAnswers(
      sections,
      answers.map((a) => ({
        itemKey: a.itemKey,
        value: (a.value ?? null) as string | number | null,
        comment: a.comment ?? null,
        clientCaptureIds: Array.from({ length: photosByItem.get(a.itemKey) ?? 0 }, () => '00000000-0000-0000-0000-000000000000'),
      }))
    );
    const labels = new Map(sections.flatMap((s) => s.items).map((i) => [i.key, i.label]));
    const flags = check.missingPhotoItemKeys.map((itemKey) => ({
      itemKey,
      message: `"${labels.get(itemKey) ?? itemKey}" needs a photo and has none.`,
    }));
    await prisma.$transaction(async (tx) => {
      await tx.siteInspectionReport.update({
        where: { id: r.id },
        data: { aiCheckStatus: 'DONE', aiCheckEngine: 'RULES', aiFlagsJson: flags as unknown as Prisma.InputJsonValue },
      });
      if (flags.length > 0) {
        await createWebNotification(tx, {
          projectId: r.projectId,
          targetPermissionKey: 'inspections:view',
          category: 'AI_OMISSION_FLAG',
          title: `Inspection photos missing · ${flags.length} item(s)`,
          description: `${r.reporterName}'s inspection of ${r.visitDate} has items that need photos: ${flags.map((f) => labels.get(f.itemKey) ?? f.itemKey).join(', ')}.`,
          actionUrl: `/app/projects/${r.projectId}/inspections?inspectionId=${r.id}`,
          metadata: { siteInspectionReportId: r.id, itemKeys: check.missingPhotoItemKeys },
          hideFromProjectContractors: true,
        });
      }
    });
    return 'DONE';
  } catch (error) {
    await prisma.siteInspectionReport.update({ where: { id: inspectionId }, data: { aiCheckStatus: 'FAILED' } }).catch(() => undefined);
    console.error('[aiOmissionCheck] inspection check error', inspectionId, error);
    return 'FAILED';
  }
}

/** Runs PENDING inspection checks older than `minAgeMs`; requeues ones stuck in RUNNING. */
export async function sweepPendingInspectionChecks(minAgeMs = 60 * 1000): Promise<number> {
  const now = Date.now();
  await prisma.siteInspectionReport.updateMany({
    where: { aiCheckStatus: 'RUNNING', updatedAt: { lt: new Date(now - STUCK_RUNNING_MS) } },
    data: { aiCheckStatus: 'PENDING' },
  });
  const pending = await prisma.siteInspectionReport.findMany({
    where: { aiCheckStatus: 'PENDING', updatedAt: { lt: new Date(now - minAgeMs) } },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  for (const r of pending) await runInspectionOmissionCheck(r.id);
  return pending.length;
}

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
    sweepPendingInspectionChecks().catch((error) => console.error('[aiOmissionCheck] inspection sweep failed', error));
  }, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
