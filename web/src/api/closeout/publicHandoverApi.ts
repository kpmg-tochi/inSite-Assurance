import axios from 'axios';
import type {
  HandoverMultipartDto,
  HandoverMultipartPartUrl,
  HandoverMultipartStatusDto,
  HandoverPresignDto,
  HandoverSessionDto,
  HandoverSubmittedDto,
  PublicHandoverInfoDto,
  SubmitHandoverInput,
} from '@insite/shared';
import { BASE_URL } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/**
 * Public stakeholder handover API (Phase 10). Its own axios instance: it never sends the portal's
 * access token, and a 401/403 here never signs a portal user out.
 */
const publicApi = axios.create({ baseURL: `${BASE_URL}/public/handover`, headers: { 'Content-Type': 'application/json' } });

publicApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const body = error?.response?.data?.error;
    const err = new Error(body?.message || 'Something went wrong. Check your connection and try again.') as Error & {
      code?: string;
      status?: number;
      details?: Record<string, unknown>;
    };
    err.code = body?.code;
    err.status = error?.response?.status;
    err.details = body?.details;
    return Promise.reject(err);
  }
);

export type PublicApiError = Error & { code?: string; status?: number; details?: Record<string, unknown> };

const auth = (session: string) => ({ headers: { Authorization: `Bearer ${session}` } });

export const getPublicHandover = async (token: string) => {
  const { data } = await publicApi.get<ApiEnvelope<PublicHandoverInfoDto>>(`/${encodeURIComponent(token)}`);
  return data.data;
};

export const requestHandoverCode = async (token: string) => {
  const { data } = await publicApi.post<ApiEnvelope<{ sent: boolean; destination: string }>>(`/${encodeURIComponent(token)}/otp/request`);
  return data.data;
};

export const verifyHandoverCode = async (token: string, code: string) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverSessionDto>>(`/${encodeURIComponent(token)}/otp/verify`, { code });
  return data.data;
};

export const startHandoverSession = async (token: string) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverSessionDto>>(`/${encodeURIComponent(token)}/session`);
  return data.data;
};

export const presignHandoverUpload = async (token: string, session: string, file: { name: string; type: string; size: number }) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverPresignDto>>(
    `/${encodeURIComponent(token)}/uploads/presign`,
    { fileName: file.name, mimeType: file.type, byteSize: file.size },
    auth(session)
  );
  return data.data;
};

/** PUT to the presigned URL with progress (XHR: fetch has no upload progress). */
export function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try again.'));
    xhr.send(file);
  });
}

// Resumable uploads (files above HANDOVER_MULTIPART_THRESHOLD_BYTES).

export const startMultipartUpload = async (token: string, session: string, file: { name: string; type: string; size: number }) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverMultipartDto>>(
    `/${encodeURIComponent(token)}/uploads/multipart/start`,
    { fileName: file.name, mimeType: file.type, byteSize: file.size },
    auth(session)
  );
  return data.data;
};

export const signUploadParts = async (token: string, session: string, uploadTicket: string, partNumbers: number[]) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverMultipartPartUrl[]>>(
    `/${encodeURIComponent(token)}/uploads/multipart/parts`,
    { uploadTicket, partNumbers },
    auth(session)
  );
  return data.data;
};

export const multipartStatus = async (token: string, session: string, uploadTicket: string) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverMultipartStatusDto>>(
    `/${encodeURIComponent(token)}/uploads/multipart/status`,
    { uploadTicket },
    auth(session)
  );
  return data.data;
};

export const completeMultipartUpload = async (token: string, session: string, uploadTicket: string) => {
  const { data } = await publicApi.post<ApiEnvelope<{ objectKey: string }>>(
    `/${encodeURIComponent(token)}/uploads/multipart/complete`,
    { uploadTicket },
    auth(session)
  );
  return data.data;
};

/** PUT one part (no Content-Type: the object's type was set when the upload started). */
export function putPartWithProgress(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload interrupted. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.send(blob);
  });
}

export const submitHandover = async (token: string, session: string, body: SubmitHandoverInput) => {
  const { data } = await publicApi.post<ApiEnvelope<HandoverSubmittedDto>>(`/${encodeURIComponent(token)}/submit`, body, auth(session));
  return data.data;
};
