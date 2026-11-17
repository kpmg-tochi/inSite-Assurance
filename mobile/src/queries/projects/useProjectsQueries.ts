import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchDemoProjects,
  resetDemoDatabase,
} from '../../api/projects/projectsApi';

export const projectQueryKeys = {
  demoList: ['demo-projects'] as const,
};

export function useDemoProjectsQuery(enabled = true) {
  return useQuery({
    queryKey: projectQueryKeys.demoList,
    queryFn: fetchDemoProjects,
    enabled,
  });
}

export function useResetDemoMutation() {
  return useMutation({
    mutationFn: resetDemoDatabase,
  });
}
