import type {
  CostingStandardImportConfirmRequestInput,
  CostingStandardImportPreviewDto,
  CostingStandardImportPreviewRequest,
  CostingStandardSaveResultDto,
  CostingStandardVersionDto,
  CostingStandardVersionSummaryDto,
  DesignStandardDocumentDto,
  NeedsFileLinkDto,
  NeedsPresignedUploadDto,
  RegisterDesignStandardDocumentRequestInput,
  StandardsOverviewDto,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';
import { downloadFile, mimeTypeOf, putPresignedFile } from './needsPipeline';

/**
 * Needs pipeline wave 2 (N2): the Standards page. Reads: any web user (`/api/v1/standards`,
 * `/api/v1/costing-standards`); writes: `standards:manage` (costing standard upload, design documents).
 */

export const getStandardsOverview = async () => {
  const { data } = await api.get<ApiEnvelope<StandardsOverviewDto>>('/standards');
  return data.data;
};

export const listCostingStandardVersions = async () => {
  const { data } = await api.get<ApiEnvelope<CostingStandardVersionSummaryDto[]>>('/costing-standards');
  return data.data;
};

export const getCurrentCostingStandard = async () => {
  const { data } = await api.get<ApiEnvelope<CostingStandardVersionDto | null>>('/costing-standards/current');
  return data.data;
};

export const getCostingStandardVersion = async (versionId: string) => {
  const { data } = await api.get<ApiEnvelope<CostingStandardVersionDto>>(`/costing-standards/${versionId}`);
  return data.data;
};

/** The costing standard workbook (.xlsx), filled with the latest version. */
export const downloadCostingStandardTemplate = () => downloadFile('/costing-standards/template', 'Costing standard.xlsx');

/** Reads the file on the server; nothing is saved. */
export const previewCostingStandardImport = async (body: CostingStandardImportPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<CostingStandardImportPreviewDto>>('/costing-standards/import/preview', body);
  return data.data;
};

/** Saves the checked file (same sha256): a new version, or the latest edited in place while unlocked. */
export const confirmCostingStandardImport = async (body: CostingStandardImportConfirmRequestInput) => {
  const { data } = await api.post<ApiEnvelope<CostingStandardSaveResultDto>>('/costing-standards/import/confirm', body);
  return data.data;
};

/** Uploads a design standard file through a presigned PUT and returns its object key. */
export const uploadDesignStandardFile = async (file: File): Promise<string> => {
  const mimeType = mimeTypeOf(file);
  const { data } = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>('/standards/design-documents/presign', {
    fileName: file.name,
    mimeType,
    byteSize: file.size,
  });
  await putPresignedFile(data.data.uploadUrl, file, mimeType);
  return data.data.objectKey;
};

export const registerDesignStandardDocument = async (body: RegisterDesignStandardDocumentRequestInput) => {
  const { data } = await api.post<ApiEnvelope<DesignStandardDocumentDto>>('/standards/design-documents', body);
  return data.data;
};

export const getDesignStandardDocumentLink = async (documentId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsFileLinkDto>>(`/standards/design-documents/${documentId}/file`, { params: { format: 'json' } });
  return data.data;
};
