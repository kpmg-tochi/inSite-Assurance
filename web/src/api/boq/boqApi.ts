import { api } from '../../config/apiConfig';
import type { ApiEnvelope, BoqItemRecordDto } from '../types';

/** BOQ reads (scope lines). Redesign R2d: edits go through api/scope; the BOQ upload is gone. */
export const getProjectBoq = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<BoqItemRecordDto[]>>(
    `/projects/${projectId}/boq`
  );
  return data.data;
};
