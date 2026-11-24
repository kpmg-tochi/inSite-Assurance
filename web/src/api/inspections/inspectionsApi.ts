import type { InspectionChecklistTemplateDto, SupervisorWorkloadDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/**
 * Phase 14 leftovers still used by the web: the legacy checklist templates (type editor picker, until
 * R5) and the supervision workload. Redesign R4f removed streams, the inspections page and its
 * overview; visits, findings and the site log are in api/visits.
 */

export const listChecklistTemplates = async (includeArchived = false) => {
  const { data } = await api.get<ApiEnvelope<InspectionChecklistTemplateDto[]>>('/inspection-templates', {
    params: includeArchived ? { includeArchived: 'true' } : {},
  });
  return data.data;
};

// Supervision

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
