import type {
  CreateScheduleRevisionRequest,
  DecideScheduleRevisionRequest,
  PreviewScheduleRevisionRequest,
  ProjectScheduleDto,
  ProposedScheduleDatesDto,
  ProposeScheduleDatesRequest,
  SaveScheduleBaselineRequest,
  ScheduleRevisionDto,
  ScheduleRevisionPreviewDto,
} from "@insite/shared";
import { api } from "../../config/apiConfig";
import type { ApiEnvelope } from "../types";

/** Phase 9: schedule baseline, variance and "Catch Project Up" revisions. */
export const getProjectSchedule = async (projectId: string): Promise<ProjectScheduleDto> => {
  const { data } = await api.get<ApiEnvelope<ProjectScheduleDto>>(`/projects/${projectId}/schedule`);
  return data.data;
};

export const saveScheduleBaseline = async (projectId: string, body: SaveScheduleBaselineRequest): Promise<ProjectScheduleDto> => {
  const { data } = await api.put<ApiEnvelope<ProjectScheduleDto>>(`/projects/${projectId}/schedule/baseline`, body);
  return data.data;
};

export const proposeScheduleDates = async (projectId: string, body: ProposeScheduleDatesRequest): Promise<ProposedScheduleDatesDto> => {
  const { data } = await api.post<ApiEnvelope<ProposedScheduleDatesDto>>(`/projects/${projectId}/schedule/propose-dates`, body);
  return data.data;
};

export const getScheduleRevisions = async (projectId: string): Promise<ScheduleRevisionDto[]> => {
  const { data } = await api.get<ApiEnvelope<ScheduleRevisionDto[]>>(`/projects/${projectId}/schedule/revisions`);
  return data.data;
};

export const previewScheduleRevision = async (
  projectId: string,
  body: PreviewScheduleRevisionRequest,
): Promise<ScheduleRevisionPreviewDto> => {
  const { data } = await api.post<ApiEnvelope<ScheduleRevisionPreviewDto>>(`/projects/${projectId}/schedule/revisions/preview`, body);
  return data.data;
};

export const createScheduleRevision = async (projectId: string, body: CreateScheduleRevisionRequest): Promise<ScheduleRevisionDto> => {
  const { data } = await api.post<ApiEnvelope<ScheduleRevisionDto>>(`/projects/${projectId}/schedule/revisions`, body);
  return data.data;
};

export const decideScheduleRevision = async (params: {
  projectId: string;
  revisionId: string;
  decision: "approve" | "reject" | "withdraw";
  body: DecideScheduleRevisionRequest;
}): Promise<ScheduleRevisionDto> => {
  const { data } = await api.post<ApiEnvelope<ScheduleRevisionDto>>(
    `/projects/${params.projectId}/schedule/revisions/${params.revisionId}/${params.decision}`,
    params.body,
  );
  return data.data;
};
