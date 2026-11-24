import { Platform } from 'react-native';
import type {
  ChangePasswordRequest,
  FieldSessionSummary,
  MobileBaselinePack,
  MobileChangePasswordResponse,
  MobileLoginResponse,
  MobileProjectSummary,
  RegisterPushToken,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';
import type { SessionScope } from '../../config/authRegistry';
import { getDevicePublicKey } from '../../security/deviceKey';
import { persistBaselinePack } from '../../storage/baselineStore';
import { getOrCreateHardwareDeviceId } from '../../storage/secureProfileStore';

/** What the device says about itself at sign-in (no extra native module needed). */
function deviceDescription() {
  return {
    deviceModel: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Field Device`,
    deviceOs: `${Platform.OS} ${String(Platform.Version)}`,
  };
}

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

/** The offline baseline for one of the account's projects. */
export const fetchBaselinePack = async (projectId: string): Promise<MobileBaselinePack> => {
  const pack = await mobileRequest<MobileBaselinePack>(`/auth/mobile/projects/${projectId}/baseline`);
  await persistBaselinePack(pack).catch(() => undefined);
  return pack;
};

/** The caller's session on a project; creates a provisioned session on first use. */
export const fetchProjectSession = async (projectId: string): Promise<FieldSessionSummary> =>
  mobileRequest<FieldSessionSummary>(`/auth/mobile/projects/${projectId}/session`);

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
