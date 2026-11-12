import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateBoqMappingsRequest } from '@insite/shared';
import {
  updateBoqMappings,
  uploadProjectBoq,
} from '../../api/boq/boqApi';

export const useUploadBoqMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { items?: unknown[]; spreadsheetBase64?: string }) =>
      uploadProjectBoq({ projectId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
    },
  });
};

export const useUpdateBoqMappingsMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateBoqMappingsRequest) =>
      updateBoqMappings({ projectId, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
    },
  });
};

