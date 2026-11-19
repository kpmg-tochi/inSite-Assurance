import type { BriefPersona, MorningDeliverableBriefDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Today's morning briefs for one persona (Phase 7: web callers choose the persona). */
export const listMorningBriefs = async (projectId: string, persona: BriefPersona) => {
  const { data } = await api.get<ApiEnvelope<MorningDeliverableBriefDto[]>>(`/projects/${projectId}/morning-briefs`, {
    params: { persona },
  });
  return data.data;
};

/** Generates (or returns the cached) brief for one BOQ item and persona. */
export const generateMorningBrief = async (projectId: string, boqItemId: string, targetPersona: BriefPersona) => {
  const { data } = await api.post<ApiEnvelope<MorningDeliverableBriefDto>>(
    `/projects/${projectId}/boq/${boqItemId}/morning-brief`,
    { targetPersona }
  );
  return data.data;
};
