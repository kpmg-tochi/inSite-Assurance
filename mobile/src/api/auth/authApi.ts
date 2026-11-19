import { Platform } from 'react-native';
import type {
  ChangePasswordRequest,
  ContractorAssuranceStatus,
  DemoSkipVerificationRequest,
  FieldAgentSessionProfile,
  FieldSessionSummary,
  JoinProjectMobileRequest,
  MobileBaselinePack,
  MobileChangePasswordResponse,
  MobileLoginResponse,
  MobileProjectSummary,
  RegisterPushToken,
  SubmitAssuranceVerificationRequest,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';
import { tokenForProject, type SessionScope } from '../../config/authRegistry';
import { getDevicePublicKey } from '../../security/deviceKey';
import { persistBaselinePack } from '../../storage/baselineStore';
import { getOrCreateHardwareDeviceId } from '../../storage/secureProfileStore';

export interface JoinProjectMobileResponse {
  accessToken: string;
  sessionProfile: FieldAgentSessionProfile;
  baselinePack: MobileBaselinePack;
}

/** What the device says about itself at sign-in and join (no extra native module needed). */
function deviceDescription() {
  return {
    deviceModel: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Field Device`,
    deviceOs: `${Platform.OS} ${String(Platform.Version)}`,
  };
}

async function saveBaseline(pack: MobileBaselinePack | undefined) {
  if (pack) await persistBaselinePack(pack).catch(() => undefined);
}

/**
 * Joins with a project code and registers this install's signing key in the same request.
 * Additive: other projects on the device are untouched (Phase 5).
 */
export const joinProjectByCode = async (
  payload: Omit<JoinProjectMobileRequest, 'devicePublicKey' | 'devicePublicKeyAlg'>
): Promise<JoinProjectMobileResponse> => {
  const deviceKey = await getDevicePublicKey();
  const result = await mobileRequest<JoinProjectMobileResponse>('/auth/join-project', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ ...payload, ...deviceKey }),
  });
  await saveBaseline(result.baselinePack);
  return result;
};

/** Signs in a pre-provisioned account. The device and its signing key are registered with it. */
export const signInWithAccount = async (email: string, password: string): Promise<MobileLoginResponse> => {
  const [deviceKey, deviceId] = await Promise.all([getDevicePublicKey(), getOrCreateHardwareDeviceId()]);
  return mobileRequest<MobileLoginResponse>('/auth/mobile/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      deviceId,
      ...deviceDescription(),
      ...deviceKey,
    }),
  });
};

/** Forced or voluntary password change. Returns a fresh account token. */
export const changeAccountPassword = async (
  accountToken: string,
  payload: ChangePasswordRequest
): Promise<MobileChangePasswordResponse> =>
  mobileRequest<MobileChangePasswordResponse>('/auth/mobile/change-password', {
    method: 'POST',
    auth: accountToken,
    authScope: 'account',
    body: JSON.stringify(payload),
  });

export const fetchAccountProjects = async (accountToken: string): Promise<MobileProjectSummary[]> =>
  mobileRequest<MobileProjectSummary[]>('/auth/mobile/projects', {
    auth: accountToken,
    authScope: 'account',
  });

/** Stops pushes to this device for the account. Best effort: sign-out continues offline. */
export const signOutAccount = async (accountToken: string): Promise<void> => {
  await mobileRequest('/auth/mobile/logout', { method: 'POST', auth: accountToken, authScope: 'account' });
};

/** The offline baseline for any project on the device (token chosen from the path). */
export const fetchBaselinePack = async (projectId: string): Promise<MobileBaselinePack> => {
  const pack = await mobileRequest<MobileBaselinePack>(`/auth/mobile/projects/${projectId}/baseline`);
  await saveBaseline(pack);
  return pack;
};

/** The caller's session on a project; creates a provisioned session on first use. */
export const fetchProjectSession = async (projectId: string): Promise<FieldSessionSummary> =>
  mobileRequest<FieldSessionSummary>(`/auth/mobile/projects/${projectId}/session`);

/** One-time registration of the signing key for a join session that joined without one. */
export const registerDeviceKey = async (
  joinToken: string,
  scope: SessionScope
): Promise<{ devicePublicKeyId: string; alreadyRegistered: boolean }> =>
  mobileRequest('/auth/device-key', {
    method: 'POST',
    auth: joinToken,
    authScope: scope,
    body: JSON.stringify(await getDevicePublicKey()),
  });

export interface FieldSessionStatus {
  sessionId: string;
  projectId: string;
  assuranceStatus: ContractorAssuranceStatus;
  rejectionReason: string | null;
  requiresIdentityAssurance: boolean;
  devicePublicKeyId: string | null;
  roleName: string;
  assuranceWeight: number;
  project?: { id: string; timezone?: string; name?: string; codePrefix?: string };
}

/** The server's view of one join session: the source of truth for assurance status. */
export const fetchJoinSessionStatus = async (
  joinToken: string,
  projectId: string
): Promise<FieldSessionStatus> => {
  const me = await mobileRequest<{ fieldSession: FieldSessionStatus }>('/auth/me', {
    auth: joinToken,
    authScope: `project:${projectId}`,
  });
  return me.fieldSession;
};

/**
 * DEMO-ONLY API: Links the mobile user directly to the project matching the
 * given joinCode with APPROVED status, skipping ID/liveness/credential verification.
 */
export const demoSkipVerification = async (
  payload: DemoSkipVerificationRequest,
  existingJoinToken?: string
): Promise<JoinProjectMobileResponse> => {
  if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('Demo features are not available in this build.');
  }
  const result = await mobileRequest<JoinProjectMobileResponse>('/auth/demo/skip-verification', {
    method: 'POST',
    auth: existingJoinToken ?? false,
    body: JSON.stringify(payload),
  });
  await saveBaseline(result.baselinePack);
  return result;
};

export const registerPushToken = async (
  payload: RegisterPushToken,
  token: string,
  scope: SessionScope
): Promise<unknown> =>
  mobileRequest('/auth/push-token', {
    method: 'POST',
    auth: token,
    authScope: scope,
    body: JSON.stringify(payload),
  });

/**
 * The route has no project in the path, so the token is taken from the payload's project: an
 * outbox row sent after the user switched project must still go out under its own join session.
 */
export const submitAssuranceVerification = async (
  payload: SubmitAssuranceVerificationRequest
): Promise<unknown> => {
  const token = tokenForProject(payload.projectId);
  return mobileRequest('/auth/assurance-verification', {
    method: 'POST',
    ...(token ? { auth: token, authScope: `project:${payload.projectId}` as const } : {}),
    body: JSON.stringify(payload),
  });
};
