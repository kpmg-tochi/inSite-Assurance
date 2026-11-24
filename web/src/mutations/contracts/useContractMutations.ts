import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ActOnDefaultCaseRequest,
  ApprovalStepConfigInput,
  ProjectDocumentDetailDto,
  RaiseDefaultCaseRequest,
  RecordKickoffHeldRequest,
  RegisterProjectDocumentRequest,
  SaveDocumentTypeRequestInput,
  SaveKickoffMeetingRequest,
  SendKickoffNoticeRequest,
} from '@insite/shared';
import {
  actOnDefaultCase,
  addDocumentVersion,
  archiveProjectDocument,
  completeMilestone,
  createDocumentType,
  getDocumentDownload,
  raiseDefaultCase,
  recordKickoffHeld,
  registerProjectDocument,
  saveKickoff,
  sendKickoffNotice,
  signProjectDocument,
  updateDocumentType,
  uploadProjectDocumentFile,
  waiveMilestone,
} from '../../api/contracts/contractsApi';
import { apiErrorCode, replaceProjectChain } from '../../api/process/processApi';
import {
  defaultCaseKey,
  defaultCasesKey,
  documentTypesKey,
  kickoffKey,
  milestonesKey,
  mobilisationComplianceKey,
  projectDocumentKey,
  projectDocumentsKey,
} from '../../queries/contracts/useContractQueries';
import { projectSetupKey } from '../../queries/projects/useProjectSetupQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/**
 * Toasts an error unless its code is one the page handles with its own prompt (e.g. a waiver
 * reason after NOTICE_LEAD_TIME_SHORT).
 */
const toastUnlessHandled = (err: unknown, fallback: string, handled: string[] = []) => {
  const { code } = apiErrorCode(err);
  if (code && handled.includes(code)) return;
  toast.error(errorMessage(err, fallback));
};

function invalidateContractState(qc: QueryClient, projectId: string) {
  for (const key of [milestonesKey, mobilisationComplianceKey, defaultCasesKey, kickoffKey]) {
    qc.invalidateQueries({ queryKey: key(projectId) });
  }
  qc.invalidateQueries({ queryKey: ['default-case', projectId] });
}

function invalidateDocuments(qc: QueryClient, projectId: string, doc?: ProjectDocumentDetailDto) {
  qc.invalidateQueries({ queryKey: projectDocumentsKey(projectId) });
  if (doc) qc.setQueryData(projectDocumentKey(projectId, doc.id), doc);
  // Documents are milestone and mobilisation evidence.
  qc.invalidateQueries({ queryKey: milestonesKey(projectId) });
  qc.invalidateQueries({ queryKey: mobilisationComplianceKey(projectId) });
  qc.invalidateQueries({ queryKey: documentTypesKey });
}

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export const useSaveDocumentTypeMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id?: string; body: SaveDocumentTypeRequestInput; successMessage?: string }) =>
      p.id ? updateDocumentType(p.id, p.body) : createDocumentType(p.body),
    onSuccess: (t, p) => {
      qc.invalidateQueries({ queryKey: documentTypesKey });
      toast.success(p.successMessage ?? `Document type "${t.name}" saved.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the document type.')),
  });
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Uploads the file, then registers it. `onProgress` gets 0..1 while the file uploads. */
export const useUploadDocumentMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      file: File;
      body: Omit<RegisterProjectDocumentRequest, 'objectKey'>;
      onProgress?: (fraction: number) => void;
    }) => {
      const objectKey = await uploadProjectDocumentFile(projectId, p.file, p.onProgress);
      return registerProjectDocument(projectId, { ...p.body, objectKey });
    },
    onSuccess: (doc) => {
      invalidateDocuments(qc, projectId, doc);
      toast.success(`"${doc.title}" added to the register.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not upload the document.')),
  });
};

export const useAddDocumentVersionMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { documentId: string; file: File; note?: string | null; onProgress?: (fraction: number) => void }) => {
      const objectKey = await uploadProjectDocumentFile(projectId, p.file, p.onProgress);
      return addDocumentVersion(projectId, p.documentId, { objectKey, note: p.note ?? null });
    },
    onSuccess: (doc) => {
      invalidateDocuments(qc, projectId, doc);
      toast.success(`Version ${doc.currentVersion} of "${doc.title}" uploaded.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not upload the new version.')),
  });
};

export const useSignDocumentMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { documentId: string; version: number; statement?: string }) =>
      signProjectDocument(projectId, p.documentId, { version: p.version, ...(p.statement ? { statement: p.statement } : {}) }),
    onSuccess: (doc) => {
      invalidateDocuments(qc, projectId, doc);
      toast.success(`You signed off version ${doc.currentVersion} of "${doc.title}".`);
    },
    onError: (err) => {
      const { code } = apiErrorCode(err);
      if (code === 'VERSION_SUPERSEDED') {
        qc.invalidateQueries({ queryKey: projectDocumentsKey(projectId) });
        qc.invalidateQueries({ queryKey: ['project-document', projectId] });
        toast.error('A newer version was uploaded. Read it before signing off.');
        return;
      }
      toast.error(errorMessage(err, 'Could not record the sign-off.'));
    },
  });
};

export const useArchiveDocumentMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { documentId: string; reason: string }) => archiveProjectDocument(projectId, p.documentId, { reason: p.reason }),
    onSuccess: (doc) => {
      invalidateDocuments(qc, projectId, doc);
      toast.success(`"${doc.title}" archived.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not archive the document.')),
  });
};

