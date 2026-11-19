import { Prisma } from '@prisma/client';
import { CaptureDto, FieldPersonaType } from '@insite/shared';
import { hasWebPermission, WebJwtPayload } from '../middleware/auth.middleware';

/**
 * Response serializers (Phase 2 Step 4). Never spread a Prisma row into a response: list the
 * fields explicitly so new columns (hashes, secrets, document URLs) are not leaked by default.
 */

const num = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Field-session data in responses is limited unless the caller manages field assurance. */
export function canSeeFieldSessionDetail(webUser?: WebJwtPayload): boolean {
  return Boolean(
    webUser && hasWebPermission(webUser, 'assurance:review_credentials', 'sessions:revoke_device')
  );
}

type FieldSessionLike = {
  id: string;
  agentFullName: string;
  roleId: string;
  roleNameSnapshot: string;
  fieldPersonaType: string;
  assuranceWeight: number;
  agentPhoneNumber?: string;
  deviceModel?: string | null;
};

export function serializeFieldSessionSummary(session: FieldSessionLike, detailed: boolean) {
  return {
    id: session.id,
    agentFullName: session.agentFullName,
    roleId: session.roleId,
    roleNameSnapshot: session.roleNameSnapshot,
    fieldPersonaType: session.fieldPersonaType as FieldPersonaType,
    assuranceWeight: session.assuranceWeight,
    ...(detailed
      ? {
          agentPhoneNumber: session.agentPhoneNumber ?? null,
          deviceModel: session.deviceModel ?? null,
        }
      : {}),
  };
}

export function serializeBoqItem(
  item: Prisma.BoqItemGetPayload<object> & {
    tranche?: { id: string; trancheNumber: number; name: string } | null;
  }
) {
  return {
    id: item.id,
    projectId: item.projectId,
    trancheId: item.trancheId,
    aiSuggestedTrancheId: item.aiSuggestedTrancheId,
    trancheMappingConfirmedByMonitor: item.trancheMappingConfirmedByMonitor,
    wbsCode: item.wbsCode,
    section: item.section,
    description: item.description,
    unit: item.unit,
    totalQuantity: Number(item.totalQuantity),
    rateNgn: Number(item.rateNgn),
    budgetedCostNgn: Number(item.budgetedCostNgn),
    isHoldPoint: item.isHoldPoint,
    isScheduledToday: item.isScheduledToday,
    planningTier: item.planningTier,
    dailyTargetQuantity: num(item.dailyTargetQuantity),
    expectedDeliverable: item.expectedDeliverable,
    holdPointInstruction: item.holdPointInstruction,
    isOpaqueLumpSum: item.isOpaqueLumpSum,
    opacityWarningReason: item.opacityWarningReason,
    cumulativeCertifiedPct: Number(item.cumulativeCertifiedPct),
    ...(item.tranche !== undefined
      ? {
          tranche: item.tranche
            ? { id: item.tranche.id, trancheNumber: item.tranche.trancheNumber, name: item.tranche.name }
            : null,
        }
      : {}),
  };
}

type CaptureRow = Prisma.FieldEvidenceLogGetPayload<{ include: { mediaAttachments: true } }>;

/** One capture (photo, voice note or document) with its server-computed integrity results. */
export function serializeCapture(log: CaptureRow): CaptureDto {
  const media = log.mediaAttachments[0];
  return {
    id: log.id,
    clientCaptureId: log.clientCaptureId,
    projectId: log.projectId,
    wbsItemId: log.boqItemId,
    workdayReportId: log.workdayReportId,
    fieldSessionId: log.fieldSessionId,
    status: log.status as CaptureDto['status'],
    mediaType: (media?.mediaType ?? 'SITE_PHOTO') as CaptureDto['mediaType'],
    objectKey: media?.objectKey ?? '',
    mimeType: media?.mimeType ?? '',
    byteSize: media?.byteSize ?? 0,
    durationSeconds: media?.durationSeconds ?? null,
    caption: log.caption,
    capturedAt: log.capturedAtDevice.toISOString(),
    registeredAt: log.syncedAtServer.toISOString(),
    locationAvailable: log.locationAvailable,
    latitude: log.latitude,
    longitude: log.longitude,
    gpsAccuracyMeters: log.gpsAccuracyMeters,
    isMockLocation: log.isMockLocation,
    isWithinGeofence: log.isWithinGeofence,
    chainageLabel: log.chainageLabel,
    distanceFromSiteMeters: log.distanceFromSiteMeters,
    signatureVerified: log.signatureVerified,
    serverSha256: log.serverSha256,
    perceptualHash: media?.perceptualHash ?? null,
    integrityPassed: log.integrityPassed,
    integrityFlags: Array.isArray(log.integrityFlags) ? (log.integrityFlags as string[]) : [],
    transcriptionStatus: log.transcriptionStatus as CaptureDto['transcriptionStatus'],
    transcript: log.transcript,
    reporterRoleName: log.reporterRoleName,
    fieldPersonaType: log.fieldPersonaType as FieldPersonaType,
    resubmittedFromClientCaptureId: log.resubmittedFromClientCaptureId ?? null,
  };
}

