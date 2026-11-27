import { File } from 'expo-file-system';
import type { PresignNeedsVerificationCaptureRequest } from '@insite/shared';
import {
  postNeedsVerificationSubmission,
  presignNeedsVerificationCapture,
  registerNeedsVerificationCapture,
} from '../../api/needsVerifications/needsVerificationsApi';
import { uploadFileToPresignedUrl } from '../../api/evidence/evidenceApi';
import { updateCaptureUpload, type CaptureRecord } from '../captureStore';
import {
  getQueuedVerificationSubmission,
  markVerificationDraftRefused,
  markVerificationDraftSent,
  noteVerificationDraftError,
} from '../needsVerificationStore';
import { classifyFailure, failureMessage, isVerificationRefusal, verificationRefusalMessage, type ClassifiableError } from './outboxPolicy';
import { LocalPermanentError, registerOutboxHandler } from './outboxProcessor';

/**
 * Needs pipeline wave 5 (N8): sending field verifications. A verification's photo or voice note is a
 * CAPTURE row like any other (`handlers.ts` hands it here when the capture names a verification):
 * presign, PUT, register, all on the verification endpoints. The submission waits for its captures
 * (dependsOn) and is idempotent on clientSubmissionId; refusals mark the draft REFUSED so the screens
 * can say what happened.
 */

const PRESIGN_MIME_TYPES: ReadonlyArray<PresignNeedsVerificationCaptureRequest['mimeType']> = ['image/jpeg', 'image/png', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg'];

/** The presign MIME type for a stored capture (the recorder's AAC in an MP4 container is audio/mp4). */
function presignMimeType(c: CaptureRecord): PresignNeedsVerificationCaptureRequest['mimeType'] {
  const m = c.mimeType.toLowerCase() as PresignNeedsVerificationCaptureRequest['mimeType'];
  if (PRESIGN_MIME_TYPES.includes(m)) return m;
  return c.mediaType === 'VOICE_NOTE' ? 'audio/mp4' : 'image/jpeg';
}

const extensionOf = (mime: string) => (mime === 'image/png' ? 'png' : mime.startsWith('audio/') ? 'm4a' : 'jpg');

/** Upload (presign + PUT), then register on the verification. The object key is stored only after a successful PUT. */
export async function sendVerificationCapture(c: CaptureRecord): Promise<void> {
  const verificationId = c.verificationId;
  if (!verificationId) throw new LocalPermanentError('This photo is not linked to a site verification.');
  if (c.uploadStatus === 'REGISTERED') return;
  const kind = c.mediaType === 'VOICE_NOTE' ? 'AUDIO' : 'PHOTO';
  const mimeType = presignMimeType(c);
  let objectKey = c.objectKey;
  if (c.uploadStatus !== 'UPLOADED' || !objectKey) {
    const file = new File(c.localPath);
    if (!file.exists) throw new LocalPermanentError('The file is no longer on this device, so it cannot be sent.');
    const presigned = await presignNeedsVerificationCapture(verificationId, { kind, fileName: `${c.id}.${extensionOf(mimeType)}`, mimeType, byteSize: file.size });
    await uploadFileToPresignedUrl(presigned.uploadUrl, c.localPath, mimeType);
    objectKey = presigned.objectKey;
    await updateCaptureUpload(c.id, { objectKey, uploadStatus: 'UPLOADED' });
  }
  try {
    await registerNeedsVerificationCapture(verificationId, {
      clientCaptureId: c.id,
      kind,
      objectKey,
      mimeType,
      byteSize: c.byteSize,
      sha256: c.sha256,
      capturedAt: c.capturedAt,
      location: c.fix ? { latitude: c.fix.latitude, longitude: c.fix.longitude, accuracyMeters: c.fix.accuracyMeters, altitudeMeters: c.fix.altitudeMeters } : null,
      isMockLocation: c.fix?.isMocked ?? false,
      headingDegrees: c.heading?.degrees ?? null,
      caption: c.caption,
      signature: c.signature,
    });
    // The verification capture DTO is not a project CaptureDto: only the state is stored.
    await updateCaptureUpload(c.id, { uploadStatus: 'REGISTERED' });
  } catch (error) {
    // The server could not find the object: upload again on the next attempt.
    if ((error as { code?: string })?.code === 'OBJECT_NOT_UPLOADED') await updateCaptureUpload(c.id, { uploadStatus: 'LOCAL' });
    throw error;
  }
}

let registered = false;

export function registerNeedsVerificationHandlers(): void {
  if (registered) return;
  registered = true;

  registerOutboxHandler('NEEDS_VERIFICATION_SUBMISSION', async (row) => {
    const q = await getQueuedVerificationSubmission(row.entityId);
    if (!q?.request) throw new LocalPermanentError('This site verification is no longer on the phone.');
    if (q.status === 'SENT') return;
    if (q.status === 'REFUSED') throw new LocalPermanentError(q.lastError ?? 'This site verification was refused by the server.');
    try {
      const submission = await postNeedsVerificationSubmission(q.verificationId, q.request);
      await markVerificationDraftSent(row.entityId, submission);
    } catch (error) {
      const e = error as ClassifiableError & { message?: string };
      if (isVerificationRefusal(e)) await markVerificationDraftRefused(row.entityId, verificationRefusalMessage(e)).catch(() => undefined);
      else if (classifyFailure(e) === 'PERMANENT') await noteVerificationDraftError(row.entityId, failureMessage(e, 'NEEDS_VERIFICATION_SUBMISSION')).catch(() => undefined);
      throw error;
    }
  });
}
