import type {
  CertificationComputation,
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  DirectMilestoneSuggestionDto,
  DirectMilestoneValuationDto,
  MilestoneVerificationLine,
  MilestonePaymentTerms,
  ReviewValuationRequest,
  VerifyDirectMilestoneRequest,
  IpcClaimDto,
  LenderTrancheDecisionRequest,
  MediaType,
  MonitorQueryDto,
  ResolveMonitorQueryRequest,
  RespondMonitorQueryRequest,
  ReverseTrancheDecisionRequest,
  SubmitIpcClaimRequest,
  TrancheDecisionDto,
  TrancheDto,
  UpdateConditionPrecedentStatusRequest,
  ValuationReportDto,
  WaiveConditionPrecedentRequest,
  WithdrawIpcClaimRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

const ipcBase = (projectId: string, ipcId: string) => `/projects/${projectId}/ipcs/${ipcId}`;

export const getProjectIpcs = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<IpcClaimDto[]>>(`/projects/${projectId}/ipcs`);
  return data.data;
};

export const getIpcDetails = async (projectId: string, ipcId: string) => {
  const { data } = await api.get<ApiEnvelope<IpcClaimDto>>(ipcBase(projectId, ipcId));
  return data.data;
};

export const submitIpcClaim = async (payload: { projectId: string; body: SubmitIpcClaimRequest }) => {
  const { data } = await api.post<ApiEnvelope<IpcClaimDto>>(
    `/projects/${payload.projectId}/ipcs`,
    payload.body
  );
  return data.data;
};

export const reconcileIpc = async (payload: { projectId: string; ipcId: string }) => {
  const { data } = await api.post<ApiEnvelope<IpcClaimDto>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/reconcile`
  );
  return data.data;
};

export const withdrawIpc = async (payload: {
  projectId: string;
  ipcId: string;
  body: WithdrawIpcClaimRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<IpcClaimDto>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/withdraw`,
    payload.body
  );
  return data.data;
};

export const createMonitorQuery = async (payload: {
  projectId: string;
  ipcId: string;
  body: CreateMonitorQueryRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<MonitorQueryDto>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/queries`,
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
  const { data } = await api.patch<ApiEnvelope<MonitorQueryDto>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/queries/${payload.queryId}/respond`,
    payload.body
  );
  return data.data;
};

export interface ResolveQueryResult {
  query: MonitorQueryDto;
  outstandingQueries: number;
  reconciliationPending: boolean;
  ipc: IpcClaimDto;
}

