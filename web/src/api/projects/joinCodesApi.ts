import type {
  IssueJoinCodeRequest,
  ProjectJoinCodeDto,
  RotateJoinCodeRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

export type JoinCodeRecordDto = ProjectJoinCodeDto & {
  rotatedFromId: string | null;
  createdAt: string;
};

export const getProjectJoinCodes = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<JoinCodeRecordDto[]>>(
    `/projects/${projectId}/join-codes`
  );
  return data.data;
};

export const issueProjectJoinCode = async (projectId: string, payload: IssueJoinCodeRequest) => {
  const { data } = await api.post<ApiEnvelope<JoinCodeRecordDto>>(
    `/projects/${projectId}/join-codes`,
    payload
  );
  return data.data;
};

export const rotateProjectJoinCode = async (
  projectId: string,
  joinCodeId: string,
  payload: RotateJoinCodeRequest
) => {
  const { data } = await api.post<ApiEnvelope<JoinCodeRecordDto>>(
    `/projects/${projectId}/join-codes/${joinCodeId}/rotate`,
    payload
  );
  return data.data;
};
