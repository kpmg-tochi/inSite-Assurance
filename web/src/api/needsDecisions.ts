import type { z } from 'zod';
import type {
  NeedsCycleDocumentDto,
  NeedsDecisionResultDto,
  NeedsReportKind,
  NeedsTaskCountDto,
  NeedsTaskDto,
  NeedsTaskListQuery,
  NeedsValidationRecordDto,
  ProposalBatchActionRequestInput,
  ProposalFlagDto,
  RecordValidationRequestInput,
  ResolveProposalFlagsRequestInput,
  SeparationOverrideDecisionRequestSchema,
  SeparationOverrideRequest,
  StageDecisionRequestInput,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 3 (N4, parent plan 17.9): stage work on proposed projects. Batch actions
 * (submit, resubmit, withdraw) and stage decisions are all or nothing: a refused batch answers 409 or
 * 422 with `details.items` (`NeedsBatchProblem[]`). Separation of duties answers 409 `SAME_PERSON_*`;
 * the blocked person asks for an override and another holder of `needs:override_separation` decides.
 */

export type SeparationOverrideDecisionInput = z.input<typeof SeparationOverrideDecisionRequestSchema>;

/** Generated cycle reports a user may regenerate here (the portfolio is regenerated from the ranking). */
export type RegenerableReportKind = Exclude<NeedsReportKind, 'PRIORITISED_PROJECT_PORTFOLIO'>;

export const runProposalBatchAction = async (cycleId: string, body: ProposalBatchActionRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsDecisionResultDto>>(`/needs/cycles/${cycleId}/proposal-actions`, body);
  return data.data;
};

export const recordStageDecision = async (cycleId: string, body: StageDecisionRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsDecisionResultDto>>(`/needs/cycles/${cycleId}/decisions`, body);
  return data.data;
};

export const recordValidation = async (proposalId: string, body: RecordValidationRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsValidationRecordDto>>(`/needs/proposals/${proposalId}/validation`, body);
  return data.data;
};

export const resolveProposalFlags = async (proposalId: string, body: ResolveProposalFlagsRequestInput) => {
  const { data } = await api.post<ApiEnvelope<ProposalFlagDto[]>>(`/needs/proposals/${proposalId}/flags/resolve`, body);
  return data.data;
};

export const requestSeparationOverride = async (cycleId: string, body: SeparationOverrideRequest) => {
  const { data } = await api.post<ApiEnvelope<ProposalFlagDto>>(`/needs/cycles/${cycleId}/separation-overrides`, body);
  return data.data;
};

export const decideSeparationOverride = async (cycleId: string, flagId: string, body: SeparationOverrideDecisionInput) => {
  const { data } = await api.post<ApiEnvelope<ProposalFlagDto>>(`/needs/cycles/${cycleId}/separation-overrides/${flagId}/decision`, body);
  return data.data;
};

export const listNeedsTasks = async (query: NeedsTaskListQuery) => {
  const { data } = await api.get<ApiEnvelope<NeedsTaskDto[]>>('/needs/tasks', { params: query.cycleId ? { cycleId: query.cycleId } : {} });
  return data.data;
};

export const getNeedsTaskCount = async () => {
  const { data } = await api.get<ApiEnvelope<NeedsTaskCountDto>>('/needs/tasks/count');
  return data.data;
};

/** Builds the report again from the records (xlsx and PDF); each supersedes the previous file. */
export const regenerateNeedsReport = async (cycleId: string, kind: RegenerableReportKind) => {
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto[]>>(`/needs/cycles/${cycleId}/reports/${kind}`);
  return data.data;
};
