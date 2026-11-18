import {
  AiOmissionPayload,
  RevalidateWorkdayReportRequest,
  SubmissionGeotag,
  SubmitWorkdayReportBundle,
  verifyLinearCorridorGeofence,
  verifyRadialGeofence,
  type ProjectGeofence,
} from '@insite/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import {
  dispatchReportQueryBundle,
  serializeReportQuery,
} from '../wbs-chat/wbsChat.service';
import { loadReportQueryInProject } from '../../utils/ownership';

async function verifySubmissionGeotag(
  rawGeotag: SubmissionGeotag | null | undefined,
  geofenceGeoJson: unknown
): Promise<SubmissionGeotag | null> {
  if (!rawGeotag) return null;
  let verified: SubmissionGeotag = rawGeotag;

  if (geofenceGeoJson) {
    const geofence = geofenceGeoJson as unknown as ProjectGeofence;
    try {
      const evalResult =
        geofence.mode === 'LINEAR_CORRIDOR'
          ? verifyLinearCorridorGeofence(
              { latitude: verified.latitude, longitude: verified.longitude },
              geofence
            )
          : verifyRadialGeofence(
              { latitude: verified.latitude, longitude: verified.longitude },
              geofence
            );

      verified = {
        ...verified,
        isWithinGeofence: evalResult.isWithinGeofence,
        chainageLabel:
          evalResult.chainageFormatted ?? verified.chainageLabel ?? null,
        distanceFromSiteMeters:
          evalResult.distanceFromCenterOrLineMeters ??
          verified.distanceFromSiteMeters ??
          null,
      };
    } catch {
      // Preserve client-supplied geotag fields if geofence evaluation fails
    }
  }

  return verified;
}

async function recordSubmissionTelemetry(params: {
  tx: Prisma.TransactionClient;
  projectId: string;
  reporterSessionId: string;
  reporterName: string;
  wbsItemId: string;
  wbsCode: string;
  reportId: string;
  geotag: SubmissionGeotag | null;
}) {
  if (!params.geotag) return;

  await params.tx.siteTelemetryPing.create({
    data: {
      projectId: params.projectId,
      fieldSessionId: params.reporterSessionId,
      wbsItemId: params.wbsItemId,
      latitude: params.geotag.latitude,
      longitude: params.geotag.longitude,
      accuracyMeters: params.geotag.accuracyMeters ?? null,
      altitudeMeters: params.geotag.altitudeMeters ?? null,
      isMocked: params.geotag.isMocked,
      isWithinGeofence: params.geotag.isWithinGeofence ?? null,
      chainageLabel: params.geotag.chainageLabel ?? null,
      distanceMeters: params.geotag.distanceFromSiteMeters ?? null,
      pingSource: 'REPORT_SUBMISSION',
      deviceSignatureHash:
        params.geotag.deviceSignatureHash || `eod-${params.reportId}`,
      capturedAtDevice: new Date(params.geotag.capturedAt),
    },
  });

  if (params.geotag.isMocked || params.geotag.isWithinGeofence === false) {
    await recordAuditEvent(params.tx, {
      projectId: params.projectId,
      actorType: 'FIELD_AGENT',
      actorId: params.reporterSessionId,
      actorDisplayName: params.reporterName,
      action: 'EVIDENCE_FLAGGED_INTEGRITY',
      summaryText: params.geotag.isMocked
        ? `EOD report for WBS ${params.wbsCode} flagged for mock GPS.`
        : `EOD report for WBS ${params.wbsCode} submitted outside project geofence.`,
      payload: {
        workdayReportId: params.reportId,
        wbsCode: params.wbsCode,
        latitude: params.geotag.latitude,
        longitude: params.geotag.longitude,
        distanceFromSiteMeters: params.geotag.distanceFromSiteMeters,
      },
    });
  }
}

