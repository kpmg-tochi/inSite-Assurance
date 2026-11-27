import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CYCLE_DOCUMENT_KIND_META,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NeedsSeparationErrorCodeEnum,
  formatProjectCode,
  type AppropriationImportConfirmRequest,
  type AppropriationImportPreviewRequest,
  type AssignLotsRequest,
  type CycleDocumentKind,
  type NeedsApprovalActionRequestInput,
  type NeedsCycleDocumentDto,
  type SaveBeapRequestInput,
} from '@insite/shared';
import {
  actOnBeap,
  assignProcurementLots,
  confirmAppropriation,
  downloadAppropriationTemplate,
  previewAppropriation,
  recordBeapCounterpart,
  recordBudgetSubmission,
  reviewBeapItems,
  saveBeap,
  submitBeap,
  uploadFundingDocument,
  type BeapItemReviewInput,
  type FundingDocumentArea,
  type RecordBudgetSubmissionInput,
} from '../../api/needsFunding';
import { apiErrorCode } from '../../api/needsPipeline';
import { needsCycleKey, needsKey } from '../../queries/needs/useNeedsQueries';
import { needsBeapKey, needsFundingKey, needsProcurementPlanKey } from '../../queries/needs/useFundingQueries';
import { needsTasksRootKey } from '../../queries/needs/useDecisionQueries';
import { approvedListsKey } from '../../queries/approvedLists';
import { projectLotsKey } from '../../queries/projectLots';
import { errorMessage, saveDownloadedFile } from './useNeedsMutations';

/**
 * Needs pipeline wave 4 (C2, C3): the funding gate. The hooks own the toasts. A conversion (the
 * appropriation import, the BEAP's approval) refreshes every needs read, the project list, the lots
 * and the approved lists, because each of them changes with it.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The toast text for a failed write: separation of duties, the cycle's owner, or the server's message. */
function failureText(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  const separation = NeedsSeparationErrorCodeEnum.safeParse(code);
  if (separation.success) return NEEDS_SEPARATION_ERROR_MESSAGES[separation.data];
  if (code === 'NEEDS_CYCLE_FORBIDDEN') return 'Only the organisation that runs this cycle can change it.';
  return errorMessage(err, fallback);
}

/** Everything a conversion touches. */
function refreshAfterConversion(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: needsKey });
  qc.invalidateQueries({ queryKey: ['projects'] });
  qc.invalidateQueries({ queryKey: approvedListsKey });
  qc.invalidateQueries({ queryKey: projectLotsKey });
}

const AREA_KEY: Record<FundingDocumentArea, (cycleId: string) => readonly unknown[]> = {
  funding: needsFundingKey,
  'procurement-plan': needsProcurementPlanKey,
  beap: needsBeapKey,
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface AddFundingDocumentInput {
  file: File;
  kind: CycleDocumentKind;
  title: string;
}

/** Uploads a file to the area and registers it as a cycle document (listed on Cycle documents too). */
export const useAddFundingDocumentMutation = (cycleId: string, area: FundingDocumentArea) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: AddFundingDocumentInput) => uploadFundingDocument(cycleId, area, p),
    onSuccess: (doc: NeedsCycleDocumentDto) => {
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      qc.invalidateQueries({ queryKey: AREA_KEY[area](cycleId) });
      toast.success(`${CYCLE_DOCUMENT_KIND_META[doc.kind].label} "${doc.title}" uploaded.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not upload the document.')),
  });
};

// ---------------------------------------------------------------------------
// Direct Intervention: budget submission and appropriation
// ---------------------------------------------------------------------------

export interface RecordBudgetSubmissionMutationInput {
  body: Omit<RecordBudgetSubmissionInput, 'acknowledgementDocumentId'>;
  /** The acknowledgement, uploaded first and named on the record. */
  acknowledgement: { file: File; title: string } | null;
}

export const useRecordBudgetSubmissionMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, acknowledgement }: RecordBudgetSubmissionMutationInput) => {
      const doc = acknowledgement
        ? await uploadFundingDocument(cycleId, 'funding', { file: acknowledgement.file, kind: 'BUDGET_SUBMISSION_ACKNOWLEDGEMENT', title: acknowledgement.title })
        : null;
      return recordBudgetSubmission(cycleId, { ...body, acknowledgementDocumentId: doc?.id ?? null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: needsFundingKey(cycleId) });
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      toast.success('Budget submission recorded.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not record the budget submission.')),
  });
};

export const useDownloadAppropriationTemplateMutation = (cycleId: string) =>
  useMutation({
    mutationFn: () => downloadAppropriationTemplate(cycleId),
    onSuccess: saveDownloadedFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the appropriated schedule template.')),
  });

/** Reads the schedule on the server; nothing is saved. */
export const usePreviewAppropriationMutation = (cycleId: string) =>
  useMutation({
    mutationFn: (body: AppropriationImportPreviewRequest) => previewAppropriation(cycleId, body),
    onError: (err) => toast.error(failureText(err, 'Could not read the appropriated schedule.')),
  });

/** Records the appropriation and converts every funded proposed project into a draft project. */
export const useConfirmAppropriationMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppropriationImportConfirmRequest) => confirmAppropriation(cycleId, body),
    onSuccess: (result) => {
      refreshAfterConversion(qc);
      const carried = result.notSelected.length ? ` ${plural(result.notSelected.length, 'proposed project')} not funded.` : '';
      toast.success(`Appropriation recorded: ${plural(result.converted.length, 'draft project')} created.${carried}`);
    },
    onError: (err) => {
      const code = apiErrorCode(err);
      toast.error(
        code === 'NEEDS_FILE_CHANGED'
          ? 'The file changed since it was checked. Choose it again.'
          : code === 'NEEDS_FUNDING_ALREADY_IMPORTED'
            ? 'The appropriation of this cycle is already recorded.'
            : code === 'NEEDS_APPROVED_LIST_EXISTS'
              ? 'An approved schedule for this year is already on file (Approved lists): nothing was saved.'
              : code === 'NEEDS_APPROPRIATION_INVALID'
                ? 'The schedule has errors: nothing was saved. See the list.'
                : failureText(err, 'Could not record the appropriation.')
      );
    },
  });
};

// ---------------------------------------------------------------------------
// Direct Intervention: procurement plan
// ---------------------------------------------------------------------------

export const useAssignLotsMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignLotsRequest) => assignProcurementLots(cycleId, body),
    onSuccess: (plan, body) => {
      qc.setQueryData(needsProcurementPlanKey(cycleId), plan);
      qc.invalidateQueries({ queryKey: needsFundingKey(cycleId) });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: projectLotsKey });
      const assigned = plan.rows.filter((r) => body.items.some((i) => i.projectId === r.projectId));
      const codes = assigned.map((r) => formatProjectCode(r.projectCode)).filter(Boolean);
      toast.success(`${plural(body.items.length, 'project')} given a lot${codes.length && codes.length <= 3 ? `: ${codes.join(', ')}` : ''}.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not assign the lot.')),
  });
};

