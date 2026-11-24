import { useQuery } from '@tanstack/react-query';
import { getTeamWorkload, listSupervisors } from '../../api/supervision/supervisionApi';

export const supervisorsKey = ['supervisors'] as const;

export const useSupervisorsQuery = (enabled = true) => useQuery({ queryKey: supervisorsKey, queryFn: listSupervisors, enabled });

export const useTeamWorkloadQuery = (projectId: string | null | undefined, userIds: string[], enabled = true) =>
  useQuery({
    queryKey: ['team-workload', projectId, [...userIds].sort().join(',')],
    queryFn: () => getTeamWorkload(projectId!, userIds),
    enabled: Boolean(projectId) && userIds.length > 0 && enabled,
    staleTime: 60 * 1000,
  });
