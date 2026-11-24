import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  FacilityArchetype,
  PreviewVisitFormRequestInput,
  SaveFacilitySubFormRequestInput,
  SaveFormSectionRequestInput,
  SaveVisitFormTemplateRequestInput,
} from '@insite/shared';
import {
  customiseFacilitySubForm,
  previewVisitForm,
  resetFacilitySubForm,
  saveArchetypeSubForm,
  saveFacilitySubForm,
  saveFormSection,
  saveVisitFormTemplate,
  setFormSectionArchived,
  setVisitFormTemplateArchived,
} from '../../api/forms/formsApi';
import { formLibraryKey } from '../../queries/forms/useFormQueries';
import { facilitiesKey } from '../../queries/facilities/useFacilityQueries';

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

const versionNote = (v: { version: number; usageCount?: number }) => ` (version ${v.version})`;

/** Invalidates the library and the facility list (it shows each facility's sub-form). */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: formLibraryKey });
    qc.invalidateQueries({ queryKey: facilitiesKey });
  };
}

export const useSaveFormSectionMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { body: SaveFormSectionRequestInput; existingCode: string | null }) => saveFormSection(p.body, p.existingCode),
    onSuccess: (s) => {
      invalidate();
      toast.success(`Section "${s.title}" saved${versionNote(s)}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the section.')),
  });
};

export const useArchiveFormSectionMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { code: string; archived: boolean }) => setFormSectionArchived(p.code, p.archived),
    onSuccess: (s, p) => {
      invalidate();
      toast.success(`Section ${s.code} ${p.archived ? 'archived' : 'restored'}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not change the section.')),
  });
};

/** Saves an archetype default or a customised facility's sub-form. */
export const useSaveSubFormMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { archetype?: FacilityArchetype; facilityId?: string; body: SaveFacilitySubFormRequestInput }) =>
      p.archetype ? saveArchetypeSubForm(p.archetype, p.body) : saveFacilitySubForm(p.facilityId!, p.body),
    onSuccess: (s) => {
      invalidate();
      toast.success(`Sub-form saved${versionNote(s)}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the sub-form.')),
  });
};

export const useCustomiseSubFormMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { facilityId: string; facilityName: string }) => customiseFacilitySubForm(p.facilityId),
    onSuccess: (_s, p) => {
      invalidate();
      toast.success(`${p.facilityName} now has its own sub-form, copied from its archetype default.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not customise the sub-form.')),
  });
};

export const useResetSubFormMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { facilityId: string; facilityName: string }) => resetFacilitySubForm(p.facilityId),
    onSuccess: (_s, p) => {
      invalidate();
      toast.success(`${p.facilityName} uses its archetype default again.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not reset the sub-form.')),
  });
};

export const useSaveVisitFormTemplateMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { body: SaveVisitFormTemplateRequestInput; existingCode: string | null }) => saveVisitFormTemplate(p.body, p.existingCode),
    onSuccess: (t) => {
      invalidate();
      toast.success(`Template "${t.name}" saved${versionNote(t)}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the template.')),
  });
};

export const useArchiveVisitFormTemplateMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { code: string; archived: boolean }) => setVisitFormTemplateArchived(p.code, p.archived),
    onSuccess: (t, p) => {
      invalidate();
      toast.success(`Template ${t.code} ${p.archived ? 'archived' : 'restored'}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not change the template.')),
  });
};

/** Builds a project's visit form without storing it (errors only are toasted). */
export const usePreviewVisitFormMutation = () =>
  useMutation({
    mutationFn: (p: { projectId: string; body: PreviewVisitFormRequestInput }) => previewVisitForm(p.projectId, p.body),
    onError: (err) => toast.error(errorMessage(err, 'Could not build the form.')),
  });
