import type {
  NeedsVerificationCaptureDto,
  NeedsVerificationFeedDto,
  NeedsVerificationFormDto,
  NeedsVerificationPresignDto,
  NeedsVerificationSubmissionDto,
  PresignNeedsVerificationCaptureRequest,
  RegisterNeedsVerificationCaptureRequestInput,
  SubmitNeedsVerificationRequestInput,
} from '@insite/shared';
import { MobileApiError, mobileRequest } from '../../config/apiConfig';

/**
 * Needs pipeline wave 5 (N8): the field verification API. Access is by assignment (the signed-in
 * account is the verification's officer; anyone else gets 404): no project path, no field session, so
 * a refusal here never ends a project scope. Writes are only ever called by outbox handlers, and every
 * one is idempotent on a client UUID.
 */

/** The account's verifications: open ones and those finished in the last 30 days. */
export const fetchMyNeedsVerifications = async (): Promise<NeedsVerificationFeedDto> =>
  mobileRequest<NeedsVerificationFeedDto>('/needs-verifications/mine');

/**
 * The frozen form. With `knownHash` (the hash of the copy on the phone), the server answers 304 when
 * the form is unchanged: this returns null then (keep the cached copy).
 */
export const fetchNeedsVerificationForm = async (verificationId: string, knownHash?: string | null): Promise<NeedsVerificationFormDto | null> => {
  try {
    return await mobileRequest<NeedsVerificationFormDto>(`/needs-verifications/${verificationId}/form`, {
      headers: knownHash ? { 'If-None-Match': `"${knownHash}"` } : undefined,
    });
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 304) return null;
    throw error;
  }
};

export const presignNeedsVerificationCapture = async (verificationId: string, body: PresignNeedsVerificationCaptureRequest): Promise<NeedsVerificationPresignDto> =>
  mobileRequest<NeedsVerificationPresignDto>(`/needs-verifications/${verificationId}/captures/presign`, { method: 'POST', body: JSON.stringify(body) });

/** 201 new / 200 replay of the same clientCaptureId; 409 OBJECT_NOT_UPLOADED: upload again. */
export const registerNeedsVerificationCapture = async (verificationId: string, body: RegisterNeedsVerificationCaptureRequestInput): Promise<NeedsVerificationCaptureDto> =>
  mobileRequest<NeedsVerificationCaptureDto>(`/needs-verifications/${verificationId}/captures`, { method: 'POST', body: JSON.stringify(body) });

/** 201 created / 200 replay of the same clientSubmissionId; both return the submission. */
export const postNeedsVerificationSubmission = async (verificationId: string, body: SubmitNeedsVerificationRequestInput): Promise<NeedsVerificationSubmissionDto> =>
  mobileRequest<NeedsVerificationSubmissionDto>(`/needs-verifications/${verificationId}/submissions`, { method: 'POST', body: JSON.stringify(body) });
