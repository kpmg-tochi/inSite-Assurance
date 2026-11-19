import type { CaptureListItemDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Every registered capture with its server-computed integrity results, newest first. */
export const getProjectEvidence = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<CaptureListItemDto[]>>(
    `/projects/${projectId}/evidence`
  );
  return data.data;
};
