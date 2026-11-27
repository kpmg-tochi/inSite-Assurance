import { useQuery } from '@tanstack/react-query';
import type { NeedsProposalListQuery } from '@insite/shared';
import {
  getNeedsCycle,
  getNeedsOptions,
  getNeedsProposal,
  listCarryForwardCandidates,
  listNeedsCycles,
  listNeedsProposals,
} from '../../api/needsPipeline';

/** Needs pipeline wave 2: cycles, options and proposed projects. Every key starts with `needs`. */
export const needsKey = ['needs'] as const;
export const needsOptionsKey = ['needs', 'options'] as const;
export const needsCyclesKey = ['needs', 'cycles'] as const;
export const needsCycleKey = (cycleId: string | null | undefined) => ['needs', 'cycle', cycleId] as const;
export const needsProposalsKey = (cycleId: string | null | undefined) => ['needs', 'proposals', cycleId] as const;
export const needsProposalKey = (proposalId: string | null | undefined) => ['needs', 'proposal', proposalId] as const;

export const useNeedsOptionsQuery = (enabled = true) =>
  useQuery({ queryKey: needsOptionsKey, queryFn: getNeedsOptions, enabled, staleTime: 60 * 1000, retry: 1 });

export const useNeedsCyclesQuery = (enabled = true) =>
  useQuery({ queryKey: needsCyclesKey, queryFn: listNeedsCycles, enabled, staleTime: 30 * 1000, retry: 1 });

export const useNeedsCycleQuery = (cycleId: string | null | undefined) =>
  useQuery({
    queryKey: needsCycleKey(cycleId),
    queryFn: () => getNeedsCycle(cycleId!),
    enabled: Boolean(cycleId),
    staleTime: 30 * 1000,
    retry: 1,
  });

export const useCarryForwardQuery = (params: { projectTypeId: string; interventionYear: number; stateCode?: string | null } | null) =>
  useQuery({
    queryKey: ['needs', 'carry-forward', params?.projectTypeId, params?.interventionYear, params?.stateCode ?? null],
    queryFn: () => listCarryForwardCandidates(params!),
    enabled: Boolean(params?.projectTypeId && params.interventionYear),
    staleTime: 30 * 1000,
    retry: 1,
  });

export const useNeedsProposalsQuery = (cycleId: string | null | undefined, query: NeedsProposalListQuery) =>
  useQuery({
    queryKey: [...needsProposalsKey(cycleId), query],
    queryFn: () => listNeedsProposals(cycleId!, query),
    enabled: Boolean(cycleId),
    staleTime: 15 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });

export const useNeedsProposalQuery = (proposalId: string | null | undefined) =>
  useQuery({
    queryKey: needsProposalKey(proposalId),
    queryFn: () => getNeedsProposal(proposalId!),
    enabled: Boolean(proposalId),
    staleTime: 15 * 1000,
    retry: 1,
  });
