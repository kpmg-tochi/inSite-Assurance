import type { NeedsFileLinkDto, NeedsPipelineQuery, NeedsPipelineRow, ProjectNeedsDocument, ProjectNeedsOriginDto } from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 4 (C5): where projects come from. The portfolio's Pipeline tab
 * (`GET /api/v1/needs/pipeline`, `needs:view`) and a project's needs assessment origin
 * (`GET /api/v1/projects/:id/needs-origin`, any web reader of the project, drafts too): the Origin
 * card, the Documents "Needs assessment" group and the Facilities tab of BoQ & work phases.
 */

export const listNeedsPipeline = async (query: NeedsPipelineQuery) => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<ApiEnvelope<NeedsPipelineRow[]>>('/needs/pipeline', { params });
  return data.data;
};

export const getProjectNeedsOrigin = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectNeedsOriginDto>>(`/projects/${projectId}/needs-origin`);
  return data.data;
};

/** A signed link to a document of the project's proposal or cycle (read-only on the project). */
export const getProjectNeedsFileLink = async (projectId: string, doc: Pick<ProjectNeedsDocument, 'scope' | 'id'>) => {
  const { data } = await api.get<ApiEnvelope<NeedsFileLinkDto>>(`/projects/${projectId}/needs-origin/files/${doc.scope}/${doc.id}`, { params: { format: 'json' } });
  return data.data;
};
