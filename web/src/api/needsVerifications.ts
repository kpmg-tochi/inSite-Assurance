import type {
  AssignNeedsVerificationRequestInput,
  CancelNeedsVerificationRequest,
  NeedsVerificationDto,
  NeedsVerificationOfficer,
  NeedsVerificationPurpose,
  ReviewNeedsVerificationRequestInput,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 5 (N8): field verifications of proposed projects (`/api/v1/needs`). Reads need
 * `needs:view`; a VALIDATION verification is assigned with `needs:validate` while the proposal is at
 * Validation, a BEAP_REVIEW one with `needs:review_beap` while the proposal is on a BEAP in review.
 * Cancel and review follow the DTO's `allowedActions`. The officer works on the field app.
 */

export const listProposalVerifications = async (proposalId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsVerificationDto[]>>(`/needs/proposals/${proposalId}/verifications`);
  return data.data;
};

/** Every verification of the cycle (no capture links: open one to review it). */
export const listCycleVerifications = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsVerificationDto[]>>(`/needs/cycles/${cycleId}/verifications`);
  return data.data;
};

export const getNeedsVerification = async (verificationId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsVerificationDto>>(`/needs/verifications/${verificationId}`);
  return data.data;
};

/** Officers with a mobile sign-in who may be assigned, with their open verifications. */
export const listVerificationOfficers = async (proposalId: string, purpose: NeedsVerificationPurpose) => {
  const { data } = await api.get<ApiEnvelope<NeedsVerificationOfficer[]>>(`/needs/proposals/${proposalId}/verification-officers`, { params: { purpose } });
  return data.data;
};

export const assignNeedsVerification = async (proposalId: string, body: AssignNeedsVerificationRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsVerificationDto>>(`/needs/proposals/${proposalId}/verifications`, body);
  return data.data;
};

export const cancelNeedsVerification = async (verificationId: string, body: CancelNeedsVerificationRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsVerificationDto>>(`/needs/verifications/${verificationId}/cancel`, body);
  return data.data;
};

export const reviewNeedsVerification = async (verificationId: string, body: ReviewNeedsVerificationRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsVerificationDto>>(`/needs/verifications/${verificationId}/review`, body);
  return data.data;
};
