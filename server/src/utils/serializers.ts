import { Prisma } from '@prisma/client';
import { CaptureDto, CaptureSummary, FieldPersonaType } from '@insite/shared';
import { hasWebPermission, WebJwtPayload } from '../middleware/auth.middleware';

/**
 * Response serializers (Phase 2 Step 4). Never spread a Prisma row into a response: list the
 * fields explicitly so new columns (hashes, secrets, document URLs) are not leaked by default.
 */

/** Field-session data in responses is limited unless the caller manages field assurance. */
export function canSeeFieldSessionDetail(webUser?: WebJwtPayload): boolean {
  return Boolean(
    webUser && hasWebPermission(webUser, 'users:revoke_device')
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
    plannedStartDate: item.plannedStartDate,
    plannedEndDate: item.plannedEndDate,
    actualStartDate: item.actualStartDate,
    actualCompletionDate: item.actualCompletionDate,
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
    headingDegrees: log.headingDegrees ?? null,
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

/** A capture as shown inside a visit submission, a finding or a site log entry (moved from the
 * workday reports module in redesign R5f). */
export function toCaptureSummary(c: CaptureRow): CaptureSummary {
  const full = serializeCapture(c);
  return {
    id: full.id,
    clientCaptureId: full.clientCaptureId,
    mediaType: full.mediaType,
    objectKey: full.objectKey,
    mimeType: full.mimeType,
    caption: full.caption,
    capturedAt: full.capturedAt,
    locationAvailable: full.locationAvailable,
    latitude: full.latitude,
    longitude: full.longitude,
    gpsAccuracyMeters: full.gpsAccuracyMeters,
    headingDegrees: full.headingDegrees ?? null,
    isMockLocation: full.isMockLocation,
    isWithinGeofence: full.isWithinGeofence,
    signatureVerified: full.signatureVerified,
    integrityPassed: full.integrityPassed,
    integrityFlags: full.integrityFlags,
    transcriptionStatus: full.transcriptionStatus,
    transcript: full.transcript,
    durationSeconds: full.durationSeconds,
    resubmittedFromClientCaptureId: full.resubmittedFromClientCaptureId ?? null,
  };
}
