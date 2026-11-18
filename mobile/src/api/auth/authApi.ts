import type {
  DemoSkipVerificationRequest,
  FieldAgentSessionProfile,
  JoinProjectMobileRequest,
  RegisterPushToken,
  SubmitAssuranceVerificationRequest,
} from '@insite/shared';
import {
  MobileBaselinePack,
  mobileRequest,
  saveBaselinePack,
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
  if (result.baselinePack) {
    saveBaselinePack(result.baselinePack);
  }
  return result;
};

/**
 * DEMO-ONLY API: Links the mobile user directly to the project matching the
 * given joinCode with APPROVED status, skipping ID/liveness/credential verification.
 */
export const demoSkipVerification = async (
  payload: DemoSkipVerificationRequest
): Promise<JoinProjectMobileResponse> => {
  if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('Demo features are not available in this build.');
  }
  const result = await mobileRequest<JoinProjectMobileResponse>(
    '/auth/demo/skip-verification',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  setFieldAgentAuth(result.accessToken, result.sessionProfile);
  if (result.baselinePack) {
    saveBaselinePack(result.baselinePack);
  }
  return result;
};

export const registerPushToken = async (
  payload: RegisterPushToken,
  sessionTokenOverride?: string
): Promise<unknown> => {
  return mobileRequest('/auth/push-token', {
    method: 'POST',
    headers: sessionTokenOverride
      ? { Authorization: `Bearer ${sessionTokenOverride}` }
      : undefined,
    body: JSON.stringify(payload),
  });
};

export const submitAssuranceVerification = async (
  payload: SubmitAssuranceVerificationRequest
): Promise<unknown> => {
  return mobileRequest('/auth/assurance-verification', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};
