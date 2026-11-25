import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ChangeProjectPhaseRequest,
  ConvertSnagsInput,
  CreateDefectTicketInput,
  RecordHandoverResponseInput,
} from '@insite/shared';
import { CONSTRUCTION_PHASE_LABELS } from '@insite/shared';
import {
  actOnDefectTicket,
  changeProjectPhase,
  convertSnagsToDefects,
  createDefectTicket,
  recordHandoverResponse,
  reviewHandoverSubmission,
  type DefectAction,
} from '../../api/closeout/closeoutApi';
import {
  defectTicketsKey,
  handoverSubmissionsKey,
  projectPhaseKey,
  retentionSummaryKey,
} from '../../queries/closeout/useCloseoutQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidateCloseout(queryClient: QueryClient, projectId: string) {
  for (const key of [projectPhaseKey, handoverSubmissionsKey, defectTicketsKey, retentionSummaryKey]) {
    queryClient.invalidateQueries({ queryKey: key(projectId) });
  }
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  // Phase 15: phase changes and handover reviews move the certificate view, milestones, the
  // register (handover certificate) and the closure checklist.
  for (const key of [['completion', projectId], ['contract-milestones', projectId], ['project-documents', projectId], ['closure-checklist', projectId]]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
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

export const useRecordHandoverResponseMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordHandoverResponseInput) => recordHandoverResponse(projectId, body),
    onSuccess: () => {
      invalidateCloseout(queryClient, projectId);
      toast.success('Handover response recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the handover response.')),
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
          ? `${result.created} defect(s) created${result.skipped ? `; ${result.skipped} already had one` : ''}.`
          : 'Every punch list item already has a defect.'
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not create the defects.')),
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
