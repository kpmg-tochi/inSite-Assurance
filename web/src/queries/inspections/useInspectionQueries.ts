import { useQuery } from '@tanstack/react-query';
import { getTeamWorkload, listChecklistTemplates, listSupervisors } from '../../api/inspections/inspectionsApi';

/** Phase 14 query keys still in use (legacy templates, supervision). */
export const checklistTemplatesKey = ['checklist-templates'] as const;
export const supervisorsKey = ['supervisors'] as const;

export const useChecklistTemplatesQuery = (includeArchived = false, enabled = true) =>
  useQuery({ queryKey: [...checklistTemplatesKey, includeArchived], queryFn: () => listChecklistTemplates(includeArchived), enabled });

export const useSupervisorsQuery = (enabled = true) => useQuery({ queryKey: supervisorsKey, queryFn: listSupervisors, enabled });

export const useTeamWorkloadQuery = (projectId: string | null | undefined, userIds: string[], enabled = true) =>
  useQuery({
    queryKey: ['team-workload', projectId, [...userIds].sort().join(',')],
    queryFn: () => getTeamWorkload(projectId!, userIds),
    enabled: Boolean(projectId) && userIds.length > 0 && enabled,
    staleTime: 60 * 1000,
  });
