import type { PortfolioOverviewDto, ProjectListFilters } from '@insite/shared';
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

/** Phase 11: optional type / region / owner filters (totals are computed over the filtered set). */
export const getPortfolioExecutiveSummary = async (filters: ProjectListFilters = {}) => {
  const { data } = await api.get<ApiEnvelope<PortfolioExecutiveSummaryDto>>(
    '/projects/portfolio/executive-summary',
    { params: filters }
  );
  return data.data;
};


/** Portfolio dashboard: a map point per visible live project plus KPIs (projects:view_portfolio). */
export const getPortfolioOverview = async (filters: ProjectListFilters = {}) => {
  const { data } = await api.get<ApiEnvelope<PortfolioOverviewDto>>('/projects/portfolio/overview', { params: filters });
  return data.data;
};
