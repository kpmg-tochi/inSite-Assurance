import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApprovedListImportConfirmRequest, ApprovedListImportPreviewRequest } from '@insite/shared';
import {
  confirmApprovedListImport,
  downloadApprovedListTemplate,
  linkProjectApprovedListRow,
  previewApprovedListImport,
} from '../api/approvedLists';
import { approvedListsKey, projectApprovedListLinkKey } from '../queries/approvedLists';
import { projectOverviewKey } from '../queries/projects/useProjectsQueries';

/** Client demo updates E3 (wave 3): link the project to its approved list row (null unlinks). */
export const useLinkApprovedListRowMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowId: string | null) => linkProjectApprovedListRow(projectId, { rowId }),
    onSuccess: (link) => {
      queryClient.setQueryData(projectApprovedListLinkKey(projectId), link);
      queryClient.invalidateQueries({ queryKey: approvedListsKey });
      queryClient.invalidateQueries({ queryKey: projectOverviewKey(projectId) });
      if (!link) toast.success('Unlinked from the approved list.');
      else if (link.mismatch.flagged) toast.warning(`Linked to ${link.rowRef}. ${link.mismatch.summary}.`);
      else toast.success(`Linked to ${link.rowRef} on ${link.listTitle}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the approved list row.'),
  });
};

// ---------------------------------------------------------------------------
// Client demo updates E3 (wave 4): upload a list from the template
// ---------------------------------------------------------------------------

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** The server's error code (e.g. APPROVED_LIST_FILE_CHANGED), when it sent one. */
export const approvedListErrorCode = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;

/** Saves the downloaded file in the browser. */
function saveFile({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The blank approved list template (.xlsx). */
export const useDownloadApprovedListTemplateMutation = () =>
  useMutation({
    mutationFn: () => downloadApprovedListTemplate(),
    onSuccess: saveFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the approved list template.')),
  });

/** Checks the file on the server; nothing is saved. */
export const usePreviewApprovedListImportMutation = () =>
  useMutation({
    mutationFn: (body: ApprovedListImportPreviewRequest) => previewApprovedListImport(body),
    onError: (err) => toast.error(errorMessage(err, 'Could not read the file.')),
  });

/** Saves the checked list: replaces the list with the same year, kind and State, or adds a new one. */
export const useConfirmApprovedListImportMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApprovedListImportConfirmRequest) => confirmApprovedListImport(body),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: approvedListsKey });
      // Rows linked from the file or unlinked with a removed row change the projects' links.
      qc.invalidateQueries({ queryKey: ['project-approved-list-row'] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'projects' && q.queryKey[2] === 'overview' });
      const rows = `${result.list.rowCount} row${result.list.rowCount === 1 ? '' : 's'}`;
      if (result.created) {
        toast.success(`${result.list.title} saved with ${rows}.`);
        return;
      }
      const parts = [
        result.newCount > 0 ? `${result.newCount} new` : null,
        result.updatedCount > 0 ? `${result.updatedCount} updated` : null,
        result.removedCount > 0 ? `${result.removedCount} removed` : null,
        result.relinkedProjectCount > 0
          ? `${result.relinkedProjectCount} project link${result.relinkedProjectCount === 1 ? '' : 's'} changed`
          : null,
      ].filter(Boolean);
      toast.success(`${result.list.title} updated (${rows}${parts.length ? `: ${parts.join(', ')}` : ', no changes'}).`);
    },
    onError: (err) => {
      const code = approvedListErrorCode(err);
      toast.error(
        code === 'APPROVED_LIST_FILE_CHANGED'
          ? 'The file changed since it was checked. Choose it again.'
          : code === 'APPROVED_LIST_IMPORT_INVALID'
            ? 'The file has errors: nothing was saved.'
            : errorMessage(err, 'Could not save the approved list.')
      );
    },
  });
};
