import { useQueries, useQuery } from '@tanstack/react-query';
import type { ProjectProcessConfig } from '@insite/shared';
import {
  getProjectProcess,
  listNeedsAssessments,
  listProjectStandards,
  listWorkflowTemplates,
} from '../../api/process/processApi';

export const workflowTemplatesKey = ['workflow-templates'] as const;
export const projectProcessKey = (projectId: string | null | undefined) => ['project-process', projectId] as const;
export const projectStandardsKey = (projectId: string | null | undefined) => ['project-standards', projectId] as const;
export const needsAssessmentsKey = (projectId: string | null | undefined) => ['needs-assessments', projectId] as const;

export const useWorkflowTemplatesQuery = (enabled = true) =>
  useQuery({ queryKey: workflowTemplatesKey, queryFn: listWorkflowTemplates, enabled, staleTime: 60 * 1000 });

/** The project's process settings (switches, chains). Used to hide modules the project turned off. */
export const useProjectProcess = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectProcessKey(projectId),
    queryFn: () => getProjectProcess(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60 * 1000,
  });

export const useProjectStandardsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectStandardsKey(projectId),
    queryFn: () => listProjectStandards(projectId!),
    enabled: Boolean(projectId) && enabled,
  });


export const useNeedsAssessmentsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: needsAssessmentsKey(projectId),
    queryFn: () => listNeedsAssessments(projectId!),
    enabled: Boolean(projectId) && enabled,
  });

/**
 * Process settings for several projects (cross-project views). One request per project, sharing
 * the cache with `useProjectProcess`; a project whose settings cannot be read is left out.
 */
export const useProjectProcessMap = (projectIds: string[], enabled = true) =>
  useQueries({
    queries: projectIds.map((id) => ({
      queryKey: projectProcessKey(id),
      queryFn: () => getProjectProcess(id),
      enabled,
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
    combine: (results) => {
      const map = new Map<string, ProjectProcessConfig>();
      results.forEach((r, i) => {
        if (r.data) map.set(projectIds[i], r.data.config);
      });
      return map;
    },
  });
