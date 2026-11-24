import { useQuery } from '@tanstack/react-query';
import {
  getProjectSetup,
  getTeamOptions,
  listDraftProjects,
} from '../../api/projects/projectSetupApi';

export const projectSetupKey = (projectId: string | null | undefined) => ['project-setup', projectId] as const;

export const useProjectSetupQuery = (projectId: string | null | undefined) =>
  useQuery({
    queryKey: projectSetupKey(projectId),
    queryFn: () => getProjectSetup(projectId!),
    enabled: Boolean(projectId),
  });

export const useDraftProjectsQuery = (enabled = true) =>
  useQuery({ queryKey: ['project-drafts'], queryFn: listDraftProjects, enabled });

export const useTeamOptionsQuery = (projectId: string | null | undefined) =>
  useQuery({
    queryKey: ['project-team-options', projectId],
    queryFn: () => getTeamOptions(projectId!),
    enabled: Boolean(projectId),
  });
