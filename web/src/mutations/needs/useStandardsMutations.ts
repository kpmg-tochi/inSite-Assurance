import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DESIGN_STANDARD_DOCUMENT_KIND_LABELS,
  type CostingStandardImportConfirmRequestInput,
  type CostingStandardImportPreviewRequest,
  type DesignStandardDocumentKind,
} from '@insite/shared';
import {
  confirmCostingStandardImport,
  downloadCostingStandardTemplate,
  previewCostingStandardImport,
  registerDesignStandardDocument,
  uploadDesignStandardFile,
} from '../../api/needsStandards';
import { apiErrorCode } from '../../api/needsPipeline';
import { standardsKey } from '../../queries/needs/useStandardsQueries';
import { errorMessage, saveDownloadedFile } from './useNeedsMutations';

/** Needs pipeline wave 2 (N2): Standards page actions (`standards:manage`). */

export const useDownloadCostingTemplateMutation = () =>
  useMutation({
    mutationFn: () => downloadCostingStandardTemplate(),
    onSuccess: saveDownloadedFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the costing standard template.')),
  });

export const usePreviewCostingImportMutation = () =>
  useMutation({
    mutationFn: (body: CostingStandardImportPreviewRequest) => previewCostingStandardImport(body),
    onError: (err) => toast.error(errorMessage(err, 'Could not read the file.')),
  });

export const useConfirmCostingImportMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CostingStandardImportConfirmRequestInput) => confirmCostingStandardImport(body),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: standardsKey });
      toast.success(
        result.createdNewVersion
          ? `Costing standard version ${result.version.version} saved.`
          : `Costing standard version ${result.version.version} updated.`
      );
    },
    onError: (err) => {
      const code = apiErrorCode(err);
      toast.error(
        code === 'COSTING_STANDARD_FILE_CHANGED'
          ? 'The file changed since it was checked. Choose it again.'
          : code === 'COSTING_STANDARD_IMPORT_INVALID'
            ? 'The file has errors: nothing was saved.'
            : code === 'COSTING_STANDARD_LOCKED'
              ? 'That version is now in use. Check the file again to save it as a new version.'
              : errorMessage(err, 'Could not save the costing standard.')
      );
    },
  });
};

export interface AddDesignDocumentInput {
  file: File;
  kind: DesignStandardDocumentKind;
  title: string;
  facilityCodes: string[];
  supersedesId?: string | null;
}

/** Uploads a standard drawing or specification and registers it (a new version when `supersedesId` is set). */
export const useAddDesignDocumentMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: AddDesignDocumentInput) => {
      const objectKey = await uploadDesignStandardFile(p.file);
      return registerDesignStandardDocument({
        objectKey,
        kind: p.kind,
        title: p.title,
        facilityCodes: p.facilityCodes,
        supersedesId: p.supersedesId ?? null,
      });
    },
    onSuccess: (doc, p) => {
      qc.invalidateQueries({ queryKey: standardsKey });
      toast.success(
        p.supersedesId ? `New version of "${doc.title}" added.` : `${DESIGN_STANDARD_DOCUMENT_KIND_LABELS[doc.kind]} "${doc.title}" added.`
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the document.')),
  });
};
