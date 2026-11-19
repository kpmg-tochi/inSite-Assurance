import type {
  RevalidateWorkdayReportRequest,
  SubmitWorkdayReportRequest,
  SuggestWorkdaySummaryRequest,
  SuggestWorkdaySummaryResponse,
  WorkdayReportDto,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/** Idempotent on clientReportId: a retry returns the original report. */
export const submitWorkdayReport = async (
  projectId: string,
  payload: SubmitWorkdayReportRequest
): Promise<WorkdayReportDto> => {
  return mobileRequest<WorkdayReportDto>(`/projects/${projectId}/workday-reports`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const revalidateWorkdayReport = async (
  projectId: string,
  reportId: string,
  payload: RevalidateWorkdayReportRequest
): Promise<WorkdayReportDto> => {
  return mobileRequest<WorkdayReportDto>(
    `/projects/${projectId}/workday-reports/${reportId}/revalidate`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
};

/** Optional assist: transcripts and a suggested summary. Returns nothing invented. */
export const suggestWorkdaySummary = async (
  projectId: string,
  payload: SuggestWorkdaySummaryRequest
): Promise<SuggestWorkdaySummaryResponse> => {
  return mobileRequest<SuggestWorkdaySummaryResponse>(
    `/projects/${projectId}/workday-reports/suggest`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
};

/** The calling reporter's own reports (field sessions only ever see their own). */
export const listOwnWorkdayReports = async (
  projectId: string,
  workdayDate?: string
): Promise<WorkdayReportDto[]> => {
  const q = workdayDate ? `?workdayDate=${encodeURIComponent(workdayDate)}` : '';
  return mobileRequest<WorkdayReportDto[]>(`/projects/${projectId}/workday-reports${q}`);
};
