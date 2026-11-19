import type {
  ApprovalChainType,
  ApprovalStepConfigInput,
  NeedsAssessmentDocumentDto,
  ProjectProcessConfig,
  ProjectProcessSettingsDto,
  ProjectStandardDto,
  ProjectStandardInput,
  RegisterNeedsAssessmentRequest,
  SaveWorkflowTemplateRequest,
  UpdateProjectStandardRequest,
  WorkflowTemplateDto,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Process engine (Phase 7): workflow templates, project process settings, standards, needs assessments. */

// Workflow templates (tenant)

export const listWorkflowTemplates = async () => {
  const { data } = await api.get<ApiEnvelope<WorkflowTemplateDto[]>>('/workflow-templates');
  return data.data;
};

export const createWorkflowTemplate = async (body: SaveWorkflowTemplateRequest) => {
  const { data } = await api.post<ApiEnvelope<WorkflowTemplateDto>>('/workflow-templates', body);
  return data.data;
};

export const updateWorkflowTemplate = async (templateId: string, body: SaveWorkflowTemplateRequest) => {
  const { data } = await api.put<ApiEnvelope<WorkflowTemplateDto>>(`/workflow-templates/${templateId}`, body);
  return data.data;
};

export const deleteWorkflowTemplate = async (templateId: string) => {
  await api.delete(`/workflow-templates/${templateId}`);
};

// Project process settings

export const getProjectProcess = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectProcessSettingsDto>>(`/projects/${projectId}/process`);
  return data.data;
};

export const updateProjectProcessConfig = async (
  projectId: string,
  body: { config: ProjectProcessConfig; confirmDeactivateContractorCodes?: boolean }
) => {
  const { data } = await api.put<ApiEnvelope<ProjectProcessSettingsDto>>(`/projects/${projectId}/process`, body);
  return data.data;
};

export const replaceProjectChain = async (
  projectId: string,
  chainType: ApprovalChainType,
  steps: ApprovalStepConfigInput[]
) => {
  const { data } = await api.put<ApiEnvelope<ProjectProcessSettingsDto>>(
    `/projects/${projectId}/process/chains/${chainType}`,
    { steps }
  );
  return data.data;
};

export const applyWorkflowTemplate = async (
  projectId: string,
  body: { templateId: string; confirmDeactivateContractorCodes?: boolean }
) => {
  const { data } = await api.post<ApiEnvelope<ProjectProcessSettingsDto>>(
    `/projects/${projectId}/process/apply-template`,
    body
  );
  return data.data;
};

// Standards

export const listProjectStandards = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectStandardDto[]>>(`/projects/${projectId}/standards`);
  return data.data;
};

export const createProjectStandard = async (projectId: string, body: ProjectStandardInput) => {
  const { data } = await api.post<ApiEnvelope<ProjectStandardDto>>(`/projects/${projectId}/standards`, body);
  return data.data;
};

export const updateProjectStandard = async (
  projectId: string,
  standardId: string,
  body: UpdateProjectStandardRequest
) => {
  const { data } = await api.patch<ApiEnvelope<ProjectStandardDto>>(
    `/projects/${projectId}/standards/${standardId}`,
    body
  );
  return data.data;
};

export const deleteProjectStandard = async (projectId: string, standardId: string) => {
  await api.delete(`/projects/${projectId}/standards/${standardId}`);
};

// Needs assessments

export const listNeedsAssessments = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsAssessmentDocumentDto[]>>(
    `/projects/${projectId}/needs-assessments`
  );
  return data.data;
};

export const registerNeedsAssessment = async (projectId: string, body: RegisterNeedsAssessmentRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsAssessmentDocumentDto>>(
    `/projects/${projectId}/needs-assessments`,
    body
  );
  return data.data;
};

export const deleteNeedsAssessment = async (projectId: string, documentId: string) => {
  await api.delete(`/projects/${projectId}/needs-assessments/${documentId}`);
};

/** Reads the server's error code and details from an axios error (e.g. 409 CONFIRMATION_REQUIRED). */
export function apiErrorCode(err: unknown): { code: string | null; details: Record<string, unknown> | null } {
  const body = (err as { response?: { data?: { error?: { code?: string; details?: Record<string, unknown> } } } })
    ?.response?.data?.error;
  return { code: body?.code ?? null, details: body?.details ?? null };
}
