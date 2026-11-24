import type { BoqItemDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export const fetchProjectBoqItems = async (
  projectId: string
): Promise<BoqItemDto[]> => {
  return mobileRequest<BoqItemDto[]>(`/projects/${projectId}/boq`);
};

