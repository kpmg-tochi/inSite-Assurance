import { useQuery } from '@tanstack/react-query';
import type { NeedsPipelineQuery } from '@insite/shared';
import { getProjectNeedsOrigin, listNeedsPipeline } from '../../api/needsIntegration';

/** Needs pipeline wave 4 (C5): the portfolio's Pipeline tab and a project's origin. Keys start with `needs`. */
export const needsPipelineKey = (query: NeedsPipelineQuery) => ['needs', 'pipeline', query] as const;
export const projectNeedsOriginKey = (projectId: string | null | undefined) => ['needs', 'project-origin', projectId] as const;

export const useNeedsPipelineQuery = (query: NeedsPipelineQuery, enabled = true) =>
  useQuery({
    queryKey: needsPipelineKey(query),
    queryFn: () => listNeedsPipeline(query),
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });

/** The project's origin, proposal documents and facilities breakdown (one request, shared by three screens). */
export const useProjectNeedsOriginQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectNeedsOriginKey(projectId),
    queryFn: () => getProjectNeedsOrigin(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60 * 1000,
    retry: 1,
  });
