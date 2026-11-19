import { File } from 'expo-file-system';
import type { MediaType } from '@insite/shared';
import { submitAssuranceVerification } from '../../api/auth/authApi';
import {
  presignEvidenceUpload,
  registerCapture,
  uploadFileToPresignedUrl,
} from '../../api/evidence/evidenceApi';
import { createIncidentReport } from '../../api/incidents/incidentsApi';
import { uploadTelemetryPings } from '../../api/telemetry/telemetryApi';
import { postBoqChatMessage } from '../../api/wbs/wbsChatApi';
import { revalidateWorkdayReport, submitWorkdayReport } from '../../api/workday/workdayApi';
import {
  loadAssuranceSubmission,
  markAssuranceSubmissionSynced,
  recordAssuranceUpload,
  type AssuranceImageSlot,
} from '../assuranceRepository';
import { getCapture, updateCaptureUpload } from '../captureStore';
import { loadIncident, markIncidentSent, recordIncidentPhotoUploaded } from '../incidentStore';
import { buildRevalidateRequest, buildSubmitRequest } from '../reportPayload';
import { getReport, markReportRefused, markReportSent } from '../reportStore';
import { CONTRACTOR_REPORTING_OFF_CODE, CONTRACTOR_REPORTING_OFF_MESSAGE } from './outboxPolicy';
import { loadPingInputs } from '../telemetryStore';
import { loadQueuedMessage, markMessageSent } from '../wbsRepository';
import {
  LocalPermanentError,
  registerOutboxBatchHandler,
  registerOutboxHandler,
} from './outboxProcessor';

/**
 * One handler per outbox kind. Handlers are idempotent: every request carries a client UUID, so
 * a retry after a timeout returns the original record instead of creating a second one.
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
        wbsItemId: c.wbsItemId,
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

  /** Marks the report itself as not sent when contractor reporting is off, then rethrows for the outbox. */
  const refusedReport =
    (reportId: string) =>
    async (error: unknown): Promise<never> => {
      if ((error as { code?: string })?.code === CONTRACTOR_REPORTING_OFF_CODE) {
        await markReportRefused(reportId, CONTRACTOR_REPORTING_OFF_MESSAGE).catch(() => undefined);
      }
      throw error;
    };

  registerOutboxHandler('REPORT', async (row) => {
    const report = await getReport(row.entityId);
    if (!report) throw new LocalPermanentError('Report not found on this device.');
    if (report.syncStatus === 'SENT') return;
    const server = await submitWorkdayReport(report.projectId, buildSubmitRequest(report)).catch(
      refusedReport(report.id)
    );
    await markReportSent(report.id, server);
  });

  registerOutboxHandler('REVALIDATION', async (row) => {
    const report = await getReport(row.entityId);
    if (!report) throw new LocalPermanentError('Report not found on this device.');
    if (report.syncStatus === 'SENT') return;
    if (!report.revisesServerReportId) throw new LocalPermanentError('Revision has no original report.');
    const server = await revalidateWorkdayReport(
      report.projectId,
      report.revisesServerReportId,
      buildRevalidateRequest(report)
    ).catch(refusedReport(report.id));
    await markReportSent(report.id, server);
  });

  registerOutboxHandler('CHAT_MESSAGE', async (row) => {
    const queued = await loadQueuedMessage(row.entityId);
    if (!queued) throw new LocalPermanentError('Message not found on this device.');
    const sent = await postBoqChatMessage(queued.projectId, queued.wbsItemId, queued.body);
    await markMessageSent(row.entityId, sent.id);
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

  // Every image must upload and the server must accept the keys before this is marked sent.
  registerOutboxHandler('ASSURANCE', async (row) => {
    const loaded = await loadAssuranceSubmission(row.entityId);
    if (!loaded) throw new LocalPermanentError('Identity submission not found on this device.');
    const { payload } = loaded;
    const keys = { ...loaded.uploadedKeys };
    const images: Array<[AssuranceImageSlot, string, MediaType]> = [
      ['idDocument', payload.idPhotoUri, 'IDENTITY_DOCUMENT'],
      ['selfieFront', payload.selfieFrontUri, 'IDENTITY_SELFIE'],
      ['selfieLeft', payload.selfieLeftUri, 'IDENTITY_SELFIE'],
      ['selfieRight', payload.selfieRightUri, 'IDENTITY_SELFIE'],
    ];
    for (const [slot, uri, mediaType] of images) {
      if (keys[slot]) continue;
      keys[slot] = await uploadLocalFile({
        projectId: payload.projectId,
        mediaType,
        localUri: uri,
        mimeType: 'image/jpeg',
        name: `${slot}-${row.entityId}.jpg`,
      });
      await recordAssuranceUpload(row.entityId, slot, keys[slot]!);
    }
    await submitAssuranceVerification({
      projectId: payload.projectId,
      idDocumentType: payload.idType,
      idDocumentUrl: keys.idDocument!,
      selfieFrontUrl: keys.selfieFront!,
      selfieLeftUrl: keys.selfieLeft!,
      selfieRightUrl: keys.selfieRight!,
      selfieSet: payload.selfieSet,
      corenLicenseNumber: `${payload.regulatoryBody} ${payload.licenseNumber}`.trim(),
      experienceSummary: payload.experienceSummary,
    });
    await markAssuranceSubmissionSynced(row.entityId);
  });

  registerOutboxBatchHandler('TELEMETRY', async (rows) => {
    const byId = await loadPingInputs(rows.map((r) => r.entityId));
    const byProject = new Map<string, typeof rows>();
    for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
    for (const [projectId, projectRows] of byProject) {
      const pings = projectRows.map((r) => byId.get(r.entityId)).filter((p) => p !== undefined);
      if (pings.length > 0) await uploadTelemetryPings(projectId, pings);
    }
  });
}
