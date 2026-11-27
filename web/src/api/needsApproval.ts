import type {
  OutOfCycleFileConfirmRequest,
  OutOfCycleFileRequest,
  WithdrawOutOfCycleRequest,
  NeedsApprovalActionRequestInput,
  NeedsCycleDocumentDto,
  NeedsOutOfCycleDto,
  NeedsPresignedUploadDto,
  NeedsProposalDocumentDto,
  NeedsSubmissionDto,
  NeedsSubmissionKind,
  NeedsUploadFilePreview,
  OutOfCycleRequestInput,
  ProposalDocumentKind,
  SubmitPortfolioRequestInput,
  UpdateOutOfCycleRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import { mimeTypeOf, putPresignedFile } from './needsPipeline';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 4 (N6, parent plan 17.10): cycle submissions (portfolio or State approval),
 * the approval chain actions and out-of-cycle requests (`/api/v1/needs`). Reads need `needs:view`;
 * the portfolio is submitted with `needs:submit_portfolio` from the cycle's owning organisation; a
 * chain step is acted on by its holder (the DTO's `canAct`); an out-of-cycle request is made with
 * `needs:submit` and decided with `needs:approve_out_of_cycle`. The server checks every rule.
 */

// ---------------------------------------------------------------------------
// Submissions (any kind)
// ---------------------------------------------------------------------------

export const listCycleSubmissions = async (cycleId: string, kind?: NeedsSubmissionKind) => {
  const { data } = await api.get<ApiEnvelope<NeedsSubmissionDto[]>>(`/needs/cycles/${cycleId}/submissions`, { params: kind ? { kind } : {} });
  return data.data;
};

export const getNeedsSubmission = async (submissionId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsSubmissionDto>>(`/needs/submissions/${submissionId}`);
  return data.data;
};

// ---------------------------------------------------------------------------
// Portfolio (DI) / State approval (MG)
// ---------------------------------------------------------------------------

/** Submits the portfolio (or resubmits a returned one): every proposed project at Approval, included or excluded with a reason. */
export const submitPortfolio = async (cycleId: string, body: SubmitPortfolioRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/portfolio`, body);
  return data.data;
};

/** Approve or return at the current step (approve may exclude more; the last step needs the signed memo). */
export const actOnPortfolio = async (cycleId: string, body: NeedsApprovalActionRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/portfolio/actions`, body);
  return data.data;
};

/** Uploads the signed approval memo (presign, PUT, register as APPROVAL_MEMO). */
export const uploadApprovalMemo = async (cycleId: string, p: { file: File; title: string }) => {
  const mimeType = mimeTypeOf(p.file);
  const presign = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>(`/needs/cycles/${cycleId}/portfolio/memo/presign`, {
    fileName: p.file.name,
    mimeType,
    byteSize: p.file.size,
  });
  await putPresignedFile(presign.data.data.uploadUrl, p.file, mimeType);
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto>>(`/needs/cycles/${cycleId}/portfolio/memo`, {
    objectKey: presign.data.data.objectKey,
    kind: 'APPROVAL_MEMO',
    title: p.title,
  });
  return data.data;
};

// ---------------------------------------------------------------------------
// Out-of-cycle requests (D-N.14)
// ---------------------------------------------------------------------------

export const createOutOfCycleRequest = async (body: OutOfCycleRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsOutOfCycleDto>>('/needs/out-of-cycle', body);
  return data.data;
};

export const listOutOfCycleRequests = async (cycleId?: string | null) => {
  const { data } = await api.get<ApiEnvelope<NeedsOutOfCycleDto[]>>('/needs/out-of-cycle', { params: cycleId ? { cycleId } : {} });
  return data.data;
};

export const getOutOfCycleRequest = async (proposalId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsOutOfCycleDto>>(`/needs/out-of-cycle/${proposalId}`);
  return data.data;
};

export const updateOutOfCycleRequest = async (proposalId: string, body: UpdateOutOfCycleRequest) => {
  const { data } = await api.patch<ApiEnvelope<NeedsOutOfCycleDto>>(`/needs/out-of-cycle/${proposalId}`, body);
  return data.data;
};

/** Uploads a document of the request (the authorising document or another proposal document kind). */
export const uploadOutOfCycleDocument = async (proposalId: string, p: { file: File; kind: ProposalDocumentKind; title: string }) => {
  const mimeType = mimeTypeOf(p.file);
  const presign = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>(`/needs/out-of-cycle/${proposalId}/documents/presign`, {
    fileName: p.file.name,
    mimeType,
    byteSize: p.file.size,
  });
  await putPresignedFile(presign.data.data.uploadUrl, p.file, mimeType);
  const { data } = await api.post<ApiEnvelope<NeedsProposalDocumentDto>>(`/needs/out-of-cycle/${proposalId}/documents`, {
    objectKey: presign.data.data.objectKey,
    kind: p.kind,
    title: p.title,
  });
  return data.data;
};

/** Checks a needs assessment file for the request (nothing saved). */
export const previewOutOfCycleNeedsAssessment = async (proposalId: string, body: OutOfCycleFileRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsUploadFilePreview>>(`/needs/out-of-cycle/${proposalId}/needs-assessment/preview`, body);
  return data.data;
};

/** Saves the checked file (same sha256 as the check, else 409 NEEDS_FILE_CHANGED). The response is not read: the request is refetched. */
export const confirmOutOfCycleNeedsAssessment = async (proposalId: string, body: OutOfCycleFileConfirmRequest) => {
  await api.post(`/needs/out-of-cycle/${proposalId}/needs-assessment/confirm`, body);
};

export const submitOutOfCycleRequest = async (proposalId: string) => {
  const { data } = await api.post<ApiEnvelope<NeedsOutOfCycleDto>>(`/needs/out-of-cycle/${proposalId}/submit`, {});
  return data.data;
};

export const actOnOutOfCycleRequest = async (proposalId: string, body: NeedsApprovalActionRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsOutOfCycleDto>>(`/needs/out-of-cycle/${proposalId}/actions`, body);
  return data.data;
};

export const withdrawOutOfCycleRequest = async (proposalId: string, reason: string) => {
  const body: WithdrawOutOfCycleRequest = { reason };
  const { data } = await api.post<ApiEnvelope<NeedsOutOfCycleDto>>(`/needs/out-of-cycle/${proposalId}/withdraw`, body);
  return data.data;
};
