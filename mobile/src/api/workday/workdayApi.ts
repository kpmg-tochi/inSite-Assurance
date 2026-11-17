import type { RevalidateWorkdayReportRequest } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export interface WorkdayReportUploadPayload {
  localReportId: string;
  projectId: string;
  wbsItemId: string;
  workdayDate: string;
  summaryText: string;
  voiceNoteUrl: string | null;
  evidenceItems: unknown[];
  reportedQuantity: number;
  unitOfMeasure: string;
  delaysOrBlockers?: string;
  isHoldPointClaimed?: boolean;
  submissionGeotag?: unknown;
}

export const submitWorkdayReport = async (
  projectId: string,
  payload: WorkdayReportUploadPayload
): Promise<unknown> => {
  return mobileRequest(`/projects/${projectId}/workday-reports`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const revalidateWorkdayReport = async (
  projectId: string,
  reportId: string,
  payload: RevalidateWorkdayReportRequest
): Promise<unknown> => {
  return mobileRequest(
    `/projects/${projectId}/workday-reports/${reportId}/revalidate`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
};
