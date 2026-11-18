import { Prisma } from '@prisma/client';
import {
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  EvidenceStrengthRating,
  FieldPersonaType,
  LenderTrancheDecisionRequest,
  PortfolioHealth,
  RespondMonitorQueryRequest,
  SubmitIpcClaimRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { generateValuationReportPdfBuffer } from '../../integrations/pdf-report.service';
import { assertProjectObjectKey } from '../../integrations/storage.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createMobileNotification } from '../notifications/notifications.service';
import {
  loadBoqItemInProject,
  loadIpcInProject,
  loadLineItemInIpc,
  loadQueryInIpc,
  loadTrancheInProject,
  loadValuationReportInProject,
} from '../../utils/ownership';
import {
  canSeeFieldSessionDetail,
  serializeBoqItem,
  serializeEvidenceLog,
  serializeMonitorQuery,
  serializeSupportingDocument,
  serializeTranche,
  serializeTrancheDecision,
  serializeValuationReport,
} from '../../utils/serializers';

/**
 * Oversight roles see AI rationale, the visit-planner queue and the corroborating field evidence.
 * Everyone else (for example a contractor answering a query) sees their claim, the rating and
 * the queries, but not other parties' evidence detail.
 */
function canSeeOversightDetail(webUser: WebJwtPayload) {
  return hasWebPermission(
    webUser,
    'ipc:trigger_ai_reconcile',
    'ipc:certify_valuation',
    'tranche:approve_disbursement',
    'audit:view_ledger'
  );
}

const IPC_BASE_INCLUDE = {
  tranche: { include: { conditionsPrecedent: true } },
  supportingDocuments: true,
  valuationReport: { include: { trancheDecision: true } },
} satisfies Prisma.IpcClaimInclude;

function ipcDetailInclude(withEvidence: boolean) {
  return {
    ...IPC_BASE_INCLUDE,
    lineItems: {
      orderBy: { boqItem: { wbsCode: 'asc' } },
      include: {
        queries: { orderBy: { createdAt: 'desc' } },
        boqItem: withEvidence
          ? {
              include: {
                evidenceLogs: {
                  where: { status: 'CONFIRMED' },
                  orderBy: { capturedAtDevice: 'desc' },
                  include: { mediaAttachments: true, fieldSession: true },
                },
              },
            }
          : true,
      },
    },
  } satisfies Prisma.IpcClaimInclude;
}

type IpcWithDetail = Prisma.IpcClaimGetPayload<{ include: ReturnType<typeof ipcDetailInclude> }>;

function serializeIpc(ipc: IpcWithDetail, webUser: WebJwtPayload) {
  const oversight = canSeeOversightDetail(webUser);
  const detailedSessions = canSeeFieldSessionDetail(webUser);

  const lineItems = ipc.lineItems.map((li) => {
    const boq = li.boqItem as typeof li.boqItem & {
      evidenceLogs?: Parameters<typeof serializeEvidenceLog>[0][];
    };
    return {
      id: li.id,
      ipcClaimId: li.ipcClaimId,
      boqItemId: li.boqItemId,
      previousCertifiedPct: Number(li.previousCertifiedPct),
      contractorClaimedPct: Number(li.contractorClaimedPct),
      contractorClaimedNgn: Number(li.contractorClaimedNgn),
      contractorRemarks: li.contractorRemarks,
      aiEvidenceRating: li.aiEvidenceRating,
      aiRationale: oversight ? li.aiRationale : null,
      visitPlannerFlag: oversight ? li.visitPlannerFlag : false,
      visitPlannerReason: oversight ? li.visitPlannerReason : null,
      missingHoldPointFlag: li.missingHoldPointFlag,
      highestCorroboratingRoleName: li.highestCorroboratingRoleName,
      highestCorroboratingWeight: li.highestCorroboratingWeight,
      corroboratingEvidenceLogIds: oversight
        ? ((li.corroboratingEvidenceLogIds as string[]) ?? [])
        : [],
      monitorCertifiedPct: li.monitorCertifiedPct ? Number(li.monitorCertifiedPct) : null,
      monitorCertifiedNgn: li.monitorCertifiedNgn ? Number(li.monitorCertifiedNgn) : null,
      monitorRemarks: li.monitorRemarks,
      boqItem: {
        ...serializeBoqItem(boq),
        ...(oversight && boq.evidenceLogs
          ? { evidenceLogs: boq.evidenceLogs.map((log) => serializeEvidenceLog(log, { detailedSessions })) }
          : {}),
      },
      queries: li.queries.map(serializeMonitorQuery),
    };
  });

  const smartVisitPlannerQueue = !oversight
    ? []
    : lineItems
        .filter((li) => li.visitPlannerFlag || li.missingHoldPointFlag)
        .map((li) => ({
          ipcLineItemId: li.id,
          wbsCode: li.boqItem.wbsCode,
          description: li.boqItem.description,
          claimedAmountNgn: li.contractorClaimedNgn,
          aiEvidenceRating: li.aiEvidenceRating,
          missingHoldPointFlag: li.missingHoldPointFlag,
          visitPlannerReason:
            li.visitPlannerReason || 'Requires physical verification by Independent Monitor.',
        }));

  return {
    id: ipc.id,
    projectId: ipc.projectId,
    trancheId: ipc.trancheId,
    ipcNumber: ipc.ipcNumber,
    periodStart: ipc.periodStart.toISOString(),
    periodEnd: ipc.periodEnd.toISOString(),
    contractorCoverNote: ipc.contractorCoverNote,
    totalClaimedAmountNgn: Number(ipc.totalClaimedAmountNgn),
    totalCertifiedNgn: ipc.totalCertifiedNgn ? Number(ipc.totalCertifiedNgn) : null,
    status: ipc.status,
    aiExecutiveSummary: oversight ? ipc.aiExecutiveSummary : null,
    submittedAt: ipc.submittedAt.toISOString(),
    updatedAt: ipc.updatedAt.toISOString(),
    tranche: serializeTranche(ipc.tranche),
    supportingDocuments: ipc.supportingDocuments.map(serializeSupportingDocument),
    valuationReport: ipc.valuationReport ? serializeValuationReport(ipc.valuationReport) : null,
    lineItems,
    smartVisitPlannerQueue,
  };
}

export async function listProjectIpcClaims(projectId: string, webUser: WebJwtPayload) {
  const ipcs = await prisma.ipcClaim.findMany({
    where: { projectId },
    orderBy: { ipcNumber: 'desc' },
    include: ipcDetailInclude(false),
  });
  return ipcs.map((ipc) => serializeIpc(ipc, webUser));
}

export async function getIpcReconciliationDetails(
  projectId: string,
  ipcId: string,
  webUser: WebJwtPayload
) {
  await loadIpcInProject(prisma, projectId, ipcId);
  const ipc = await prisma.ipcClaim.findUniqueOrThrow({
    where: { id: ipcId },
    include: ipcDetailInclude(canSeeOversightDetail(webUser)),
  });
  return serializeIpc(ipc, webUser);
}

export async function runAiReconciliationForIpc(
  projectId: string,
  ipcId: string
) {
  const ipc = await prisma.ipcClaim.findFirst({
    where: { id: ipcId, projectId },
    include: {
      project: true,
      lineItems: {
        include: {
          boqItem: {
            include: {
              evidenceLogs: {
                where: { status: 'CONFIRMED' },
              },
            },
          },
        },
      },
    },
  });

  if (!ipc) {
    throw new AppError('IPC Claim not found', 404, 'IPC_NOT_FOUND');
  }

  const aiResult = await azureOpenAiService.reconcileIpcLineItems({
    projectName: ipc.project.name,
    ipcNumber: ipc.ipcNumber,
    lineClaims: ipc.lineItems.map((li) => ({
      boqItemId: li.boqItemId,
      wbsCode: li.boqItem.wbsCode,
      description: li.boqItem.description,
      unit: li.boqItem.unit,
      totalQuantity: Number(li.boqItem.totalQuantity),
      budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
      isHoldPoint: li.boqItem.isHoldPoint,
      isOpaqueLumpSum: li.boqItem.isOpaqueLumpSum,
      previousCertifiedPct: Number(li.previousCertifiedPct),
      contractorClaimedPct: Number(li.contractorClaimedPct),
      contractorClaimedNgn: Number(li.contractorClaimedNgn),
      confirmedLogs: li.boqItem.evidenceLogs.map((log) => ({
        id: log.id,
        reporterRoleName: log.reporterRoleName,
        fieldPersonaType: log.fieldPersonaType as FieldPersonaType,
        assuranceWeight: log.assuranceWeight,
        isWithinGeofence: log.isWithinGeofence,
        chainageLabel: log.chainageLabel,
        confirmedSummary: log.confirmedSummary,
        confirmedQuantities: log.confirmedQuantities,
        siteBlockers: log.siteBlockers,
      })),
    })),
  });

  const evalByBoqId = new Map(
    aiResult.lineEvaluations.map((e) => [e.boqItemId, e])
  );

  return prisma.$transaction(async (tx) => {
    const ratings: EvidenceStrengthRating[] = [];

    for (const li of ipc.lineItems) {
      const ev = evalByBoqId.get(li.boqItemId);
      if (!ev) continue;

      ratings.push(ev.evidenceStrengthRating);

      await tx.ipcLineItem.update({
        where: { id: li.id },
        data: {
          aiEvidenceRating: ev.evidenceStrengthRating,
          aiRationale: ev.aiRationale,
          visitPlannerFlag: ev.visitPlannerFlag,
          visitPlannerReason: ev.visitPlannerReason,
          missingHoldPointFlag: ev.missingHoldPointFlag,
          highestCorroboratingRoleName: ev.highestCorroboratingRoleName,
          highestCorroboratingWeight: ev.highestCorroboratingWeight,
          corroboratingEvidenceLogIds:
            ev.corroboratingEvidenceLogIds as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const updatedIpc = await tx.ipcClaim.update({
      where: { id: ipc.id },
      data: {
        status: 'AI_RECONCILED',
        aiExecutiveSummary: aiResult.executiveSummaryNote,
      },
    });

    // Update Project Geospatial Portfolio Health Pin
    let nextHealth: PortfolioHealth = 'EVIDENCE_SUPPORTED';
    if (
      ratings.includes('CONTRADICTED') ||
      ratings.includes('UNSUPPORTED')
    ) {
      nextHealth = 'EVIDENCE_CONFLICT';
    } else if (ratings.includes('PARTIALLY_SUPPORTED')) {
      nextHealth = 'EVIDENCE_PARTIAL';
    }

    await tx.project.update({
      where: { id: projectId },
      data: { portfolioHealth: nextHealth },
    });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'AI_SYSTEM',
      actorId: 'AZURE-GPT4O-RECONCILER',
      actorDisplayName: 'inSite AI Reconciliation Co-Pilot',
      action: 'AI_RECONCILIATION_COMPLETED',
      summaryText: aiResult.executiveSummaryNote,
      payload: {
        ipcId: ipc.id,
        ipcNumber: ipc.ipcNumber,
        portfolioHealth: nextHealth,
      },
    });

    return updatedIpc;
  });
}

export async function submitContractorIpcClaim(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: SubmitIpcClaimRequest;
}) {
  await loadTrancheInProject(prisma, params.projectId, params.input.trancheId);
  for (const doc of params.input.supportingDocuments) {
    assertProjectObjectKey(doc.objectKey, params.webUser.tenantId, params.projectId);
    if (doc.boqItemId) {
      await loadBoqItemInProject(prisma, params.projectId, doc.boqItemId);
    }
  }

  const boqItems = await prisma.boqItem.findMany({
    where: { projectId: params.projectId },
  });
  const boqById = new Map(boqItems.map((b) => [b.id, b]));

  let totalClaimedAmountNgn = 0;
  const preparedLines = params.input.lineItems.map((line) => {
    const boq = boqById.get(line.boqItemId);
    if (!boq) {
      throw new AppError(
        `BOQ Item ${line.boqItemId} does not belong to this project`,
        400,
        'INVALID_BOQ_ITEM'
      );
    }

    const prevPct = Number(boq.cumulativeCertifiedPct);
    const deltaPct = Math.max(0, line.claimedCumulativePct - prevPct);
    const claimedNgn = (deltaPct / 100) * Number(boq.budgetedCostNgn);
    totalClaimedAmountNgn += claimedNgn;

    return {
      boqItemId: boq.id,
      previousCertifiedPct: prevPct,
      contractorClaimedPct: line.claimedCumulativePct,
      contractorClaimedNgn: Number(claimedNgn.toFixed(2)),
      contractorRemarks: line.contractorRemarks ?? null,
    };
  });

  const createdIpc = await prisma.$transaction(async (tx) => {
    const ipc = await tx.ipcClaim.create({
      data: {
        projectId: params.projectId,
        trancheId: params.input.trancheId,
        ipcNumber: params.input.ipcNumber,
        periodStart: new Date(params.input.periodStart),
        periodEnd: new Date(params.input.periodEnd),
        contractorCoverNote: params.input.contractorCoverNote ?? null,
        totalClaimedAmountNgn: Number(totalClaimedAmountNgn.toFixed(2)),
        status: 'SUBMITTED',
        lineItems: {
          create: preparedLines,
        },
        supportingDocuments: {
          create: params.input.supportingDocuments.map((doc) => ({
            title: doc.title,
            mediaType: doc.mediaType,
            objectKey: doc.objectKey,
            boqItemId: doc.boqItemId ?? null,
          })),
        },
      },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'IPC_SUBMITTED',
      summaryText: `Contractor submitted IPC #${params.input.ipcNumber} claiming NGN ${totalClaimedAmountNgn.toLocaleString()} across ${preparedLines.length} BOQ line items.`,
      payload: {
        ipcId: ipc.id,
        ipcNumber: ipc.ipcNumber,
        totalClaimedAmountNgn,
      },
    });

    return ipc;
  });

  // Immediately run AI Reconciliation Engine on the new IPC Claim
  await runAiReconciliationForIpc(params.projectId, createdIpc.id);

  return getIpcReconciliationDetails(
    params.projectId,
    createdIpc.id,
    params.webUser
  );
}

export async function createMonitorLineQuery(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: CreateMonitorQueryRequest;
}) {
  return prisma.$transaction(async (tx) => {
    await loadIpcInProject(tx, params.projectId, params.ipcId);
    await loadLineItemInIpc(tx, params.ipcId, params.input.ipcLineItemId);

    const query = await tx.monitorQuery.create({
      data: {
        ipcLineItemId: params.input.ipcLineItemId,
        status: 'OPEN',
        queryReason: params.input.queryReason,
        requestedProofTypes:
          params.input.requestedProofTypes as unknown as Prisma.InputJsonValue,
      },
      include: {
        ipcLineItem: { include: { boqItem: true } },
      },
    });

    await tx.ipcClaim.update({
      where: { id: params.ipcId },
      data: { status: 'QUERIED_BY_MONITOR' },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'MONITOR_QUERY_RAISED',
      summaryText: `Monitor raised query on [${query.ipcLineItem.boqItem.wbsCode}]: "${params.input.queryReason}"`,
      payload: {
        queryId: query.id,
        ipcLineItemId: params.input.ipcLineItemId,
      },
    });

    await createMobileNotification(tx, {
      projectId: params.projectId,
      type: 'REPORT_QUERY',
      actionType: 'OPEN_WBS_CHAT',
      requiresAction: true,
      title: `Clarification Requested · WBS ${query.ipcLineItem.boqItem.wbsCode}`,
      message: `${params.webUser.fullName}: ${params.input.queryReason}`,
      metadata: {
        monitorQueryId: query.id,
        wbsItemId: query.ipcLineItem.boqItemId,
        wbsCode: query.ipcLineItem.boqItem.wbsCode,
        requestedProofTypes: params.input.requestedProofTypes,
      },
    });

    await tx.wbsChatMessage.create({
      data: {
        projectId: params.projectId,
        boqItemId: query.ipcLineItem.boqItemId,
        senderName: params.webUser.fullName,
        senderRole: 'MONITOR',
        messageType: 'MONITOR_QUERY',
        textContent: params.input.queryReason,
      },
    });

    return serializeMonitorQuery(query);
  });
}

export async function respondToMonitorLineQuery(params: {
  projectId: string;
  ipcId: string;
  queryId: string;
  webUser: WebJwtPayload;
  input: RespondMonitorQueryRequest;
}) {
  return prisma.$transaction(async (tx) => {
    await loadIpcInProject(tx, params.projectId, params.ipcId);
    await loadQueryInIpc(tx, params.ipcId, params.queryId);

    const updatedQuery = await tx.monitorQuery.update({
      where: { id: params.queryId },
      data: {
        status: 'RESPONDED',
        contractorResponseText: params.input.contractorResponseText,
        revisedClaimedCumulativePct:
          params.input.revisedClaimedCumulativePct ?? null,
        attachedDocumentsJson:
          params.input.attachedDocuments as unknown as Prisma.InputJsonValue,
        respondedAt: new Date(),
      },
      include: {
        ipcLineItem: { include: { boqItem: true } },
      },
    });

    if (params.input.revisedClaimedCumulativePct !== undefined) {
      const boq = updatedQuery.ipcLineItem.boqItem;
      const prevPct = Number(updatedQuery.ipcLineItem.previousCertifiedPct);
      const deltaPct = Math.max(
        0,
        params.input.revisedClaimedCumulativePct - prevPct
      );
      const revisedNgn = (deltaPct / 100) * Number(boq.budgetedCostNgn);

      await tx.ipcLineItem.update({
        where: { id: updatedQuery.ipcLineItemId },
        data: {
          contractorClaimedPct: params.input.revisedClaimedCumulativePct,
          contractorClaimedNgn: Number(revisedNgn.toFixed(2)),
        },
      });
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'CONTRACTOR_QUERY_RESPONDED',
      summaryText: `Contractor responded to Monitor query on [${updatedQuery.ipcLineItem.boqItem.wbsCode}].`,
      payload: {
        queryId: updatedQuery.id,
        revisedClaimedCumulativePct: params.input.revisedClaimedCumulativePct,
      },
    });

    return serializeMonitorQuery(updatedQuery);
  });
}

