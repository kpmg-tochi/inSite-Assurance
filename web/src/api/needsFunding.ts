import type { z } from 'zod';
import type {
  AppropriationImportConfirmRequest,
  AppropriationImportPreviewRequest,
  AppropriationPreviewDto,
  AppropriationResultDto,
  AssignLotsRequest,
  BeapItemReviewRequestSchema,
  CycleDocumentKind,
  NeedsApprovalActionRequestInput,
  NeedsCycleDocumentDto,
  NeedsFundingDto,
  NeedsFundingRecordDto,
  NeedsPresignedUploadDto,
  NeedsProcurementPlanDto,
  NeedsSubmissionDto,
  RecordBudgetSubmissionRequestSchema,
  RecordCounterpartRequest,
  SaveBeapRequestInput,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';
import { downloadFile, mimeTypeOf, putPresignedFile } from './needsPipeline';

/**
 * Needs pipeline wave 4 (C2, C3): the funding gate of a cycle (`/api/v1/needs`).
 * - Direct Intervention (`fundingGate` APPROPRIATION): budget submission records, the appropriated
 *   schedule import (preview writes nothing; confirm by sha256 converts the funded proposals into draft
 *   projects), and the procurement plan (lots and batches on the converted drafts).
 * - Matching Grants (`fundingGate` BEAP_APPROVAL): the State's BEAP (build, submit, UBEC review per
 *   item, approve or return, counterpart funding).
 * Documents of each area go up through its own presign and are registered as cycle documents.
 */

export type RecordBudgetSubmissionInput = z.input<typeof RecordBudgetSubmissionRequestSchema>;
export type BeapItemReviewInput = z.input<typeof BeapItemReviewRequestSchema>;

/** Where a funding document is uploaded and registered (each area checks its own permission). */
export type FundingDocumentArea = 'funding' | 'procurement-plan' | 'beap';


// ---------------------------------------------------------------------------
// Funding (Direct Intervention)
// ---------------------------------------------------------------------------

export const getNeedsFunding = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsFundingDto>>(`/needs/cycles/${cycleId}/funding`);
  return data.data;
};

export const recordBudgetSubmission = async (cycleId: string, body: RecordBudgetSubmissionInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsFundingRecordDto>>(`/needs/cycles/${cycleId}/funding/budget-submission`, body);
  return data.data;
};

/** The appropriated schedule template (.xlsx): the approved-list workbook with a "Proposal reference" column. */
export const downloadAppropriationTemplate = (cycleId: string) =>
  downloadFile(`/needs/cycles/${cycleId}/funding/appropriation/template`, 'Appropriated schedule template.xlsx');

export const previewAppropriation = async (cycleId: string, body: AppropriationImportPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<AppropriationPreviewDto>>(`/needs/cycles/${cycleId}/funding/appropriation/preview`, body);
  return data.data;
};

export const confirmAppropriation = async (cycleId: string, body: AppropriationImportConfirmRequest) => {
  const { data } = await api.post<ApiEnvelope<AppropriationResultDto>>(`/needs/cycles/${cycleId}/funding/appropriation/confirm`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Procurement plan (Direct Intervention)
// ---------------------------------------------------------------------------

export const getProcurementPlan = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsProcurementPlanDto>>(`/needs/cycles/${cycleId}/procurement-plan`);
  return data.data;
};

export const assignProcurementLots = async (cycleId: string, body: AssignLotsRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsProcurementPlanDto>>(`/needs/cycles/${cycleId}/procurement-plan/lots`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// BEAP (Matching Grants)
// ---------------------------------------------------------------------------

/** The State's BEAP, or null before the SUBEB first saves it. */
export const getBeap = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsSubmissionDto | null>>(`/needs/cycles/${cycleId}/beap`);
  return data.data ?? null;
};

export const saveBeap = async (cycleId: string, body: SaveBeapRequestInput) => {
  const { data } = await api.put<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/beap`, body);
  return data.data;
};

export const submitBeap = async (cycleId: string) => {
  const { data } = await api.post<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/beap/submit`, {});
  return data.data;
};

export const reviewBeapItems = async (cycleId: string, body: BeapItemReviewInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/beap/review-items`, body);
  return data.data;
};

export const actOnBeap = async (cycleId: string, body: NeedsApprovalActionRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/beap/actions`, body);
  return data.data;
};

export const recordBeapCounterpart = async (cycleId: string, body: RecordCounterpartRequest) => {
  const { data } = await api.put<ApiEnvelope<NeedsSubmissionDto>>(`/needs/cycles/${cycleId}/beap/counterpart`, body);
  return data.data;
};

// ---------------------------------------------------------------------------
// Documents of each area (presign, PUT the bytes, register as a cycle document)
// ---------------------------------------------------------------------------

export const uploadFundingDocument = async (
  cycleId: string,
  area: FundingDocumentArea,
  p: { file: File; kind: CycleDocumentKind; title: string }
): Promise<NeedsCycleDocumentDto> => {
  const base = `/needs/cycles/${cycleId}/${area}/documents`;
  const mimeType = mimeTypeOf(p.file);
  const presign = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>(`${base}/presign`, {
    fileName: p.file.name,
    mimeType,
    byteSize: p.file.size,
  });
  await putPresignedFile(presign.data.data.uploadUrl, p.file, mimeType);
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto>>(base, { objectKey: presign.data.data.objectKey, kind: p.kind, title: p.title });
  return data.data;
};
