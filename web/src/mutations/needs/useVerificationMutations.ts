import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AssignNeedsVerificationRequestInput,
  CancelNeedsVerificationRequest,
  NeedsVerificationDto,
  ReviewNeedsVerificationRequestInput,
} from '@insite/shared';
import { assignNeedsVerification, cancelNeedsVerification, reviewNeedsVerification } from '../../api/needsVerifications';
import { apiErrorCode } from '../../api/needsPipeline';
import { needsCycleKey, needsProposalKey, needsProposalsKey } from '../../queries/needs/useNeedsQueries';
import { needsTasksRootKey } from '../../queries/needs/useDecisionQueries';
import { needsBeapKey } from '../../queries/needs/useFundingQueries';
import { needsVerificationsRootKey } from '../../queries/needs/useVerificationQueries';
import { errorMessage } from './useNeedsMutations';

/**
 * Needs pipeline wave 5 (N8): assign, cancel and review field verifications. The hooks own the toasts.
 * A review changes the proposal (corrected site coordinates, PHOTO documents, the validation record's
 * pre-filled site verification), so the proposal, its cycle list and the task queue are refreshed.
 */

const CODE_MESSAGES: Record<string, string> = {
  NEEDS_VERIFICATION_OPEN_EXISTS: 'This proposed project already has an open field verification for this purpose. Cancel it first or wait for it.',
  NEEDS_VERIFICATION_NOT_SUBMITTED: 'The officer has not submitted this field verification (or it was already reviewed). Reload to see where it stands.',
  NEEDS_VERIFICATION_OFFICER_INVALID: 'This officer cannot be assigned: choose someone from the list (a field app sign-in in the right organisation).',
  NEEDS_VERIFICATION_SITES_INVALID: 'Choose sites of the current needs assessment version.',
  NEEDS_VERIFICATION_NOT_ACCEPTED: 'The site verification must name an accepted field verification of this proposed project.',
  NEEDS_VERIFICATION_STALE: 'The proposed project has moved on since this verification was assigned: return or cancel it.',
  NEEDS_VERIFICATION_STALE_VERSION: 'This field verification was made on an earlier version: assign a new one.',
  SAME_PERSON_VALIDATION: 'You uploaded a version of this proposed project, so another person must accept its field verification.',
  NEEDS_CYCLE_NOT_OPEN: 'The cycle is closed: nothing was changed.',
  NEEDS_CYCLE_FORBIDDEN: 'Only the organisation that runs this cycle can do this.',
};

/** The message for a failed verification write: a known code, or the server's message. */
export function verificationFailureText(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return errorMessage(err, fallback);
}

function refreshVerification(qc: QueryClient, v: NeedsVerificationDto, proposalChanged: boolean) {
  qc.invalidateQueries({ queryKey: needsVerificationsRootKey });
  qc.invalidateQueries({ queryKey: needsTasksRootKey });
  if (v.purpose === 'BEAP_REVIEW') qc.invalidateQueries({ queryKey: needsBeapKey(v.cycleId) });
  if (proposalChanged) {
    qc.invalidateQueries({ queryKey: needsProposalKey(v.proposalId) });
    qc.invalidateQueries({ queryKey: needsProposalsKey(v.cycleId) });
    qc.invalidateQueries({ queryKey: needsCycleKey(v.cycleId) });
  }
}

export const useAssignVerificationMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignNeedsVerificationRequestInput) => assignNeedsVerification(proposalId, body),
    onSuccess: (v) => {
      refreshVerification(qc, v, false);
      toast.success(`Assigned to ${v.officer.name}: it appears on their field app at the next sync.`);
    },
    onError: (err) => toast.error(verificationFailureText(err, 'Could not assign the field verification.')),
  });
};

export const useCancelVerificationMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { verificationId: string; body: CancelNeedsVerificationRequest }) => cancelNeedsVerification(p.verificationId, p.body),
    onSuccess: (v) => {
      refreshVerification(qc, v, false);
      toast.success('Field verification cancelled.');
    },
    onError: (err) => toast.error(verificationFailureText(err, 'Could not cancel the field verification.')),
  });
};

export const useReviewVerificationMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { verificationId: string; body: ReviewNeedsVerificationRequestInput }) => reviewNeedsVerification(p.verificationId, p.body),
    onSuccess: (v, p) => {
      refreshVerification(qc, v, p.body.decision === 'ACCEPT');
      if (p.body.decision === 'RETURN') {
        toast.success(`Returned to ${v.officer.name} with your reason.`);
        return;
      }
      const moved = v.submission?.siteCorrections?.length ?? 0;
      const photos = v.submission?.evidenceDocumentIds.length ?? 0;
      const parts = [
        moved ? `${moved} site location${moved === 1 ? '' : 's'} corrected` : null,
        photos ? `${photos} photo${photos === 1 ? '' : 's'} filed` : null,
      ].filter(Boolean);
      toast.success(`Field verification accepted${parts.length ? `: ${parts.join(', ')}` : ''}.`);
    },
    onError: (err) => toast.error(verificationFailureText(err, 'Could not record the review.')),
  });
};
