import type {
  DismissInspectionFindingRequest,
  InspectionChecklistTemplateDto,
  InspectionFindingDto,
  InspectionOverviewDto,
  ProjectReportingStreamsDto,
  RaiseInspectionFindingRequest,
  ReviewSiteInspectionRequest,
  SaveChecklistTemplateRequestInput,
  SaveReportingStreamsRequest,
  SiteInspectionDto,
  SiteInspectionSummaryDto,
  SupervisorWorkloadDto,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 14: reporting streams, site inspections, findings, checklist templates, supervision. */

// Reporting streams

export const getReportingStreams = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectReportingStreamsDto>>(`/projects/${projectId}/reporting-streams`);
  return data.data;
};

export const saveReportingStreams = async (projectId: string, body: SaveReportingStreamsRequest) => {
  const { data } = await api.put<ApiEnvelope<ProjectReportingStreamsDto>>(`/projects/${projectId}/reporting-streams`, body);
  return data.data;
};

// Inspections

export interface InspectionFilters {
  visitType?: string;
  overallFinding?: string;
  status?: string;
  late?: boolean;
  openFindings?: boolean;
}

export const listInspections = async (projectId: string, f: InspectionFilters = {}) => {
  const params: Record<string, string> = {};
  if (f.visitType) params.visitType = f.visitType;
  if (f.overallFinding) params.overallFinding = f.overallFinding;
  if (f.status) params.status = f.status;
  if (f.late) params.late = 'true';
  if (f.openFindings) params.openFindings = 'true';
  const { data } = await api.get<ApiEnvelope<SiteInspectionSummaryDto[]>>(`/projects/${projectId}/inspections`, { params });
  return data.data;
};

export const getInspection = async (projectId: string, inspectionId: string) => {
  const { data } = await api.get<ApiEnvelope<SiteInspectionDto>>(`/projects/${projectId}/inspections/${inspectionId}`);
  return data.data;
};

export const getInspectionOverview = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<InspectionOverviewDto>>(`/projects/${projectId}/inspections/overview`);
  return data.data;
};

export const reviewInspection = async (projectId: string, inspectionId: string, body: ReviewSiteInspectionRequest) => {
  const { data } = await api.post<ApiEnvelope<SiteInspectionDto>>(`/projects/${projectId}/inspections/${inspectionId}/review`, body);
  return data.data;
};

// Findings

export const listFindings = async (projectId: string, status?: string) => {
  const { data } = await api.get<ApiEnvelope<InspectionFindingDto[]>>(`/projects/${projectId}/inspection-findings`, {
    params: status ? { status } : {},
  });
  return data.data;
};

export const raiseFinding = async (projectId: string, inspectionId: string, body: RaiseInspectionFindingRequest) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/inspections/${inspectionId}/findings`, body);
  return data.data;
};

export const resolveFinding = async (projectId: string, findingId: string, notes: string) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/inspection-findings/${findingId}/resolve`, {
    notes,
    clientCaptureIds: [],
  });
  return data.data;
};

export const dismissFinding = async (projectId: string, findingId: string, body: DismissInspectionFindingRequest) => {
  const { data } = await api.post<ApiEnvelope<InspectionFindingDto>>(`/projects/${projectId}/inspection-findings/${findingId}/dismiss`, body);
  return data.data;
};

// Checklist templates (tenant)

export const listChecklistTemplates = async (includeArchived = false) => {
  const { data } = await api.get<ApiEnvelope<InspectionChecklistTemplateDto[]>>('/inspection-templates', {
    params: includeArchived ? { includeArchived: 'true' } : {},
  });
  return data.data;
};

export const createChecklistTemplate = async (body: SaveChecklistTemplateRequestInput) => {
  const { data } = await api.post<ApiEnvelope<InspectionChecklistTemplateDto>>('/inspection-templates', body);
  return data.data;
};

export const updateChecklistTemplate = async (code: string, body: SaveChecklistTemplateRequestInput) => {
  const { data } = await api.put<ApiEnvelope<InspectionChecklistTemplateDto>>(`/inspection-templates/${code}`, body);
  return data.data;
};

export const setChecklistTemplateArchived = async (code: string, archived: boolean) => {
  const { data } = await api.post<ApiEnvelope<InspectionChecklistTemplateDto[]>>(`/inspection-templates/${code}/${archived ? 'archive' : 'restore'}`);
  return data.data;
};

// Supervision

export const listSupervisors = async () => {
  const { data } = await api.get<ApiEnvelope<SupervisorWorkloadDto[]>>('/supervision');
  return data.data;
};

export const getTeamWorkload = async (projectId: string, userIds: string[]) => {
  const { data } = await api.get<ApiEnvelope<SupervisorWorkloadDto[]>>(`/projects/${projectId}/supervision/workload`, {
    params: { userIds: userIds.join(',') },
  });
  return data.data;
};
