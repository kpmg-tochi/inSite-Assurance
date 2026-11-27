import { useQuery } from '@tanstack/react-query';
import { getMyScoring, getNeedsCommittee, getNeedsRanking, getProposalScores } from '../../api/needsCommittee';

/**
 * Needs pipeline wave 3 (N5): committee, the member's own score sheets, a proposal's scores and the
 * ranking. Every key starts with `needs`, so invalidating `needsKey` refreshes them too.
 */
export const committeeKey = (cycleId: string | null | undefined) => ['needs', 'committee', cycleId] as const;
export const myScoringKey = (cycleId: string | null | undefined) => ['needs', 'scoring', cycleId] as const;
export const rankingKey = (cycleId: string | null | undefined) => ['needs', 'ranking', cycleId] as const;
export const proposalScoresKey = (proposalId: string | null | undefined) => ['needs', 'scores', proposalId] as const;
/** Prefix of every proposal's scores. */
export const allProposalScoresKey = ['needs', 'scores'] as const;

export const useCommitteeQuery = (cycleId: string | null | undefined) =>
  useQuery({
    queryKey: committeeKey(cycleId),
    queryFn: () => getNeedsCommittee(cycleId!),
    enabled: Boolean(cycleId),
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useMyScoringQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: myScoringKey(cycleId),
    queryFn: () => getMyScoring(cycleId!),
    enabled: Boolean(cycleId) && enabled,
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useRankingQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: rankingKey(cycleId),
    queryFn: () => getNeedsRanking(cycleId!),
    enabled: Boolean(cycleId) && enabled,
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useProposalScoresQuery = (proposalId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: proposalScoresKey(proposalId),
    queryFn: () => getProposalScores(proposalId!),
    enabled: Boolean(proposalId) && enabled,
    staleTime: 15 * 1000,
    retry: 1,
  });
