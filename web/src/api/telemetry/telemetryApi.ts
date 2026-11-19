import type {
  CreateWorkdayReportQueryRequest,
  ReportQueryDto,
  SiteTelemetryPingDto,
  WorkdayReportDto,
} from "@insite/shared";
import { api } from "../../config/apiConfig";
import type { ApiEnvelope } from "../types";

/** Server contract for GET /projects/:projectId/workday-reports (Phase 4). */
export type WorkdayReportRecordDto = WorkdayReportDto;

export const getProjectTelemetryPings = async (
  projectId: string,
  params?: { date?: string; fieldSessionId?: string },
): Promise<SiteTelemetryPingDto[]> => {
  const { data } = await api.get<ApiEnvelope<SiteTelemetryPingDto[]>>(
    `/projects/${projectId}/telemetry`,
    { params },
  );
  return data.data;
};

export const getProjectWorkdayReports = async (
  projectId: string,
  params?: { workdayDate?: string },
): Promise<WorkdayReportRecordDto[]> => {
  const { data } = await api.get<ApiEnvelope<WorkdayReportRecordDto[]>>(
    `/projects/${projectId}/workday-reports`,
    { params },
  );
  return data.data;
};

export const createWorkdayReportQuery = async (params: {
  projectId: string;
  reportId: string;
  body: CreateWorkdayReportQueryRequest;
}): Promise<ReportQueryDto> => {
  const { data } = await api.post<ApiEnvelope<ReportQueryDto>>(
    `/projects/${params.projectId}/workday-reports/${params.reportId}/queries`,
    params.body,
  );
  return data.data;
};
