import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  CaptureDto,
  CaptureListItemDto,
  canonicalCaptureString,
  normaliseHeadingDegrees,
  RegisterCaptureRequest,
  RESUBMITTED_AFTER_SESSION_END_FLAG,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { scheduleCaptureTranscription } from './transcription';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload } from '../../middleware/auth.middleware';
import { assertProjectObjectKey, isHandoverObjectKey, MEDIA_UPLOAD_POLICY, storageService } from '../../integrations/storage.service';
import { computeDifferenceHash, screenCapture } from '../../utils/integrity';
import { evaluateProjectGeofence, GEOFENCE_CONTEXT_SELECT } from '../../utils/geofenceEvaluation';
import { verifyDeviceSignature } from '../../utils/deviceSignature';
import { recordAuditEvent } from '../audit/audit.service';
import { serializeCapture } from '../../utils/serializers';

const CAPTURE_INCLUDE = { mediaAttachments: true } satisfies Prisma.FieldEvidenceLogInclude;

/** GET /projects/:projectId/evidence — every registered capture, newest first. */
export async function listProjectCaptures(
  projectId: string,
  filters: { limit?: number } = {}
): Promise<CaptureListItemDto[]> {
  const logs = await prisma.fieldEvidenceLog.findMany({
    where: { projectId },
    orderBy: { capturedAtDevice: 'desc' },
    take: Math.min(filters.limit ?? 300, 1000),
    include: {
      ...CAPTURE_INCLUDE,
      fieldSession: { select: { agentFullName: true } },
    },
  });
  return logs.map((log) => ({
    ...serializeCapture(log),
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
      select: { id: true, tenantId: true, ...GEOFENCE_CONTEXT_SELECT },
    }),
    prisma.fieldAgentSession.findUniqueOrThrow({
      where: { id: fieldAgent.sessionId },
      select: { devicePublicKey: true, devicePublicKeyAlg: true, devicePublicKeyId: true },
    }),
  ]);

  assertProjectObjectKey(input.objectKey, project.tenantId, project.id);
  // Phase 10: stakeholder handover uploads are quarantined and never become field evidence.
  if (isHandoverObjectKey(input.objectKey, project.tenantId, project.id)) {
    throw new AppError('File reference must be an object key issued for this project', 400, 'INVALID_OBJECT_KEY');
  }
  const policy = MEDIA_UPLOAD_POLICY[input.mediaType];
  const mimeType = input.mimeType.toLowerCase();
  if (!policy.mimeTypes.includes(mimeType)) {
    throw new AppError(`Content type ${input.mimeType} is not allowed for ${input.mediaType}`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const bytes = await storageService.getObjectBuffer(input.objectKey, policy.maxBytes);
  if (!bytes) {
    throw new AppError('Upload the file before registering the capture', 409, 'OBJECT_NOT_UPLOADED');
  }
  const serverSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const perceptualHash = input.mediaType === 'SITE_PHOTO' ? await computeDifferenceHash(bytes) : null;

  const location = input.location;
  const geofence = evaluateProjectGeofence(project, location);

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

  const resubmission = await resolveResubmission(input, fieldAgent, projectId);

  const capturedAt = new Date(input.capturedAt);
  const screening = await screenCapture(prisma, {
    allowedDuplicateOf: resubmission?.originalEvidenceLogId ? [resubmission.originalEvidenceLogId] : [],
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
  if (resubmission) {
    screening.integrityFlags.push(RESUBMITTED_AFTER_SESSION_END_FLAG);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const log = await tx.fieldEvidenceLog.create({
        data: {
          projectId,
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
          // UBEC IRL: stored as sent (wrapped to 0-360); not screened and not signed.
          headingDegrees: normaliseHeadingDegrees(input.headingDegrees),
          isMockLocation: input.isMockLocation,
          isWithinGeofence: geofence.isWithinGeofence,
          geofenceStatus: geofence.geofenceStatus,
          distanceOutsideMeters: geofence.distanceOutsideMeters,
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
          resubmittedFromClientCaptureId: resubmission?.originalClientCaptureId ?? null,
          resubmittedFromEvidenceLogId: resubmission?.originalEvidenceLogId ?? null,
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
          geofenceStatus: geofence.geofenceStatus,
          duplicateOfCaptureIds: screening.duplicateOf.map((d) => d.evidenceLogId),
          ...(resubmission
            ? {
                resubmittedFromClientCaptureId: resubmission.originalClientCaptureId,
                resubmittedFromEvidenceLogId: resubmission.originalEvidenceLogId,
              }
            : {}),
        },
      });

      return log;
    });
    // Redesign R4c: voice notes are transcribed once registered (off the request path).
    if (input.mediaType === 'VOICE_NOTE') scheduleCaptureTranscription(created.id);
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

/**
 * Phase 5 Step 8: checks a re-submission. The original may never have reached the server (it was
 * still queued when the session ended); if it did, it must be on this project, under a different
 * session that has ended, captured on this same device. The re-submission is recorded under the
 * caller's session and never merged into the original's.
 */
async function resolveResubmission(
  input: RegisterCaptureRequest,
  fieldAgent: FieldAgentJwtPayload,
  projectId: string
): Promise<{ originalClientCaptureId: string; originalEvidenceLogId: string | null } | null> {
  const originalClientCaptureId = input.resubmittedFromClientCaptureId;
  if (!originalClientCaptureId) return null;
  if (originalClientCaptureId === input.clientCaptureId) {
    throw new AppError('A capture cannot re-submit itself', 422, 'INVALID_RESUBMISSION');
  }
  const original = await prisma.fieldEvidenceLog.findUnique({
    where: { clientCaptureId: originalClientCaptureId },
    select: {
      id: true,
      projectId: true,
      fieldSessionId: true,
      fieldSession: { select: { isActive: true, deviceId: true } },
    },
  });
  if (!original) return { originalClientCaptureId, originalEvidenceLogId: null };
  if (
    original.projectId !== projectId ||
    original.fieldSessionId === fieldAgent.sessionId ||
    original.fieldSession.isActive ||
    original.fieldSession.deviceId !== fieldAgent.deviceId
  ) {
    throw new AppError(
      'Only a capture from an ended session on this device and project can be re-submitted',
      422,
      'INVALID_RESUBMISSION'
    );
  }
  return { originalClientCaptureId, originalEvidenceLogId: original.id };
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
