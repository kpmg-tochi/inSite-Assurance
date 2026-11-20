import { useQuery } from '@tanstack/react-query';
import { getTerminology, listProjectTypes, listRegions } from '../../api/deliveryModels/deliveryModelsApi';

/** Phase 11: project types (type picker, filters, settings). */
export const useProjectTypesQuery = (includeInactive = false, enabled = true) =>
  useQuery({
    queryKey: ['project-types', { includeInactive }],
    queryFn: () => listProjectTypes(includeInactive),
    enabled,
    staleTime: 60_000,
  });

/** Phase 11: tenant regions and areas. */
export const useRegionsQuery = (includeArchived = false, enabled = true) =>
  useQuery({
    queryKey: ['regions', { includeArchived }],
    queryFn: () => listRegions(includeArchived),
    enabled,
    staleTime: 60_000,
  });

/** Phase 11: the terminology editor (other pages read resolved terms from the profile). */
export const useTerminologyQuery = (enabled = true) =>
  useQuery({ queryKey: ['terminology'], queryFn: getTerminology, enabled });
