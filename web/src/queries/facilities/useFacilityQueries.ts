import { useQuery } from '@tanstack/react-query';
import { listFacilities } from '../../api/facilities/facilitiesApi';

export const facilitiesKey = ['facilities'] as const;

/** Redesign R2a: active facilities by default; `includeRetired` for the catalogue editor. */
export const useFacilitiesQuery = (includeRetired = false, enabled = true) =>
  useQuery({
    queryKey: [...facilitiesKey, includeRetired],
    queryFn: () => listFacilities(includeRetired),
    enabled,
    staleTime: 60 * 1000,
  });