export async function certifyIpcValuationByMonitor(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: CertifyIpcValuationRequest;
}) {
  return prisma.$transaction(async (tx) => {
    await loadIpcInProject(tx, params.projectId, params.ipcId);
    for (const val of params.input.lineValuations) {
      await loadLineItemInIpc(tx, params.ipcId, val.ipcLineItemId);
    }

    let totalCertifiedNgn = 0;

    for (const val of params.input.lineValuations) {
      totalCertifiedNgn += val.monitorCertifiedAmountNgn;
      const updatedLine = await tx.ipcLineItem.update({
        where: { id: val.ipcLineItemId },
        data: {
          monitorCertifiedPct: val.monitorCertifiedCumulativePct,
          monitorCertifiedNgn: val.monitorCertifiedAmountNgn,
          monitorRemarks: val.monitorRemarks ?? null,
        },
      });

      await tx.boqItem.update({
        where: { id: updatedLine.boqItemId },
        data: {
          cumulativeCertifiedPct: val.monitorCertifiedCumulativePct,
        },
      });
    }

    const report = await tx.valuationReport.upsert({
      where: { ipcClaimId: params.ipcId },
      create: {
        ipcClaimId: params.ipcId,
        certifiedByUserId: params.webUser.userId,
        trancheRecommendation: params.input.trancheRecommendation,
        recommendedReleaseAmountNgn: params.input.recommendedReleaseAmountNgn,
        recommendedHoldbackAmountNgn: params.input.recommendedHoldbackAmountNgn,
        executiveCertificationSummary:
          params.input.executiveCertificationSummary,
        certifierFullName: params.input.certifierFullName,
        certifierLicenseType: params.input.certifierLicenseType,
        certifierLicenseNumber: params.input.certifierLicenseNumber,
        reportPdfUrl: `/api/v1/projects/${params.projectId}/ipcs/${params.ipcId}/valuation-report.pdf`,
      },
      update: {
        certifiedByUserId: params.webUser.userId,
        trancheRecommendation: params.input.trancheRecommendation,
        recommendedReleaseAmountNgn: params.input.recommendedReleaseAmountNgn,
        recommendedHoldbackAmountNgn: params.input.recommendedHoldbackAmountNgn,
        executiveCertificationSummary:
          params.input.executiveCertificationSummary,
        certifierFullName: params.input.certifierFullName,
        certifierLicenseType: params.input.certifierLicenseType,
        certifierLicenseNumber: params.input.certifierLicenseNumber,
        certifiedAt: new Date(),
      },
    });

    await tx.ipcClaim.update({
      where: { id: params.ipcId },
      data: {
        totalCertifiedNgn,
        status: 'MONITOR_CERTIFIED',
      },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.input.certifierFullName} (${params.input.certifierLicenseType} #${params.input.certifierLicenseNumber})`,
      action: 'VALUATION_REPORT_CERTIFIED',
      summaryText: `Certified Valuation Report for IPC (${params.input.trancheRecommendation}): Recommended Release NGN ${params.input.recommendedReleaseAmountNgn.toLocaleString()}, Holdback NGN ${params.input.recommendedHoldbackAmountNgn.toLocaleString()}.`,
      payload: {
        valuationReportId: report.id,
        trancheRecommendation: params.input.trancheRecommendation,
        recommendedReleaseAmountNgn: params.input.recommendedReleaseAmountNgn,
        recommendedHoldbackAmountNgn: params.input.recommendedHoldbackAmountNgn,
        certifierLicenseType: params.input.certifierLicenseType,
        certifierLicenseNumber: params.input.certifierLicenseNumber,
      },
    });

    return serializeValuationReport(report);
  });
}