/** Opens a document version in a new tab (opened first so it is not treated as a pop-up). */
export const useOpenDocumentMutation = (projectId: string) =>
  useMutation({
    mutationFn: async (p: { documentId: string; version?: number }) => {
      const tab = window.open('', '_blank');
      try {
        const d = await getDocumentDownload(projectId, p.documentId, p.version);
        if (tab) tab.location.href = d.url;
        else window.location.assign(d.url);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not open the document.')),
  });

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const useCompleteMilestoneMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { milestoneId: string; notes?: string | null }) => completeMilestone(projectId, p.milestoneId, { notes: p.notes ?? null }),
    onSuccess: (data) => {
      qc.setQueryData(milestonesKey(projectId), data);
      qc.invalidateQueries({ queryKey: mobilisationComplianceKey(projectId) });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Milestone completed.');
    },
    onError: (err) => {
      const { code, details } = apiErrorCode(err);
      if (code === 'MILESTONE_DOCUMENTS_MISSING') {
        const missing = (details?.missing as Array<{ name?: string; code?: string } | string> | undefined) ?? [];
        const names = missing.map((m) => (typeof m === 'string' ? m : m.name ?? m.code)).filter(Boolean);
        toast.error(names.length ? `Still missing or unsigned: ${names.join(', ')}.` : errorMessage(err, 'Required documents are missing.'));
        return;
      }
      toast.error(errorMessage(err, 'Could not complete the milestone.'));
    },
  });
};

export const useWaiveMilestoneMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { milestoneId: string; reason: string }) => waiveMilestone(projectId, p.milestoneId, { reason: p.reason }),
    onSuccess: (data) => {
      qc.setQueryData(milestonesKey(projectId), data);
      qc.invalidateQueries({ queryKey: mobilisationComplianceKey(projectId) });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Milestone waived.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not waive the milestone.')),
  });
};

// ---------------------------------------------------------------------------
// Kick-off
// ---------------------------------------------------------------------------

export const useSaveKickoffMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveKickoffMeetingRequest) => saveKickoff(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(kickoffKey(projectId), data);
      toast.success('Kick-off meeting saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the kick-off meeting.')),
  });
};

/** A short lead time (422 NOTICE_LEAD_TIME_SHORT) is not toasted: the page asks for a waiver reason. */
export const useSendKickoffNoticeMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendKickoffNoticeRequest) => sendKickoffNotice(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(kickoffKey(projectId), data);
      invalidateContractState(qc, projectId);
      const invitees = data.meeting?.invitees ?? [];
      const queued = invitees.filter((i) => i.noticeStatus === 'QUEUED' || i.noticeStatus === 'SENT').length;
      const noEmail = invitees.filter((i) => i.noticeStatus === 'NO_EMAIL').length;
      toast.success(`Notice handed to the mail service for ${queued} invitee(s)${noEmail ? `; ${noEmail} have no email address` : ''}.`);
    },
    onError: (err) => toastUnlessHandled(err, 'Could not send the notice.', ['NOTICE_LEAD_TIME_SHORT']),
  });
};

/** Missing quorum (422 QUORUM_NOT_MET) is not toasted: the page asks for a waiver reason. */
export const useRecordKickoffHeldMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordKickoffHeldRequest) => recordKickoffHeld(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(kickoffKey(projectId), data);
      invalidateContractState(qc, projectId);
      qc.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      toast.success('Kick-off recorded as held.');
    },
    onError: (err) => toastUnlessHandled(err, 'Could not record the meeting.', ['QUORUM_NOT_MET']),
  });
};

// ---------------------------------------------------------------------------
// Default cases and termination
// ---------------------------------------------------------------------------

export const useRaiseDefaultCaseMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RaiseDefaultCaseRequest) => raiseDefaultCase(projectId, body),
    onSuccess: (c) => {
      invalidateContractState(qc, projectId);
      toast.success(`Default case opened against ${c.contractorName}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not open the default case.')),
  });
};

export const useActOnDefaultCaseMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: string; body: ActOnDefaultCaseRequest }) => actOnDefaultCase(projectId, p.caseId, p.body),
    onSuccess: (c, p) => {
      qc.setQueryData(defaultCaseKey(projectId, c.id), c);
      invalidateContractState(qc, projectId);
      if (c.status === 'TERMINATED') {
        qc.invalidateQueries({ queryKey: projectSetupKey(projectId) });
        qc.invalidateQueries({ queryKey: ['projects'] });
        qc.invalidateQueries({ queryKey: ['boq', projectId] });
      }
      const message =
        p.body.decision === 'RETURN'
          ? 'Case returned to the first step.'
          : c.status === 'TERMINATED'
            ? `Contract with ${c.contractorName} terminated.`
            : c.status === 'CURE_PERIOD'
              ? `Cure period set until ${c.newDueDate}.`
              : c.status === 'EXTENSION_GRANTED'
                ? `Extension granted to ${c.newDueDate}.`
                : c.status === 'CLOSED'
                  ? 'Case closed with no action.'
                  : 'Step approved.';
      toast.success(message);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the decision.')),
  });
};

// ---------------------------------------------------------------------------
// Contract default chain (process settings; not part of the Process step body)
// ---------------------------------------------------------------------------

export const useSaveContractDefaultChainMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { steps: ApprovalStepConfigInput[]; silent?: boolean }) => replaceProjectChain(projectId, 'CONTRACT_DEFAULT', p.steps),
    onSuccess: (_settings, p) => {
      qc.invalidateQueries({ queryKey: projectSetupKey(projectId) });
      qc.invalidateQueries({ queryKey: ['project-process', projectId] });
      if (!p.silent) toast.success('Default case chain saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the default case chain.')),
  });
};
