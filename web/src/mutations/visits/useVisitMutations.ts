import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CancelVisitRequest,
  CreateVisitRequestInput,
  DecideVisitProposalRequest,
  DismissInspectionFindingRequest,
  GenerateVisitsRequestInput,
  RaiseVisitFindingRequestInput,
  ReviewVisitSubmissionRequest,
  UpdateVisitRequest,
  VerifySprintRequest,
} from '@insite/shared';
import {
  addVisitComment,
  cancelVisit,
  createVisit,
  decideVisitProposal,
  dismissProjectFinding,
  generateVisits,
  publishVisits,
  raiseVisitFinding,
  rebuildVisitForm,
  resolveProjectFinding,
  reviewVisitSubmission,
  saveVisitOfficers,
  updateVisit,
  verifySprint,
} from '../../api/visits/visitsApi';
import { plannerKey, projectFindingsKey, projectVisitsKey, visitOfficersKey, visitPlanPreviewKey } from '../../queries/visits/useVisitQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidateVisits(qc: QueryClient, projectId: string) {
  qc.invalidateQueries({ queryKey: projectVisitsKey(projectId) });
  qc.invalidateQueries({ queryKey: ['visit', projectId] });
  qc.invalidateQueries({ queryKey: plannerKey });
  qc.invalidateQueries({ queryKey: visitPlanPreviewKey(projectId) });
}

export const useCreateVisitMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVisitRequestInput) => createVisit(projectId, body),
    onSuccess: (v) => {
      invalidateVisits(qc, projectId);
      toast.success(v.status === 'PROPOSED' ? 'Monitoring visit proposed.' : 'Monitoring visit planned and sent to the officers.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not create the monitoring visit.')),
  });
};

export const useUpdateVisitMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; body: UpdateVisitRequest }) => updateVisit(projectId, p.visitId, p.body),
    onSuccess: () => {
      invalidateVisits(qc, projectId);
      toast.success('Monitoring visit updated.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update the monitoring visit.')),
  });
};

export const usePublishVisitsMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visitIds: string[]) => publishVisits(projectId, visitIds),
    onSuccess: (list) => {
      invalidateVisits(qc, projectId);
      toast.success(`${list.length} monitoring visit(s) published to their officers.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not publish the monitoring visits.')),
  });
};

export const useCancelVisitMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; body: CancelVisitRequest }) => cancelVisit(projectId, p.visitId, p.body),
    onSuccess: () => {
      invalidateVisits(qc, projectId);
      toast.success('Monitoring visit cancelled.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not cancel the monitoring visit.')),
  });
};

export const useRebuildVisitFormMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) => rebuildVisitForm(projectId, visitId),
    onSuccess: (r) => {
      invalidateVisits(qc, projectId);
      toast.success(r.changed ? 'Form rebuilt; the officers get the new version.' : 'The form is already up to date.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not rebuild the form.')),
  });
};

export const useGenerateVisitsMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateVisitsRequestInput) => generateVisits(projectId, body),
    onSuccess: (r) => {
      invalidateVisits(qc, projectId);
      toast.success(r.created ? `${r.created} monitoring visit(s) proposed from the plan.` : 'The plan has nothing new to propose.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not run the monitoring plan.')),
  });
};

export const useDecideProposalMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; changeId: string; body: DecideVisitProposalRequest }) => decideVisitProposal(projectId, p.visitId, p.changeId, p.body),
    onSuccess: (_v, p) => {
      invalidateVisits(qc, projectId);
      toast.success(p.body.decision === 'ACCEPT' ? 'New date accepted.' : 'Proposal rejected; the date stays.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the decision.')),
  });
};

export const useReviewVisitSubmissionMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; submissionId: string; body: ReviewVisitSubmissionRequest }) => reviewVisitSubmission(projectId, p.visitId, p.submissionId, p.body),
    onSuccess: (s) => {
      invalidateVisits(qc, projectId);
      qc.invalidateQueries({ queryKey: projectFindingsKey(projectId) });
      toast.success(s.status === 'RETURNED' ? 'Returned to the officer.' : s.status === 'APPROVED' ? 'Monitoring report accepted.' : 'Step approved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the review.')),
  });
};

export const useAddVisitCommentMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; text: string }) => addVisitComment(projectId, p.visitId, p.text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visit', projectId] }),
    onError: (err) => toast.error(errorMessage(err, 'Could not add the comment.')),
  });
};

export const useRaiseVisitFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { visitId: string; body: RaiseVisitFindingRequestInput }) => raiseVisitFinding(projectId, p.visitId, p.body),
    onSuccess: () => {
      invalidateVisits(qc, projectId);
      qc.invalidateQueries({ queryKey: projectFindingsKey(projectId) });
      toast.success('Finding raised; the next monitoring visits include a follow-up check.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not raise the finding.')),
  });
};

export const useResolveProjectFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { findingId: string; notes: string }) => resolveProjectFinding(projectId, p.findingId, p.notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectFindingsKey(projectId) });
      invalidateVisits(qc, projectId);
      toast.success('Finding rectified.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not mark the finding rectified.')),
  });
};

export const useDismissProjectFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { findingId: string; body: DismissInspectionFindingRequest }) => dismissProjectFinding(projectId, p.findingId, p.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectFindingsKey(projectId) });
      invalidateVisits(qc, projectId);
      toast.success('Finding dismissed.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not dismiss the finding.')),
  });
};

export const useSaveVisitOfficersMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => saveVisitOfficers(projectId, userIds),
    onSuccess: (data) => {
      qc.setQueryData(visitOfficersKey(projectId), data);
      toast.success('Monitoring officers saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the monitoring officers.')),
  });
};

export const useVerifySprintMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { sprintId: string; body: VerifySprintRequest }) => verifySprint(projectId, p.sprintId, p.body),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['sprint-verification', projectId] });
      qc.invalidateQueries({ queryKey: ['project-scope', projectId] });
      qc.invalidateQueries({ queryKey: ['project-scope', projectId] });
      toast.success(`${v.name} verified.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not verify the work phase.')),
  });
};
