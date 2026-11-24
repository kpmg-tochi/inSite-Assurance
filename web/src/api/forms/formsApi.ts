import type {
  FacilityArchetype,
  FacilityEffectiveSubForm,
  FacilitySubFormDto,
  FormLibraryDto,
  FormSectionDto,
  PreviewVisitFormRequestInput,
  SaveFacilitySubFormRequestInput,
  SaveFormSectionRequestInput,
  SaveVisitFormTemplateRequestInput,
  VisitFormPreviewDto,
  VisitFormTemplateDto,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Redesign R3: the tenant form library and the visit form preview. */

export type FormComponentKind = 'sections' | 'subforms' | 'templates';

export const getFormLibrary = async () => {
  const { data } = await api.get<ApiEnvelope<FormLibraryDto>>('/form-library');
  return data.data;
};

export const listFormComponentVersions = async (kind: FormComponentKind, key: string) => {
  const { data } = await api.get<ApiEnvelope<Array<FormSectionDto | FacilitySubFormDto | VisitFormTemplateDto>>>(
    `/form-library/${kind}/${encodeURIComponent(key)}/versions`
  );
  return data.data;
};

export const saveFormSection = async (body: SaveFormSectionRequestInput, existingCode: string | null) => {
  const { data } = existingCode
    ? await api.put<ApiEnvelope<FormSectionDto>>(`/form-library/sections/${existingCode}`, body)
    : await api.post<ApiEnvelope<FormSectionDto>>('/form-library/sections', body);
  return data.data;
};

export const setFormSectionArchived = async (code: string, archived: boolean) => {
  const { data } = await api.patch<ApiEnvelope<FormSectionDto>>(`/form-library/sections/${code}`, { archived });
  return data.data;
};

export const saveArchetypeSubForm = async (archetype: FacilityArchetype, body: SaveFacilitySubFormRequestInput) => {
  const { data } = await api.put<ApiEnvelope<FacilitySubFormDto>>(`/form-library/subforms/archetype/${archetype}`, body);
  return data.data;
};

export const customiseFacilitySubForm = async (facilityId: string, body: Partial<SaveFacilitySubFormRequestInput> = {}) => {
  const { data } = await api.post<ApiEnvelope<FacilitySubFormDto>>(`/form-library/subforms/facility/${facilityId}`, body);
  return data.data;
};

export const saveFacilitySubForm = async (facilityId: string, body: SaveFacilitySubFormRequestInput) => {
  const { data } = await api.put<ApiEnvelope<FacilitySubFormDto>>(`/form-library/subforms/facility/${facilityId}`, body);
  return data.data;
};

export const resetFacilitySubForm = async (facilityId: string) => {
  const { data } = await api.post<ApiEnvelope<FacilityEffectiveSubForm>>(`/form-library/subforms/facility/${facilityId}/reset`);
  return data.data;
};

export const saveVisitFormTemplate = async (body: SaveVisitFormTemplateRequestInput, existingCode: string | null) => {
  const { data } = existingCode
    ? await api.put<ApiEnvelope<VisitFormTemplateDto>>(`/form-library/templates/${existingCode}`, body)
    : await api.post<ApiEnvelope<VisitFormTemplateDto>>('/form-library/templates', body);
  return data.data;
};

export const setVisitFormTemplateArchived = async (code: string, archived: boolean) => {
  const { data } = await api.patch<ApiEnvelope<VisitFormTemplateDto>>(`/form-library/templates/${code}`, { archived });
  return data.data;
};

export const previewVisitForm = async (projectId: string, body: PreviewVisitFormRequestInput) => {
  const { data } = await api.post<ApiEnvelope<VisitFormPreviewDto>>(`/projects/${projectId}/visit-form/preview`, body);
  return data.data;
};
