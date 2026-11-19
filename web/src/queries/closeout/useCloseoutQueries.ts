import { useQuery } from '@tanstack/react-query';
import {
  getProjectPhase,
  getRetentionSummary,
  listDefectTickets,
  listHandoverLinks,
  listHandoverSubmissions,
} from '../../api/closeout/closeoutApi';

/** Phase 10 query keys. */
export const projectPhaseKey = (projectId: string | null | undefined) => ['project-phase', projectId] as const;
export const handoverLinksKey = (projectId: string | null | undefined) => ['handover-links', projectId] as const;
export const handoverSubmissionsKey = (projectId: string | null | undefined) => ['handover-submissions', projectId] as const;
export const defectTicketsKey = (projectId: string | null | undefined) => ['defect-tickets', projectId] as const;
export const retentionSummaryKey = (projectId: string | null | undefined) => ['retention-summary', projectId] as const;

/** Only call when a closeout module is on for the project (the endpoint answers 404 otherwise). */
export const useProjectPhaseQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectPhaseKey(projectId),
    queryFn: () => getProjectPhase(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });

export const useHandoverLinksQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: handoverLinksKey(projectId), queryFn: () => listHandoverLinks(projectId!), enabled: Boolean(projectId) && enabled });

export const useHandoverSubmissionsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: handoverSubmissionsKey(projectId),
    queryFn: () => listHandoverSubmissions(projectId!),
    enabled: Boolean(projectId) && enabled,
  });

export const useDefectTicketsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: defectTicketsKey(projectId), queryFn: () => listDefectTickets(projectId!), enabled: Boolean(projectId) && enabled });

export const useRetentionSummaryQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: retentionSummaryKey(projectId),
    queryFn: () => getRetentionSummary(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
