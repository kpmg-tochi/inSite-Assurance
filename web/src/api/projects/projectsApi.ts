import { api } from '../../config/apiConfig';
import type {
  ApiEnvelope,
  BoqItemRecordDto,
  ProjectSummaryDto,
} from '../types';

export const getProjects = async () => {
  const { data } = await api.get<ApiEnvelope<ProjectSummaryDto[]>>('/projects');
  return data.data;
};

export const getProjectBaseline = async (projectId: string) => {
  const { data } = await api.get<
    ApiEnvelope<ProjectSummaryDto & { boqItems: BoqItemRecordDto[] }>
  >(`/projects/${projectId}/baseline`);
  return data.data;
};
