import { File } from 'expo-file-system';
import type { MediaType } from '@insite/shared';
import {
  presignEvidenceUpload,
  registerCapture,
  uploadFileToPresignedUrl,
} from '../../api/evidence/evidenceApi';
import { createIncidentReport } from '../../api/incidents/incidentsApi';
import { postDefectVerify } from '../../api/defects/defectsApi';
import { DEFECT_ALREADY_APPLIED_CODES, defectActionBody, type DefectActionPayload } from '../../utils/defects';
import { getCapture, updateCaptureUpload } from '../captureStore';
import { loadIncident, markIncidentSent, recordIncidentPhotoUploaded } from '../incidentStore';
import {
  LocalPermanentError,
  registerOutboxHandler,
} from './outboxProcessor';
import { registerVisitHandlers } from './visitHandlers';

/**
 * One handler per outbox kind. Handlers are idempotent: every request carries a client UUID, so
 * a retry after a timeout returns the original record instead of creating a second one. The visit
 * app's kinds are in visitHandlers.ts (redesign R5).
 */

function extensionOf(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'm4a';
  return 'jpg';
}

async function uploadLocalFile(params: {
  projectId: string;
  mediaType: MediaType;
  localUri: string;
  mimeType: string;
  name: string;
}): Promise<string> {
  const file = new File(params.localUri);
  if (!file.exists) {
    throw new LocalPermanentError('The file is no longer on this device, so it cannot be sent.');
  }
  const presigned = await presignEvidenceUpload({
    projectId: params.projectId,
    mediaType: params.mediaType,
    fileName: params.name,
    mimeType: params.mimeType,
    byteSize: file.size,
  });
  await uploadFileToPresignedUrl(presigned.uploadUrl, params.localUri, params.mimeType);
  return presigned.objectKey;
}

let registered = false;

export function registerOutboxHandlers(): void {
  if (registered) return;
  registered = true;

  // Upload (presign + PUT), then register. The object key is stored only after a successful PUT.
  registerOutboxHandler('CAPTURE', async (row) => {
    const c = await getCapture(row.entityId);
    if (!c) throw new LocalPermanentError('Capture record not found on this device.');
    if (c.uploadStatus === 'REGISTERED') return;

    let objectKey = c.objectKey;
    if (c.uploadStatus !== 'UPLOADED' || !objectKey) {
      objectKey = await uploadLocalFile({
        projectId: c.projectId,
        mediaType: c.mediaType,
        localUri: c.localPath,
        mimeType: c.mimeType,
        name: `${c.id}.${extensionOf(c.mimeType)}`,
      });
      await updateCaptureUpload(c.id, { objectKey, uploadStatus: 'UPLOADED' });
    }

    try {
      const server = await registerCapture(c.projectId, {
        clientCaptureId: c.id,
        mediaType: c.mediaType,
        objectKey,
        mimeType: c.mimeType,
        byteSize: c.byteSize,
        sha256: c.sha256,
        durationSeconds: c.durationSeconds,
        capturedAt: c.capturedAt,
        location: c.fix
          ? {
              latitude: c.fix.latitude,
              longitude: c.fix.longitude,
              accuracyMeters: c.fix.accuracyMeters,
              altitudeMeters: c.fix.altitudeMeters,
            }
          : null,
        isMockLocation: c.fix?.isMocked ?? false,
        caption: c.caption,
        signature: c.signature,
        resubmittedFromClientCaptureId: c.resubmittedFrom,
      });
      await updateCaptureUpload(c.id, { uploadStatus: 'REGISTERED', server });
    } catch (error) {
      // The server could not find the object: upload again on the next attempt.
      if ((error as { code?: string })?.code === 'OBJECT_NOT_UPLOADED') {
        await updateCaptureUpload(c.id, { uploadStatus: 'LOCAL' });
      }
      throw error;
    }
  });

  registerOutboxHandler('INCIDENT', async (row) => {
    const stored = await loadIncident(row.entityId);
    if (!stored) throw new LocalPermanentError('Incident not found on this device.');
    for (const uri of stored.localPhotoUris) {
      const key = await uploadLocalFile({
        projectId: row.projectId,
        mediaType: 'SITE_PHOTO',
        localUri: uri,
        mimeType: 'image/jpeg',
        name: `incident-${row.entityId}.jpg`,
      });
      await recordIncidentPhotoUploaded(row.entityId, uri, key);
    }
    const ready = await loadIncident(row.entityId);
    const created = await createIncidentReport(row.projectId, ready!.request);
    if (created?.id) await markIncidentSent(row.entityId, created.id);
  });

  // Phase 10: a defect verify action (close with photos, or reopen). Its photos were sent first
  // (dependsOn). A retry after a lost response finds the ticket already moved on; that counts as done.
  registerOutboxHandler('DEFECT_ACTION', async (row) => {
    const payload = row.payload as unknown as DefectActionPayload;
    if (!payload?.ticketId) throw new LocalPermanentError('Defect update is missing its ticket.');
    let body: Record<string, unknown>;
    try {
      body = defectActionBody(payload);
    } catch (err) {
      throw new LocalPermanentError((err as Error).message);
    }
    try {
      await postDefectVerify(row.projectId, payload.ticketId, body);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code && DEFECT_ALREADY_APPLIED_CODES.includes(code) && row.attempts > 0) return;
      throw error;
    }
  });

  registerVisitHandlers();
}
