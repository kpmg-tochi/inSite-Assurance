import type { UpdateBoqMappingsRequest } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope, BoqItemRecordDto } from '../types';

export const getProjectBoq = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<BoqItemRecordDto[]>>(
    `/projects/${projectId}/boq`
  );
  return data.data;
};

export const uploadProjectBoq = async (payload: {
  projectId: string;
  items?: unknown[];
  spreadsheetBase64?: string;
}) => {
  const { projectId, ...body } = payload;
  const { data } = await api.post<
    ApiEnvelope<{
      totalUploaded: number;
      opaqueLumpSumCount: number;
      holdPointCount: number;
      items: BoqItemRecordDto[];
    }>
  >(`/projects/${projectId}/boq/upload`, body);
  return data.data;
};

export const updateBoqMappings = async (payload: {
  projectId: string;
  body: UpdateBoqMappingsRequest;
}) => {
  const { data } = await api.patch<ApiEnvelope<BoqItemRecordDto[]>>(
    `/projects/${payload.projectId}/boq/mappings`,
    payload.body
  );
  return data.data;
};

