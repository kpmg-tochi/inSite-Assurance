import type {
  FieldAgentSessionProfile,
  JoinProjectMobileRequest,
} from '@insite/shared';
import {
  MobileBaselinePack,
  mobileRequest,
  setFieldAgentAuth,
} from '../../config/apiConfig';

export interface JoinProjectMobileResponse {
  accessToken: string;
  sessionProfile: FieldAgentSessionProfile;
  baselinePack: MobileBaselinePack;
}

export const joinProjectByCode = async (
  payload: JoinProjectMobileRequest
): Promise<JoinProjectMobileResponse> => {
  const result = await mobileRequest<JoinProjectMobileResponse>(
    '/auth/join-project',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  setFieldAgentAuth(result.accessToken, result.sessionProfile);
  return result;
};

