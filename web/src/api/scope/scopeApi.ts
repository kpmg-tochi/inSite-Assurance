import type {
  CreateFacilityUnitRequest,
  CreateScopeLineRequest,
  ProjectScopeDto,
  SaveSprintsRequest,
  ScopeImportConfirmRequest,
  ScopeImportPreviewRequest,
  ScopeImportResultDto,
  ScopeWorkbookPreviewDto,
  UpdateFacilityUnitRequest,
  UpdateScopeLineRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Redesign R2b: project scope (sprints, facility units, scope lines). Every write returns the scope. */

const base = (projectId: string) => `/projects/${projectId}/scope`;

export const getProjectScope = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectScopeDto>>(base(projectId));
  return data.data;
};

export const saveSprints = async (projectId: string, body: SaveSprintsRequest) => {
  const { data } = await api.put<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/sprints`, body);
  return data.data;
};

export const createFacilityUnit = async (projectId: string, body: CreateFacilityUnitRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/units`, body);
  return data.data;
};

export const updateFacilityUnit = async (projectId: string, unitId: string, body: UpdateFacilityUnitRequest) => {
  const { data } = await api.patch<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/units/${unitId}`, body);
  return data.data;
};

export const deleteFacilityUnit = async (projectId: string, unitId: string) => {
  const { data } = await api.delete<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/units/${unitId}`);
  return data.data;
};

export const createScopeLine = async (projectId: string, body: CreateScopeLineRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/lines`, body);
  return data.data;
};

export const updateScopeLine = async (projectId: string, lineId: string, body: UpdateScopeLineRequest) => {
  const { data } = await api.patch<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/lines/${lineId}`, body);
  return data.data;
};

export const deleteScopeLine = async (projectId: string, lineId: string) => {
  const { data } = await api.delete<ApiEnvelope<ProjectScopeDto>>(`${base(projectId)}/lines/${lineId}`);
  return data.data;
};

// Redesign R2c: the needs-assessment workbook.

/** Downloads the .xlsx (pre-filled when the project has data). */
export const downloadScopeWorkbook = async (projectId: string) => {
  const res = await api.get<Blob>(`${base(projectId)}/workbook`, { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'scope-workbook.xlsx';
  return { blob: res.data, fileName };
};

/** A blank workbook with the workspace's lists (Settings); it imports into any draft. */
export const downloadTenantScopeWorkbook = async () => {
  const res = await api.get<Blob>('/scope-workbook', { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'needs-assessment-workbook.xlsx';
  return { blob: res.data, fileName };
};

export const previewScopeImport = async (projectId: string, body: ScopeImportPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<ScopeWorkbookPreviewDto>>(`${base(projectId)}/import/preview`, body);
  return data.data;
};

export const confirmScopeImport = async (projectId: string, body: ScopeImportConfirmRequest) => {
  const { data } = await api.post<ApiEnvelope<ScopeImportResultDto>>(`${base(projectId)}/import/confirm`, body);
  return data.data;
};
