import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  DismissInspectionFindingRequest,
  RaiseInspectionFindingRequest,
  ReviewSiteInspectionRequest,
  SaveReportingStreamsRequest,
} from '@insite/shared';
import {
  dismissFinding,
  raiseFinding,
  resolveFinding,
  reviewInspection,
  saveReportingStreams,
} from '../../api/inspections/inspectionsApi';
import {
  findingsKey,
  inspectionKey,
  inspectionOverviewKey,
  inspectionsKey,
  reportingStreamsKey,
} from '../../queries/inspections/useInspectionQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidateInspections(qc: QueryClient, projectId: string) {
  for (const key of [inspectionsKey, inspectionOverviewKey, findingsKey]) qc.invalidateQueries({ queryKey: key(projectId) });
  qc.invalidateQueries({ queryKey: ['inspection', projectId] });
}

export const useSaveReportingStreamsMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveReportingStreamsRequest) => saveReportingStreams(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(reportingStreamsKey(projectId), data);
      const pending = data.streams.find((s) => s.pendingChange);
      toast.success(pending ? `Streams saved. Period changes start on ${pending.pendingChange!.effectiveFrom}.` : 'Reporting streams saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the reporting streams.')),
  });
};

export const useReviewInspectionMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { inspectionId: string; body: ReviewSiteInspectionRequest }) => reviewInspection(projectId, p.inspectionId, p.body),
    onSuccess: (inspection) => {
      invalidateInspections(qc, projectId);
      qc.setQueryData(inspectionKey(projectId, inspection.id), inspection);
      toast.success(inspection.status === 'RETURNED' ? 'Inspection returned to the inspector.' : inspection.status === 'APPROVED' ? 'Inspection approved.' : 'Step approved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the review.')),
  });
};

export const useRaiseFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { inspectionId: string; body: RaiseInspectionFindingRequest }) => raiseFinding(projectId, p.inspectionId, p.body),
    onSuccess: (f) => {
      invalidateInspections(qc, projectId);
      toast.success(f.contractorName ? `Finding sent to ${f.contractorName}.` : 'Finding raised.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not raise the finding.')),
  });
};

export const useResolveFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { findingId: string; notes: string }) => resolveFinding(projectId, p.findingId, p.notes),
    onSuccess: () => {
      invalidateInspections(qc, projectId);
      toast.success('Finding resolved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not resolve the finding.')),
  });
};

export const useDismissFindingMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { findingId: string; body: DismissInspectionFindingRequest }) => dismissFinding(projectId, p.findingId, p.body),
    onSuccess: () => {
      invalidateInspections(qc, projectId);
      toast.success('Finding dismissed.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not dismiss the finding.')),
  });
};

