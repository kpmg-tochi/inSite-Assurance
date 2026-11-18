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
  senderName: string;
  senderRole: string;
  messageType: string;
  textContent: string | null;
  mediaUrls: unknown;
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
    senderName: row.senderName,
    senderRole: row.senderRole,
    messageType: row.messageType as WbsChatMessageType,
    textContent: row.textContent,
    mediaUrls: Array.isArray(row.mediaUrls)
      ? (row.mediaUrls as string[])
      : [],
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

export async function listBoqChatMessages(params: {
  projectId: string;
  boqItemId: string;
}): Promise<WbsChatMessageDto[]> {
  const rows = await prisma.wbsChatMessage.findMany({
    where: {
      projectId: params.projectId,
      boqItemId: params.boqItemId,
    },
    include: {
      reportQuery: {
        include: {
          raisedByUser: { select: { fullName: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  return rows.map(serializeWbsChatMessage);
}

export async function postWbsChatMessage(params: {
  projectId: string;
  boqItemId: string;
  fieldSessionId?: string;
  senderName: string;
  senderRole: string;
  input: CreateWbsChatMessageRequest;
}): Promise<WbsChatMessageDto> {
  const boq = await prisma.boqItem.findFirst({
    where: { id: params.boqItemId, projectId: params.projectId },
    select: { id: true },
  });

  if (!boq) {
    throw new AppError('BOQ item not found in project', 404, 'BOQ_ITEM_NOT_FOUND');
  }
  // Linked report and query must belong to this project and this WBS item.
  if (params.input.workdayReportId) {
    const report = await loadWorkdayReportInProject(
      prisma,
      params.projectId,
      params.input.workdayReportId
    );
    if (report.wbsItemId !== params.boqItemId) {
      throw new AppError('Workday report not found', 404, 'WORKDAY_REPORT_NOT_FOUND');
    }
    if (params.fieldSessionId && report.reporterSessionId !== params.fieldSessionId) {
      throw new AppError('Workday report not found', 404, 'WORKDAY_REPORT_NOT_FOUND');
    }
  }
  if (params.input.reportQueryId) {
    const query = await loadReportQueryInProject(
      prisma,
      params.projectId,
      params.input.reportQueryId
    );
    if (query.boqItemId !== params.boqItemId) {
      throw new AppError('Report query not found', 404, 'REPORT_QUERY_NOT_FOUND');
    }
  }

  const created = await prisma.wbsChatMessage.create({
    data: {
      projectId: params.projectId,
      boqItemId: params.boqItemId,
      workdayReportId: params.input.workdayReportId ?? null,
      reportQueryId: params.input.reportQueryId ?? null,
      fieldSessionId: params.fieldSessionId ?? null,
      senderName: params.senderName,
      senderRole: params.senderRole,
      messageType: params.input.messageType,
      textContent: params.input.textContent ?? null,
      mediaUrls: params.input.mediaUrls as unknown as Prisma.InputJsonValue,
      latitude: params.input.latitude ?? null,
      longitude: params.input.longitude ?? null,
      chainageLabel: params.input.chainageLabel ?? null,
    },
    include: {
      reportQuery: {
        include: {
          raisedByUser: { select: { fullName: true } },
        },
      },
    },
  });

  return serializeWbsChatMessage(created);
}
