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
}) => {
  const { projectId, ...body } = payload;
  return mobileRequest<{
    uploadUrl: string;
    objectKey: string;
    publicUrl: string;
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

