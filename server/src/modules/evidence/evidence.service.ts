import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  CaptureDto,
  CaptureListItemDto,
  canonicalCaptureString,
  RegisterCaptureRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload } from '../../middleware/auth.middleware';
import { assertProjectObjectKey, MEDIA_UPLOAD_POLICY, storageService } from '../../integrations/storage.service';
import { computeDifferenceHash, screenCapture } from '../../utils/integrity';
import { evaluateGeofence } from '../../utils/geofenceEvaluation';
import { verifyDeviceSignature } from '../../utils/deviceSignature';
import { recordAuditEvent } from '../audit/audit.service';
import { loadBoqItemInProject } from '../../utils/ownership';
import { serializeCapture } from '../../utils/serializers';

const CAPTURE_INCLUDE = { mediaAttachments: true } satisfies Prisma.FieldEvidenceLogInclude;

/** GET /projects/:projectId/evidence — every registered capture, newest first. */
export async function listProjectCaptures(
  projectId: string,
  filters: { wbsItemId?: string; workdayReportId?: string; limit?: number } = {}
): Promise<CaptureListItemDto[]> {
  const logs = await prisma.fieldEvidenceLog.findMany({
    where: {
      projectId,
      ...(filters.wbsItemId ? { boqItemId: filters.wbsItemId } : {}),
      ...(filters.workdayReportId ? { workdayReportId: filters.workdayReportId } : {}),
    },
    orderBy: { capturedAtDevice: 'desc' },
    take: Math.min(filters.limit ?? 300, 1000),
    include: {
      ...CAPTURE_INCLUDE,
      boqItem: { select: { wbsCode: true, description: true } },
      fieldSession: { select: { agentFullName: true } },
    },
  });
  return logs.map((log) => ({
    ...serializeCapture(log),
    wbsCode: log.boqItem?.wbsCode ?? null,
    wbsDescription: log.boqItem?.description ?? null,
    reporterName: log.fieldSession.agentFullName,
  }));
}

/** Captures the field agent registered, for device reconciliation after reinstall or sync. */
export async function listOwnCaptures(fieldAgent: FieldAgentJwtPayload, since?: Date): Promise<CaptureDto[]> {
  const logs = await prisma.fieldEvidenceLog.findMany({
    where: {
      projectId: fieldAgent.projectId,
      fieldSessionId: fieldAgent.sessionId,
      ...(since ? { syncedAtServer: { gte: since } } : {}),
    },
    orderBy: { capturedAtDevice: 'desc' },
    take: 500,
    include: CAPTURE_INCLUDE,
  });
  return logs.map(serializeCapture);
}

export type RegisterCaptureResult = { capture: CaptureDto; created: boolean };

/**
 * POST /projects/:projectId/captures
 *
 * Idempotent on `clientCaptureId`: a repeat from the same session returns the existing capture.
 * The object must already be uploaded. The server hashes the stored bytes, computes the
 * perceptual hash, verifies the device signature, evaluates the geofence and screens for
 * duplicates within the tenant. No client assertion about hashes or geofence is stored as fact.
 */
