import { Prisma } from '@prisma/client';
import {
  ConfirmEvidenceLogRequest,
  ProjectGeofenceSchema,
  SubmitEvidenceForExtractionRequest,
  verifyPointAgainstGeofence,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload } from '../../middleware/auth.middleware';
import { whisperService } from '../../integrations/whisper.service';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { screenCaptureIntegrity } from '../../utils/integrity';
import { recordAuditEvent } from '../audit/audit.service';

export async function listProjectEvidenceTimeline(projectId: string) {
  const logs = await prisma.fieldEvidenceLog.findMany({
    where: { projectId },
    orderBy: { capturedAtDevice: 'desc' },
    include: {
      boqItem: {
        select: {
          id: true,
          wbsCode: true,
          description: true,
          unit: true,
          isHoldPoint: true,
        },
      },
      fieldSession: {
        select: {
          id: true,
          agentFullName: true,
          agentPhoneNumber: true,
          independenceTier: true,
          deviceModel: true,
        },
      },
      mediaAttachments: true,
    },
  });

  return logs;
}

export async function submitEvidenceForAiExtraction(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SubmitEvidenceForExtractionRequest;
}) {
  if (params.fieldAgent.projectId !== params.projectId) {
    throw new AppError(
      'Field Agent session is bound to a different project',
      403,
      'PROJECT_MISMATCH'
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: {
      boqItems: {
        select: { id: true, wbsCode: true, description: true, unit: true },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  // 1. Run Turf.js Radial or Linear Corridor Chainage Verification
  const parsedGeofence = ProjectGeofenceSchema.parse(project.geofenceGeoJson);
  const geofenceResult = verifyPointAgainstGeofence(
    {
      latitude: params.input.hardwareMetadata.latitude,
      longitude: params.input.hardwareMetadata.longitude,
    },
    parsedGeofence
  );

  // 2. Run Hardware & Media Integrity Screening (Mock GPS, SHA-256 & 64-bit pHash)
  const integrityResult = await screenCaptureIntegrity({
    projectId: params.projectId,
    hardwareMetadata: params.input.hardwareMetadata,
    geofenceResult,
    mediaAttachments: params.input.mediaAttachments,
  });

  // 2b. Check Contractor Identity Assurance Gate
  const liveSession = await prisma.fieldAgentSession.findUnique({
    where: { id: params.fieldAgent.sessionId },
  });

  if (liveSession && liveSession.assuranceStatus !== 'APPROVED') {
    // Stage report locally without incurring Whisper/Vision/GPT-4o API costs
    const stagedLog = await prisma.$transaction(async (tx) => {
      const created = await tx.fieldEvidenceLog.create({
        data: {
          projectId: params.projectId,
          boqItemId: params.input.boqItemId ?? null,
          fieldSessionId: params.fieldAgent.sessionId,
          clientCaptureId: params.input.hardwareMetadata.clientCaptureId,
          independenceTier: params.fieldAgent.independenceTier,
          status: 'QUEUED_OFFLINE',
          latitude: params.input.hardwareMetadata.latitude,
          longitude: params.input.hardwareMetadata.longitude,
          altitudeMeters: params.input.hardwareMetadata.altitudeMeters ?? null,
          gpsAccuracyMeters: params.input.hardwareMetadata.gpsAccuracyMeters,
          isMockLocation: params.input.hardwareMetadata.isMockLocation,
          isWithinGeofence: geofenceResult.isWithinGeofence,
          chainageKm: geofenceResult.chainageKm,
          chainageLabel: geofenceResult.chainageFormatted,
          corridorOffsetMeters: geofenceResult.corridorOffsetMeters,
          verificationBadgeText: geofenceResult.verificationBadgeText,
          devicePitchDeg: params.input.hardwareMetadata.devicePitchDeg ?? null,
          deviceRollDeg: params.input.hardwareMetadata.deviceRollDeg ?? null,
          deviceAzimuthDeg: params.input.hardwareMetadata.deviceAzimuthDeg ?? null,
          deviceSignatureHash: params.input.hardwareMetadata.deviceSignatureHash,
          integrityPassed: integrityResult.integrityPassed,
          integrityFlags:
            integrityResult.integrityFlags as unknown as Prisma.InputJsonValue,
          rawTextNote: params.input.rawTextNote ?? null,
          rawWhisperTranscript: null,
          confirmedSummary:
            params.input.rawTextNote ??
            'Queued unverified contractor report (Awaiting verification approval)',
          confirmedQuantities:
            (params.input.offlineManualQuantities ??
              []) as unknown as Prisma.InputJsonValue,
          siteBlockers: [] as unknown as Prisma.InputJsonValue,
          visionObservationSummary: null,
          capturedAtDevice: new Date(
            params.input.hardwareMetadata.capturedAtDevice
          ),
        },
      });

      for (const media of params.input.mediaAttachments) {
        await tx.evidenceMedia.create({
          data: {
            evidenceLogId: created.id,
            mediaType: media.mediaType,
            objectKey: media.objectKey,
            fileUrl: media.publicOrSignedUrl ?? null,
            mimeType: media.mimeType,
            byteSize: media.byteSize,
            sha256FileHash: media.sha256FileHash,
            perceptualHash:
              integrityResult.computedPerceptualHashes[media.objectKey] ?? null,
            durationSeconds: media.durationSeconds ?? null,
          },
        });
      }

      return created;
    });

    return {
      ...stagedLog,
      isUnverifiedContractorQueued: true,
      proposedExtraction: {
        normalizedSummary:
          params.input.rawTextNote ??
          'Submission queued pending contractor verification approval.',
        extractedQuantities: params.input.offlineManualQuantities ?? [],
        siteBlockers: [],
        matchedBoqWbsCodes: [],
        visionObservationSummary: null,
      },
      geofenceResult,
      integrityResult,
    };
  }

  // 3. Standalone Whisper Transcription (if VOICE_NOTE attachment is present)
  const voiceAttachment = params.input.mediaAttachments.find(
    (m) => m.mediaType === 'VOICE_NOTE'
  );
  let rawWhisperTranscript: string | null = null;

  if (voiceAttachment) {
    const whisperRes = await whisperService.transcribeAudio({
      audioUrl: voiceAttachment.publicOrSignedUrl,
      fallbackContextHint: params.input.rawTextNote ?? undefined,
    });
    rawWhisperTranscript = whisperRes.transcript;
  }

  const combinedTextForExtraction = [
    rawWhisperTranscript,
    params.input.rawTextNote,
  ]
    .filter(Boolean)
    .join(' | ');

  // 4. Azure OpenAI GPT-4o Quantity & Blocker Extraction
  const photoAttachment = params.input.mediaAttachments.find(
    (m) => m.mediaType === 'SITE_PHOTO'
  );

  const proposedExtraction =
    await azureOpenAiService.extractFieldNoteFromTranscript({
      rawTranscriptOrNote: combinedTextForExtraction,
      offlineManualQuantities: params.input.offlineManualQuantities,
      photoUrl: photoAttachment?.publicOrSignedUrl,
      projectBoqItems: project.boqItems,
    });

  // Resolve BOQ item link if not explicitly passed
  let resolvedBoqItemId = params.input.boqItemId ?? null;
  if (!resolvedBoqItemId && proposedExtraction.matchedBoqWbsCodes.length > 0) {
    const matched = project.boqItems.find(
      (b) => b.wbsCode === proposedExtraction.matchedBoqWbsCodes[0]
    );
    if (matched) {
      resolvedBoqItemId = matched.id;
    }
  }

  const initialStatus = integrityResult.integrityPassed
    ? 'AWAITING_CONFIRMATION'
    : 'FLAGGED_INTEGRITY';

  // 5. Persist Draft Log in PostgreSQL
  const savedLog = await prisma.$transaction(async (tx) => {
    const log = await tx.fieldEvidenceLog.create({
      data: {
        projectId: params.projectId,
        boqItemId: resolvedBoqItemId,
        fieldSessionId: params.fieldAgent.sessionId,
        clientCaptureId: params.input.hardwareMetadata.clientCaptureId,
        independenceTier: params.fieldAgent.independenceTier,
        status: initialStatus,
        latitude: params.input.hardwareMetadata.latitude,
        longitude: params.input.hardwareMetadata.longitude,
        altitudeMeters: params.input.hardwareMetadata.altitudeMeters ?? null,
        gpsAccuracyMeters: params.input.hardwareMetadata.gpsAccuracyMeters,
        isMockLocation: params.input.hardwareMetadata.isMockLocation,
        isWithinGeofence: geofenceResult.isWithinGeofence,
        chainageKm: geofenceResult.chainageKm,
        chainageLabel: geofenceResult.chainageFormatted,
        corridorOffsetMeters: geofenceResult.corridorOffsetMeters,
        verificationBadgeText: geofenceResult.verificationBadgeText,
        devicePitchDeg: params.input.hardwareMetadata.devicePitchDeg ?? null,
        deviceRollDeg: params.input.hardwareMetadata.deviceRollDeg ?? null,
        deviceAzimuthDeg: params.input.hardwareMetadata.deviceAzimuthDeg ?? null,
        deviceSignatureHash: params.input.hardwareMetadata.deviceSignatureHash,
        integrityPassed: integrityResult.integrityPassed,
        integrityFlags:
          integrityResult.integrityFlags as unknown as Prisma.InputJsonValue,
        rawTextNote: params.input.rawTextNote ?? null,
        rawWhisperTranscript,
        confirmedSummary: proposedExtraction.normalizedSummary,
        confirmedQuantities:
          proposedExtraction.extractedQuantities as unknown as Prisma.InputJsonValue,
        siteBlockers:
          proposedExtraction.siteBlockers as unknown as Prisma.InputJsonValue,
        visionObservationSummary:
          proposedExtraction.visionObservationSummary ?? null,
        capturedAtDevice: new Date(
          params.input.hardwareMetadata.capturedAtDevice
        ),
      },
    });

    for (const media of params.input.mediaAttachments) {
      await tx.evidenceMedia.create({
        data: {
          evidenceLogId: log.id,
          mediaType: media.mediaType,
          objectKey: media.objectKey,
          fileUrl: media.publicOrSignedUrl ?? null,
          mimeType: media.mimeType,
          byteSize: media.byteSize,
          sha256FileHash: media.sha256FileHash,
          perceptualHash:
            integrityResult.computedPerceptualHashes[media.objectKey] ?? null,
          durationSeconds: media.durationSeconds ?? null,
        },
      });
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'FIELD_AGENT',
      actorId: params.fieldAgent.sessionId,
      actorDisplayName: `${params.fieldAgent.agentFullName} (${params.fieldAgent.independenceTier})`,
      action: integrityResult.integrityPassed
        ? 'EVIDENCE_EXTRACTED'
        : 'EVIDENCE_FLAGGED_INTEGRITY',
      summaryText: integrityResult.integrityPassed
        ? `Extracted field log draft (${geofenceResult.verificationBadgeText}); awaiting mandatory human confirmation.`
        : `Field capture flagged by integrity screen: ${integrityResult.integrityFlags.join(', ')}`,
      payload: {
        evidenceLogId: log.id,
        integrityPassed: integrityResult.integrityPassed,
        integrityFlags: integrityResult.integrityFlags,
        chainage: geofenceResult.chainageFormatted,
      },
    });

    return log;
  });

  return {
    evidenceLogId: savedLog.id,
    clientCaptureId: savedLog.clientCaptureId,
    status: savedLog.status,
    independenceTier: savedLog.independenceTier,
    geofenceVerification: geofenceResult,
    integrityPassed: integrityResult.integrityPassed,
    integrityFlags: integrityResult.integrityFlags,
    rawWhisperTranscript,
    proposedExtraction,
    capturedAtDevice: savedLog.capturedAtDevice.toISOString(),
  };
}

export async function confirmEvidenceLogByAgent(params: {
  projectId: string;
  logId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: ConfirmEvidenceLogRequest;
}) {
  const existing = await prisma.fieldEvidenceLog.findFirst({
    where: {
      id: params.logId,
      projectId: params.projectId,
      fieldSessionId: params.fieldAgent.sessionId,
    },
  });

  if (!existing) {
    throw new AppError('Evidence log not found', 404, 'EVIDENCE_LOG_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    const nextStatus = existing.integrityPassed
      ? 'CONFIRMED'
      : 'FLAGGED_INTEGRITY';

    const updated = await tx.fieldEvidenceLog.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        ...(params.input.confirmedBoqItemId !== undefined
          ? { boqItemId: params.input.confirmedBoqItemId }
          : {}),
        confirmedSummary: params.input.confirmedSummary,
        confirmedQuantities:
          params.input.confirmedQuantities as unknown as Prisma.InputJsonValue,
        siteBlockers:
          params.input.confirmedSiteBlockers as unknown as Prisma.InputJsonValue,
        wasEditedByAgent: params.input.wasEditedByAgent,
        confirmationSignatureHash: params.input.confirmationSignatureHash,
        confirmedAt: new Date(),
      },
      include: {
        boqItem: true,
        mediaAttachments: true,
      },
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'FIELD_AGENT',
      actorId: params.fieldAgent.sessionId,
      actorDisplayName: `${params.fieldAgent.agentFullName} (${params.fieldAgent.independenceTier})`,
      action: 'EVIDENCE_CONFIRMED',
      summaryText: `Field reporter confirmed & signed log (${updated.verificationBadgeText}): "${params.input.confirmedSummary}"`,
      payload: {
        evidenceLogId: updated.id,
        wasEditedByAgent: params.input.wasEditedByAgent,
        confirmedQuantities: params.input.confirmedQuantities,
        confirmationSignatureHash: params.input.confirmationSignatureHash,
      },
    });

    return updated;
  });
}

