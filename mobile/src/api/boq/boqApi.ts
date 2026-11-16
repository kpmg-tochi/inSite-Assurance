import type { MorningDeliverableBriefDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export const fetchProjectBoqItems = async (
  projectId: string
): Promise<any[]> => {
  return mobileRequest<any[]>(`/projects/${projectId}/boq`);
};

export const fetchMorningBriefs = async (
  projectId: string
): Promise<MorningDeliverableBriefDto[]> => {
  return mobileRequest<MorningDeliverableBriefDto[]>(
    `/projects/${projectId}/morning-briefs`
  );
};

