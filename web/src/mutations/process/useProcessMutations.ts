import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  NeedsAssessmentDocType,
  ProjectStandardInput,
  SaveWorkflowTemplateRequest,
  UpdateProjectStandardRequest,
} from '@insite/shared';
import {
  createProjectStandard,
  createWorkflowTemplate,
  deleteNeedsAssessment,
  deleteProjectStandard,
  deleteWorkflowTemplate,
  registerNeedsAssessment,
  updateProjectStandard,
  updateWorkflowTemplate,
} from '../../api/process/processApi';
import { getMediaUrl, uploadSupportingDocument } from '../../api/evidence/mediaApi';
import {
  needsAssessmentsKey,
  projectStandardsKey,
  workflowTemplatesKey,
} from '../../queries/process/useProcessQueries';
import { projectSetupKey } from '../../queries/projects/useProjectSetupQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

// Workflow templates

export const useSaveWorkflowTemplateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { templateId?: string; body: SaveWorkflowTemplateRequest; successMessage?: string }) =>
      args.templateId ? updateWorkflowTemplate(args.templateId, args.body) : createWorkflowTemplate(args.body),
    onSuccess: (template, args) => {
      queryClient.invalidateQueries({ queryKey: workflowTemplatesKey });
      toast.success(args.successMessage ?? `Template "${template.name}" saved.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the template.')),
  });
};

export const useDeleteWorkflowTemplateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => deleteWorkflowTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowTemplatesKey });
      toast.success('Template deleted. Projects that used it keep their own copy.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not delete the template.')),
  });
};

// Standards

function invalidateStandards(queryClient: QueryClient, projectId: string) {
  queryClient.invalidateQueries({ queryKey: projectStandardsKey(projectId) });
  queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
}

export const useCreateStandardMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectStandardInput) => createProjectStandard(projectId, body),
    onSuccess: (s) => {
      invalidateStandards(queryClient, projectId);
      toast.success(`Standard ${s.code} added.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the standard.')),
  });
};

export const useUpdateStandardMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { standardId: string; body: UpdateProjectStandardRequest }) =>
      updateProjectStandard(projectId, args.standardId, args.body),
    onSuccess: (s) => {
      invalidateStandards(queryClient, projectId);
      toast.success(`Standard ${s.code} updated.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update the standard.')),
  });
};

export const useDeleteStandardMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (standardId: string) => deleteProjectStandard(projectId, standardId),
    onSuccess: () => {
      invalidateStandards(queryClient, projectId);
      toast.success('Standard deleted.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not delete the standard.')),
  });
};

// Needs assessments

/** Uploads the file through the presign flow, then registers it. */
export const useUploadNeedsAssessmentMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      file: File;
      title: string;
      documentType: NeedsAssessmentDocType;
    }) => {
      const objectKey = await uploadSupportingDocument({ projectId, file: args.file, mediaType: 'PROJECT_DOCUMENT' });
      return registerNeedsAssessment(projectId, {
        title: args.title,
        documentType: args.documentType,
        objectKey,
        mimeType: args.file.type || 'application/octet-stream',
        byteSize: args.file.size,
      });
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: needsAssessmentsKey(projectId) });
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      toast.success(`"${doc.title}" uploaded.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not upload the document.')),
  });
};

export const useDeleteNeedsAssessmentMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteNeedsAssessment(projectId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: needsAssessmentsKey(projectId) });
      queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      toast.success('Document deleted.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not delete the document.')),
  });
};

/** Opens a project document through the authenticated media endpoint (short-lived URL). */
export const useOpenProjectDocumentMutation = (projectId: string) =>
  useMutation({
    mutationFn: async (objectKey: string) => {
      // Open the tab first so the browser does not treat it as an unrequested pop-up.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      try {
        const url = await getMediaUrl(projectId, objectKey);
        if (tab) tab.location.href = url;
        else window.open(url, '_blank', 'noopener');
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not open the document.')),
  });