export function serializeConditionPrecedent(cp: Prisma.ConditionPrecedentGetPayload<object>) {
  return {
    id: cp.id,
    referenceCode: cp.referenceCode,
    description: cp.description,
    isMandatoryForRelease: cp.isMandatoryForRelease,
    status: cp.status,
    verifiedAt: iso(cp.verifiedAt),
    statusChangedAt: iso(cp.statusChangedAt),
    waivedByUserId: cp.waivedByUserId,
    waiverReason: cp.waiverReason,
  };
}

export function serializeTranche(
  t: Prisma.FacilityTrancheGetPayload<object> & {
    conditionsPrecedent?: Prisma.ConditionPrecedentGetPayload<object>[];
  }
) {
  return {
    id: t.id,
    projectId: t.projectId,
    trancheNumber: t.trancheNumber,
    name: t.name,
    allocatedAmountNgn: Number(t.allocatedAmountNgn),
    releasedAmountNgn: Number(t.releasedAmountNgn),
    targetCompletionPct: Number(t.targetCompletionPct),
    isReleased: t.isReleased,
    ...(t.conditionsPrecedent
      ? {
          conditionsPrecedent: [...t.conditionsPrecedent]
            .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode))
            .map(serializeConditionPrecedent),
        }
      : {}),
  };
}

export function serializeMonitorQuery(q: Prisma.MonitorQueryGetPayload<object>) {
  return {
    id: q.id,
    ipcLineItemId: q.ipcLineItemId,
    status: q.status,
    queryReason: q.queryReason,
    requestedProofTypes: (q.requestedProofTypes as string[]) ?? [],
    contractorResponseText: q.contractorResponseText,
    revisedClaimedCumulativePct: num(q.revisedClaimedCumulativePct),
    attachedDocuments: (q.attachedDocumentsJson as unknown[]) ?? [],
    resolutionNote: q.resolutionNote,
    raisedByUserId: q.raisedByUserId,
    respondedByUserId: q.respondedByUserId,
    resolvedByUserId: q.resolvedByUserId,
    createdAt: q.createdAt.toISOString(),
    respondedAt: iso(q.respondedAt),
    resolvedAt: iso(q.resolvedAt),
  };
}

type DecisionRow = Prisma.TrancheDecisionGetPayload<object>;

/** `allDecisions` lets the serializer tell whether a later reversal cancels this decision. */
export function serializeTrancheDecision(d: DecisionRow, allDecisions: DecisionRow[] = []) {
  return {
    id: d.id,
    valuationReportId: d.valuationReportId,
    decision: d.decision,
    approvedDisbursementAmountNgn: Number(d.approvedDisbursementAmountNgn),
    heldBackAmountNgn: Number(d.heldBackAmountNgn),
    creditCommitteeReference: d.creditCommitteeReference,
    approverNotes: d.approverNotes,
    decidedByUserId: d.decidedByUserId,
    reversesDecisionId: d.reversesDecisionId,
    isReversed: allDecisions.some((o) => o.reversesDecisionId === d.id),
    cpSnapshot: Array.isArray(d.cpSnapshotJson)
      ? (d.cpSnapshotJson as Array<{
          id: string;
          referenceCode: string;
          isMandatoryForRelease: boolean;
          status: 'PENDING' | 'SATISFIED' | 'WAIVED' | 'BREACHED';
        }>)
      : [],
    decidedAt: d.decidedAt.toISOString(),
  };
}

export function serializeValuationReport(
  r: Prisma.ValuationReportGetPayload<object> & { trancheDecisions?: DecisionRow[] }
) {
  const decisions = [...(r.trancheDecisions ?? [])].sort(
    (a, b) => a.decidedAt.getTime() - b.decidedAt.getTime()
  );
  return {
    id: r.id,
    ipcClaimId: r.ipcClaimId,
    revisionNumber: r.revisionNumber,
    trancheRecommendation: r.trancheRecommendation,
    totalClaimedNgn: Number(r.totalClaimedNgn),
    totalCertifiedNgn: Number(r.totalCertifiedNgn),
    recommendedReleaseAmountNgn: Number(r.recommendedReleaseAmountNgn),
    recommendedHoldbackAmountNgn: Number(r.recommendedHoldbackAmountNgn),
    executiveCertificationSummary: r.executiveCertificationSummary,
    certifiedByUserId: r.certifiedByUserId,
    certifierFullName: r.certifierFullName,
    certifierLicenseType: r.certifierLicenseType,
    certifierLicenseNumber: r.certifierLicenseNumber,
    certifiedAt: r.certifiedAt.toISOString(),
    supersededAt: iso(r.supersededAt),
    decisions: decisions.map((d) => serializeTrancheDecision(d, decisions)),
  };
}

export function serializeSupportingDocument(doc: Prisma.IpcSupportingDocumentGetPayload<object>) {
  return {
    id: doc.id,
    boqItemId: doc.boqItemId,
    title: doc.title,
    mediaType: doc.mediaType,
    objectKey: doc.objectKey,
    uploadedAt: doc.uploadedAt.toISOString(),
  };
}
