import type {
  ConfirmEvidenceLogRequest,
  EvidenceConfirmationDraftResponse,
  MediaType,
  SubmitEvidenceForExtractionRequest,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export const presignEvidenceUpload = async (payload: {
  projectId: string;
  mediaType: MediaType;
  fileName: string;
  mimeType: string;
  byteSize: number;
}) => {
  const { projectId, ...body } = payload;
  return mobileRequest<{
    uploadUrl: string;
    objectKey: string;
    expiresInSeconds: number;
  }>(`/projects/${projectId}/evidence/presign`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const submitEvidenceForExtraction = async (payload: {
  projectId: string;
  body: SubmitEvidenceForExtractionRequest;
}): Promise<EvidenceConfirmationDraftResponse> => {
  return mobileRequest<EvidenceConfirmationDraftResponse>(
    `/projects/${payload.projectId}/evidence/extract`,
    {
      method: 'POST',
      body: JSON.stringify(payload.body),
    }
  );
};

export const confirmEvidenceLog = async (payload: {
  projectId: string;
  logId: string;
  body: ConfirmEvidenceLogRequest;
}) => {
  return mobileRequest<unknown>(
    `/projects/${payload.projectId}/evidence/${payload.logId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(payload.body),
    }
  );
};

export const readLocalFileBlob = async (localUri: string): Promise<Blob> => {
  const fileRes = await fetch(localUri);
  return fileRes.blob();
};

/** PUTs bytes to a presigned URL. Type and size must match what was presigned. */
export const uploadBinaryToPresignedUrl = async (
  uploadUrl: string,
  blob: Blob,
  mimeType: string
): Promise<void> => {
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Presigned upload failed (${putRes.status})`);
  }
};

