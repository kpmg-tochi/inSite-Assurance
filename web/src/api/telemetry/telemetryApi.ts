import type {
  CreateWorkdayReportQueryRequest,
  ReportQueryDto,
  ResolveReportQueryRequest,
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

/** Monitor closes a workday-report query (answered or withdrawn). */
export const resolveReportQuery = async (params: {
  projectId: string;
  queryId: string;
  body: ResolveReportQueryRequest;
}): Promise<ReportQueryDto> => {
  const { data } = await api.post<ApiEnvelope<ReportQueryDto>>(
    `/projects/${params.projectId}/report-queries/${params.queryId}/resolve`,
    params.body,
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
