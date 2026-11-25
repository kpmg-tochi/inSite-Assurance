import type {
  ProjectRegisterFilterOptionsDto,
  ProjectRegisterFilters,
  ProjectRegisterImportConfirmRequest,
  ProjectRegisterImportPreviewDto,
  ProjectRegisterImportPreviewRequest,
  ProjectRegisterImportResultDto,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** UBEC IRL: the project register (filter options, Excel/PDF export, bulk import of existing projects). */

/** The download name from Content-Disposition (filename* first, for non-ASCII names). */
function attachmentName(disposition: string, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
}

/** Drops empty values so the query string carries only the filters in use. */
function cleanParams(filters: ProjectRegisterFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value as string | number;
  }
  return out;
}

/** What the register filters can choose from, over the projects the caller can see. */
export const getProjectRegisterOptions = async () => {
  const { data } = await api.get<ApiEnvelope<ProjectRegisterFilterOptionsDto>>('/projects/register/options');
  return data.data;
};

export type ProjectRegisterExportFormat = 'xlsx' | 'pdf';

/** The register as shown (filters, status button, search), as .xlsx or .pdf. */
export const downloadProjectRegisterExport = async (format: ProjectRegisterExportFormat, filters: ProjectRegisterFilters) => {
  const res = await api.get<Blob>(`/projects/export.${format}`, { params: cleanParams(filters), responseType: 'blob' });
  const fileName = attachmentName(String(res.headers['content-disposition'] ?? ''), `Project register.${format}`);
  return { blob: res.data, fileName };
};

/** The blank import template with the workspace's lists. */
export const downloadProjectRegisterTemplate = async () => {
  const res = await api.get<Blob>('/project-register/template', { responseType: 'blob' });
  const fileName = attachmentName(String(res.headers['content-disposition'] ?? ''), 'Project register template.xlsx');
  return { blob: res.data, fileName };
};

/** Reads the file on the server; nothing is saved. */
export const previewProjectRegisterImport = async (body: ProjectRegisterImportPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectRegisterImportPreviewDto>>('/project-register/import/preview', body);
  return data.data;
};

/** Creates the previewed projects (the file must be the one previewed: same sha256). */
export const confirmProjectRegisterImport = async (body: ProjectRegisterImportConfirmRequest) => {
  const { data } = await api.post<ApiEnvelope<ProjectRegisterImportResultDto>>('/project-register/import/confirm', body);
  return data.data;
};
