import { useQuery } from '@tanstack/react-query';
import type { NeedsSubmissionKind } from '@insite/shared';
import { getOutOfCycleRequest, listCycleSubmissions, listOutOfCycleRequests } from '../../api/needsApproval';

/** Needs pipeline wave 4 (N6): submissions and out-of-cycle requests. Every key starts with `needs`. */
export const needsSubmissionsRootKey = ['needs', 'submissions'] as const;
export const needsSubmissionsKey = (cycleId: string | null | undefined, kind?: NeedsSubmissionKind) => ['needs', 'submissions', cycleId, kind ?? 'ALL'] as const;
export const outOfCycleRootKey = ['needs', 'out-of-cycle'] as const;
export const outOfCycleListKey = (cycleId: string | null | undefined) => ['needs', 'out-of-cycle', 'list', cycleId ?? 'all'] as const;
export const outOfCycleKey = (proposalId: string | null | undefined) => ['needs', 'out-of-cycle', 'one', proposalId] as const;

/** The cycle's submissions of one kind, newest first. */
export const useCycleSubmissionsQuery = (cycleId: string | null | undefined, kind?: NeedsSubmissionKind) =>
  useQuery({
    queryKey: needsSubmissionsKey(cycleId, kind),
    queryFn: () => listCycleSubmissions(cycleId!, kind),
    enabled: Boolean(cycleId),
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useOutOfCycleRequestsQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: outOfCycleListKey(cycleId),
    queryFn: () => listOutOfCycleRequests(cycleId),
    enabled,
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useOutOfCycleRequestQuery = (proposalId: string | null | undefined) =>
  useQuery({
    queryKey: outOfCycleKey(proposalId),
    queryFn: () => getOutOfCycleRequest(proposalId!),
    enabled: Boolean(proposalId),
    staleTime: 15 * 1000,
    retry: 1,
  });