export async function registerCapture(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: RegisterCaptureRequest;
}): Promise<RegisterCaptureResult> {
  const { input, fieldAgent, projectId } = params;

  const existing = await findCaptureForReplay(input.clientCaptureId, fieldAgent.sessionId);
  if (existing) return { capture: existing, created: false };

  const [project, session] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, tenantId: true, geofenceGeoJson: true },
    }),
    prisma.fieldAgentSession.findUniqueOrThrow({
      where: { id: fieldAgent.sessionId },
      select: { devicePublicKey: true, devicePublicKeyAlg: true, devicePublicKeyId: true },
    }),
  ]);

  assertProjectObjectKey(input.objectKey, project.tenantId, project.id);
  const policy = MEDIA_UPLOAD_POLICY[input.mediaType];
  const mimeType = input.mimeType.toLowerCase();
  if (!policy.mimeTypes.includes(mimeType)) {
    throw new AppError(`Content type ${input.mimeType} is not allowed for ${input.mediaType}`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (input.wbsItemId) {
    await loadBoqItemInProject(prisma, projectId, input.wbsItemId);
  }

  const bytes = await storageService.getObjectBuffer(input.objectKey, policy.maxBytes);
  if (!bytes) {
    throw new AppError('Upload the file before registering the capture', 409, 'OBJECT_NOT_UPLOADED');
  }
  const serverSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const perceptualHash = input.mediaType === 'SITE_PHOTO' ? await computeDifferenceHash(bytes) : null;

  const location = input.location;
  const geofence = evaluateGeofence(project.geofenceGeoJson, location);

  const signature = verifyDeviceSignature({
    publicKey: session.devicePublicKey,
    alg: session.devicePublicKeyAlg,
    signature: input.signature,
    message: canonicalCaptureString({
      clientCaptureId: input.clientCaptureId,
      projectId,
      mediaType: input.mediaType,
      sha256: input.sha256,
      byteSize: input.byteSize,
      capturedAt: input.capturedAt,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracyMeters: location?.accuracyMeters ?? null,
      isMockLocation: input.isMockLocation,
    }),
  });

  const capturedAt = new Date(input.capturedAt);
  const screening = await screenCapture(prisma, {
    tenantId: project.tenantId,
    fieldSessionId: fieldAgent.sessionId,
    mediaType: input.mediaType,
    serverSha256,
    clientSha256: input.sha256,
    perceptualHash,
    capturedAt,
    locationAvailable: Boolean(location),
    isMockLocation: input.isMockLocation,
    gpsAccuracyMeters: location?.accuracyMeters ?? null,
    geofenceFlag: geofence.flag,
    signatureFlag: signature.flag,
  });
  if (perceptualHash === null && input.mediaType === 'SITE_PHOTO') {
    screening.integrityFlags.push('IMAGE_NOT_DECODABLE');
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const log = await tx.fieldEvidenceLog.create({
        data: {
          projectId,
          boqItemId: input.wbsItemId ?? null,
          fieldSessionId: fieldAgent.sessionId,
          clientCaptureId: input.clientCaptureId,
          reporterRoleId: fieldAgent.roleId,
          reporterRoleName: fieldAgent.roleName,
          fieldPersonaType: fieldAgent.fieldPersonaType,
          assuranceWeight: fieldAgent.assuranceWeight,
          status: screening.integrityPassed ? 'REGISTERED' : 'FLAGGED_INTEGRITY',
          caption: input.caption ?? null,
          locationAvailable: Boolean(location),
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          altitudeMeters: location?.altitudeMeters ?? null,
          gpsAccuracyMeters: location?.accuracyMeters ?? null,
          isMockLocation: input.isMockLocation,
          isWithinGeofence: geofence.isWithinGeofence,
          chainageKm: geofence.chainageKm,
          chainageLabel: geofence.chainageLabel,
          corridorOffsetMeters: geofence.corridorOffsetMeters,
          distanceFromSiteMeters: geofence.distanceFromSiteMeters,
          devicePitchDeg: input.devicePitchDeg ?? null,
          deviceRollDeg: input.deviceRollDeg ?? null,
          deviceAzimuthDeg: input.deviceAzimuthDeg ?? null,
          deviceSignature: input.signature ?? null,
          devicePublicKeyId: session.devicePublicKeyId,
          signatureVerified: signature.verified,
          clientSha256: input.sha256.toLowerCase(),
          serverSha256,
          integrityPassed: screening.integrityPassed,
          integrityFlags: screening.integrityFlags as unknown as Prisma.InputJsonValue,
          transcriptionStatus: input.mediaType === 'VOICE_NOTE' ? 'PENDING' : 'NOT_APPLICABLE',
          capturedAtDevice: capturedAt,
          mediaAttachments: {
            create: {
              tenantId: project.tenantId,
              projectId,
              mediaType: input.mediaType,
              objectKey: input.objectKey,
              mimeType,
              byteSize: bytes.length,
              sha256FileHash: serverSha256,
              perceptualHash,
              durationSeconds: input.durationSeconds ?? null,
            },
          },
        },
        include: CAPTURE_INCLUDE,
      });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: fieldAgent.sessionId,
        actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
        action: screening.integrityPassed ? 'CAPTURE_REGISTERED' : 'CAPTURE_FLAGGED_INTEGRITY',
        summaryText: screening.integrityPassed
          ? `Registered ${input.mediaType.toLowerCase().replace('_', ' ')} capture.`
          : `Capture flagged by integrity screening: ${screening.integrityFlags.join(', ')}`,
        payload: {
          captureId: log.id,
          clientCaptureId: log.clientCaptureId,
          mediaType: input.mediaType,
          integrityFlags: screening.integrityFlags,
          signatureVerified: signature.verified,
          isWithinGeofence: geofence.isWithinGeofence,
          duplicateOfCaptureIds: screening.duplicateOf.map((d) => d.evidenceLogId),
        },
      });

      return log;
    });
    return { capture: serializeCapture(created), created: true };
  } catch (error) {
    // Concurrent retry of the same capture: return the row the other request created.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await findCaptureForReplay(input.clientCaptureId, fieldAgent.sessionId);
      if (replay) return { capture: replay, created: false };
    }
    throw error;
  }
}

async function findCaptureForReplay(clientCaptureId: string, sessionId: string): Promise<CaptureDto | null> {
  const existing = await prisma.fieldEvidenceLog.findUnique({
    where: { clientCaptureId },
    include: CAPTURE_INCLUDE,
  });
  if (!existing) return null;
  if (existing.fieldSessionId !== sessionId) {
    throw new AppError('This capture ID is already in use', 409, 'CAPTURE_ID_CONFLICT');
  }
  return serializeCapture(existing);
}