// ---------------------------------------------------------------------------
// Matching Grants: BEAP
// ---------------------------------------------------------------------------

function refreshBeap(qc: QueryClient, cycleId: string) {
  qc.invalidateQueries({ queryKey: needsBeapKey(cycleId) });
  qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
  qc.invalidateQueries({ queryKey: needsTasksRootKey });
}

export const useSaveBeapMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveBeapRequestInput) => saveBeap(cycleId, body),
    onSuccess: (beap) => {
      qc.setQueryData(needsBeapKey(cycleId), beap);
      refreshBeap(qc, cycleId);
      toast.success('BEAP saved.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not save the BEAP.')),
  });
};

/** Saves the current edits, then submits the BEAP to UBEC (422 NEEDS_BEAP_INCOMPLETE says what is missing). */
export const useSubmitBeapMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SaveBeapRequestInput) => {
      const saved = await saveBeap(cycleId, body);
      qc.setQueryData(needsBeapKey(cycleId), saved);
      return submitBeap(cycleId);
    },
    onSuccess: (beap) => {
      qc.setQueryData(needsBeapKey(cycleId), beap);
      refreshBeap(qc, cycleId);
      toast.success(beap.actions.some((a) => a.decision === 'RETURN') ? 'BEAP resubmitted to UBEC.' : 'BEAP submitted to UBEC.');
    },
    onError: (err) => {
      refreshBeap(qc, cycleId);
      toast.error(
        apiErrorCode(err) === 'NEEDS_BEAP_INCOMPLETE'
          ? 'The BEAP was saved but not submitted: some details are missing. See the list.'
          : failureText(err, 'Could not submit the BEAP.')
      );
    },
  });
};

export const useReviewBeapItemsMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BeapItemReviewInput) => reviewBeapItems(cycleId, body),
    onSuccess: (beap, body) => {
      qc.setQueryData(needsBeapKey(cycleId), beap);
      toast.success(`Review saved for ${plural(body.items.length, 'item')}.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not save the review.')),
  });
};

export const useBeapActionMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NeedsApprovalActionRequestInput) => actOnBeap(cycleId, body),
    onSuccess: (beap, body) => {
      qc.setQueryData(needsBeapKey(cycleId), beap);
      if (beap.status === 'APPROVED') {
        refreshAfterConversion(qc);
        const converted = beap.items.filter((i) => i.projectId).length;
        toast.success(`BEAP approved: ${plural(converted, 'draft project')} created for the SUBEB.`);
      } else {
        refreshBeap(qc, cycleId);
        toast.success(body.decision === 'RETURN' ? 'BEAP returned to the SUBEB for revision.' : 'Approved: the BEAP moves to the next step.');
      }
    },
    onError: (err) => toast.error(failureText(err, 'Could not record the decision.')),
  });
};

export interface RecordCounterpartInput {
  counterpartDeclaredNgn: number;
  /** A new evidence file (uploaded first), or the document already on the BEAP. */
  evidence: { file: File; title: string } | { documentId: string };
}

/** Records the counterpart amount and its evidence (also after approval: activation waits for it, A5). */
export const useRecordCounterpartMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ counterpartDeclaredNgn, evidence }: RecordCounterpartInput) => {
      const documentId =
        'documentId' in evidence
          ? evidence.documentId
          : (await uploadFundingDocument(cycleId, 'beap', { file: evidence.file, kind: 'COUNTERPART_EVIDENCE', title: evidence.title })).id;
      return recordBeapCounterpart(cycleId, { counterpartDeclaredNgn, counterpartEvidenceDocumentId: documentId });
    },
    onSuccess: (beap) => {
      qc.setQueryData(needsBeapKey(cycleId), beap);
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Counterpart funding recorded.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not record the counterpart funding.')),
  });
};
