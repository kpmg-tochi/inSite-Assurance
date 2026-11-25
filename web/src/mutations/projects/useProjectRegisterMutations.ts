import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ProjectRegisterFilters,
  ProjectRegisterImportConfirmRequest,
  ProjectRegisterImportPreviewRequest,
} from '@insite/shared';
import {
  confirmProjectRegisterImport,
  downloadProjectRegisterExport,
  downloadProjectRegisterTemplate,
  previewProjectRegisterImport,
  type ProjectRegisterExportFormat,
} from '../../api/projects/projectRegisterApi';

/** UBEC IRL: the project register's export and bulk import. */

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** The server's error code (e.g. PROJECT_REGISTER_FILE_CHANGED), when it sent one. */
export const registerErrorCode = (err: unknown): string | undefined =>
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

/** The register as shown (filters, status button and search) as Excel or PDF. */
export const useExportProjectRegisterMutation = () =>
  useMutation({
    mutationFn: ({ format, filters }: { format: ProjectRegisterExportFormat; filters: ProjectRegisterFilters }) =>
      downloadProjectRegisterExport(format, filters),
    onSuccess: saveFile,
    onError: (err, vars) =>
      toast.error(errorMessage(err, `Could not export the project register as ${vars.format === 'pdf' ? 'PDF' : 'Excel'}.`)),
  });

/** The blank import template (.xlsx) with the workspace's lists. */
export const useDownloadProjectRegisterTemplateMutation = () =>
  useMutation({
    mutationFn: () => downloadProjectRegisterTemplate(),
    onSuccess: saveFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the import template.')),
  });

/** Reads the file on the server; nothing is saved. */
export const usePreviewProjectRegisterImportMutation = () =>
  useMutation({
    mutationFn: (body: ProjectRegisterImportPreviewRequest) => previewProjectRegisterImport(body),
    onError: (err) => toast.error(errorMessage(err, 'Could not read the file.')),
  });

/** Creates the previewed projects: drafts for projects not started, live imported projects for the others. */
export const useConfirmProjectRegisterImportMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectRegisterImportConfirmRequest) => confirmProjectRegisterImport(body),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio-overview'] });
      qc.invalidateQueries({ queryKey: ['project-drafts'] });
      // New contractors are added to the organisations.
      qc.invalidateQueries({ queryKey: ['organizations'] });
      const parts = [
        result.liveCount > 0 ? `${result.liveCount} live project${result.liveCount === 1 ? '' : 's'}` : null,
        result.draftCount > 0 ? `${result.draftCount} draft${result.draftCount === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      toast.success(parts.length ? `Imported ${parts.join(' and ')}.` : 'Nothing was imported.');
    },
    onError: (err) => {
      const code = registerErrorCode(err);
      toast.error(
        code === 'PROJECT_REGISTER_FILE_CHANGED'
          ? 'The file changed since the preview. Choose it again to preview it.'
          : errorMessage(err, 'Could not import the projects.')
      );
    },
  });
};
