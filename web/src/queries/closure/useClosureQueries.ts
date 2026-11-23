import { useQuery } from '@tanstack/react-query';
import {
  getClosureChecklist,
  getOrganizationRatings,
  getProjectCompletion,
  getProjectRatings,
  getRatingCriteria,
  listClosurePacks,
  listLessonLibrary,
  listProjectLessons,
  type LessonLibraryFilters,
} from '../../api/closure/closureApi';

/** Phase 15 query keys. */
export const completionKey = (projectId: string | null | undefined) => ['completion', projectId] as const;
export const closureChecklistKey = (projectId: string | null | undefined) => ['closure-checklist', projectId] as const;
export const projectRatingsKey = (projectId: string | null | undefined) => ['contractor-ratings', projectId] as const;
export const organizationRatingsKey = (organizationId: string | null | undefined) => ['organization-ratings', organizationId] as const;
export const projectLessonsKey = (projectId: string | null | undefined) => ['project-lessons', projectId] as const;
export const lessonLibraryKey = ['lesson-library'] as const;
export const closurePacksKey = (projectId: string | null | undefined) => ['closure-packs', projectId] as const;
export const ratingCriteriaKey = ['rating-criteria'] as const;

export const useProjectCompletionQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: completionKey(projectId), queryFn: () => getProjectCompletion(projectId!), enabled: Boolean(projectId) && enabled });

export const useClosureChecklistQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: closureChecklistKey(projectId), queryFn: () => getClosureChecklist(projectId!), enabled: Boolean(projectId) && enabled });

/** The server answers 404 to the contractor side when ratings are not shared: no retries then. */
export const useProjectRatingsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: projectRatingsKey(projectId), queryFn: () => getProjectRatings(projectId!), enabled: Boolean(projectId) && enabled, retry: false });

export const useOrganizationRatingsQuery = (organizationId: string | null | undefined) =>
  useQuery({ queryKey: organizationRatingsKey(organizationId), queryFn: () => getOrganizationRatings(organizationId!), enabled: Boolean(organizationId), retry: false });

export const useProjectLessonsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: projectLessonsKey(projectId), queryFn: () => listProjectLessons(projectId!), enabled: Boolean(projectId) && enabled });

export const useLessonLibraryQuery = (filters: LessonLibraryFilters) =>
  useQuery({ queryKey: [...lessonLibraryKey, filters], queryFn: () => listLessonLibrary(filters) });

/** Polls while an export is queued or running. */
export const useClosurePacksQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: closurePacksKey(projectId),
    queryFn: () => listClosurePacks(projectId!),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: (query) => (query.state.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 3000 : false),
  });

export const useRatingCriteriaQuery = (enabled = true) =>
  useQuery({ queryKey: ratingCriteriaKey, queryFn: getRatingCriteria, enabled, staleTime: 5 * 60 * 1000 });
