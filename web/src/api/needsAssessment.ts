import type {
  NeedsAssessmentConfirmRequest,
  NeedsAssessmentConfirmResultDto,
  NeedsAssessmentPreviewDto,
  NeedsAssessmentPreviewRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates D1 (wave 2): start a project from the needs assessment template. Preview
 * writes nothing; confirm (same sha256) creates the draft with its sites, work phases, units and BoQ.
 */
export const previewNeedsAssessment = async (body: NeedsAssessmentPreviewRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsAssessmentPreviewDto>>('/projects/from-needs-assessment/preview', body);
  return data.data;
};

export const confirmNeedsAssessment = async (body: NeedsAssessmentConfirmRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsAssessmentConfirmResultDto>>('/projects/from-needs-assessment/confirm', body);
  return data.data;
};

/** The coded error body of a failed call (`{ error: { code, message, details } }`). */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

export const apiErrorOf = (err: unknown): ApiErrorBody =>
  (err as { response?: { data?: { error?: ApiErrorBody } } })?.response?.data?.error ?? {};

export const NOT_NEEDS_ASSESSMENT_TEMPLATE = 'NOT_NEEDS_ASSESSMENT_TEMPLATE';
export const NEEDS_ASSESSMENT_INPUT_REQUIRED = 'NEEDS_ASSESSMENT_INPUT_REQUIRED';
