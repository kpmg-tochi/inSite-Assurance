import { useQueries, useQuery } from '@tanstack/react-query';
import { getApprovedList, getApprovedListYearRows, getApprovedListsOverview, getProjectApprovedListLink } from '../api/approvedLists';

/** Client demo updates E3 (wave 3): approved lists and a project's link to its row. */
export const approvedListsKey = ['approved-lists'] as const;
export const approvedListsOverviewKey = (year: number | null | undefined) => ['approved-lists', 'overview', year ?? 'latest'] as const;
export const approvedListYearRowsKey = (year: number | null | undefined) => ['approved-lists', 'year-rows', year ?? 'latest'] as const;
export const approvedListKey = (listId: string | null | undefined) => ['approved-lists', 'list', listId] as const;
export const projectApprovedListLinkKey = (projectId: string | null | undefined) => ['project-approved-list-row', projectId] as const;

export const useApprovedListsOverviewQuery = (interventionYear: number | null | undefined, enabled = true) =>
  useQuery({
    queryKey: approvedListsOverviewKey(interventionYear),
    queryFn: () => getApprovedListsOverview(interventionYear),
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });

/** Design refinement (2026-11-26): every row of a year (the Needs assessment table). */
export const useApprovedListYearRowsQuery = (interventionYear: number | null | undefined, enabled = true) =>
  useQuery({
    queryKey: approvedListYearRowsKey(interventionYear),
    queryFn: () => getApprovedListYearRows(interventionYear),
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });

export const useApprovedListQuery = (listId: string | null | undefined) =>
  useQuery({
    queryKey: approvedListKey(listId),
    queryFn: () => getApprovedList(listId!),
    enabled: Boolean(listId),
    staleTime: 30 * 1000,
    retry: 1,
  });

/** Every list of a year with its rows (the row picker). */
export const useApprovedListsDetailQueries = (listIds: string[]) =>
  useQueries({
    queries: listIds.map((id) => ({
      queryKey: approvedListKey(id),
      queryFn: () => getApprovedList(id),
      staleTime: 30 * 1000,
      retry: 1,
    })),
  });

export const useProjectApprovedListLinkQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectApprovedListLinkKey(projectId),
    queryFn: () => getProjectApprovedListLink(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });
