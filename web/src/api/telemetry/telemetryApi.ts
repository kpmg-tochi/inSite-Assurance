import type { SiteTelemetryPingDto, SubmissionGeotag } from "@insite/shared";
import { api } from "../../config/apiConfig";
import type { ApiEnvelope } from "../types";

export interface WorkdayReportRecordDto {
  id: string;
  projectId: string;
  reporterSessionId: string;
  reporterName: string;
  reporterTier: string;
  wbsItemId: string;
  wbsCode: string;
  wbsDescription: string;
  workdayDate: string;
  status: string;
  summaryText: string;
  reportedQuantity: number;
  unitOfMeasure: string;
  isHoldPointClaimed: boolean;
  evidenceItems: Array<{
    id: string;
    type: string;
    mediaUrl?: string;
    caption?: string;
    capturedAt: string;
  }>;
  voiceNoteUrl: string | null;
  submissionGeotag: SubmissionGeotag | null;
  humanConfirmedAt: string | null;
  createdAt: string;
}

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

