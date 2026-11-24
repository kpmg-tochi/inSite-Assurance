import type {
  ActOnDefaultCaseRequest,
  AddDocumentVersionRequest,
  ArchiveProjectDocumentRequest,
  CompleteMilestoneRequest,
  ContractorDefaultCaseDto,
  DocumentDownloadDto,
  DocumentTypeDto,
  MobilisationComplianceRow,
  ProjectDocumentDetailDto,
  ProjectDocumentDto,
  ProjectKickoffDto,
  ProjectMilestonesDto,
  RaiseDefaultCaseRequest,
  RecordKickoffHeldRequest,
  RegisterProjectDocumentRequest,
  SaveDocumentTypeRequestInput,
  SaveKickoffMeetingRequest,
  SendKickoffNoticeRequest,
  SignProjectDocumentRequest,
  WaiveMilestoneRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/**
 * Phase 13: document register, document types, contract milestones, kick-off meeting, mobilisation
 * compliance and contractor default cases (termination). Redesign R2d: the programme of works is a document.
 */

const base = (projectId: string) => `/projects/${projectId}`;

/** Largest file the register accepts (the server enforces the same limit). */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Upload: presign, then PUT the file (also in local dev mode, whose signed URL stores it).
// ---------------------------------------------------------------------------

export const uploadProjectDocumentFile = async (
  projectId: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<string> => {
  const mimeType = (file.type || 'application/octet-stream').toLowerCase();
  const { data } = await api.post<ApiEnvelope<{ objectKey: string; uploadUrl: string; storageMode: string }>>(
    `${base(projectId)}/evidence/presign`,
    { mediaType: 'PROJECT_DOCUMENT', fileName: file.name, mimeType, byteSize: file.size }
  );
  const presigned = data.data;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presigned.uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else reject(new Error(`Upload of ${file.name} failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed. Check the connection and try again.`));
    xhr.send(file);
  });
  return presigned.objectKey;
};

// ---------------------------------------------------------------------------
// Document types (tenant)
// ---------------------------------------------------------------------------

export const listDocumentTypes = async (includeArchived = false) => {
  const { data } = await api.get<ApiEnvelope<DocumentTypeDto[]>>('/document-types', {
    params: includeArchived ? { includeArchived: 'true' } : {},
  });
  return data.data;
};

export const createDocumentType = async (body: SaveDocumentTypeRequestInput) => {
  const { data } = await api.post<ApiEnvelope<DocumentTypeDto>>('/document-types', body);
  return data.data;
};

export const updateDocumentType = async (id: string, body: SaveDocumentTypeRequestInput) => {
  const { data } = await api.put<ApiEnvelope<DocumentTypeDto>>(`/document-types/${id}`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Project documents
// ---------------------------------------------------------------------------

export interface DocumentFilters {
  typeCode?: string;
  contractorId?: string;
  includeArchived?: boolean;
}

export const listProjectDocuments = async (projectId: string, f: DocumentFilters = {}) => {
  const params: Record<string, string> = {};
  if (f.typeCode) params.typeCode = f.typeCode;
  if (f.contractorId) params.contractorId = f.contractorId;
  if (f.includeArchived) params.includeArchived = 'true';
  const { data } = await api.get<ApiEnvelope<ProjectDocumentDto[]>>(`${base(projectId)}/documents`, { params });
  return data.data;
};

export const getProjectDocument = async (projectId: string, documentId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectDocumentDetailDto>>(`${base(projectId)}/documents/${documentId}`);
  return data.data;
};

export const registerProjectDocument = async (projectId: string, body: RegisterProjectDocumentRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectDocumentDetailDto>>(`${base(projectId)}/documents`, body);
  return data.data;
};

export const addDocumentVersion = async (projectId: string, documentId: string, body: AddDocumentVersionRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectDocumentDetailDto>>(`${base(projectId)}/documents/${documentId}/versions`, body);
  return data.data;
};

export const signProjectDocument = async (projectId: string, documentId: string, body: SignProjectDocumentRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectDocumentDetailDto>>(`${base(projectId)}/documents/${documentId}/sign-off`, body);
  return data.data;
};

export const archiveProjectDocument = async (projectId: string, documentId: string, body: ArchiveProjectDocumentRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectDocumentDetailDto>>(`${base(projectId)}/documents/${documentId}/archive`, body);
  return data.data;
};

export const getDocumentDownload = async (projectId: string, documentId: string, version?: number) => {
  const { data } = await api.get<ApiEnvelope<DocumentDownloadDto>>(`${base(projectId)}/documents/${documentId}/download`, {
    params: version ? { version: String(version) } : {},
  });
  return data.data;
};

// ---------------------------------------------------------------------------
// Contract milestones
// ---------------------------------------------------------------------------

export const getProjectMilestones = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectMilestonesDto>>(`${base(projectId)}/milestones`);
  return data.data;
};

export const completeMilestone = async (projectId: string, milestoneId: string, body: CompleteMilestoneRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectMilestonesDto>>(`${base(projectId)}/milestones/${milestoneId}/complete`, body);
  return data.data;
};

export const waiveMilestone = async (projectId: string, milestoneId: string, body: WaiveMilestoneRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectMilestonesDto>>(`${base(projectId)}/milestones/${milestoneId}/waive`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Kick-off meeting
// ---------------------------------------------------------------------------

export const getKickoff = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectKickoffDto>>(`${base(projectId)}/kickoff`);
  return data.data;
};

export const saveKickoff = async (projectId: string, body: SaveKickoffMeetingRequest) => {
  const { data } = await api.put<ApiEnvelope<ProjectKickoffDto>>(`${base(projectId)}/kickoff`, body);
  return data.data;
};

export const sendKickoffNotice = async (projectId: string, body: SendKickoffNoticeRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectKickoffDto>>(`${base(projectId)}/kickoff/send-notice`, body);
  return data.data;
};

export const recordKickoffHeld = async (projectId: string, body: RecordKickoffHeldRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectKickoffDto>>(`${base(projectId)}/kickoff/held`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Mobilisation compliance and default cases
// ---------------------------------------------------------------------------

export const getMobilisationCompliance = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<MobilisationComplianceRow[]>>(`${base(projectId)}/mobilisation-compliance`);
  return data.data;
};

export const listDefaultCases = async (projectId: string, f: { contractorId?: string; openOnly?: boolean } = {}) => {
  const params: Record<string, string> = {};
  if (f.contractorId) params.contractorId = f.contractorId;
  if (f.openOnly) params.openOnly = 'true';
  const { data } = await api.get<ApiEnvelope<ContractorDefaultCaseDto[]>>(`${base(projectId)}/default-cases`, { params });
  return data.data;
};

export const getDefaultCase = async (projectId: string, caseId: string) => {
  const { data } = await api.get<ApiEnvelope<ContractorDefaultCaseDto>>(`${base(projectId)}/default-cases/${caseId}`);
  return data.data;
};

export const raiseDefaultCase = async (projectId: string, body: RaiseDefaultCaseRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorDefaultCaseDto>>(`${base(projectId)}/default-cases`, body);
  return data.data;
};

export const actOnDefaultCase = async (projectId: string, caseId: string, body: ActOnDefaultCaseRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorDefaultCaseDto>>(`${base(projectId)}/default-cases/${caseId}/act`, body);
  return data.data;
};