export const resolveMonitorQuery = async (payload: {
  projectId: string;
  ipcId: string;
  queryId: string;
  body: ResolveMonitorQueryRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<ResolveQueryResult>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/queries/${payload.queryId}/resolve`,
    payload.body
  );
  return data.data;
};

export interface CertifyResult {
  dryRun: boolean;
  valuationReport: ValuationReportDto | null;
  computation: CertificationComputation;
}

export const certifyIpcValuation = async (payload: {
  projectId: string;
  ipcId: string;
  body: CertifyIpcValuationRequest;
  dryRun?: boolean;
}) => {
  const { data } = await api.post<ApiEnvelope<CertifyResult>>(
    `${ipcBase(payload.projectId, payload.ipcId)}/certify${payload.dryRun ? '?dryRun=true' : ''}`,
    payload.body
  );
  return data.data;
};

export const decideTrancheRelease = async (payload: {
  projectId: string;
  trancheId: string;
  body: LenderTrancheDecisionRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<TrancheDecisionDto>>(
    `/projects/${payload.projectId}/tranches/${payload.trancheId}/decision`,
    payload.body
  );
  return data.data;
};

export const reverseTrancheDecision = async (payload: {
  projectId: string;
  decisionId: string;
  body: ReverseTrancheDecisionRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<TrancheDecisionDto>>(
    `/projects/${payload.projectId}/tranche-decisions/${payload.decisionId}/reverse`,
    payload.body
  );
  return data.data;
};

export const updateConditionStatus = async (payload: {
  projectId: string;
  trancheId: string;
  conditionId: string;
  body: UpdateConditionPrecedentStatusRequest;
}) => {
  const { data } = await api.patch<ApiEnvelope<TrancheDto>>(
    `/projects/${payload.projectId}/tranches/${payload.trancheId}/conditions/${payload.conditionId}/status`,
    payload.body
  );
  return data.data;
};

export const waiveCondition = async (payload: {
  projectId: string;
  trancheId: string;
  conditionId: string;
  body: WaiveConditionPrecedentRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<TrancheDto>>(
    `/projects/${payload.projectId}/tranches/${payload.trancheId}/conditions/${payload.conditionId}/waive`,
    payload.body
  );
  return data.data;
};

/** Uploads one supporting document through a presigned PUT and returns its object key. */
export const uploadSupportingDocument = async (payload: {
  projectId: string;
  file: File;
  mediaType: MediaType;
}) => {
  const { data } = await api.post<
    ApiEnvelope<{ objectKey: string; uploadUrl: string; storageMode: string }>
  >(`/projects/${payload.projectId}/evidence/presign`, {
    mediaType: payload.mediaType,
    fileName: payload.file.name,
    mimeType: payload.file.type || 'application/octet-stream',
    byteSize: payload.file.size,
  });
  const presigned = data.data;
  // Local development without object storage: the server issues a key but stores nothing.
  if (presigned.storageMode !== 'LOCAL_DEV_SIMULATED') {
    const res = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': payload.file.type || 'application/octet-stream' },
      body: payload.file,
    });
    if (!res.ok) throw new Error(`Upload of ${payload.file.name} failed (${res.status})`);
  }
  return presigned.objectKey;
};

/** Short-lived signed URL for an object key in this project (for <audio>/<img>). */
export const getMediaUrl = async (projectId: string, objectKey: string) => {
  const { data } = await api.get<ApiEnvelope<{ url: string; expiresInSeconds: number }>>(
    `/projects/${projectId}/media`,
    { params: { key: objectKey, format: 'json' } }
  );
  return data.data.url;
};

/** Throws on failure so the caller's mutation can report it. */
export const downloadValuationReportPdf = async (projectId: string, ipcId: string) => {
  const response = await api.get(`${ipcBase(projectId, ipcId)}/valuation-report.pdf`, {
    responseType: 'blob',
  });
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

/** PDF for any valuation (IPC or direct milestone), by valuation id (Phase 7). */
export const downloadValuationPdfById = async (projectId: string, valuationId: string) => {
  const response = await api.get(`/projects/${projectId}/valuations/${valuationId}/valuation-report.pdf`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inSite-Valuation-Report-${valuationId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Phase 7: disbursement chain and direct milestone release
// ---------------------------------------------------------------------------

/** Approve or return a valuation at an added step between certification and release. */
export const reviewValuation = async (payload: {
  projectId: string;
  valuationId: string;
  body: ReviewValuationRequest;
}) => {
  const { data } = await api.post<ApiEnvelope<{ ipcId: string | null }>>(
    `/projects/${payload.projectId}/valuations/${payload.valuationId}/review`,
    payload.body
  );
  return data.data;
};

export const getDirectMilestoneSuggestion = async (projectId: string, trancheId: string) => {
  const { data } = await api.get<ApiEnvelope<DirectMilestoneSuggestionDto>>(
    `/projects/${projectId}/milestones/direct-verify/suggestion`,
    { params: { trancheId } }
  );
  return data.data;
};

/** Server-computed amounts for a direct milestone verification (also returned by a dry run). */
export interface DirectMilestoneComputation {
  trancheId: string;
  lines: MilestoneVerificationLine[];
  totalClaimedNgn: number;
  totalCertifiedNgn: number;
  recommendedReleaseAmountNgn: number;
  recommendedHoldbackAmountNgn: number;
  certifierFullName: string;
  /** Phase 12: registration snapshot; null when none was given or the policy is HIDDEN. */
  certifierLicenseType: string | null;
  certifierLicenseNumber: string | null;
  certifierRegistrationBodyName?: string | null;
  certifierRegistrationPrefix?: string | null;
  revisionNumber: number;
  /** Phase 12: payment basis and completion as verified (dry run and verification). */
  paymentTerms?: MilestonePaymentTerms | null;
  holdbackReason?: string | null;
}

export interface VerifyDirectMilestoneResult {
  dryRun: boolean;
  valuationReportId: string | null;
  computation: DirectMilestoneComputation;
  valuation?: DirectMilestoneValuationDto;
}

export const verifyDirectMilestone = async (payload: { projectId: string; body: VerifyDirectMilestoneRequest }) => {
  const { data } = await api.post<ApiEnvelope<VerifyDirectMilestoneResult>>(
    `/projects/${payload.projectId}/milestones/direct-verify`,
    payload.body
  );
  return data.data;
};

export const listDirectMilestoneValuations = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<DirectMilestoneValuationDto[]>>(
    `/projects/${projectId}/milestones/valuations`
  );
  return data.data;
};
