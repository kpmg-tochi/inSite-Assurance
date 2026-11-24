import { useQuery } from '@tanstack/react-query';
import { getFormLibrary, listFormComponentVersions, type FormComponentKind } from '../../api/forms/formsApi';

export const formLibraryKey = ['form-library'] as const;

/** Redesign R3: the latest of every form component, usage counts and each facility's sub-form. */
export const useFormLibraryQuery = (enabled = true) =>
  useQuery({ queryKey: formLibraryKey, queryFn: getFormLibrary, enabled, staleTime: 30 * 1000 });

export const useFormComponentVersionsQuery = (kind: FormComponentKind, key: string | null) =>
  useQuery({
    queryKey: [...formLibraryKey, 'versions', kind, key],
    queryFn: () => listFormComponentVersions(kind, key!),
    enabled: Boolean(key),
  });
