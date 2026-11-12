import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success(
        `Ingested ${data.totalUploaded} BOQ items (${data.holdPointCount} Hold-Points, ${data.opaqueLumpSumCount} Opaque Lump Sums screened).`
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Spreadsheet upload failed.');
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
      toast.success('BOQ tranche mappings and Hold-Point rules updated.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update BOQ mappings.');
    },
  });
};

