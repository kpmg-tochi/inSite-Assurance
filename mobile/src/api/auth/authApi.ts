import type {
  ContractorAssuranceStatus,
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
import { getDevicePublicKey } from '../../security/deviceKey';
import { persistBaselinePack } from '../../storage/baselineStore';

export interface JoinProjectMobileResponse {
  accessToken: string;
  sessionProfile: FieldAgentSessionProfile;
  baselinePack: MobileBaselinePack;
}

/** Joins with a project code and registers this install's signing key in the same request. */
export const joinProjectByCode = async (
  payload: Omit<JoinProjectMobileRequest, 'devicePublicKey' | 'devicePublicKeyAlg'>
): Promise<JoinProjectMobileResponse> => {
  const deviceKey = await getDevicePublicKey();
  const result = await mobileRequest<JoinProjectMobileResponse>(
    '/auth/join-project',
    {
      method: 'POST',
      body: JSON.stringify({ ...payload, ...deviceKey }),
    }
  );
  setFieldAgentAuth(result.accessToken, result.sessionProfile);
  if (result.baselinePack) {
    saveBaselinePack(result.baselinePack);
    await persistBaselinePack(result.baselinePack).catch(() => undefined);
  }
  return result;
};

/** One-time registration of the signing key for a session that joined without one. */
export const registerDeviceKey = async (): Promise<{ devicePublicKeyId: string; alreadyRegistered: boolean }> => {
  return mobileRequest('/auth/device-key', {
    method: 'POST',
    body: JSON.stringify(await getDevicePublicKey()),
  });
};

export interface FieldSessionStatus {
  sessionId: string;
  projectId: string;
  assuranceStatus: ContractorAssuranceStatus;
  rejectionReason: string | null;
  requiresIdentityAssurance: boolean;
  devicePublicKeyId: string | null;
  project?: { id: string; timezone?: string };
}

/** The server's view of this session: the source of truth for assurance status. */
export const fetchFieldSessionStatus = async (): Promise<FieldSessionStatus> => {
  const me = await mobileRequest<{ fieldSession: FieldSessionStatus }>('/auth/me');
  return me.fieldSession;
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
    await persistBaselinePack(result.baselinePack).catch(() => undefined);
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
