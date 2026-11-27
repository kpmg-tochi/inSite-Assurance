import type {
  CloseNeedsCycleRequest,
  NeedsCarryForwardCandidateDto,
  NeedsCycleDocumentDto,
  NeedsCycleDto,
  NeedsCycleSummaryDto,
  NeedsFileLinkDto,
  NeedsOptionsDto,
  NeedsPresignedUploadDto,
  NeedsProposalDetailDto,
  NeedsProposalDocumentDto,
  NeedsProposalListQuery,
  NeedsProposalSummaryDto,
  NeedsUploadConfirmRequestInput,
  NeedsUploadPreviewDto,
  NeedsUploadPreviewRequestInput,
  NeedsUploadResultDto,
  OpenNeedsCycleRequestInput,
  RegisterCycleDocumentRequestInput,
  RegisterProposalDocumentRequestInput,
  UpdateNeedsCycleRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 2 (N3): annual needs assessment cycles, the upload of needs assessments and
 * the proposed projects (`/api/v1/needs`; reads `needs:view`, writes per route: open/update/close
 * and cycle documents `needs:manage_cycle`, upload `needs:submit`). The server also checks that the
 * user's organisation owns the cycle, so a hidden button is a convenience, not the rule.
 */

// ---------------------------------------------------------------------------
// Shared helpers (also used by `needsStandards.ts`)
// ---------------------------------------------------------------------------

/** The download name from Content-Disposition (filename* first, for non-ASCII names). */
export function attachmentName(disposition: string, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
}

/** A file (.xlsx) returned by the API, with its download name. */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

export async function downloadFile(url: string, fallbackName: string): Promise<DownloadedFile> {
  const res = await api.get<Blob>(url, { responseType: 'blob' });
  return { blob: res.data, fileName: attachmentName(String(res.headers['content-disposition'] ?? ''), fallbackName) };
}

/** PUTs a file to a presigned URL (also in local dev mode, whose signed URL stores it). */
export function putPresignedFile(uploadUrl: string, file: File, mimeType: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload of ${file.name} failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed. Check the connection and try again.`));
    xhr.send(file);
  });
}

/** The MIME type sent for a file (the browser's, else by extension). */
export function mimeTypeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
  };
  return byExt[ext] ?? 'application/octet-stream';
}

/** The coded error of a failed call (`{ error: { code, message, details } }`). */
export function apiErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
}

export function apiErrorDetails(err: unknown): unknown {
  return (err as { response?: { data?: { error?: { details?: unknown } } } })?.response?.data?.error?.details;
}

// ---------------------------------------------------------------------------
// Options and cycles
// ---------------------------------------------------------------------------

export const getNeedsOptions = async () => {
  const { data } = await api.get<ApiEnvelope<NeedsOptionsDto>>('/needs/options');
  return data.data;
};

export const listNeedsCycles = async () => {
  const { data } = await api.get<ApiEnvelope<NeedsCycleSummaryDto[]>>('/needs/cycles');
  return data.data;
};

export const listCarryForwardCandidates = async (params: { projectTypeId: string; interventionYear: number; stateCode?: string | null }) => {
  const { data } = await api.get<ApiEnvelope<NeedsCarryForwardCandidateDto[]>>('/needs/cycles/carry-forward', {
    params: { projectTypeId: params.projectTypeId, interventionYear: params.interventionYear, ...(params.stateCode ? { stateCode: params.stateCode } : {}) },
  });
  return data.data;
};

export const openNeedsCycle = async (body: OpenNeedsCycleRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsCycleDto>>('/needs/cycles', body);
  return data.data;
};

export const getNeedsCycle = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsCycleDto>>(`/needs/cycles/${cycleId}`);
  return data.data;
};

export const updateNeedsCycle = async (cycleId: string, body: UpdateNeedsCycleRequest) => {
  const { data } = await api.patch<ApiEnvelope<NeedsCycleDto>>(`/needs/cycles/${cycleId}`, body);
  return data.data;
};

export const closeNeedsCycle = async (cycleId: string, body: Partial<CloseNeedsCycleRequest>) => {
  const { data } = await api.post<ApiEnvelope<NeedsCycleDto>>(`/needs/cycles/${cycleId}/close`, body);
  return data.data;
};

/** The blank needs assessment template for the cycle (.xlsx). */
export const downloadCycleTemplate = (cycleId: string) => downloadFile(`/needs/cycles/${cycleId}/template`, 'Needs assessment template.xlsx');

// ---------------------------------------------------------------------------
// Cycle and proposal documents (presign through the cycle, PUT, register)
// ---------------------------------------------------------------------------

/** Uploads one file to the cycle's document area and returns its object key. */
export const uploadNeedsDocumentFile = async (cycleId: string, file: File): Promise<string> => {
  const mimeType = mimeTypeOf(file);
  const { data } = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>(`/needs/cycles/${cycleId}/documents/presign`, {
    fileName: file.name,
    mimeType,
    byteSize: file.size,
  });
  await putPresignedFile(data.data.uploadUrl, file, mimeType);
  return data.data.objectKey;
};

export const listCycleDocuments = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsCycleDocumentDto[]>>(`/needs/cycles/${cycleId}/documents`);
  return data.data;
};

export const registerCycleDocument = async (cycleId: string, body: RegisterCycleDocumentRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto>>(`/needs/cycles/${cycleId}/documents`, body);
  return data.data;
};

export const getCycleDocumentLink = async (cycleId: string, documentId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsFileLinkDto>>(`/needs/cycles/${cycleId}/documents/${documentId}/file`, { params: { format: 'json' } });
  return data.data;
};

export const listProposalDocuments = async (proposalId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsProposalDocumentDto[]>>(`/needs/proposals/${proposalId}/documents`);
  return data.data;
};

export const registerProposalDocument = async (proposalId: string, body: RegisterProposalDocumentRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsProposalDocumentDto>>(`/needs/proposals/${proposalId}/documents`, body);
  return data.data;
};

export const getProposalDocumentLink = async (proposalId: string, documentId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsFileLinkDto>>(`/needs/proposals/${proposalId}/documents/${documentId}/file`, { params: { format: 'json' } });
  return data.data;
};

// ---------------------------------------------------------------------------
// Upload of needs assessments (preview writes nothing; confirm by sha256)
// ---------------------------------------------------------------------------

export const previewNeedsUpload = async (cycleId: string, body: NeedsUploadPreviewRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsUploadPreviewDto>>(`/needs/cycles/${cycleId}/uploads/preview`, body);
  return data.data;
};

export const confirmNeedsUpload = async (cycleId: string, body: NeedsUploadConfirmRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsUploadResultDto>>(`/needs/cycles/${cycleId}/uploads/confirm`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Proposed projects
// ---------------------------------------------------------------------------

export const listNeedsProposals = async (cycleId: string, query: NeedsProposalListQuery) => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<ApiEnvelope<NeedsProposalSummaryDto[]>>(`/needs/cycles/${cycleId}/proposals`, { params });
  return data.data;
};

export const getNeedsProposal = async (proposalId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsProposalDetailDto>>(`/needs/proposals/${proposalId}`);
  return data.data;
};

/** The needs assessment template pre-filled from the proposal's current version (.xlsx). */
export const downloadProposalTemplate = (proposalId: string) => downloadFile(`/needs/proposals/${proposalId}/template`, 'Needs assessment.xlsx');

export const getVersionFileLink = async (proposalId: string, versionNumber: number) => {
  const { data } = await api.get<ApiEnvelope<NeedsFileLinkDto>>(`/needs/proposals/${proposalId}/versions/${versionNumber}/file`, { params: { format: 'json' } });
  return data.data;
};
