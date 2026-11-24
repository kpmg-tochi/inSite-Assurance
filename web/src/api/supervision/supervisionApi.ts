import type { SupervisorWorkloadDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Supervision workload (Phase 14): people in a project type's supervisor roles and their live sites. */

export const listSupervisors = async () => {
  const { data } = await api.get<ApiEnvelope<SupervisorWorkloadDto[]>>('/supervision');
  return data.data;
};

export const getTeamWorkload = async (projectId: string, userIds: string[]) => {
  const { data } = await api.get<ApiEnvelope<SupervisorWorkloadDto[]>>(`/projects/${projectId}/supervision/workload`, {
    params: { userIds: userIds.join(',') },
  });
  return data.data;
};
