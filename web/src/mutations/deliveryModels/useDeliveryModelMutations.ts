import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SaveProjectTypeRequestInput, SaveRegionRequest, UpdateTerminologyRequest } from '@insite/shared';
import {
  archiveProjectType,
  createProjectType,
  createRegion,
  updateProjectType,
  updateRegion,
  updateTerminology,
} from '../../api/deliveryModels/deliveryModelsApi';
import { useAuth } from '../../lib/auth-context';

export const useSaveProjectTypeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectTypeId: string | null; payload: SaveProjectTypeRequestInput }) =>
      args.projectTypeId ? updateProjectType(args.projectTypeId, args.payload) : createProjectType(args.payload),
    onSuccess: (type, args) => {
      queryClient.invalidateQueries({ queryKey: ['project-types'] });
      toast.success(
        args.projectTypeId
          ? `Saved ${type.name} (version ${type.version}). Projects that already have it keep their version.`
          : `Created ${type.name}.`
      );
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the project type.'),
  });
};

export const useArchiveProjectTypeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectTypeId: string) => archiveProjectType(projectTypeId),
    onSuccess: (type) => {
      queryClient.invalidateQueries({ queryKey: ['project-types'] });
      toast.success(`Archived ${type.name}. New projects cannot choose it.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not archive the project type.'),
  });
};

export const useSaveRegionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { regionId: string | null; payload: SaveRegionRequest }) =>
      args.regionId ? updateRegion(args.regionId, args.payload) : createRegion(args.payload),
    onSuccess: (region, args) => {
      queryClient.invalidateQueries({ queryKey: ['regions'] });
      toast.success(args.regionId ? `Saved ${region.name}.` : `Added ${region.name}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the zone or state.'),
  });
};

/** Saving terminology refreshes the signed-in profile so every page picks the new words up. */
export const useUpdateTerminologyMutation = () => {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: (payload: UpdateTerminologyRequest) => updateTerminology(payload),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['terminology'] });
      await refreshUser();
      toast.success('Terminology saved.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the terminology.'),
  });
};
