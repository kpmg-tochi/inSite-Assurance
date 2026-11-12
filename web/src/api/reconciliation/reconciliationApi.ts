import type {
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  LenderTrancheDecisionRequest,
  RespondMonitorQueryRequest,
  SubmitIpcClaimRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope, IpcDetailsDto } from '../types';

export const getProjectIpcs = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<IpcDetailsDto[]>>(
    `/projects/${projectId}/ipcs`
  );
  return data.data;
};

export const getIpcDetails = async (projectId: string, ipcId: string) => {
  const { data } = await api.get<ApiEnvelope<IpcDetailsDto>>(
    `/projects/${projectId}/ipcs/${ipcId}`
  );
  return data.data;
};

export const submitIpcClaim = async (payload: {
  projectId: string;
  body: SubmitIpcClaimRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<IpcDetailsDto>>(
    `/projects/${payload.projectId}/ipcs`,
    payload.body
  );
  return data.data;
};

export const reconcileIpc = async (payload: {
  projectId: string;
  ipcId: string;
}) => {
  const { data } = await api.post<ApiEnvelope<unknown>>(
    `/projects/${payload.projectId}/ipcs/${payload.ipcId}/reconcile`
  );
  return data.data;
};

export const createMonitorQuery = async (payload: {
  projectId: string;
  ipcId: string;
  body: CreateMonitorQueryRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<unknown>>(
    `/projects/${payload.projectId}/ipcs/${payload.ipcId}/queries`,
    payload.body
  );
  return data.data;
};

export const respondMonitorQuery = async (payload: {
  projectId: string;
  ipcId: string;
  queryId: string;
  body: RespondMonitorQueryRequest;
}) => {
  const { data } = await api.patch<ApiEnvelope<unknown>>(
    `/projects/${payload.projectId}/ipcs/${payload.ipcId}/queries/${payload.queryId}/respond`,
    payload.body
  );
  return data.data;
};

export const certifyIpcValuation = async (payload: {
  projectId: string;
  ipcId: string;
  body: CertifyIpcValuationRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<unknown>>(
    `/projects/${payload.projectId}/ipcs/${payload.ipcId}/certify`,
    payload.body
  );
  return data.data;
};

export const decideTrancheRelease = async (payload: {
  projectId: string;
  trancheId: string;
  body: LenderTrancheDecisionRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<unknown>>(
    `/projects/${payload.projectId}/tranches/${payload.trancheId}/decision`,
    payload.body
  );
  return data.data;
};

export const downloadValuationReportPdf = async (
  projectId: string,
  ipcId: string
) => {
  const response = await api.get(
    `/projects/${projectId}/ipcs/${ipcId}/valuation-report.pdf`,
    {
      responseType: 'blob',
    }
  );
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inSite-Valuation-Report-${ipcId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

