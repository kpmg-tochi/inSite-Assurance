import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CommitteeScoringRequest,
  ConflictDeclarationRequestInput,
  FinaliseRankingRequest,
  RankingPlacementRequest,
  ScoreSheetInput,
  SetCommitteeRequest,
  SetFundingLineRequest,
} from '@insite/shared';
import {
  declareCommitteeConflicts,
  finaliseRanking,
  generateRankingReport,
  saveScoreSheet,
  setCommitteeScoring,
  setFundingLine,
  setNeedsCommittee,
  setRankingPlacement,
  uploadCommitteeMinutes,
} from '../../api/needsCommittee';
import { apiErrorDetails } from '../../api/needsPipeline';
import { needsCycleKey, needsKey, needsProposalsKey } from '../../queries/needs/useNeedsQueries';
import { allProposalScoresKey, committeeKey, myScoringKey, rankingKey } from '../../queries/needs/useCommitteeQueries';

/** Needs pipeline wave 3 (N5): committee, scoring and ranking actions. The hooks own the toasts. */

/**
 * The server's message; when the error lists proposed projects (e.g. 409 `NEEDS_QUORUM_NOT_MET`
 * with `details.items` or `details.proposals`), their references are added.
 */
export function committeeErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: string })?.message || fallback;
  const details = apiErrorDetails(err) as { items?: unknown; proposals?: unknown } | undefined;
  const list = Array.isArray(details?.items) ? details.items : Array.isArray(details?.proposals) ? details.proposals : [];
  const refs = list
    .map((i) => (i && typeof i === 'object' && 'reference' in i ? String((i as { reference: unknown }).reference) : null))
    .filter((r): r is string => Boolean(r));
  if (refs.length === 0) return message;
  const shown = refs.slice(0, 5).join(', ');
  return `${message} (${shown}${refs.length > 5 ? ` and ${refs.length - 5} more` : ''})`;
}

/** Refreshes everything a committee action can change: committee, own sheets, ranking, scores, the cycle and its proposals, tasks. */
function invalidateCommittee(qc: QueryClient, cycleId: string) {
  for (const queryKey of [
    committeeKey(cycleId),
    myScoringKey(cycleId),
    rankingKey(cycleId),
    allProposalScoresKey,
    needsCycleKey(cycleId),
    needsProposalsKey(cycleId),
    ['needs', 'proposal'],
    ['needs', 'tasks'],
  ]) {
    qc.invalidateQueries({ queryKey });
  }
}

export const useSetCommitteeMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetCommitteeRequest) => setNeedsCommittee(cycleId, body),
    onSuccess: (committee) => {
      qc.setQueryData(committeeKey(cycleId), committee);
      invalidateCommittee(qc, cycleId);
      toast.success(`Committee saved: ${committee.members.length} ${committee.members.length === 1 ? 'person' : 'people'}.`);
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not save the committee.')),
  });
};

export const useDeclareConflictsMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConflictDeclarationRequestInput) => declareCommitteeConflicts(cycleId, body),
    onSuccess: (committee, body) => {
      qc.setQueryData(committeeKey(cycleId), committee);
      invalidateCommittee(qc, cycleId);
      toast.success(body.hasConflict ? 'Declaration saved. You will not score the proposed projects you named.' : 'Declaration saved: no conflict of interest.');
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not save your declaration.')),
  });
};

export const useCommitteeScoringMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CommitteeScoringRequest) => setCommitteeScoring(cycleId, body),
    onSuccess: (committee, body) => {
      qc.setQueryData(committeeKey(cycleId), committee);
      invalidateCommittee(qc, cycleId);
      toast.success(body.action === 'OPEN' ? 'Scoring is open. Members can score now.' : 'Scoring is closed.');
    },
    onError: (err, body) => toast.error(committeeErrorMessage(err, body.action === 'OPEN' ? 'Could not open scoring.' : 'Could not close scoring.')),
  });
};

export const useSaveScoreSheetMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScoreSheetInput & { reference?: string }) => {
      const { reference, ...sheet } = body;
      void reference;
      return saveScoreSheet(cycleId, sheet);
    },
    onSuccess: (_sheet, body) => {
      invalidateCommittee(qc, cycleId);
      toast.success(body.reference ? `Scores for ${body.reference} saved.` : 'Scores saved.');
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not save your scores.')),
  });
};

export const useRankingPlacementMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RankingPlacementRequest & { reference?: string }) => {
      const { reference, ...request } = body;
      void reference;
      return setRankingPlacement(cycleId, request);
    },
    onSuccess: (_r, body) => {
      invalidateCommittee(qc, cycleId);
      const who = body.reference ?? 'The proposed project';
      toast.success(body.placement === null ? `${who}: override cleared.` : `${who} placed ${body.placement === 'ABOVE' ? 'above' : 'below'} the line.`);
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not save the override.')),
  });
};

export const useFundingLineMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetFundingLineRequest) => setFundingLine(cycleId, body),
    onSuccess: (_r, body) => {
      invalidateCommittee(qc, cycleId);
      toast.success(body.linePosition === null ? 'The funding line is back at the ceiling.' : `The funding line now sits after ${body.linePosition} ranked proposed projects.`);
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not move the funding line.')),
  });
};

export const useFinaliseRankingMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FinaliseRankingRequest) => finaliseRanking(cycleId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: needsKey });
      toast.success('Ranking finalised. The proposed projects moved to Approval.');
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not finalise the ranking.')),
  });
};

export const useRankingReportMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generateRankingReport(cycleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      toast.success('Prioritised Project Portfolio generated.');
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not generate the Prioritised Project Portfolio.')),
  });
};

export const useUploadMinutesMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { file: File; title: string; supersedesId?: string | null }) => uploadCommitteeMinutes(cycleId, p),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      toast.success(`Minutes "${doc.title}" uploaded.`);
    },
    onError: (err) => toast.error(committeeErrorMessage(err, 'Could not upload the minutes.')),
  });
};
