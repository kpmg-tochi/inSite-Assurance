import { Prisma } from '@prisma/client';
import {
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  EvidenceStrengthRating,
  LenderTrancheDecisionRequest,
  PortfolioHealth,
  RespondMonitorQueryRequest,
  SubmitIpcClaimRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { generateValuationReportPdfBuffer } from '../../integrations/pdf-report.service';
import { recordAuditEvent } from '../audit/audit.service';

export async function listProjectIpcClaims(projectId: string) {
  const ipcs = await prisma.ipcClaim.findMany({
    where: { projectId },
    orderBy: { ipcNumber: 'desc' },
    include: {
      tranche: true,
      valuationReport: {
        include: { trancheDecision: true },
      },
      lineItems: {
        include: {
          boqItem: true,
          queries: true,
        },
      },
      supportingDocuments: true,
    },
  });

  return ipcs.map((ipc) => ({
    ...ipc,
    totalClaimedAmountNgn: Number(ipc.totalClaimedAmountNgn),
    totalCertifiedNgn: ipc.totalCertifiedNgn
      ? Number(ipc.totalCertifiedNgn)
      : null,
    lineItems: ipc.lineItems.map((li) => ({
      ...li,
      previousCertifiedPct: Number(li.previousCertifiedPct),
      contractorClaimedPct: Number(li.contractorClaimedPct),
      contractorClaimedNgn: Number(li.contractorClaimedNgn),
      monitorCertifiedPct: li.monitorCertifiedPct
        ? Number(li.monitorCertifiedPct)
        : null,
      monitorCertifiedNgn: li.monitorCertifiedNgn
        ? Number(li.monitorCertifiedNgn)
        : null,
      boqItem: {
        ...li.boqItem,
        totalQuantity: Number(li.boqItem.totalQuantity),
        rateNgn: Number(li.boqItem.rateNgn),
        budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
        cumulativeCertifiedPct: Number(li.boqItem.cumulativeCertifiedPct),
      },
    })),
  }));
}

export async function getIpcReconciliationDetails(
  projectId: string,
  ipcId: string,
  webUser: WebJwtPayload
) {
  const ipc = await prisma.ipcClaim.findFirst({
    where: { id: ipcId, projectId },
    include: {
      project: {
        include: {
          monitorOrganization: true,
          lenderOrganization: true,
          contractorOrganization: true,
        },
      },
      tranche: {
        include: { conditionsPrecedent: true },
      },
      supportingDocuments: true,
      valuationReport: {
        include: { trancheDecision: true },
      },
      lineItems: {
        orderBy: { boqItem: { wbsCode: 'asc' } },
        include: {
          boqItem: {
            include: {
              evidenceLogs: {
                where: { status: 'CONFIRMED' },
                orderBy: { capturedAtDevice: 'desc' },
                include: { mediaAttachments: true, fieldSession: true },
              },
            },
          },
          queries: {
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  if (!ipc) {
    throw new AppError('IPC Claim not found', 404, 'IPC_NOT_FOUND');
  }

  const isContractor = webUser.role === 'CONTRACTOR';

  const formattedLineItems = ipc.lineItems.map((li) => ({
    id: li.id,
    ipcClaimId: li.ipcClaimId,
    boqItemId: li.boqItemId,
    previousCertifiedPct: Number(li.previousCertifiedPct),
    contractorClaimedPct: Number(li.contractorClaimedPct),
    contractorClaimedNgn: Number(li.contractorClaimedNgn),
    contractorRemarks: li.contractorRemarks,
    aiEvidenceRating: li.aiEvidenceRating,
    aiRationale: isContractor ? null : li.aiRationale,
    visitPlannerFlag: isContractor ? false : li.visitPlannerFlag,
    visitPlannerReason: isContractor ? null : li.visitPlannerReason,
    missingHoldPointFlag: li.missingHoldPointFlag,
    highestCorroboratingTier: li.highestCorroboratingTier,
    corroboratingEvidenceLogIds: li.corroboratingEvidenceLogIds,
    monitorCertifiedPct: li.monitorCertifiedPct
      ? Number(li.monitorCertifiedPct)
      : null,
    monitorCertifiedNgn: li.monitorCertifiedNgn
      ? Number(li.monitorCertifiedNgn)
      : null,
    monitorRemarks: li.monitorRemarks,
    boqItem: {
      ...li.boqItem,
      totalQuantity: Number(li.boqItem.totalQuantity),
      rateNgn: Number(li.boqItem.rateNgn),
      budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
      cumulativeCertifiedPct: Number(li.boqItem.cumulativeCertifiedPct),
    },
    queries: li.queries,
  }));

  // Smart Visit Planner Queue (only for MONITOR & LENDER)
  const smartVisitPlannerQueue = isContractor
    ? []
    : formattedLineItems
        .filter((li) => li.visitPlannerFlag || li.missingHoldPointFlag)
        .map((li) => ({
          ipcLineItemId: li.id,
          wbsCode: li.boqItem.wbsCode,
          description: li.boqItem.description,
          claimedAmountNgn: li.contractorClaimedNgn,
          aiEvidenceRating: li.aiEvidenceRating,
          missingHoldPointFlag: li.missingHoldPointFlag,
          visitPlannerReason:
            li.visitPlannerReason ||
            'Requires physical verification by Independent Monitor.',
        }));

  return {
    id: ipc.id,
    projectId: ipc.projectId,
    trancheId: ipc.trancheId,
    ipcNumber: ipc.ipcNumber,
    periodStart: ipc.periodStart,
    periodEnd: ipc.periodEnd,
    contractorCoverNote: ipc.contractorCoverNote,
    totalClaimedAmountNgn: Number(ipc.totalClaimedAmountNgn),
    totalCertifiedNgn: ipc.totalCertifiedNgn
      ? Number(ipc.totalCertifiedNgn)
      : null,
    status: ipc.status,
    aiExecutiveSummary: isContractor ? null : ipc.aiExecutiveSummary,
    submittedAt: ipc.submittedAt,
    tranche: {
      ...ipc.tranche,
      allocatedAmountNgn: Number(ipc.tranche.allocatedAmountNgn),
      releasedAmountNgn: Number(ipc.tranche.releasedAmountNgn),
      targetCompletionPct: Number(ipc.tranche.targetCompletionPct),
    },
    supportingDocuments: ipc.supportingDocuments,
    valuationReport: ipc.valuationReport
      ? {
          ...ipc.valuationReport,
          recommendedReleaseAmountNgn: Number(
            ipc.valuationReport.recommendedReleaseAmountNgn
          ),
          recommendedHoldbackAmountNgn: Number(
            ipc.valuationReport.recommendedHoldbackAmountNgn
          ),
        }
      : null,
    lineItems: formattedLineItems,
    smartVisitPlannerQueue,
  };
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
        independenceTier: log.independenceTier,
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
          highestCorroboratingTier: ev.highestCorroboratingTier,
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
            fileUrl: doc.fileUrl ?? null,
            boqItemId: doc.boqItemId ?? null,
          })),
        },
      },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.role})`,
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
      actorDisplayName: `${params.webUser.fullName} (MONITOR)`,
      action: 'MONITOR_QUERY_RAISED',
      summaryText: `Monitor raised query on [${query.ipcLineItem.boqItem.wbsCode}]: "${params.input.queryReason}"`,
      payload: {
        queryId: query.id,
        ipcLineItemId: params.input.ipcLineItemId,
      },
    });

    return query;
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
      actorDisplayName: `${params.webUser.fullName} (CONTRACTOR)`,
      action: 'CONTRACTOR_QUERY_RESPONDED',
      summaryText: `Contractor responded to Monitor query on [${updatedQuery.ipcLineItem.boqItem.wbsCode}].`,
      payload: {
        queryId: updatedQuery.id,
        revisedClaimedCumulativePct: params.input.revisedClaimedCumulativePct,
      },
    });

    return updatedQuery;
  });
}

export async function certifyIpcValuationByMonitor(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: CertifyIpcValuationRequest;
}) {
  return prisma.$transaction(async (tx) => {
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

    return report;
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

  return generateValuationReportPdfBuffer({
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
    const report = await tx.valuationReport.findUnique({
      where: { id: params.input.valuationReportId },
      include: { ipcClaim: true },
    });

    if (!report) {
      throw new AppError(
        'Certified Valuation Report not found',
        404,
        'VALUATION_REPORT_NOT_FOUND'
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
      actorDisplayName: `${params.webUser.fullName} (LENDER)`,
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

    return decision;
  });
}

