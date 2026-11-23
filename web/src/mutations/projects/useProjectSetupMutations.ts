import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  BoqItemInput,
  CreateProjectDraftRequest,
  ProjectSetupDto,
  ProjectSetupStepId,
} from '@insite/shared';
import {
  activateProject,
  archiveProject,
  commitBoq,
  createProjectDraft,
  deleteDraftProject,
  previewBoq,
  saveProjectSetupStep,
  suggestContractorPackages,
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
      if (args.stepId === 'boq') queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      // Phase 13: contract dates, contractors and the project type shape the contract milestones.
      if (args.stepId === 'contract' || args.stepId === 'parties' || args.stepId === 'basics') {
        queryClient.invalidateQueries({ queryKey: ['contract-milestones', projectId] });
        queryClient.invalidateQueries({ queryKey: ['mobilisation-compliance', projectId] });
      }
      if (args.stepId === 'process') {
        queryClient.invalidateQueries({ queryKey: ['project-process', projectId] });
        queryClient.invalidateQueries({ queryKey: ['morning-briefs', projectId] });
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
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      toast.success(`Project is active. ${res.issuedJoinCodes.length} join code(s) issued.`);
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

export const usePreviewBoqMutation = (projectId: string) =>
  useMutation({
    mutationFn: (args: { base64: string; fileName?: string }) => previewBoq(projectId, args.base64, args.fileName),
    onError: (err: Error) => toast.error(err?.message || 'Could not read the file.'),
  });

export const useCommitBoqMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { items: BoqItemInput[]; reason?: string; mode?: 'REPLACE' | 'MERGE' }) =>
      commitBoq(projectId, body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      queryClient.invalidateQueries({ queryKey: ['boq-revisions', projectId] });
      toast.success(
        res.revisionNumber
          ? `BOQ revision ${res.revisionNumber} saved (${res.totalUploaded} items).`
          : `${res.totalUploaded} BOQ items saved${res.removedCount ? `, ${res.removedCount} replaced` : ''}.`
      );
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the BOQ.'),
  });
};

export const useSuggestContractorsMutation = (projectId: string) =>
  useMutation({
    mutationFn: () => suggestContractorPackages(projectId),
    onError: (err: Error) => toast.error(err?.message || 'Could not suggest packages.'),
  });
