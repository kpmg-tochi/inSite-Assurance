import { useQuery } from '@tanstack/react-query';
import {
  getInspection,
  getInspectionOverview,
  getReportingStreams,
  getTeamWorkload,
  listChecklistTemplates,
  listFindings,
  listInspections,
  listSupervisors,
  type InspectionFilters,
} from '../../api/inspections/inspectionsApi';

/** Phase 14 query keys. */
export const reportingStreamsKey = (projectId: string | null | undefined) => ['reporting-streams', projectId] as const;
export const inspectionsKey = (projectId: string | null | undefined) => ['inspections', projectId] as const;
export const inspectionKey = (projectId: string | null | undefined, id: string | null | undefined) => ['inspection', projectId, id] as const;
export const inspectionOverviewKey = (projectId: string | null | undefined) => ['inspection-overview', projectId] as const;
export const findingsKey = (projectId: string | null | undefined) => ['inspection-findings', projectId] as const;
export const checklistTemplatesKey = ['checklist-templates'] as const;
export const supervisorsKey = ['supervisors'] as const;

export const useReportingStreamsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: reportingStreamsKey(projectId), queryFn: () => getReportingStreams(projectId!), enabled: Boolean(projectId) && enabled });

export const useInspectionsQuery = (projectId: string | null | undefined, filters: InspectionFilters, enabled = true) =>
  useQuery({
    queryKey: [...inspectionsKey(projectId), filters],
    queryFn: () => listInspections(projectId!, filters),
    enabled: Boolean(projectId) && enabled,
  });

export const useInspectionQuery = (projectId: string | null | undefined, inspectionId: string | null | undefined) =>
  useQuery({
    queryKey: inspectionKey(projectId, inspectionId),
    queryFn: () => getInspection(projectId!, inspectionId!),
    enabled: Boolean(projectId && inspectionId),
  });

export const useInspectionOverviewQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: inspectionOverviewKey(projectId),
    queryFn: () => getInspectionOverview(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });

export const useFindingsQuery = (projectId: string | null | undefined, status?: string, enabled = true) =>
  useQuery({ queryKey: [...findingsKey(projectId), status ?? 'ALL'], queryFn: () => listFindings(projectId!, status), enabled: Boolean(projectId) && enabled });

export const useChecklistTemplatesQuery = (includeArchived = false, enabled = true) =>
  useQuery({ queryKey: [...checklistTemplatesKey, includeArchived], queryFn: () => listChecklistTemplates(includeArchived), enabled });

export const useSupervisorsQuery = (enabled = true) => useQuery({ queryKey: supervisorsKey, queryFn: listSupervisors, enabled });

export const useTeamWorkloadQuery = (projectId: string | null | undefined, userIds: string[], enabled = true) =>
  useQuery({
    queryKey: ['team-workload', projectId, [...userIds].sort().join(',')],
    queryFn: () => getTeamWorkload(projectId!, userIds),
    enabled: Boolean(projectId) && userIds.length > 0 && enabled,
    staleTime: 60 * 1000,
  });
