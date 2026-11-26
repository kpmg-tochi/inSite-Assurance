import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CONTRACTOR_FLAG_ACTION_META,
  CONTRACTOR_FLAG_ACTION_STATUS_LABELS,
  type ContractorFlagDto,
  type DecideContractorFlagActionRequest,
  type LiftContractorFlagActionRequest,
} from '@insite/shared';
import { decideContractorFlagAction, liftContractorFlagAction } from '../api/contractorFlags';
import { contractorFlagsKey } from '../queries/contractorFlags';
import { contractorsKey } from '../queries/contractors';
import { projectPaymentsKey } from '../queries/payments/usePaymentsQueries';
import { plannerKey, projectVisitsKey } from '../queries/visits/useVisitQueries';
import { useGuardedNavigate } from '../lib/navigationGuard';

/** Client demo updates F.4: deciding and lifting flag actions. Mutation hooks own their toasts. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidateAfterDecision(queryClient: QueryClient, flag: ContractorFlagDto) {
  queryClient.invalidateQueries({ queryKey: contractorFlagsKey });
  queryClient.invalidateQueries({ queryKey: contractorsKey });
  queryClient.invalidateQueries({ queryKey: projectPaymentsKey(flag.projectId) });
  queryClient.invalidateQueries({ queryKey: projectVisitsKey(flag.projectId) });
  queryClient.invalidateQueries({ queryKey: plannerKey });
  queryClient.invalidateQueries({ queryKey: ['web-notifications'] });
}

export const useDecideContractorFlagActionMutation = (flagId: string) => {
  const queryClient = useQueryClient();
  const navigate = useGuardedNavigate();
  return useMutation({
    mutationFn: (payload: DecideContractorFlagActionRequest) => decideContractorFlagAction(flagId, payload),
    onSuccess: (flag, payload) => {
      invalidateAfterDecision(queryClient, flag);
      const meta = CONTRACTOR_FLAG_ACTION_META[payload.kind];
      if (payload.kind === 'ADDITIONAL_VISITS') {
        const decided = flag.actions
          .filter((a) => a.kind === 'ADDITIONAL_VISITS')
          .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
        const n = decided?.visitIds.length ?? payload.visitCount ?? 0;
        toast.success(`${n} monitoring visit${n === 1 ? '' : 's'} proposed: publish ${n === 1 ? 'it' : 'them'} in the monitoring planner.`, {
          action: { label: 'Open monitoring visits', onClick: () => navigate(`/app/projects/${flag.projectId}/visits`) },
          duration: 10000,
        });
        return;
      }
      if (meta.closesFlag) {
        toast.success('Flag closed with no further action.');
        return;
      }
      // Lower-case the first letter only: "Sent to Legal review" keeps "Legal review" as the cards write it.
      const status = CONTRACTOR_FLAG_ACTION_STATUS_LABELS[meta.initialStatus];
      toast.success(`${meta.label}: ${status.charAt(0).toLowerCase()}${status.slice(1)}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the action.')),
  });
};

export const useLiftContractorFlagActionMutation = (flagId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { actionId: string; body: LiftContractorFlagActionRequest }) => liftContractorFlagAction(flagId, args.actionId, args.body),
    onSuccess: (flag) => {
      invalidateAfterDecision(queryClient, flag);
      toast.success('Payment hold lifted.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not lift the payment hold.')),
  });
};
