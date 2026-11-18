import type {
  ChangePasswordRequest,
  WebAuthResponse,
  WebLoginRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

export const loginUser = async (payload: WebLoginRequest) => {
  const { data } = await api.post<ApiEnvelope<WebAuthResponse>>(
    '/auth/login',
    payload
  );
  return data.data;
};

export const changePassword = async (payload: ChangePasswordRequest) => {
  const { data } = await api.post<ApiEnvelope<WebAuthResponse>>(
    '/auth/change-password',
    payload
  );
  return data.data;
};

export const getCurrentUser = async () => {
  const { data } = await api.get<
    ApiEnvelope<{ actorType: string; user: WebAuthResponse['user'] }>
  >('/auth/me');
  return data.data;
};

