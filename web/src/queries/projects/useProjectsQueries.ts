import { useQuery } from '@tanstack/react-query';
import {
  getProjectBaseline,
  getProjects,
} from '../../api/projects/projectsApi';

export const useProjectsQuery = (enabled = true) => {
  return useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled,
  });
};

export const useProjectBaselineQuery = (projectId: string | null) => {
  return useQuery({
    queryKey: ['project-baseline', projectId],
    queryFn: () => getProjectBaseline(projectId!),
    enabled: Boolean(projectId),
  });
};

