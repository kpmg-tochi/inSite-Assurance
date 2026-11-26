import { useQuery } from '@tanstack/react-query';
import { getProjectSites } from '../api/sites';

export const projectSitesKey = (projectId: string | null | undefined) => ['project-sites', projectId] as const;

/** Client demo updates C2 (wave 2): the project's sites (GET /projects/:id/sites). */
export const useProjectSitesQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectSitesKey(projectId),
    queryFn: () => getProjectSites(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });
