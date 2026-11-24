import type { ProjectCadenceOverviewDto, ReportingObligationDto } from "@insite/shared";
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
