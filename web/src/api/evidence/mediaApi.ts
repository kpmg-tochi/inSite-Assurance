import type { MediaType } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Uploads one supporting document through a presigned PUT and returns its object key. */
export const uploadSupportingDocument = async (payload: {
  projectId: string;
  file: File;
  mediaType: MediaType;
}) => {
  const { data } = await api.post<
    ApiEnvelope<{ objectKey: string; uploadUrl: string; storageMode: string }>
  >(`/projects/${payload.projectId}/evidence/presign`, {
    mediaType: payload.mediaType,
    fileName: payload.file.name,
    mimeType: payload.file.type || 'application/octet-stream',
    byteSize: payload.file.size,
  });
  const presigned = data.data;
  // Local development without object storage: the server issues a key but stores nothing.
  if (presigned.storageMode !== 'LOCAL_DEV_SIMULATED') {
    const res = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': payload.file.type || 'application/octet-stream' },
      body: payload.file,
    });
    if (!res.ok) throw new Error(`Upload of ${payload.file.name} failed (${res.status})`);
  }
  return presigned.objectKey;
};

/** Short-lived signed URL for an object key in this project (for <audio>/<img>). */
export const getMediaUrl = async (projectId: string, objectKey: string) => {
  const { data } = await api.get<ApiEnvelope<{ url: string; expiresInSeconds: number }>>(
    `/projects/${projectId}/media`,
    { params: { key: objectKey, format: 'json' } }
  );
  return data.data.url;
};
