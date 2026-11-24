import type {
  AssignDefectTicketRequest,
  ChangeProjectPhaseRequest,
  ConvertSnagsInput,
  CreateDefectTicketInput,
  DefectTicketDto,
  HandoverSubmissionDto,
  ProjectPhaseDto,
  RecordHandoverResponseInput,
  RejectDefectTicketRequest,
  RetentionSummaryDto,
  VerifyDefectTicketInput,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 10 (authenticated): construction phase, handover responses and review, defects, retention. */

// Construction phase

export const getProjectPhase = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectPhaseDto>>(`/projects/${projectId}/phase`);
  return data.data;
};

export const changeProjectPhase = async (projectId: string, body: ChangeProjectPhaseRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectPhaseDto>>(`/projects/${projectId}/phase`, body);
  return data.data;
};

// Handover responses (recorded by an officer from the signed paper copy)

export const listHandoverSubmissions = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<HandoverSubmissionDto[]>>(`/projects/${projectId}/handover/submissions`);
  return data.data;
};

export const recordHandoverResponse = async (projectId: string, body: RecordHandoverResponseInput) => {
  const { data } = await api.post<ApiEnvelope<HandoverSubmissionDto>>(`/projects/${projectId}/handover/submissions`, body);
  return data.data;
};

export const reviewHandoverSubmission = async (projectId: string, submissionId: string, notes?: string) => {
  const { data } = await api.post<ApiEnvelope<HandoverSubmissionDto>>(
    `/projects/${projectId}/handover/submissions/${submissionId}/review`,
    { notes: notes || undefined }
  );
  return data.data;
};

export const convertSnagsToDefects = async (projectId: string, submissionId: string, body: ConvertSnagsInput) => {
  const { data } = await api.post<ApiEnvelope<{ created: number; skipped: number }>>(
    `/projects/${projectId}/handover/submissions/${submissionId}/defects`,
    body
  );
  return data.data;
};

// Defect tickets

export const listDefectTickets = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<DefectTicketDto[]>>(`/projects/${projectId}/defects`);
  return data.data;
};

export const createDefectTicket = async (projectId: string, body: CreateDefectTicketInput) => {
  const { data } = await api.post<ApiEnvelope<DefectTicketDto>>(`/projects/${projectId}/defects`, body);
  return data.data;
};

export type DefectAction =
  | { kind: 'assign'; body: AssignDefectTicketRequest }
  | { kind: 'verify'; body: VerifyDefectTicketInput }
  | { kind: 'reject'; body: RejectDefectTicketRequest };

export const actOnDefectTicket = async (projectId: string, ticketId: string, action: DefectAction) => {
  const { data } = await api.post<ApiEnvelope<DefectTicketDto>>(`/projects/${projectId}/defects/${ticketId}/${action.kind}`, action.body);
  return data.data;
};

// Retention

export const getRetentionSummary = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<RetentionSummaryDto>>(`/projects/${projectId}/retention`);
  return data.data;
};
