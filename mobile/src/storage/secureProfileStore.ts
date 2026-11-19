import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { FieldPersonaType } from '@insite/shared';

export interface LocalUserProfile {
  fullName: string;
  phoneNumber: string;
  roleTitle?: string;
  avatarBase64?: string | null;
  hardwareDeviceId: string;
  deviceKeyFingerprint: string;
  activeProjectId?: string | null;
  activeProjectCode?: string | null;
  activeSessionId?: string | null;
  activeSessionToken?: string | null;
  activeRoleId?: string | null;
  activeRoleCode?: string | null;
  activeRoleName?: string | null;
  activeFieldPersonaType?: FieldPersonaType | null;
  activeAssuranceWeight?: number | null;
  activeRequiresIdentityAssurance?: boolean;
  activePermissions?: string[];
  assuranceStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'NOT_SUBMITTED';
  /** Reviewer's reason when the identity check was returned. */
  rejectionReason?: string | null;
  onboardingCompleted: boolean;
}

const PROFILE_KEY = 'insite_mobile_user_profile_v2';
const DEVICE_ID_KEY = 'insite_mobile_device_id_v2';

/**
 * Retrieves the hardware identity binding or generates a cryptographically
 * unique UUID if running for the first time.
 */
export async function getOrCreateHardwareDeviceId(): Promise<string> {
  try {
    let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `DEV-${Crypto.randomUUID().toUpperCase().slice(0, 18)}`;
      await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch (error) {
    // Web or fallback simulation
    return 'DEV-IN-SITU-HARDWARE-001';
  }
}

/**
 * Load the profile stored securely on this physical device.
 */
export async function loadLocalProfile(): Promise<LocalUserProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalUserProfile;
  } catch (error) {
    console.warn('Failed to load local profile from SecureStore:', error);
    return null;
  }
}

/**
 * Persist the user profile into expo-secure-store.
 */
export async function saveLocalProfile(profile: LocalUserProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.error('Failed to save profile to SecureStore:', error);
    throw error;
  }
}

/**
 * Convenience helper to update partial fields on the active profile.
 */
export async function updateLocalProfile(
  updates: Partial<LocalUserProfile>
): Promise<LocalUserProfile> {
  const existing = await loadLocalProfile();
  const hardwareDeviceId =
    existing?.hardwareDeviceId || (await getOrCreateHardwareDeviceId());

  const merged: LocalUserProfile = {
    fullName: updates.fullName || existing?.fullName || '',
    phoneNumber: updates.phoneNumber || existing?.phoneNumber || '',
    roleTitle: updates.roleTitle ?? existing?.roleTitle ?? '',
    avatarBase64: updates.avatarBase64 ?? existing?.avatarBase64 ?? null,
    hardwareDeviceId,
    deviceKeyFingerprint:
      existing?.deviceKeyFingerprint ||
      `KEY-${Crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    activeProjectId: updates.activeProjectId ?? existing?.activeProjectId ?? null,
    activeProjectCode: updates.activeProjectCode ?? existing?.activeProjectCode ?? null,
    activeSessionId: updates.activeSessionId ?? existing?.activeSessionId ?? null,
    activeSessionToken: updates.activeSessionToken ?? existing?.activeSessionToken ?? null,
    activeRoleId: updates.activeRoleId ?? existing?.activeRoleId ?? null,
    activeRoleCode: updates.activeRoleCode ?? existing?.activeRoleCode ?? null,
    activeRoleName: updates.activeRoleName ?? existing?.activeRoleName ?? null,
    activeFieldPersonaType:
      updates.activeFieldPersonaType ?? existing?.activeFieldPersonaType ?? null,
    activeAssuranceWeight:
      updates.activeAssuranceWeight ?? existing?.activeAssuranceWeight ?? null,
    activeRequiresIdentityAssurance:
      updates.activeRequiresIdentityAssurance ??
      existing?.activeRequiresIdentityAssurance ??
      false,
    activePermissions:
      updates.activePermissions ?? existing?.activePermissions ?? [],
    assuranceStatus:
      updates.assuranceStatus ?? existing?.assuranceStatus ?? 'NOT_SUBMITTED',
    rejectionReason:
      updates.rejectionReason !== undefined ? updates.rejectionReason : existing?.rejectionReason ?? null,
    onboardingCompleted:
      updates.onboardingCompleted ?? existing?.onboardingCompleted ?? false,
  };

  await saveLocalProfile(merged);
  return merged;
}

/**
 * Clear session data when switching project or resetting device binding.
 */
export async function clearActiveProjectSession(): Promise<void> {
  const existing = await loadLocalProfile();
  if (existing) {
    await saveLocalProfile({
      ...existing,
      activeProjectId: null,
      activeProjectCode: null,
      activeSessionId: null,
      activeSessionToken: null,
      activeRoleId: null,
      activeRoleCode: null,
      activeRoleName: null,
      activeFieldPersonaType: null,
      activeAssuranceWeight: null,
      activeRequiresIdentityAssurance: false,
      activePermissions: [],
      assuranceStatus: 'NOT_SUBMITTED',
    });
  }
}

/**
 * Completely removes persisted profile and session credentials from device SecureStore.
 */
export async function wipeAllLocalProfileData(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PROFILE_KEY);
  } catch (error) {
    console.warn('Failed to clear profile from SecureStore:', error);
  }
}

