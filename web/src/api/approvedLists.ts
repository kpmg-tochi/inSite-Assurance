import type {
  ApprovedListDetailDto,
  ApprovedListImportConfirmRequest,
  ApprovedListImportPreviewDto,
  ApprovedListImportPreviewRequest,
  ApprovedListImportResultDto,
  ApprovedListsOverviewDto,
  ApprovedListYearRowsDto,
  LinkApprovedListRowRequest,
  ProjectApprovedListLinkDto,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates E3 (wave 3, read-only lists): the annual approved lists
 * (`/api/v1/approved-lists`, `approved_lists:view`) and a project's link to its row
 * (`/projects/:id/approved-list-row`: read by any project reader, saved by the setup editors).
 */
export const getApprovedListsOverview = async (interventionYear?: number | null) => {
  const params = interventionYear ? { interventionYear } : {};
  const { data } = await api.get<ApiEnvelope<ApprovedListsOverviewDto>>('/approved-lists', { params });
  return data.data;
};

/** Design refinement (2026-11-26): the year's overview plus every row of its lists, in one request. */
export const getApprovedListYearRows = async (interventionYear?: number | null) => {
  const params = interventionYear ? { interventionYear } : {};
  const { data } = await api.get<ApiEnvelope<ApprovedListYearRowsDto>>('/approved-lists/rows', { params });
  return data.data;
};

export const getApprovedList = async (listId: string) => {
  const { data } = await api.get<ApiEnvelope<ApprovedListDetailDto>>(`/approved-lists/${listId}`);
  return data.data;
};

export const getProjectApprovedListLink = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectApprovedListLinkDto | null>>(`/projects/${projectId}/approved-list-row`);
  return data.data;
};

export const linkProjectApprovedListRow = async (projectId: string, body: LinkApprovedListRowRequest) => {
  const { data } = await api.put<ApiEnvelope<ProjectApprovedListLinkDto | null>>(`/projects/${projectId}/approved-list-row`, body);
  return data.data;
};

/*
 * Client demo updates E3 (wave 4): upload a list from the template (`approved_lists:manage`).
 * One list per file; an upload replaces the list with the same year, kind and State.
 */

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

/** The blank approved list template (.xlsx) with the workspace's lists. */
export const downloadApprovedListTemplate = async () => {
  const res = await api.get<Blob>('/approved-lists/template', { responseType: 'blob' });
  const fileName = attachmentName(String(res.headers['content-disposition'] ?? ''), 'Approved list template.xlsx');
  return { blob: res.data, fileName };
};

/** Reads the file on the server; nothing is saved. */
export const previewApprovedListImport = async (body: ApprovedListImportPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<ApprovedListImportPreviewDto>>('/approved-lists/import/preview', body);
  return data.data;
};

/** Saves the checked list (the file must be the one checked: same sha256). */
export const confirmApprovedListImport = async (body: ApprovedListImportConfirmRequest) => {
  const { data } = await api.post<ApiEnvelope<ApprovedListImportResultDto>>('/approved-lists/import/confirm', body);
  return data.data;
};
