import type {
  ActivateProjectResponse,
  CreateProjectDraftRequest,
  ProjectContractorDto,
  ProjectContractorInput,
  ProjectDraftSummary,
  ProjectSetupDto,
  ProjectSetupSectionId,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Staged project creation (Phase 6). */

export const createProjectDraft = async (payload: CreateProjectDraftRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectSetupDto>>('/projects', payload);
  return data.data;
};

export const getProjectSetup = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectSetupDto>>(`/projects/${projectId}/setup`);
  return data.data;
};

/** Saves one setup section (redesign R6a: the endpoint takes a section id). */
export const saveProjectSetupStep = async (projectId: string, sectionId: ProjectSetupSectionId, body: unknown) => {
  const { data } = await api.put<ApiEnvelope<ProjectSetupDto>>(`/projects/${projectId}/setup/${sectionId}`, body);
  return data.data;
};

export const activateProject = async (projectId: string) => {
  const { data } = await api.post<ApiEnvelope<ActivateProjectResponse>>(`/projects/${projectId}/activate`);
  return data.data;
};

export const archiveProject = async (projectId: string, reason?: string) => {
  const { data } = await api.post<ApiEnvelope<ProjectSetupDto>>(`/projects/${projectId}/archive`, { reason });
  return data.data;
};

export const deleteDraftProject = async (projectId: string) => {
  await api.delete(`/projects/${projectId}`);
};

export const listDraftProjects = async () => {
  const { data } = await api.get<ApiEnvelope<ProjectDraftSummary[]>>('/projects/drafts');
  return data.data;
};

export interface TeamOptions {
  users: Array<{
    id: string;
    fullName: string;
    email: string;
    roleName: string;
    organizationName: string;
    /** Set when the user signs in on mobile with a pre-provisioned role. */
    mobileRoleName: string | null;
  }>;
  roles: Array<{
    id: string;
    name: string;
    code: string;
    fieldPersonaType: string;
  }>;
}

export const getTeamOptions = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<TeamOptions>>(`/projects/${projectId}/setup/team-options`);
  return data.data;
};

// Contractors

export const listProjectContractors = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectContractorDto[]>>(`/projects/${projectId}/contractors`);
  return data.data;
};

export const addProjectContractor = async (projectId: string, body: Omit<ProjectContractorInput, 'id'>) => {
  const { data } = await api.post<ApiEnvelope<ProjectContractorDto>>(`/projects/${projectId}/contractors`, body);
  return data.data;
};
