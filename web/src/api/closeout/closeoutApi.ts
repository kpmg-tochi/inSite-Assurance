import type {
  AssignDefectTicketRequest,
  CertifyRetentionReleaseRequest,
  ChangeProjectPhaseRequest,
  ConvertSnagsInput,
  CreateDefectTicketInput,
  CreateHandoverLinkInput,
  DefectTicketDto,
  HandoverLinkDto,
  HandoverLinkIssuedDto,
  HandoverSubmissionDto,
  LenderTrancheDecisionRequest,
  ProjectPhaseDto,
  RectifyDefectTicketInput,
  RejectDefectTicketRequest,
  RequestRetentionReleaseRequest,
  RetentionReleaseRequestDto,
  RetentionSummaryDto,
  TrancheDecisionDto,
  VerifyDefectTicketInput,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 10 (authenticated): construction phase, handover links and review, defects, retention. */

// Construction phase

export const getProjectPhase = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectPhaseDto>>(`/projects/${projectId}/phase`);
  return data.data;
};

export const changeProjectPhase = async (projectId: string, body: ChangeProjectPhaseRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectPhaseDto>>(`/projects/${projectId}/phase`, body);
  return data.data;
};

// Handover links and submissions

export const listHandoverLinks = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<HandoverLinkDto[]>>(`/projects/${projectId}/handover/links`);
  return data.data;
};

export const createHandoverLink = async (projectId: string, body: CreateHandoverLinkInput) => {
  const { data } = await api.post<ApiEnvelope<HandoverLinkIssuedDto>>(`/projects/${projectId}/handover/links`, body);
  return data.data;
};

export const revokeHandoverLink = async (projectId: string, linkId: string) => {
  const { data } = await api.post<ApiEnvelope<HandoverLinkDto>>(`/projects/${projectId}/handover/links/${linkId}/revoke`);
  return data.data;
};

export const reissueHandoverLink = async (projectId: string, linkId: string, body: { expiresInDays?: number; sendNow?: boolean }) => {
  const { data } = await api.post<ApiEnvelope<HandoverLinkIssuedDto>>(`/projects/${projectId}/handover/links/${linkId}/reissue`, body);
  return data.data;
};

export const listHandoverSubmissions = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<HandoverSubmissionDto[]>>(`/projects/${projectId}/handover/submissions`);
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
  | { kind: 'rectify'; body: RectifyDefectTicketInput }
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

export const requestRetentionRelease = async (projectId: string, body: RequestRetentionReleaseRequest) => {
  const { data } = await api.post<ApiEnvelope<RetentionReleaseRequestDto>>(`/projects/${projectId}/retention/release-request`, body);
  return data.data;
};

export const certifyRetentionRelease = async (projectId: string, requestId: string, body: CertifyRetentionReleaseRequest) => {
  const { data } = await api.post<ApiEnvelope<RetentionReleaseRequestDto>>(
    `/projects/${projectId}/retention/release-requests/${requestId}/certify`,
    body
  );
  return data.data;
};

export const cancelRetentionRelease = async (projectId: string, requestId: string) => {
  const { data } = await api.post<ApiEnvelope<RetentionReleaseRequestDto>>(
    `/projects/${projectId}/retention/release-requests/${requestId}/cancel`
  );
  return data.data;
};

export const decideRetentionRelease = async (
  projectId: string,
  valuationId: string,
  body: Omit<LenderTrancheDecisionRequest, 'valuationReportId'>
) => {
  const { data } = await api.post<ApiEnvelope<TrancheDecisionDto>>(
    `/projects/${projectId}/retention/valuations/${valuationId}/decision`,
    body
  );
  return data.data;
};
