import { useQuery } from '@tanstack/react-query';
import { getProjectScope } from '../../api/scope/scopeApi';

export const projectScopeKey = (projectId: string | null | undefined) => ['project-scope', projectId] as const;

/** Redesign R2b: sprints, facility units and scope lines of a project. */
export const useProjectScopeQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectScopeKey(projectId),
    queryFn: () => getProjectScope(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