function serializeWorkdayReport(r: {
  id: string;
  projectId: string;
  reporterSessionId: string;
  wbsItemId: string;
  workdayDate: string;
  status: string;
  revisionNumber: number;
  parentReportId: string | null;
  resolvedQueryId: string | null;
  summaryText: string;
  reportedQuantity: Prisma.Decimal | number;
  unitOfMeasure: string;
  isHoldPointClaimed: boolean;
  evidenceItems: unknown;
  voiceNoteUrl: string | null;
  submissionGeotag: unknown;
  aiParsedConfidence: number | null;
  aiReasoning: string | null;
  humanConfirmedAt: Date | null;
  createdAt: Date;
  boqItem: { wbsCode: string; description: string };
  reporterSession: { agentFullName: string; roleNameSnapshot: string };
  queries?: Array<Parameters<typeof serializeReportQuery>[0]>;
}) {
  return {
    id: r.id,
    projectId: r.projectId,
    reporterSessionId: r.reporterSessionId,
    reporterName: r.reporterSession.agentFullName,
    reporterTier: r.reporterSession.roleNameSnapshot,
    wbsItemId: r.wbsItemId,
    wbsCode: r.boqItem.wbsCode,
    wbsDescription: r.boqItem.description,
    workdayDate: r.workdayDate,
    status: r.status,
    revisionNumber: r.revisionNumber,
    parentReportId: r.parentReportId,
    resolvedQueryId: r.resolvedQueryId,
    summaryText: r.summaryText,
    reportedQuantity: Number(r.reportedQuantity),
    unitOfMeasure: r.unitOfMeasure,
    isHoldPointClaimed: r.isHoldPointClaimed,
    evidenceItems: r.evidenceItems,
    voiceNoteUrl: r.voiceNoteUrl,
    submissionGeotag: r.submissionGeotag,
    aiParsedConfidence: r.aiParsedConfidence,
    aiReasoning: r.aiReasoning,
    queries: r.queries ? r.queries.map(serializeReportQuery) : [],
    humanConfirmedAt: r.humanConfirmedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function submitWorkdayReportBundle(params: {
  projectId: string;
  reporterSessionId: string;
  input: SubmitWorkdayReportBundle;
}) {
  const [project, boqItem, morningBrief, existingCount] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, geofenceMode: true, geofenceGeoJson: true },
    }),
    prisma.boqItem.findFirst({
      where: { id: params.input.wbsItemId, projectId: params.projectId },
      select: {
        id: true,
        wbsCode: true,
        description: true,
        unit: true,
        isHoldPoint: true,
        holdPointInstruction: true,
      },
    }),
    prisma.morningDeliverableBrief.findFirst({
      where: {
        projectId: params.projectId,
        boqItemId: params.input.wbsItemId,
        workdayDate: params.input.workdayDate,
      },
      select: { reportingChecklist: true },
    }),
    prisma.workdayReport.count({
      where: {
        projectId: params.projectId,
        wbsItemId: params.input.wbsItemId,
        workdayDate: params.input.workdayDate,
      },
    }),
  ]);

  if (!project) {
    throw new AppError('Project not found', 404);
  }
  if (!boqItem) {
    throw new AppError('WBS / BOQ item not found for this project', 404);
  }

  const verifiedGeotag = await verifySubmissionGeotag(
    params.input.submissionGeotag,
    project.geofenceGeoJson
  );

  const checklist = Array.isArray(morningBrief?.reportingChecklist)
    ? (morningBrief.reportingChecklist as string[])
    : [];

  const omissionEval = await azureOpenAiService.evaluateWorkdayReportOmissions({
    wbsCode: boqItem.wbsCode,
    wbsDescription: boqItem.description,
    unit: params.input.unitOfMeasure || boqItem.unit,
    summaryText: params.input.summaryText,
    reportedQuantity: params.input.reportedQuantity,
    isHoldPoint: boqItem.isHoldPoint,
    holdPointInstruction: boqItem.holdPointInstruction,
    isHoldPointClaimed: params.input.isHoldPointClaimed,
    morningChecklist: checklist,
    evidenceItems: params.input.evidenceItems,
    voiceNoteUrl: params.input.voiceNoteUrl,
    delaysOrBlockers: params.input.delaysOrBlockers,
  });

  const createdReport = await prisma.$transaction(async (tx) => {
    const report = await tx.workdayReport.create({
      data: {
        projectId: params.projectId,
        reporterSessionId: params.reporterSessionId,
        wbsItemId: params.input.wbsItemId,
        workdayDate: params.input.workdayDate,
        status: 'CONFIRMED',
        revisionNumber: existingCount + 1,
        summaryText: params.input.summaryText,
        reportedQuantity: params.input.reportedQuantity,
        unitOfMeasure: params.input.unitOfMeasure,
        isHoldPointClaimed: params.input.isHoldPointClaimed,
        evidenceItems: params.input.evidenceItems as unknown as Prisma.InputJsonValue,
        voiceNoteUrl: params.input.voiceNoteUrl ?? null,
        submissionGeotag: verifiedGeotag
          ? (verifiedGeotag as unknown as Prisma.InputJsonValue)
          : undefined,
        aiParsedConfidence: omissionEval.aiConfidence,
        aiReasoning: omissionEval.aiReasoning,
        humanConfirmedAt: new Date(),
      },
      include: {
        boqItem: { select: { wbsCode: true, description: true } },
        reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
      },
    });

    await recordSubmissionTelemetry({
      tx,
      projectId: params.projectId,
      reporterSessionId: params.reporterSessionId,
      reporterName: report.reporterSession.agentFullName,
      wbsItemId: params.input.wbsItemId,
      wbsCode: report.boqItem.wbsCode,
      reportId: report.id,
      geotag: verifiedGeotag,
    });

    let raisedQuery: ReturnType<typeof serializeReportQuery> | null = null;
    if (
      omissionEval.hasUnexplainedOmission &&
      omissionEval.omissionPayload
    ) {
      raisedQuery = await dispatchReportQueryBundle(tx, {
        projectId: params.projectId,
        boqItemId: params.input.wbsItemId,
        wbsCode: report.boqItem.wbsCode,
        workdayReportId: report.id,
        fieldSessionId: params.reporterSessionId,
        source: 'AI_OMISSION_CHECK',
        aiOmissionPayload: omissionEval.omissionPayload,
      });
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'FIELD_AGENT',
      actorId: params.reporterSessionId,
      actorDisplayName: report.reporterSession.agentFullName,
      action: 'WORKDAY_REPORT_SUBMITTED',
      summaryText: `Submitted WBS ${report.boqItem.wbsCode} daily report Rev #${report.revisionNumber} (${params.input.reportedQuantity} ${params.input.unitOfMeasure}).`,
      payload: {
        workdayReportId: report.id,
        wbsCode: report.boqItem.wbsCode,
        revisionNumber: report.revisionNumber,
        aiOmissionTriggered: Boolean(raisedQuery),
      },
    });

    return {
      ...serializeWorkdayReport(report),
      queries: raisedQuery ? [raisedQuery] : [],
    };
  });

  return createdReport;
}