export async function generateIpcValuationPdf(
  projectId: string,
  ipcId: string
): Promise<Buffer> {
  const ipc = await prisma.ipcClaim.findFirst({
    where: { id: ipcId, projectId },
    include: {
      project: {
        include: {
          tenant: true,
          monitorOrganization: true,
          lenderOrganization: true,
          contractorOrganization: true,
        },
      },
      tranche: true,
      valuationReport: true,
      lineItems: {
        include: { boqItem: true },
        orderBy: { boqItem: { wbsCode: 'asc' } },
      },
    },
  });

  if (!ipc) {
    throw new AppError('IPC Claim not found', 404, 'IPC_NOT_FOUND');
  }

  const report = ipc.valuationReport;
  const branding = parseTenantBranding(ipc.project.tenant.brandingConfig);

  return generateValuationReportPdfBuffer({
    tenantName: ipc.project.tenant.name,
    pdfHeaderTitle: branding.pdfHeaderTitle,
    pdfFooterDisclaimer: branding.pdfFooterDisclaimer,
    primaryColorHex: branding.primaryColorHex,
    projectName: ipc.project.name,
    projectCodePrefix: ipc.project.codePrefix,
    stateLocation: ipc.project.stateLocation,
    lenderName: ipc.project.lenderOrganization.name,
    contractorName: ipc.project.contractorOrganization.name,
    monitorOrganizationName: ipc.project.monitorOrganization.name,
    ipcNumber: ipc.ipcNumber,
    trancheName: ipc.tranche.name,
    totalClaimedNgn: Number(ipc.totalClaimedAmountNgn),
    recommendedReleaseNgn: report
      ? Number(report.recommendedReleaseAmountNgn)
      : Number(ipc.totalCertifiedNgn ?? 0),
    recommendedHoldbackNgn: report
      ? Number(report.recommendedHoldbackAmountNgn)
      : 0,
    trancheRecommendation:
      report?.trancheRecommendation ?? 'UNDER_MONITOR_REVIEW',
    executiveSummary:
      report?.executiveCertificationSummary ??
      ipc.aiExecutiveSummary ??
      'Independent Project Monitor valuation review.',
    certifierFullName: report?.certifierFullName ?? 'Independent QS Monitor',
    certifierLicenseType: report?.certifierLicenseType ?? 'QSRBN',
    certifierLicenseNumber: report?.certifierLicenseNumber ?? 'PENDING',
    certifiedAtIso: (report?.certifiedAt ?? new Date()).toISOString(),
    lineItems: ipc.lineItems.map((li) => ({
      wbsCode: li.boqItem.wbsCode,
      description: li.boqItem.description,
      budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
      contractorClaimedPct: Number(li.contractorClaimedPct),
      aiEvidenceRating: li.aiEvidenceRating,
      monitorCertifiedPct: Number(
        li.monitorCertifiedPct ?? li.previousCertifiedPct
      ),
      monitorCertifiedNgn: Number(li.monitorCertifiedNgn ?? 0),
    })),
  });
}

