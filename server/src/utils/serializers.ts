import { Prisma } from '@prisma/client';
import { FieldPersonaType } from '@insite/shared';
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

export function serializeEvidenceMedia(media: Prisma.EvidenceMediaGetPayload<object>) {
  return {
    id: media.id,
    mediaType: media.mediaType,
    objectKey: media.objectKey,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    sha256FileHash: media.sha256FileHash,
    durationSeconds: media.durationSeconds,
    createdAt: media.createdAt.toISOString(),
  };
}

type EvidenceLogRow = Prisma.FieldEvidenceLogGetPayload<object> & {
  mediaAttachments?: Prisma.EvidenceMediaGetPayload<object>[];
  fieldSession?: FieldSessionLike | null;
  boqItem?: { id: string; wbsCode: string; description: string; unit: string; isHoldPoint: boolean } | null;
};

export function serializeEvidenceLog(log: EvidenceLogRow, opts: { detailedSessions: boolean }) {
  return {
    id: log.id,
    projectId: log.projectId,
    boqItemId: log.boqItemId,
    fieldSessionId: log.fieldSessionId,
    reporterRoleId: log.reporterRoleId,
    reporterRoleName: log.reporterRoleName,
    fieldPersonaType: log.fieldPersonaType as FieldPersonaType,
    assuranceWeight: log.assuranceWeight,
    status: log.status,
    latitude: log.latitude,
    longitude: log.longitude,
    altitudeMeters: log.altitudeMeters,
    gpsAccuracyMeters: log.gpsAccuracyMeters,
    isMockLocation: log.isMockLocation,
    isWithinGeofence: log.isWithinGeofence,
    chainageKm: log.chainageKm,
    chainageLabel: log.chainageLabel,
    corridorOffsetMeters: log.corridorOffsetMeters,
    verificationBadgeText: log.verificationBadgeText,
    devicePitchDeg: log.devicePitchDeg,
    deviceRollDeg: log.deviceRollDeg,
    deviceAzimuthDeg: log.deviceAzimuthDeg,
    deviceSignatureHash: log.deviceSignatureHash,
    integrityPassed: log.integrityPassed,
    integrityFlags: (log.integrityFlags as string[]) ?? [],
    rawTextNote: log.rawTextNote,
    rawWhisperTranscript: log.rawWhisperTranscript,
    confirmedSummary: log.confirmedSummary,
    confirmedQuantities: (log.confirmedQuantities as unknown[]) ?? [],
    siteBlockers: (log.siteBlockers as string[]) ?? [],
    visionObservationSummary: log.visionObservationSummary,
    wasEditedByAgent: log.wasEditedByAgent,
    confirmationSignatureHash: log.confirmationSignatureHash,
    capturedAtDevice: log.capturedAtDevice.toISOString(),
    syncedAtServer: log.syncedAtServer.toISOString(),
    confirmedAt: iso(log.confirmedAt),
    ...(log.boqItem !== undefined
      ? {
          boqItem: log.boqItem
            ? {
                id: log.boqItem.id,
                wbsCode: log.boqItem.wbsCode,
                description: log.boqItem.description,
                unit: log.boqItem.unit,
                isHoldPoint: log.boqItem.isHoldPoint,
              }
            : null,
        }
      : {}),
    ...(log.fieldSession
      ? { fieldSession: serializeFieldSessionSummary(log.fieldSession, opts.detailedSessions) }
      : {}),
    ...(log.mediaAttachments
      ? { mediaAttachments: log.mediaAttachments.map(serializeEvidenceMedia) }
      : {}),
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
          conditionsPrecedent: t.conditionsPrecedent.map((cp) => ({
            id: cp.id,
            referenceCode: cp.referenceCode,
            description: cp.description,
            isMandatoryForRelease: cp.isMandatoryForRelease,
            status: cp.status,
            verifiedAt: iso(cp.verifiedAt),
          })),
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
    createdAt: q.createdAt.toISOString(),
    respondedAt: iso(q.respondedAt),
    resolvedAt: iso(q.resolvedAt),
  };
}

export function serializeValuationReport(
  r: Prisma.ValuationReportGetPayload<object> & {
    trancheDecision?: Prisma.TrancheDecisionGetPayload<object> | null;
  }
) {
  return {
    id: r.id,
    ipcClaimId: r.ipcClaimId,
    trancheRecommendation: r.trancheRecommendation,
    recommendedReleaseAmountNgn: Number(r.recommendedReleaseAmountNgn),
    recommendedHoldbackAmountNgn: Number(r.recommendedHoldbackAmountNgn),
    executiveCertificationSummary: r.executiveCertificationSummary,
    certifierFullName: r.certifierFullName,
    certifierLicenseType: r.certifierLicenseType,
    certifierLicenseNumber: r.certifierLicenseNumber,
    certifiedAt: r.certifiedAt.toISOString(),
    ...(r.trancheDecision !== undefined
      ? { trancheDecision: r.trancheDecision ? serializeTrancheDecision(r.trancheDecision) : null }
      : {}),
  };
}

export function serializeTrancheDecision(d: Prisma.TrancheDecisionGetPayload<object>) {
  return {
    id: d.id,
    valuationReportId: d.valuationReportId,
    decision: d.decision,
    approvedDisbursementAmountNgn: Number(d.approvedDisbursementAmountNgn),
    heldBackAmountNgn: Number(d.heldBackAmountNgn),
    creditCommitteeReference: d.creditCommitteeReference,
    approverNotes: d.approverNotes,
    decidedAt: d.decidedAt.toISOString(),
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
