import { useQuery } from '@tanstack/react-query';
import { listProjectLots } from '../api/projectLots';

export const projectLotsKey = ['project-lots'] as const;

/** Client demo updates C3: lots per intervention year (GET /project-lots). */
export const useProjectLotsQuery = (interventionYear?: number | null, enabled = true) =>
  useQuery({
    queryKey: [...projectLotsKey, interventionYear ?? null],
    queryFn: () => listProjectLots(interventionYear),
    enabled,
    staleTime: 30 * 1000,
  });
