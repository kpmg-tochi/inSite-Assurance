import type {
  AttendanceAlertActionRequest,
  AttendanceAlertStatus,
  CreateExpectedParticipantRequest,
  ExpectedParticipantDto,
  ProjectCadenceOverviewDto,
  ProjectReminderSettings,
  ReportingObligationDto,
  SiteAttendanceAlertDto,
  UpdateExpectedParticipantRequest,
} from "@insite/shared";
import { api } from "../../config/apiConfig";
import type { ApiEnvelope } from "../types";

/** Phase 8: cadence overview (settings, current period, obligations and counts). */
export const getCadenceOverview = async (projectId: string): Promise<ProjectCadenceOverviewDto> => {
  const { data } = await api.get<ApiEnvelope<ProjectCadenceOverviewDto>>(`/projects/${projectId}/cadence`);
  return data.data;
};

export const getReportingObligations = async (
  projectId: string,
  params?: { periodStart?: string; view?: "due" },
): Promise<ReportingObligationDto[]> => {
  const { data } = await api.get<ApiEnvelope<ReportingObligationDto[]>>(`/projects/${projectId}/reporting-obligations`, { params });
  return data.data;
};

export const excuseReportingObligation = async (params: {
  projectId: string;
  obligationId: string;
  notes: string;
}): Promise<ReportingObligationDto> => {
  const { data } = await api.post<ApiEnvelope<ReportingObligationDto>>(
    `/projects/${params.projectId}/reporting-obligations/${params.obligationId}/excuse`,
    { notes: params.notes },
  );
  return data.data;
};

export const getParticipants = async (projectId: string): Promise<ExpectedParticipantDto[]> => {
  const { data } = await api.get<ApiEnvelope<ExpectedParticipantDto[]>>(`/projects/${projectId}/participants`);
  return data.data;
};

export const createParticipant = async (projectId: string, body: CreateExpectedParticipantRequest): Promise<ExpectedParticipantDto> => {
  const { data } = await api.post<ApiEnvelope<ExpectedParticipantDto>>(`/projects/${projectId}/participants`, body);
  return data.data;
};

export const updateParticipant = async (
  projectId: string,
  participantId: string,
  body: UpdateExpectedParticipantRequest,
): Promise<ExpectedParticipantDto> => {
  const { data } = await api.patch<ApiEnvelope<ExpectedParticipantDto>>(`/projects/${projectId}/participants/${participantId}`, body);
  return data.data;
};

export const deleteParticipant = async (projectId: string, participantId: string): Promise<void> => {
  await api.delete(`/projects/${projectId}/participants/${participantId}`);
};

export const saveReminderSettings = async (projectId: string, body: ProjectReminderSettings): Promise<ProjectReminderSettings> => {
  const { data } = await api.put<ApiEnvelope<ProjectReminderSettings>>(`/projects/${projectId}/participants/reminder-settings`, body);
  return data.data;
};

export const getAttendanceAlerts = async (
  projectId: string,
  params?: { status?: AttendanceAlertStatus[]; type?: string[] },
): Promise<SiteAttendanceAlertDto[]> => {
  const { data } = await api.get<ApiEnvelope<SiteAttendanceAlertDto[]>>(`/projects/${projectId}/attendance-alerts`, {
    params: {
      status: params?.status?.length ? params.status.join(",") : undefined,
      type: params?.type?.length ? params.type.join(",") : undefined,
    },
  });
  return data.data;
};

export const actOnAttendanceAlert = async (params: {
  projectId: string;
  alertId: string;
  body: AttendanceAlertActionRequest;
}): Promise<SiteAttendanceAlertDto> => {
  const { data } = await api.post<ApiEnvelope<SiteAttendanceAlertDto>>(
    `/projects/${params.projectId}/attendance-alerts/${params.alertId}/action`,
    params.body,
  );
  return data.data;
};
