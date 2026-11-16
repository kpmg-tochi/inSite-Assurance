import { useQuery } from '@tanstack/react-query';
import { fetchDemoProjects } from '../../api/projects/projectsApi';

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

