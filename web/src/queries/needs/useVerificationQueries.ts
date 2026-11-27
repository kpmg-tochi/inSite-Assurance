import { useQuery } from '@tanstack/react-query';
import type { NeedsVerificationPurpose } from '@insite/shared';
import { getNeedsVerification, listCycleVerifications, listProposalVerifications, listVerificationOfficers } from '../../api/needsVerifications';

/** Needs pipeline wave 5 (N8): field verifications. Every key starts with `needs`. */
export const needsVerificationsRootKey = ['needs', 'verifications'] as const;
export const proposalVerificationsKey = (proposalId: string | null | undefined) => ['needs', 'verifications', 'proposal', proposalId] as const;
export const cycleVerificationsKey = (cycleId: string | null | undefined) => ['needs', 'verifications', 'cycle', cycleId] as const;
export const needsVerificationKey = (verificationId: string | null | undefined) => ['needs', 'verifications', 'one', verificationId] as const;
export const verificationOfficersKey = (proposalId: string | null | undefined, purpose: NeedsVerificationPurpose) =>
  ['needs', 'verifications', 'officers', proposalId, purpose] as const;

export const useProposalVerificationsQuery = (proposalId: string | null | undefined) =>
  useQuery({
    queryKey: proposalVerificationsKey(proposalId),
    queryFn: () => listProposalVerifications(proposalId!),
    enabled: Boolean(proposalId),
    staleTime: 15 * 1000,
    retry: 1,
  });

export const useCycleVerificationsQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: cycleVerificationsKey(cycleId),
    queryFn: () => listCycleVerifications(cycleId!),
    enabled: Boolean(cycleId) && enabled,
    staleTime: 15 * 1000,
    retry: 1,
  });

/** One verification with its capture links (signed links expire: refetched when the drawer opens). */
export const useNeedsVerificationQuery = (verificationId: string | null | undefined) =>
  useQuery({
    queryKey: needsVerificationKey(verificationId),
    queryFn: () => getNeedsVerification(verificationId!),
    enabled: Boolean(verificationId),
    staleTime: 0,
    retry: 1,
  });

export const useVerificationOfficersQuery = (proposalId: string | null | undefined, purpose: NeedsVerificationPurpose, enabled = true) =>
  useQuery({
    queryKey: verificationOfficersKey(proposalId, purpose),
    queryFn: () => listVerificationOfficers(proposalId!, purpose),
    enabled: Boolean(proposalId) && enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });
