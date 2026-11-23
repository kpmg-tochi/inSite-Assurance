import type { PaymentDto, ProjectPaymentsSummaryDto, RecordPaymentRequest, VoidPaymentRequest } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Payment record (redesign R1b): payments are made outside the platform and recorded here. */

export const getProjectPayments = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectPaymentsSummaryDto>>(`/projects/${projectId}/payments`);
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