/**
 * Re-submits and AI-revalidates a queried Workday Report using the updated WBS chat history
 * (newly attached photos/voice/justifications) alongside the original Monitor/AI query context.
 */
export async function revalidateWorkdayReport(params: {
  projectId: string;
  reportId: string;
  reporterSessionId: string;
  input: RevalidateWorkdayReportRequest;
}) {
  const prevReport = await prisma.workdayReport.findFirst({
    where: { id: params.reportId, projectId: params.projectId },
    include: {
      boqItem: { select: { id: true, wbsCode: true, description: true, unit: true } },
      project: { select: { id: true, geofenceGeoJson: true } },
      reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
    },
  });

  // The reporter may only revalidate their own report.
  if (!prevReport || prevReport.reporterSessionId !== params.reporterSessionId) {
    throw new AppError('Original workday report not found for this project', 404, 'WORKDAY_REPORT_NOT_FOUND');
  }
  if (params.input.reportQueryId) {
    const query = await loadReportQueryInProject(prisma, params.projectId, params.input.reportQueryId);
    if (query.boqItemId !== prevReport.wbsItemId) {
      throw new AppError('Report query not found', 404, 'REPORT_QUERY_NOT_FOUND');
    }
  }

  // Locate the open query being addressed (either explicitly by reportQueryId or latest OPEN on this WBS/report)
  const targetQuery = await prisma.reportQuery.findFirst({
    where: params.input.reportQueryId
      ? { id: params.input.reportQueryId, projectId: params.projectId }
      : {
          projectId: params.projectId,
          boqItemId: prevReport.wbsItemId,
          status: 'OPEN',
        },
    orderBy: { createdAt: 'desc' },
  });

  const dbMessages = await prisma.wbsChatMessage.findMany({
    where: {
      projectId: params.projectId,
      boqItemId: prevReport.wbsItemId,
    },
    orderBy: { createdAt: 'asc' },
    take: 60,
  });

  const combinedChatHistory = [
    ...dbMessages.map((m) => ({
      senderName: m.senderName,
      senderRole: m.senderRole,
      messageType: m.messageType,
      textContent: m.textContent,
      caption: null,
    })),
    ...params.input.chatMessages.map((m) => ({
      senderName: m.senderName,
      senderRole: m.senderRole,
      messageType: m.messageType,
      textContent: m.textContent ?? null,
      caption: m.caption ?? null,
    })),
  ];

  const aiReval = await azureOpenAiService.reparseWorkdayChatAfterQuery({
    wbsCode: prevReport.boqItem.wbsCode,
    wbsDescription: prevReport.boqItem.description,
    unit: params.input.unitOfMeasure || prevReport.unitOfMeasure || prevReport.boqItem.unit,
    previousSummary: prevReport.summaryText,
    previousQuantity: Number(prevReport.reportedQuantity),
    originalQuery: {
      source: targetQuery?.source || 'MONITOR',
      monitorComment: targetQuery?.monitorComment ?? null,
      aiOmissionPayload:
        (targetQuery?.aiOmissionPayload as AiOmissionPayload | null) ?? null,
    },
    chatMessages: combinedChatHistory,
    newEvidenceCount: params.input.evidenceItems.length,
    overrideSummary: params.input.summaryText,
    overrideQuantity: params.input.reportedQuantity,
  });

  const verifiedGeotag = await verifySubmissionGeotag(
    params.input.submissionGeotag,
    prevReport.project.geofenceGeoJson
  );

  const prevEvidence = Array.isArray(prevReport.evidenceItems)
    ? (prevReport.evidenceItems as unknown[])
    : [];
  const mergedEvidence = [...prevEvidence, ...params.input.evidenceItems];

  const maxRevRow = await prisma.workdayReport.aggregate({
    where: {
      projectId: params.projectId,
      wbsItemId: prevReport.wbsItemId,
      workdayDate: prevReport.workdayDate,
    },
    _max: { revisionNumber: true },
  });
  const nextRevisionNumber = (maxRevRow._max.revisionNumber ?? prevReport.revisionNumber) + 1;

  return prisma.$transaction(async (tx) => {
    const newReport = await tx.workdayReport.create({
      data: {
        projectId: params.projectId,
        reporterSessionId: params.reporterSessionId,
        wbsItemId: prevReport.wbsItemId,
        workdayDate: prevReport.workdayDate,
        status: 'CONFIRMED',
        revisionNumber: nextRevisionNumber,
        parentReportId: prevReport.id,
        resolvedQueryId: targetQuery?.id ?? null,
        summaryText: aiReval.updatedSummary,
        reportedQuantity: aiReval.updatedQuantity,
        unitOfMeasure: params.input.unitOfMeasure || prevReport.unitOfMeasure,
        isHoldPointClaimed:
          params.input.isHoldPointClaimed ?? prevReport.isHoldPointClaimed,
        evidenceItems: mergedEvidence as unknown as Prisma.InputJsonValue,
        voiceNoteUrl: params.input.voiceNoteUrl ?? prevReport.voiceNoteUrl,
        submissionGeotag: verifiedGeotag
          ? (verifiedGeotag as unknown as Prisma.InputJsonValue)
          : (prevReport.submissionGeotag as Prisma.InputJsonValue | undefined),
        aiParsedConfidence: aiReval.aiConfidence,
        aiReasoning: aiReval.aiReasoning,
        humanConfirmedAt: new Date(),
      },
      include: {
        boqItem: { select: { wbsCode: true, description: true } },
        reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
      },
    });

    await recordSubmissionTelemetry({
      tx,
      projectId: params.projectId,
      reporterSessionId: params.reporterSessionId,
      reporterName: newReport.reporterSession.agentFullName,
      wbsItemId: prevReport.wbsItemId,
      wbsCode: prevReport.boqItem.wbsCode,
      reportId: newReport.id,
      geotag: verifiedGeotag,
    });

    await tx.wbsChatMessage.create({
      data: {
        projectId: params.projectId,
        boqItemId: prevReport.wbsItemId,
        workdayReportId: newReport.id,
        reportQueryId: targetQuery?.id ?? null,
        fieldSessionId: params.reporterSessionId,
        senderName: newReport.reporterSession.agentFullName,
        senderRole: 'ENGINEER',
        messageType: 'QUERY_RESPONSE',
        textContent: `Re-submitted Daily Report (Rev #${nextRevisionNumber}): ${aiReval.updatedSummary}`,
      },
    });

    // Update all matching open queries for this WBS / report
    await tx.reportQuery.updateMany({
      where: targetQuery
        ? { id: targetQuery.id }
        : {
            projectId: params.projectId,
            boqItemId: prevReport.wbsItemId,
            status: 'OPEN',
          },
      data: {
        status: 'RESUBMITTED',
        respondedAt: new Date(),
      },
    });

    // Resolve unread mobile REPORT_QUERY notifications for this WBS item
    await tx.mobileNotification.updateMany({
      where: {
        projectId: params.projectId,
        type: 'REPORT_QUERY',
        isRead: false,
        metadata: {
          path: ['wbsItemId'],
          equals: prevReport.wbsItemId,
        },
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Trigger a live Web Notification pointing directly to the Site Presence Drawer revision
    await createWebNotification(tx, {
      projectId: params.projectId,
      targetPermissionKey: 'reports:view_all',
      category: 'REPORT_RESUBMITTED',
      title: `Report Resubmitted · WBS ${prevReport.boqItem.wbsCode} (Rev #${nextRevisionNumber})`,
      description: `${newReport.reporterSession.agentFullName} resubmitted clarified evidence for WBS ${prevReport.boqItem.wbsCode} (${aiReval.updatedQuantity} ${newReport.unitOfMeasure}). AI re-evaluated updated thread.`,
      actionUrl: `/app/projects/${params.projectId}/audit?tab=presence&wbsItemId=${prevReport.wbsItemId}&reportId=${newReport.id}`,
      metadata: {
        wbsItemId: prevReport.wbsItemId,
        wbsCode: prevReport.boqItem.wbsCode,
        workdayReportId: newReport.id,
        parentReportId: prevReport.id,
        revisionNumber: nextRevisionNumber,
        reportQueryId: targetQuery?.id ?? null,
      },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'FIELD_AGENT',
      actorId: params.reporterSessionId,
      actorDisplayName: newReport.reporterSession.agentFullName,
      action: 'CONTRACTOR_QUERY_RESPONDED',
      summaryText: `Re-submitted WBS ${prevReport.boqItem.wbsCode} daily report (Rev #${nextRevisionNumber}) addressing query and triggering AI re-parse.`,
      payload: {
        workdayReportId: newReport.id,
        parentReportId: prevReport.id,
        revisionNumber: nextRevisionNumber,
        resolvedQueryId: targetQuery?.id ?? null,
      },
    });

    return serializeWorkdayReport(newReport);
  });
}

export async function listProjectWorkdayReports(params: {
  projectId: string;
  workdayDate?: string;
  reporterSessionId?: string;
}) {
  const where: Prisma.WorkdayReportWhereInput = { projectId: params.projectId };
  if (params.reporterSessionId) {
    where.reporterSessionId = params.reporterSessionId;
  }
  if (params.workdayDate) {
    where.workdayDate = params.workdayDate;
  }

  const rows = await prisma.workdayReport.findMany({
    where,
    include: {
      boqItem: { select: { wbsCode: true, description: true } },
      reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
      queries: {
        include: { raisedByUser: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { revisionNumber: 'desc' }],
    take: 150,
  });

  return rows.map(serializeWorkdayReport);
}
