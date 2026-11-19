import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import type { CaptureDto, MediaType, RegisterCaptureRequest } from '@insite/shared';
import { MobileApiError, mobileRequest } from '../../config/apiConfig';

export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
  storageMode: 'S3_COMPATIBLE' | 'LOCAL_DEV_SIMULATED';
}

export const presignEvidenceUpload = async (payload: {
  projectId: string;
  mediaType: MediaType;
  fileName: string;
  mimeType: string;
  byteSize: number;
}): Promise<PresignedUpload> => {
  const { projectId, ...body } = payload;
  return mobileRequest<PresignedUpload>(`/projects/${projectId}/evidence/presign`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

/**
 * PUTs a file from app storage to a presigned URL. The file is streamed from disk (never read
 * into JS as base64). Content type and size must match what was presigned.
 */
export const uploadFileToPresignedUrl = async (
  uploadUrl: string,
  localUri: string,
  mimeType: string
): Promise<void> => {
  let res: Response;
  try {
    res = await expoFetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: new File(localUri),
    });
  } catch (err) {
    throw new MobileApiError((err as Error)?.message || 'Upload failed', 'network');
  }
  if (!res.ok) {
    // An expired URL (403) or a storage error: retried, and the next attempt presigns again.
    throw new MobileApiError(`Upload failed (${res.status})`, 'network', res.status);
  }
};

/** Registers an uploaded capture. Idempotent on clientCaptureId. */
export const registerCapture = async (
  projectId: string,
  body: RegisterCaptureRequest
): Promise<CaptureDto> => {
  return mobileRequest<CaptureDto>(`/projects/${projectId}/captures`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

/** Short-lived signed URL for showing a stored photo or playing a voice note. */
export const getMediaUrl = async (projectId: string, objectKey: string): Promise<string> => {
  const result = await mobileRequest<{ url: string }>(
    `/projects/${projectId}/media?key=${encodeURIComponent(objectKey)}&format=json`
  );
  return result.url;
};
