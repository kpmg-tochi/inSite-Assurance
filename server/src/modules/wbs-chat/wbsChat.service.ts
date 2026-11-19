import {
  AiOmissionPayload,
  CreateWbsChatMessageRequest,
  ReportQueryDto,
  ReportQuerySource,
  ReportQueryStatus,
  WbsChatMessageDto,
  WbsChatMessageType,
} from '@insite/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createMobileNotification } from '../notifications/notifications.service';
import { loadReportQueryInProject, loadWorkdayReportInProject } from '../../utils/ownership';

type PrismaTransactionOrClient = Prisma.TransactionClient | typeof prisma;

export function serializeReportQuery(row: {
  id: string;
  projectId: string;
  boqItemId: string;
  workdayReportId: string | null;
  ipcLineItemId: string | null;
  source: string;
  status: string;
  monitorComment: string | null;
  aiOmissionPayload: unknown;
  raisedByUserId: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  raisedByUser?: { fullName: string } | null;
}): ReportQueryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    boqItemId: row.boqItemId,
    workdayReportId: row.workdayReportId,
    ipcLineItemId: row.ipcLineItemId,
    source: row.source as ReportQuerySource,
    status: row.status as ReportQueryStatus,
    monitorComment: row.monitorComment,
    aiOmissionPayload:
      (row.aiOmissionPayload as AiOmissionPayload | null) ?? null,
    raisedByUserId: row.raisedByUserId,
    raisedByName: row.raisedByUser?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export function serializeWbsChatMessage(row: {
  id: string;
  projectId: string;
  boqItemId: string;
  workdayReportId: string | null;
  reportQueryId: string | null;
  fieldSessionId: string | null;
  clientMessageId: string | null;
  senderSessionId: string | null;
  senderUserId: string | null;
  senderName: string;
  senderRole: string;
  messageType: string;
  textContent: string | null;
  capture?: {
    clientCaptureId: string;
    mediaAttachments: Array<{ mediaType: string; objectKey: string; mimeType: string; durationSeconds: number | null }>;
  } | null;
  latitude: number | null;
  longitude: number | null;
  chainageLabel: string | null;
  createdAt: Date;
  reportQuery?: Parameters<typeof serializeReportQuery>[0] | null;
}): WbsChatMessageDto {
  return {
    id: row.id,
    projectId: row.projectId,
    boqItemId: row.boqItemId,
    workdayReportId: row.workdayReportId,
    reportQueryId: row.reportQueryId,
    fieldSessionId: row.fieldSessionId,
    clientMessageId: row.clientMessageId,
    senderSessionId: row.senderSessionId,
    senderUserId: row.senderUserId,
    senderName: row.senderName,
    senderRole: row.senderRole,
    messageType: row.messageType as WbsChatMessageType,
    textContent: row.textContent,
    capture:
      row.capture && row.capture.mediaAttachments[0]
        ? {
            clientCaptureId: row.capture.clientCaptureId,
            mediaType: row.capture.mediaAttachments[0].mediaType,
            objectKey: row.capture.mediaAttachments[0].objectKey,
            mimeType: row.capture.mediaAttachments[0].mimeType,
            durationSeconds: row.capture.mediaAttachments[0].durationSeconds,
          }
        : null,
    latitude: row.latitude,
    longitude: row.longitude,
    chainageLabel: row.chainageLabel,
    queryDetails: row.reportQuery
      ? serializeReportQuery(row.reportQuery)
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Shared transactional helper that persists a ReportQuery (Monitor or AI omission check),
 * appends a WBS chat message so it appears inline on Mobile, and emits a REPORT_QUERY notification.
 */
export async function dispatchReportQueryBundle(
  tx: PrismaTransactionOrClient,
  params: {
    projectId: string;
    boqItemId: string;
    wbsCode: string;
    workdayReportId?: string | null;
    ipcLineItemId?: string | null;
    fieldSessionId?: string | null;
    source: ReportQuerySource;
    monitorComment?: string | null;
    aiOmissionPayload?: AiOmissionPayload | null;
    raisedByUserId?: string | null;
    raisedByName?: string;
    requestedProofTypes?: string[];
  }
) {
  const query = await tx.reportQuery.create({
    data: {
      projectId: params.projectId,
      boqItemId: params.boqItemId,
      workdayReportId: params.workdayReportId ?? null,
      ipcLineItemId: params.ipcLineItemId ?? null,
      raisedByUserId: params.raisedByUserId ?? null,
      source: params.source,
      status: 'OPEN',
      monitorComment: params.monitorComment ?? null,
      aiOmissionPayload: params.aiOmissionPayload
        ? (params.aiOmissionPayload as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
    include: {
      raisedByUser: { select: { fullName: true } },
    },
  });

  const messageText =
    params.source === 'MONITOR'
      ? params.monitorComment || 'Clarification requested by Monitor.'
      : params.aiOmissionPayload?.clarificationQuestion ||
        'Required evidence was omitted without an explanation.';

  await tx.wbsChatMessage.create({
    data: {
      projectId: params.projectId,
      boqItemId: params.boqItemId,
      workdayReportId: params.workdayReportId ?? null,
      reportQueryId: query.id,
      fieldSessionId: params.fieldSessionId ?? null,
      senderUserId: params.source === 'MONITOR' ? params.raisedByUserId ?? null : null,
      senderName:
        params.source === 'MONITOR'
          ? params.raisedByName || 'Independent Monitor'
          : 'inSite AI Co-Pilot',
      senderRole: params.source === 'MONITOR' ? 'MONITOR' : 'AI_CO_PILOT',
      messageType: params.source === 'MONITOR' ? 'MONITOR_QUERY' : 'AI_QUERY',
      textContent: messageText,
    },
  });

  await createMobileNotification(tx, {
    projectId: params.projectId,
    fieldSessionId: params.fieldSessionId ?? null,
    type: 'REPORT_QUERY',
    actionType: 'OPEN_WBS_CHAT',
    requiresAction: true,
    title:
      params.source === 'MONITOR'
        ? `Monitor Query · WBS ${params.wbsCode}`
        : `Missing Evidence Query · WBS ${params.wbsCode}`,
    message:
      params.source === 'MONITOR'
        ? `${params.raisedByName || 'Independent Monitor'}: ${messageText}`
        : messageText,
    metadata: {
      wbsItemId: params.boqItemId,
      wbsCode: params.wbsCode,
      workdayReportId: params.workdayReportId ?? undefined,
      reportQueryId: query.id,
      querySource: params.source,
      aiOmissionPayload:
        (params.aiOmissionPayload as unknown as Record<string, unknown>) ??
        undefined,
      requestedProofTypes: params.requestedProofTypes,
    },
  });

  return serializeReportQuery(query);
}

/**
 * Monitor raises a clarification query from the Web Workday Report Summary Drawer.
 */
export async function createWorkdayReportQuery(params: {
  projectId: string;
  reportId: string;
  webUser: WebJwtPayload;
  queryText: string;
}): Promise<ReportQueryDto> {
  const report = await prisma.workdayReport.findFirst({
    where: { id: params.reportId, projectId: params.projectId },
    include: {
      boqItem: { select: { id: true, wbsCode: true } },
    },
  });

  if (!report) {
    throw new AppError('Workday report not found for this project', 404);
  }

  return prisma.$transaction(async (tx) => {
    const createdQuery = await dispatchReportQueryBundle(tx, {
      projectId: params.projectId,
      boqItemId: report.wbsItemId,
      wbsCode: report.boqItem.wbsCode,
      workdayReportId: report.id,
      fieldSessionId: report.reporterSessionId,
      source: 'MONITOR',
      monitorComment: params.queryText,
      raisedByUserId: params.webUser.userId,
      raisedByName: params.webUser.fullName,
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'MONITOR_QUERY_RAISED',
      summaryText: `${params.webUser.roleName} queried daily report WBS ${report.boqItem.wbsCode} (Rev #${report.revisionNumber}): "${params.queryText}"`,
      payload: {
        workdayReportId: report.id,
        reportQueryId: createdQuery.id,
        wbsCode: report.boqItem.wbsCode,
      },
    });

    return createdQuery;
  });
}

const MESSAGE_INCLUDE = {
  reportQuery: { include: { raisedByUser: { select: { fullName: true } } } },
  capture: {
    select: {
      clientCaptureId: true,
      mediaAttachments: { select: { mediaType: true, objectKey: true, mimeType: true, durationSeconds: true } },
    },
  },
} satisfies Prisma.WbsChatMessageInclude;

export async function listBoqChatMessages(params: {
  projectId: string;
  boqItemId: string;
}): Promise<WbsChatMessageDto[]> {
  const rows = await prisma.wbsChatMessage.findMany({
    where: { projectId: params.projectId, boqItemId: params.boqItemId },
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map(serializeWbsChatMessage);
}

/**
 * Appends a message to a WBS thread. Idempotent on clientMessageId (required from devices). Media
 * is referenced by a registered capture; URLs, file paths and data URIs are never accepted.
 */
export async function postWbsChatMessage(params: {
  projectId: string;
  boqItemId: string;
  fieldSessionId?: string;
  senderUserId?: string;
  senderName: string;
  senderRole: string;
  input: CreateWbsChatMessageRequest;
}): Promise<{ message: WbsChatMessageDto; created: boolean }> {
  const { input } = params;
  if (params.fieldSessionId && !input.clientMessageId) {
    throw new AppError('clientMessageId is required', 400, 'CLIENT_MESSAGE_ID_REQUIRED');
  }
  if (input.clientMessageId) {
    const existing = await prisma.wbsChatMessage.findUnique({
      where: { clientMessageId: input.clientMessageId },
      include: MESSAGE_INCLUDE,
    });
    if (existing) {
      const sameSender =
        (params.fieldSessionId && existing.senderSessionId === params.fieldSessionId) ||
        (params.senderUserId && existing.senderUserId === params.senderUserId);
      if (!sameSender) {
        throw new AppError('This message ID is already in use', 409, 'MESSAGE_ID_CONFLICT');
      }
      return { message: serializeWbsChatMessage(existing), created: false };
    }
  }

  const boq = await prisma.boqItem.findFirst({
    where: { id: params.boqItemId, projectId: params.projectId },
    select: { id: true },
  });
  if (!boq) {
    throw new AppError('BOQ item not found in project', 404, 'BOQ_ITEM_NOT_FOUND');
  }
  // Linked report and query must belong to this project and this WBS item.
  if (input.workdayReportId) {
    const report = await loadWorkdayReportInProject(prisma, params.projectId, input.workdayReportId);
    if (report.wbsItemId !== params.boqItemId) {
      throw new AppError('Workday report not found', 404, 'WORKDAY_REPORT_NOT_FOUND');
    }
    if (params.fieldSessionId && report.reporterSessionId !== params.fieldSessionId) {
      throw new AppError('Workday report not found', 404, 'WORKDAY_REPORT_NOT_FOUND');
    }
  }
  if (input.reportQueryId) {
    const query = await loadReportQueryInProject(prisma, params.projectId, input.reportQueryId);
    if (query.boqItemId !== params.boqItemId) {
      throw new AppError('Report query not found', 404, 'REPORT_QUERY_NOT_FOUND');
    }
  }

  let captureId: string | null = null;
  let location: { latitude: number | null; longitude: number | null; chainageLabel: string | null } = {
    latitude: null,
    longitude: null,
    chainageLabel: null,
  };
  if (input.captureId) {
    const capture = await prisma.fieldEvidenceLog.findUnique({
      where: { clientCaptureId: input.captureId },
      select: { id: true, projectId: true, fieldSessionId: true, boqItemId: true, latitude: true, longitude: true, chainageLabel: true },
    });
    if (!capture) {
      throw new AppError('Register the capture before posting it', 409, 'CAPTURES_NOT_REGISTERED', {
        missingClientCaptureIds: [input.captureId],
      });
    }
    if (
      capture.projectId !== params.projectId ||
      (params.fieldSessionId && capture.fieldSessionId !== params.fieldSessionId) ||
      (capture.boqItemId && capture.boqItemId !== params.boqItemId)
    ) {
      throw new AppError('Capture not found', 404, 'CAPTURE_NOT_FOUND');
    }
    captureId = capture.id;
    location = { latitude: capture.latitude, longitude: capture.longitude, chainageLabel: capture.chainageLabel };
  } else if (input.messageType === 'PHOTO' || input.messageType === 'VOICE_NOTE') {
    throw new AppError('Photo and voice messages must reference a registered capture', 400, 'CAPTURE_REQUIRED');
  }

  try {
    const created = await prisma.wbsChatMessage.create({
      data: {
        projectId: params.projectId,
        boqItemId: params.boqItemId,
        workdayReportId: input.workdayReportId ?? null,
        reportQueryId: input.reportQueryId ?? null,
        fieldSessionId: params.fieldSessionId ?? null,
        clientMessageId: input.clientMessageId ?? null,
        senderSessionId: params.fieldSessionId ?? null,
        senderUserId: params.senderUserId ?? null,
        captureId,
        senderName: params.senderName,
        senderRole: params.senderRole,
        messageType: input.messageType,
        textContent: input.textContent ?? null,
        // Location shown on a media message is the capture's server-evaluated location only.
        latitude: location.latitude,
        longitude: location.longitude,
        chainageLabel: location.chainageLabel,
      },
      include: MESSAGE_INCLUDE,
    });
    return { message: serializeWbsChatMessage(created), created: true };
  } catch (error) {
    if (
      input.clientMessageId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.wbsChatMessage.findUniqueOrThrow({
        where: { clientMessageId: input.clientMessageId },
        include: MESSAGE_INCLUDE,
      });
      return { message: serializeWbsChatMessage(existing), created: false };
    }
    throw error;
  }
}
