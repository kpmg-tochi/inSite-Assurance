import type {
  FindingsExportQuery,
  KpiQuery,
  PaymentsExportQuery,
  PlannerVisitsExportQuery,
  PortfolioPaymentsQuery,
  ProjectVisitsExportQuery,
} from '@insite/shared';
import { api } from '../../config/apiConfig';

/**
 * UBEC IRL: Excel exports of the visits, findings, payments and KPI screens. The server builds the
 * .xlsx with the screen's filters and names the file (Content-Disposition).
 */

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

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

const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** A blob error body hides the server's message from the API client: read it back. */
async function withServerMessage(err: unknown): Promise<never> {
  const e = err as { message?: string; response?: { data?: unknown } };
  const data = e.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text()) as { error?: { message?: string }; message?: string };
      const message = body.error?.message ?? body.message;
      if (message) e.message = message;
    } catch {
      // not JSON: keep the client's message
    }
  }
  throw err;
}

async function downloadXlsx(path: string, params: object, fallbackName: string): Promise<DownloadedFile> {
  try {
    const res = await api.get<Blob>(path, { params: clean(params), responseType: 'blob' });
    return { blob: res.data, fileName: attachmentName(String(res.headers['content-disposition'] ?? ''), fallbackName) };
  } catch (err) {
    return withServerMessage(err);
  }
}

export const exportProjectVisits = (projectId: string, query: ProjectVisitsExportQuery) =>
  downloadXlsx(`/projects/${projectId}/visits/export.xlsx`, query, 'Visits.xlsx');

export const exportPlannerVisits = (query: PlannerVisitsExportQuery) => downloadXlsx('/visits/export.xlsx', query, 'Visits.xlsx');

export const exportProjectFindings = (projectId: string, query: FindingsExportQuery) =>
  downloadXlsx(`/projects/${projectId}/findings/export.xlsx`, query, 'Findings.xlsx');

export const exportProjectPayments = (projectId: string, query: PaymentsExportQuery) =>
  downloadXlsx(`/projects/${projectId}/payments/export.xlsx`, query, 'Payments.xlsx');

export const exportKpis = (query: Partial<KpiQuery>) => downloadXlsx('/kpis/export.xlsx', query, 'Programme KPIs.xlsx');

/** Client demo updates G.2: the portfolio Payments tab (sheets Summary and Payments). */
export const exportPortfolioPayments = (query: Partial<PortfolioPaymentsQuery>) => downloadXlsx('/payments/export.xlsx', query, 'Payments.xlsx');
