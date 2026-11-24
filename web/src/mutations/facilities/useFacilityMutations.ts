import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateFacilityRequestInput, UpdateFacilityRequest } from '@insite/shared';
import { createFacility, updateFacility } from '../../api/facilities/facilitiesApi';
import { facilitiesKey } from '../../queries/facilities/useFacilityQueries';

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Creates (no id) or updates a facility; retire/restore is an update of `isRetired`. */
export const useSaveFacilityMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id?: string; create?: CreateFacilityRequestInput; update?: UpdateFacilityRequest; successMessage?: string }) =>
      p.id ? updateFacility(p.id, p.update ?? {}) : createFacility(p.create!),
    onSuccess: (f, p) => {
      qc.invalidateQueries({ queryKey: facilitiesKey });
      toast.success(p.successMessage ?? `Facility "${f.name}" saved.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the facility.')),
  });
};
