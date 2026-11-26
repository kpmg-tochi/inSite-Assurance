import type {
  PaymentDto,
  PaymentsBreakdownDto,
  PortfolioPaymentsBreakdownQuery,
  PortfolioPaymentsListDto,
  PortfolioPaymentsQuery,
  PortfolioPaymentsSummaryDto,
  ProjectPaymentsQuery,
  ProjectPaymentsSummaryDto,
  RecordPaymentRequest,
  VoidPaymentRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Payment record (redesign R1b): payments are made outside the platform and recorded here. */

/** Only the keys in use, so the URL carries no empty parameters. */
const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** Client demo updates G.1: the record's filters and period apply server-side; the totals are the project's to date. */
export const getProjectPayments = async (projectId: string, query: ProjectPaymentsQuery = {}) => {
  const { data } = await api.get<ApiEnvelope<ProjectPaymentsSummaryDto>>(`/projects/${projectId}/payments`, { params: clean(query) });
  return data.data;
};

export const recordPayment = async (projectId: string, body: RecordPaymentRequest) => {
  const { data } = await api.post<ApiEnvelope<PaymentDto>>(`/projects/${projectId}/payments`, body);
  return data.data;
};

export const voidPayment = async (projectId: string, paymentId: string, body: VoidPaymentRequest) => {
  const { data } = await api.post<ApiEnvelope<PaymentDto>>(`/projects/${projectId}/payments/${paymentId}/void`, body);
  return data.data;
};

/** Client demo updates G.2: payments across the programme (directory visibility, `payments:view`). */
export const listPortfolioPayments = async (query: Partial<PortfolioPaymentsQuery>) => {
  const { data } = await api.get<ApiEnvelope<PortfolioPaymentsListDto>>('/payments', { params: clean(query) });
  return data.data;
};

export const getPortfolioPaymentsSummary = async (query: Partial<PortfolioPaymentsQuery>) => {
  const { data } = await api.get<ApiEnvelope<PortfolioPaymentsSummaryDto>>('/payments/summary', { params: clean(query) });
  return data.data;
};

/** Wave 4 (G.1/G.2): the summary's filters grouped by zone, State, LGA, contractor, project, month or quarter. */
export const getPortfolioPaymentsBreakdown = async (query: Partial<PortfolioPaymentsBreakdownQuery>) => {
  const { data } = await api.get<ApiEnvelope<PaymentsBreakdownDto>>('/payments/breakdown', { params: clean(query) });
  return data.data;
};
