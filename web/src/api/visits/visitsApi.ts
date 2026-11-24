import type {
  CancelVisitRequest,
  CreateVisitRequestInput,
  DecideVisitProposalRequest,
  DismissInspectionFindingRequest,
  GenerateVisitsRequestInput,
  GenerateVisitsResult,
  InspectionFindingDto,
  PlannerDto,
  ProjectVisitsDto,
  RaiseVisitFindingRequestInput,
  RebuildVisitFormResult,
  ReviewVisitSubmissionRequest,
  SiteLogEntryDto,
  SprintVerificationViewDto,
  UpdateVisitRequest,
  VerifySprintRequest,
  VisitCommentDto,
  VisitDetailDto,
  VisitDto,
  VisitOfficersDto,
  VisitPlanPreviewDto,
  VisitSubmissionDto,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Redesign R4: visits, the planner, submissions review, findings, site log and sprint verification. */

export interface VisitFilters {
  from?: string;
  to?: string;
  status?: string;
  visitKind?: string;
}

export const listProjectVisits = async (projectId: string, filters: VisitFilters = {}) => {
  const { data } = await api.get<ApiEnvelope<ProjectVisitsDto>>(`/projects/${projectId}/visits`, { params: filters });
  return data.data;
};

export const getVisitDetail = async (projectId: string, visitId: string) => {
  const { data } = await api.get<ApiEnvelope<VisitDetailDto>>(`/projects/${projectId}/visits/${visitId}`);
  return data.data;
};

export const getVisitPlanPreview = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<VisitPlanPreviewDto>>(`/projects/${projectId}/visit-plan/preview`);
  return data.data;
};

export const getVisitOfficers = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<VisitOfficersDto>>(`/projects/${projectId}/visit-officers`);
  return data.data;
};

export const saveVisitOfficers = async (projectId: string, userIds: string[]) => {
  const { data } = await api.put<ApiEnvelope<VisitOfficersDto>>(`/projects/${projectId}/visit-officers`, { userIds });
  return data.data;
};

export const createVisit = async (projectId: string, body: CreateVisitRequestInput) => {
  const { data } = await api.post<ApiEnvelope<VisitDto>>(`/projects/${projectId}/visits`, body);
  return data.data;
};

export const updateVisit = async (projectId: string, visitId: string, body: UpdateVisitRequest) => {
  const { data } = await api.patch<ApiEnvelope<VisitDto>>(`/projects/${projectId}/visits/${visitId}`, body);
  return data.data;
};

export const publishVisits = async (projectId: string, visitIds: string[]) => {
  const { data } = await api.post<ApiEnvelope<VisitDto[]>>(`/projects/${projectId}/visits/publish`, { visitIds });
  return data.data;
};

export const cancelVisit = async (projectId: string, visitId: string, body: CancelVisitRequest) => {
  const { data } = await api.post<ApiEnvelope<VisitDto>>(`/projects/${projectId}/visits/${visitId}/cancel`, body);
  return data.data;
};

export const rebuildVisitForm = async (projectId: string, visitId: string) => {
  const { data } = await api.post<ApiEnvelope<RebuildVisitFormResult>>(`/projects/${projectId}/visits/${visitId}/rebuild-form`);
  return data.data;
};

export const generateVisits = async (projectId: string, body: GenerateVisitsRequestInput) => {
  const { data } = await api.post<ApiEnvelope<GenerateVisitsResult>>(`/projects/${projectId}/visits/generate`, body);
  return data.data;
};

export const decideVisitProposal = async (projectId: string, visitId: string, changeId: string, body: DecideVisitProposalRequest) => {
  const { data } = await api.post<ApiEnvelope<VisitDto>>(`/projects/${projectId}/visits/${visitId}/date-changes/${changeId}/decide`, body);
  return data.data;
};

export const reviewVisitSubmission = async (projectId: string, visitId: string, submissionId: string, body: ReviewVisitSubmissionRequest) => {
  const { data } = await api.post<ApiEnvelope<VisitSubmissionDto>>(`/projects/${projectId}/visits/${visitId}/submissions/${submissionId}/review`, body);
  return data.data;
};

export const addVisitComment = async (projectId: string, visitId: string, text: string) => {
  const { data } = await api.post<ApiEnvelope<VisitCommentDto>>(`/projects/${projectId}/visits/${visitId}/comments`, { text });
  return data.data;
};

export const raiseVisitFinding = async (projectId: string, visitId: string, body: RaiseVisitFindingRequestInput) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/visits/${visitId}/findings`, body);
  return data.data;
};

// Planner (tenant)

export interface PlannerFilters {
  from: string;
  to: string;
  regionId?: string;
  projectId?: string;
  officerId?: string;
  visitKind?: string;
}

export const getPlanner = async (filters: PlannerFilters) => {
  const { data } = await api.get<ApiEnvelope<PlannerDto>>('/visits', { params: filters });
  return data.data;
};

// Findings (R4d)

export const listProjectFindings = async (projectId: string, params: { status?: string; visitId?: string } = {}) => {
  const { data } = await api.get<ApiEnvelope<InspectionFindingDto[]>>(`/projects/${projectId}/findings`, { params });
  return data.data;
};

export const resolveProjectFinding = async (projectId: string, findingId: string, notes: string) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/findings/${findingId}/resolve`, { notes, clientCaptureIds: [] });
  return data.data;
};

export const dismissProjectFinding = async (projectId: string, findingId: string, body: DismissInspectionFindingRequest) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/findings/${findingId}/dismiss`, body);
  return data.data;
};

// Site log (R4c)

export const listSiteLog = async (projectId: string, params: { includeAttached?: boolean; includeHidden?: boolean } = {}) => {
  const { data } = await api.get<ApiEnvelope<SiteLogEntryDto[]>>(`/projects/${projectId}/site-log`, { params });
  return data.data;
};

// Sprint verification (R4e)

export const getSprintVerification = async (projectId: string, sprintId: string) => {
  const { data } = await api.get<ApiEnvelope<SprintVerificationViewDto>>(`/projects/${projectId}/scope/sprints/${sprintId}/verification`);
  return data.data;
};

export const verifySprint = async (projectId: string, sprintId: string, body: VerifySprintRequest) => {
  const { data } = await api.post<ApiEnvelope<SprintVerificationViewDto>>(`/projects/${projectId}/scope/sprints/${sprintId}/verification`, body);
  return data.data;
};
