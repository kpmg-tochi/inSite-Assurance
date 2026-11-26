import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getPlanner,
  getSprintVerification,
  getVisitDetail,
  getVisitOfficers,
  getVisitPlanPreview,
  listProjectFindings,
  listProjectVisits,
  listSiteLog,
  type PlannerFilters,
  type VisitFilters,
} from '../../api/visits/visitsApi';

/** Redesign R4 query keys. */
export const projectVisitsKey = (projectId: string | null | undefined) => ['visits', projectId] as const;
export const visitDetailKey = (projectId: string | null | undefined, visitId: string | null | undefined) => ['visit', projectId, visitId] as const;
export const visitPlanPreviewKey = (projectId: string | null | undefined) => ['visit-plan-preview', projectId] as const;
export const visitOfficersKey = (projectId: string | null | undefined) => ['visit-officers', projectId] as const;
export const plannerKey = ['visit-planner'] as const;
export const projectFindingsKey = (projectId: string | null | undefined) => ['findings', projectId] as const;
export const siteLogKey = (projectId: string | null | undefined) => ['site-log', projectId] as const;
export const sprintVerificationKey = (projectId: string | null | undefined, sprintId: string | null | undefined) => ['sprint-verification', projectId, sprintId] as const;

/** `keepPrevious` (client demo updates D4, the calendar): keep the last range on screen while the next one loads. */
export const useProjectVisitsQuery = (projectId: string | null | undefined, filters: VisitFilters = {}, enabled = true, keepPrevious = false) =>
  useQuery({
    queryKey: [...projectVisitsKey(projectId), filters],
    queryFn: () => listProjectVisits(projectId!, filters),
    enabled: Boolean(projectId) && enabled,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });

export const useVisitDetailQuery = (projectId: string | null | undefined, visitId: string | null | undefined) =>
  useQuery({ queryKey: visitDetailKey(projectId, visitId), queryFn: () => getVisitDetail(projectId!, visitId!), enabled: Boolean(projectId && visitId) });

export const useVisitPlanPreviewQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: visitPlanPreviewKey(projectId), queryFn: () => getVisitPlanPreview(projectId!), enabled: Boolean(projectId) && enabled });

export const useVisitOfficersQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: visitOfficersKey(projectId), queryFn: () => getVisitOfficers(projectId!), enabled: Boolean(projectId) && enabled });

export const usePlannerQuery = (filters: PlannerFilters, enabled = true, keepPrevious = false) =>
  useQuery({ queryKey: [...plannerKey, filters], queryFn: () => getPlanner(filters), enabled, placeholderData: keepPrevious ? keepPreviousData : undefined });

export const useProjectFindingsQuery = (projectId: string | null | undefined, params: { status?: string; visitId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: [...projectFindingsKey(projectId), params], queryFn: () => listProjectFindings(projectId!, params), enabled: Boolean(projectId) && enabled });

export const useSiteLogQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: siteLogKey(projectId), queryFn: () => listSiteLog(projectId!, { includeAttached: true }), enabled: Boolean(projectId) && enabled });

export const useSprintVerificationQuery = (projectId: string | null | undefined, sprintId: string | null | undefined) =>
  useQuery({ queryKey: sprintVerificationKey(projectId, sprintId), queryFn: () => getSprintVerification(projectId!, sprintId!), enabled: Boolean(projectId && sprintId) });
