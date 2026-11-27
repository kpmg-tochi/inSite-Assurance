import { useQuery } from '@tanstack/react-query';
import { getBeap, getNeedsFunding, getProcurementPlan } from '../../api/needsFunding';

/** Needs pipeline wave 4 (C2, C3): the funding gate of a cycle. Keys start with `needs`. */
export const needsFundingKey = (cycleId: string | null | undefined) => ['needs', 'funding', cycleId] as const;
export const needsProcurementPlanKey = (cycleId: string | null | undefined) => ['needs', 'procurement-plan', cycleId] as const;
export const needsBeapKey = (cycleId: string | null | undefined) => ['needs', 'beap', cycleId] as const;

/** Direct Intervention: budget submissions, the appropriation, proposals waiting and converted. */
export const useNeedsFundingQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: needsFundingKey(cycleId),
    queryFn: () => getNeedsFunding(cycleId!),
    enabled: enabled && Boolean(cycleId),
    staleTime: 30 * 1000,
    retry: 1,
  });

/** Direct Intervention: converted drafts and their lots. */
export const useProcurementPlanQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: needsProcurementPlanKey(cycleId),
    queryFn: () => getProcurementPlan(cycleId!),
    enabled: enabled && Boolean(cycleId),
    staleTime: 30 * 1000,
    retry: 1,
  });

/** Matching Grants: the State's BEAP (null before it is first saved). */
export const useBeapQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: needsBeapKey(cycleId),
    queryFn: () => getBeap(cycleId!),
    enabled: enabled && Boolean(cycleId),
    staleTime: 30 * 1000,
    retry: 1,
  });
