import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CYCLE_DOCUMENT_KIND_META,
  type CycleDocumentKind,
  type NeedsFileLinkDto,
  type NeedsUploadConfirmRequestInput,
  type NeedsUploadPreviewRequestInput,
  type OpenNeedsCycleRequestInput,
  type ProposalDocumentKind,
} from '@insite/shared';
import {
  apiErrorCode,
  confirmNeedsUpload,
  downloadCycleTemplate,
  downloadProposalTemplate,
  openNeedsCycle,
  previewNeedsUpload,
  registerCycleDocument,
  registerProposalDocument,
  uploadNeedsDocumentFile,
  type DownloadedFile,
} from '../../api/needsPipeline';
import { needsCycleKey, needsCyclesKey, needsKey, needsOptionsKey, needsProposalKey, needsProposalsKey } from '../../queries/needs/useNeedsQueries';

/** Needs pipeline wave 2: cycle, upload and document actions. The hooks own the toasts. */

export const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Saves a downloaded file in the browser. */
export function saveDownloadedFile({ blob, fileName }: DownloadedFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a stored file in a new tab (the tab is opened first so it is not treated as a pop-up). */
export const useOpenNeedsFileMutation = () =>
  useMutation({
    mutationFn: async (getLink: () => Promise<NeedsFileLinkDto>) => {
      const tab = window.open('', '_blank');
      try {
        const link = await getLink();
        if (tab) tab.location.href = link.url;
        else window.location.assign(link.url);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not open the file.')),
  });

export const useDownloadCycleTemplateMutation = () =>
  useMutation({
    mutationFn: (cycleId: string) => downloadCycleTemplate(cycleId),
    onSuccess: saveDownloadedFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the needs assessment template.')),
  });

export const useDownloadProposalTemplateMutation = () =>
  useMutation({
    mutationFn: (proposalId: string) => downloadProposalTemplate(proposalId),
    onSuccess: saveDownloadedFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the pre-filled template.')),
  });

/** Opens a cycle (the circular, for Matching Grants, is added after it with `useAddCycleDocumentMutation`). */
export const useOpenNeedsCycleMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpenNeedsCycleRequestInput) => openNeedsCycle(body),
    onSuccess: (cycle) => {
      qc.setQueryData(needsCycleKey(cycle.id), cycle);
      qc.invalidateQueries({ queryKey: needsCyclesKey });
      qc.invalidateQueries({ queryKey: needsOptionsKey });
      toast.success(`${cycle.projectTypeName} ${cycle.interventionYear}${cycle.stateCode ? ` (${cycle.stateCode})` : ''} cycle opened.`);
    },
    onError: (err) => {
      const code = apiErrorCode(err);
      toast.error(
        code === 'NEEDS_CYCLE_EXISTS'
          ? 'A cycle for this programme, year and State is already open.'
          : code === 'NEEDS_PIPELINE_DISABLED'
            ? 'This programme has no needs assessment cycle. Turn it on in its project type first.'
            : errorMessage(err, 'Could not open the cycle.')
      );
    },
  });
};

export interface AddCycleDocumentInput {
  cycleId: string;
  file: File;
  kind: CycleDocumentKind;
  title: string;
  supersedesId?: string | null;
  proposalIds?: string[];
}

/** Uploads a file and registers it as a cycle document (a new version when `supersedesId` is set). */
export const useAddCycleDocumentMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: AddCycleDocumentInput) => {
      const objectKey = await uploadNeedsDocumentFile(p.cycleId, p.file);
      return registerCycleDocument(p.cycleId, {
        objectKey,
        kind: p.kind,
        title: p.title,
        supersedesId: p.supersedesId ?? null,
        proposalIds: p.proposalIds ?? [],
      });
    },
    onSuccess: (doc, p) => {
      qc.invalidateQueries({ queryKey: needsCycleKey(p.cycleId) });
      toast.success(`${CYCLE_DOCUMENT_KIND_META[doc.kind].label} "${doc.title}" added.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the document.')),
  });
};

export interface AddProposalDocumentInput {
  cycleId: string;
  proposalId: string;
  file: File;
  kind: ProposalDocumentKind;
  title: string;
  supersedesId?: string | null;
}

/** Uploads a file through the proposal's cycle and registers it on the proposal. */
export const useAddProposalDocumentMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: AddProposalDocumentInput) => {
      const objectKey = await uploadNeedsDocumentFile(p.cycleId, p.file);
      return registerProposalDocument(p.proposalId, { objectKey, kind: p.kind, title: p.title, supersedesId: p.supersedesId ?? null });
    },
    onSuccess: (doc, p) => {
      qc.invalidateQueries({ queryKey: needsProposalKey(p.proposalId) });
      toast.success(`"${doc.title}" added.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the document.')),
  });
};

/** Reads the files on the server; nothing is saved. */
export const usePreviewNeedsUploadMutation = (cycleId: string) =>
  useMutation({
    mutationFn: (body: NeedsUploadPreviewRequestInput) => previewNeedsUpload(cycleId, body),
    onError: (err) => toast.error(errorMessage(err, 'Could not read the files.')),
  });

/** Saves the valid files (each its own proposed project or a new version of the named one). */
export const useConfirmNeedsUploadMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NeedsUploadConfirmRequestInput) => confirmNeedsUpload(cycleId, body),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: needsProposalsKey(cycleId) });
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      qc.invalidateQueries({ queryKey: needsCyclesKey });
      for (const f of result.files) if (f.proposalId) qc.invalidateQueries({ queryKey: needsProposalKey(f.proposalId) });
      qc.invalidateQueries({ queryKey: [...needsKey, 'proposal'] });
      const parts = [
        result.createdCount > 0 ? `${result.createdCount} proposed project${result.createdCount === 1 ? '' : 's'} created` : null,
        result.versionCount > 0 ? `${result.versionCount} new version${result.versionCount === 1 ? '' : 's'}` : null,
        result.refusedCount > 0 ? `${result.refusedCount} file${result.refusedCount === 1 ? '' : 's'} refused` : null,
      ].filter(Boolean);
      if (result.refusedCount > 0) toast.warning(`Upload saved: ${parts.join(', ')}.`);
      else toast.success(`Upload saved: ${parts.join(', ')}.`);
    },
    onError: (err) => {
      const code = apiErrorCode(err);
      toast.error(
        code === 'NEEDS_FILE_CHANGED'
          ? 'A file changed since it was checked. Check the files again.'
          : code === 'NEEDS_FILE_INVALID'
            ? 'No file could be saved: every file has errors.'
            : code === 'NEEDS_CYCLE_NOT_OPEN'
              ? 'The cycle is closed: nothing was saved.'
              : errorMessage(err, 'Could not save the upload.')
      );
    },
  });
};
