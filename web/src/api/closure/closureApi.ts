import type {
  ClosureChecklistList,
  ClosurePackExportDto,
  DraftCompletionCertificateRequest,
  LessonDto,
  OrganizationRatingsDto,
  ProjectClosureChecklistDto,
  ProjectCompletionDto,
  ProjectRatingsDto,
  RateContractorRequest,
  RatingCriterion,
  RecordBeneficiarySignatureRequest,
  SaveLessonRequestInput,
  SignCompletionCertificateRequest,
  UpdateCompletionCertificateRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/**
 * Phase 15: Certificate of Completion, closure checklist, contractor ratings, lessons learned and
 * the closure pack.
 */

const base = (projectId: string) => `/projects/${projectId}`;
const LIST_PATH: Record<ClosureChecklistList, string> = { BEFORE_CLOSE: 'before-close', BEFORE_ARCHIVE: 'before-archive' };

// Certificate of Completion ---------------------------------------------------------

export const getProjectCompletion = async (projectId: string) =>
  (await api.get<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion`)).data.data;

export const draftCompletionCertificate = async (projectId: string, body: DraftCompletionCertificateRequest) =>
  (await api.post<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion/certificate`, body)).data.data;

export const updateCompletionCertificate = async (projectId: string, body: UpdateCompletionCertificateRequest) =>
  (await api.put<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion/certificate`, body)).data.data;

export const signCompletionCertificate = async (projectId: string, body: SignCompletionCertificateRequest) =>
  (await api.post<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion/certificate/sign`, body)).data.data;

export const recordBeneficiarySignature = async (projectId: string, body: RecordBeneficiarySignatureRequest) =>
  (await api.post<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion/certificate/beneficiary`, body)).data.data;

export const revokeCompletionCertificate = async (projectId: string, reason: string) =>
  (await api.post<ApiEnvelope<ProjectCompletionDto>>(`${base(projectId)}/completion/certificate/revoke`, { reason })).data.data;

/** The issued PDF, or a draft for signature (as a blob URL to open in a tab). */
export const fetchCompletionCertificatePdf = async (projectId: string) => {
  const response = await api.get(`${base(projectId)}/completion/certificate/pdf`, { responseType: 'blob' });
  return URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
};

// Closure checklist -------------------------------------------------------------------

export const getClosureChecklist = async (projectId: string) =>
  (await api.get<ApiEnvelope<ProjectClosureChecklistDto>>(`${base(projectId)}/closure`)).data.data;

export const completeClosureItem = async (projectId: string, list: ClosureChecklistList, itemKey: string, notes: string | null) =>
  (await api.post<ApiEnvelope<ProjectClosureChecklistDto>>(`${base(projectId)}/closure/${LIST_PATH[list]}/${itemKey}/complete`, { notes })).data.data;

export const waiveClosureItem = async (projectId: string, list: ClosureChecklistList, itemKey: string, reason: string) =>
  (await api.post<ApiEnvelope<ProjectClosureChecklistDto>>(`${base(projectId)}/closure/${LIST_PATH[list]}/${itemKey}/waive`, { reason })).data.data;

// Ratings -------------------------------------------------------------------------------

export const getProjectRatings = async (projectId: string) =>
  (await api.get<ApiEnvelope<ProjectRatingsDto>>(`${base(projectId)}/contractor-ratings`)).data.data;

export const rateContractor = async (projectId: string, body: RateContractorRequest) =>
  (await api.post<ApiEnvelope<ProjectRatingsDto>>(`${base(projectId)}/contractor-ratings`, body)).data.data;

export const getOrganizationRatings = async (organizationId: string) =>
  (await api.get<ApiEnvelope<OrganizationRatingsDto>>(`/closure/organizations/${organizationId}/ratings`)).data.data;

export const getRatingCriteria = async () => (await api.get<ApiEnvelope<RatingCriterion[]>>('/closure/rating-criteria')).data.data;

export const saveRatingCriteria = async (criteria: RatingCriterion[]) =>
  (await api.put<ApiEnvelope<RatingCriterion[]>>('/closure/rating-criteria', { criteria })).data.data;

// Lessons -------------------------------------------------------------------------------

export const listProjectLessons = async (projectId: string) =>
  (await api.get<ApiEnvelope<LessonDto[]>>(`${base(projectId)}/lessons`)).data.data;

export const createLesson = async (projectId: string, body: SaveLessonRequestInput) =>
  (await api.post<ApiEnvelope<LessonDto>>(`${base(projectId)}/lessons`, body)).data.data;

export const updateLesson = async (projectId: string, lessonId: string, body: SaveLessonRequestInput) =>
  (await api.put<ApiEnvelope<LessonDto>>(`${base(projectId)}/lessons/${lessonId}`, body)).data.data;

export const publishLesson = async (projectId: string, lessonId: string) =>
  (await api.post<ApiEnvelope<LessonDto>>(`${base(projectId)}/lessons/${lessonId}/publish`)).data.data;

export interface LessonLibraryFilters {
  projectTypeId?: string;
  regionId?: string;
  category?: string;
  tag?: string;
  q?: string;
}

export const listLessonLibrary = async (filters: LessonLibraryFilters) => {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => typeof v === 'string' && v.trim()));
  return (await api.get<ApiEnvelope<LessonDto[]>>('/closure/lessons', { params })).data.data;
};

// Closure pack --------------------------------------------------------------------------

export const listClosurePacks = async (projectId: string) =>
  (await api.get<ApiEnvelope<ClosurePackExportDto[]>>(`${base(projectId)}/closure-pack`)).data.data;

export const requestClosurePack = async (projectId: string) =>
  (await api.post<ApiEnvelope<ClosurePackExportDto>>(`${base(projectId)}/closure-pack`)).data.data;
