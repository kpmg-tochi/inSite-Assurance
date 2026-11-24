import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateProjectDraftRequest,
  ProjectSetupDto,
  ProjectSetupStepId,
} from '@insite/shared';
import {
  activateProject,
  archiveProject,
  createProjectDraft,
  deleteDraftProject,
  saveProjectSetupStep,
} from '../../api/projects/projectSetupApi';
import { projectSetupKey } from '../../queries/projects/useProjectSetupQueries';

export const useCreateProjectDraftMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProjectDraftRequest) => createProjectDraft(payload),
    onSuccess: (setup) => {
      queryClient.setQueryData(projectSetupKey(setup.projectId), setup);
      queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      toast.success(`Draft "${setup.basics.name}" started. It is saved; you can leave and come back.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not start the project.'),
  });
};

/**
 * Saves one step. `silent` skips the success toast (used when saving on navigation). Field errors
 * come back on the error object (`response.data.error.issues`) for the step form to show.
 */
export const useSaveSetupStepMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { stepId: ProjectSetupStepId; body: unknown; silent?: boolean }) =>
      saveProjectSetupStep(projectId, args.stepId, args.body),
    onSuccess: (setup: ProjectSetupDto, args) => {
      queryClient.setQueryData(projectSetupKey(projectId), setup);
      queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      if (setup.status !== 'DRAFT') {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['project-baseline', projectId] });
      }
      if (args.stepId === 'scope') queryClient.invalidateQueries({ queryKey: ['project-scope', projectId] });
      // Phase 13: contract dates, contractors and the project type shape the contract milestones.
      if (args.stepId === 'contract' || args.stepId === 'parties' || args.stepId === 'basics') {
        queryClient.invalidateQueries({ queryKey: ['contract-milestones', projectId] });
        queryClient.invalidateQueries({ queryKey: ['mobilisation-compliance', projectId] });
      }
      if (args.stepId === 'process') {
        queryClient.invalidateQueries({ queryKey: ['project-process', projectId] });
      }
      if (!args.silent) toast.success('Saved.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save this step.'),
  });
};

export const useActivateProjectMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => activateProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      toast.success("Project is active.");
    },
    onError: (err: Error) => toast.error(err?.message || 'The project could not be activated.'),
  });
};

export const useArchiveProjectMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => archiveProject(projectId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project archived. It is read-only and hidden from mobile.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not archive the project.'),
  });
};

export const useDeleteDraftMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteDraftProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      toast.success('Draft deleted.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not delete the draft.'),
  });
};

