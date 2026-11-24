import { Prisma } from '@prisma/client';
import { ApprovalProgressDto, CaptureDto, FieldPersonaType } from '@insite/shared';
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

export function serializeBoqItem(item: Prisma.BoqItemGetPayload<object>) {
  return {
    id: item.id,
    projectId: item.projectId,
    lastRevisionId: item.lastRevisionId,
    wbsCode: item.wbsCode,
    section: item.section,
    description: item.description,
    unit: item.unit,
    totalQuantity: Number(item.totalQuantity),
    rateNgn: Number(item.rateNgn),
    budgetedCostNgn: Number(item.budgetedCostNgn),
    isHoldPoint: item.isHoldPoint,
    plannedStartDate: item.plannedStartDate,
    plannedEndDate: item.plannedEndDate,
    actualStartDate: item.actualStartDate,
    actualCompletionDate: item.actualCompletionDate,
    planningTier: item.planningTier,
    dailyTargetQuantity: num(item.dailyTargetQuantity),
    expectedDeliverable: item.expectedDeliverable,
    holdPointInstruction: item.holdPointInstruction,
    isOpaqueLumpSum: item.isOpaqueLumpSum,
    opacityWarningReason: item.opacityWarningReason,
    cumulativeCertifiedPct: Number(item.cumulativeCertifiedPct),
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
    geofenceStatus: log.geofenceStatus ?? null,
    distanceOutsideMeters: log.distanceOutsideMeters ?? null,
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
