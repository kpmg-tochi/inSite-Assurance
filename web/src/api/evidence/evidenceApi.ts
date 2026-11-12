import { api } from '../../config/apiConfig';
import type { ApiEnvelope, FieldEvidenceLogRecordDto } from '../types';

export const getProjectEvidence = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<FieldEvidenceLogRecordDto[]>>(
    `/projects/${projectId}/evidence`
  );
  return data.data;
};

