import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CertifyRetentionReleaseRequest,
  ChangeProjectPhaseRequest,
  ConvertSnagsInput,
  CreateDefectTicketInput,
  CreateHandoverLinkInput,
  LenderTrancheDecisionRequest,
  RequestRetentionReleaseRequest,
} from '@insite/shared';
import { CONSTRUCTION_PHASE_LABELS } from '@insite/shared';
import {
  actOnDefectTicket,
  cancelRetentionRelease,
  certifyRetentionRelease,
  changeProjectPhase,
  convertSnagsToDefects,
  createDefectTicket,
  createHandoverLink,
  decideRetentionRelease,
  reissueHandoverLink,
  requestRetentionRelease,
  reviewHandoverSubmission,
  revokeHandoverLink,
  type DefectAction,
} from '../../api/closeout/closeoutApi';
import {
  defectTicketsKey,
  handoverLinksKey,
  handoverSubmissionsKey,
  projectPhaseKey,
  retentionSummaryKey,
} from '../../queries/closeout/useCloseoutQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidateCloseout(queryClient: QueryClient, projectId: string) {
  for (const key of [projectPhaseKey, handoverLinksKey, handoverSubmissionsKey, defectTicketsKey, retentionSummaryKey]) {
    queryClient.invalidateQueries({ queryKey: key(projectId) });
  }
  queryClient.invalidateQueries({ queryKey: ['projects'] });
}

export const useChangeProjectPhaseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangeProjectPhaseRequest) => changeProjectPhase(projectId, body),
    onSuccess: (phase) => {
      invalidateCloseout(queryClient, projectId);
      toast.success(`Project moved to ${CONSTRUCTION_PHASE_LABELS[phase.phase]}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not change the project phase.')),
  });
};

export const useCreateHandoverLinkMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHandoverLinkInput) => createHandoverLink(projectId, body),
    onSuccess: (issued) => {
      queryClient.invalidateQueries({ queryKey: handoverLinksKey(projectId) });
      toast.success(
        issued.delivery === 'SENT' || issued.delivery === 'QUEUED'
          ? `Link emailed to ${issued.link.recipientContact}.`
          : 'Link created. Copy it now: it is shown only once.'
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not create the link.')),
  });
};

export const useRevokeHandoverLinkMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => revokeHandoverLink(projectId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handoverLinksKey(projectId) });
      toast.success('Link revoked. It stopped working immediately.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not revoke the link.')),
  });
};

export const useReissueHandoverLinkMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { linkId: string; sendNow: boolean }) => reissueHandoverLink(projectId, args.linkId, { sendNow: args.sendNow }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handoverLinksKey(projectId) });
      toast.success('New link issued; the old one no longer works.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not re-issue the link.')),
  });
};

export const useReviewHandoverSubmissionMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { submissionId: string; notes?: string }) => reviewHandoverSubmission(projectId, args.submissionId, args.notes),
    onSuccess: () => {
      invalidateCloseout(queryClient, projectId);
      toast.success('Submission marked as reviewed.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not mark the submission as reviewed.')),
  });
};

export const useConvertSnagsMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { submissionId: string; body: ConvertSnagsInput }) => convertSnagsToDefects(projectId, args.submissionId, args.body),
    onSuccess: (result) => {
      invalidateCloseout(queryClient, projectId);
      toast.success(
        result.created > 0
          ? `${result.created} defect ticket(s) created${result.skipped ? `; ${result.skipped} already had one` : ''}.`
          : 'Every snag already has a defect ticket.'
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not create defect tickets.')),
  });
};

export const useCreateDefectTicketMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDefectTicketInput) => createDefectTicket(projectId, body),
    onSuccess: (ticket) => {
      invalidateCloseout(queryClient, projectId);
      toast.success(`${ticket.reference} raised against ${ticket.contractorName}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not raise the defect.')),
  });
};

const ACTION_DONE: Record<DefectAction['kind'], string> = {
  assign: 'assigned',
  rectify: 'marked as fixed',
  verify: 'updated',
  reject: 'rejected as not a defect',
};

export const useDefectActionMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { ticketId: string; action: DefectAction }) => actOnDefectTicket(projectId, args.ticketId, args.action),
    onSuccess: (ticket, args) => {
      invalidateCloseout(queryClient, projectId);
      const verb =
        args.action.kind === 'verify'
          ? ticket.status === 'VERIFIED_CLOSED'
            ? 'closed'
            : 'reopened'
          : ACTION_DONE[args.action.kind];
      toast.success(`${ticket.reference} ${verb}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update the defect.')),
  });
};

export const useRequestRetentionReleaseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestRetentionReleaseRequest) => requestRetentionRelease(projectId, body),
    onSuccess: () => {
      invalidateCloseout(queryClient, projectId);
      toast.success('Release requested. A certifier must certify it next.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not request the release.')),
  });
};

export const useCertifyRetentionReleaseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { requestId: string; body: CertifyRetentionReleaseRequest }) => certifyRetentionRelease(projectId, args.requestId, args.body),
    onSuccess: () => {
      invalidateCloseout(queryClient, projectId);
      toast.success('Release certified. It now follows the disbursement approval chain.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not certify the release.')),
  });
};

export const useCancelRetentionReleaseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelRetentionRelease(projectId, requestId),
    onSuccess: () => {
      invalidateCloseout(queryClient, projectId);
      toast.success('Release request cancelled.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not cancel the request.')),
  });
};

export const useDecideRetentionReleaseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { valuationId: string; body: Omit<LenderTrancheDecisionRequest, 'valuationReportId'> }) =>
      decideRetentionRelease(projectId, args.valuationId, args.body),
    onSuccess: (decision) => {
      invalidateCloseout(queryClient, projectId);
      toast.success(decision.decision === 'HOLD' ? 'Release held.' : 'Retention released.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the decision.')),
  });
};