export async function recordLenderTrancheDecision(params: {
  projectId: string;
  trancheId: string;
  webUser: WebJwtPayload;
  input: LenderTrancheDecisionRequest;
}) {
  return prisma.$transaction(async (tx) => {
    await loadTrancheInProject(tx, params.projectId, params.trancheId);
    const report = await loadValuationReportInProject(
      tx,
      params.projectId,
      params.input.valuationReportId
    );
    if (report.ipcClaim.trancheId !== params.trancheId) {
      throw new AppError(
        'The valuation report belongs to a different tranche',
        409,
        'TRANCHE_MISMATCH'
      );
    }

    const decision = await tx.trancheDecision.upsert({
      where: { valuationReportId: report.id },
      create: {
        valuationReportId: report.id,
        decidedByUserId: params.webUser.userId,
        decision: params.input.decision,
        approvedDisbursementAmountNgn:
          params.input.approvedDisbursementAmountNgn,
        heldBackAmountNgn: params.input.heldBackAmountNgn,
        creditCommitteeReference:
          params.input.creditCommitteeReference ?? null,
        approverNotes: params.input.approverNotes ?? null,
      },
      update: {
        decidedByUserId: params.webUser.userId,
        decision: params.input.decision,
        approvedDisbursementAmountNgn:
          params.input.approvedDisbursementAmountNgn,
        heldBackAmountNgn: params.input.heldBackAmountNgn,
        creditCommitteeReference:
          params.input.creditCommitteeReference ?? null,
        approverNotes: params.input.approverNotes ?? null,
        decidedAt: new Date(),
      },
    });

    await tx.ipcClaim.update({
      where: { id: report.ipcClaimId },
      data: { status: 'LENDER_DECIDED' },
    });

    if (params.input.decision !== 'HOLD') {
      await tx.facilityTranche.update({
        where: { id: params.trancheId },
        data: {
          releasedAmountNgn: {
            increment: params.input.approvedDisbursementAmountNgn,
          },
          isReleased: params.input.decision === 'APPROVE_FULL',
        },
      });

      await tx.project.update({
        where: { id: params.projectId },
        data: {
          disbursedToDateNgn: {
            increment: params.input.approvedDisbursementAmountNgn,
          },
          portfolioHealth:
            params.input.decision === 'APPROVE_FULL'
              ? 'EVIDENCE_SUPPORTED'
              : 'EVIDENCE_PARTIAL',
        },
      });
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'LENDER_TRANCHE_DECIDED',
      summaryText: `Lender recorded tranche decision "${params.input.decision}": Approved Disbursement NGN ${params.input.approvedDisbursementAmountNgn.toLocaleString()}, Holdback NGN ${params.input.heldBackAmountNgn.toLocaleString()}.`,
      payload: {
        trancheDecisionId: decision.id,
        decision: params.input.decision,
        approvedDisbursementAmountNgn:
          params.input.approvedDisbursementAmountNgn,
        heldBackAmountNgn: params.input.heldBackAmountNgn,
      },
    });

    return serializeTrancheDecision(decision);
  });
}

