import type {
  ContractorVerificationRecordDto,
  PortfolioExecutiveSummaryDto,
  ReviewContractorVerificationRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

export const getProjectContractorVerifications = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ContractorVerificationRecordDto[]>>(
    `/projects/${projectId}/contractor-verifications`
  );
  return data.data;
};

export const reviewContractorVerification = async (
  projectId: string,
  sessionId: string,
  payload: ReviewContractorVerificationRequest
) => {
  const { data } = await api.post<ApiEnvelope<ContractorVerificationRecordDto>>(
    `/projects/${projectId}/contractor-verifications/${sessionId}/review`,
    payload
  );
  return data.data;
};

export const getPortfolioExecutiveSummary = async () => {
  const { data } = await api.get<ApiEnvelope<PortfolioExecutiveSummaryDto>>(
    '/projects/portfolio/executive-summary'
  );
  return data.data;
};

