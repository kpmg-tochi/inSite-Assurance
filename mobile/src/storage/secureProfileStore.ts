import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type {
  FieldProjectContext,
  MobileAccountProfile,
} from '@insite/shared';

/**
 * Everything that identifies this device's user, kept in the OS keystore (Phase 5).
 *
 * - `persona`: name and phone typed by someone who joins with a project code (no account).
 * - `account`: a pre-provisioned account signed in on this device, with its token.
 * - `joinSessions`: one per project joined with a code, each with its own token.
 * - `projects`: the provisioned projects last listed by the server (offline cache).
 * - `activeProjectId`: the project the app is showing.
 *
 * The state is always written as a whole object, so a field can be cleared (the v2 store merged
 * with `??` and could never clear one).
 */

export interface LocalPersona {
  fullName: string;
  phoneNumber: string;
  avatarBase64: string | null;
}

export interface StoredAccount {
  token: string;
  profile: MobileAccountProfile;
}

export interface StoredJoinSession {
  token: string;
  context: FieldProjectContext;
}

export interface DeviceState {
  version: 3;
  persona: LocalPersona | null;
  account: StoredAccount | null;
  joinSessions: StoredJoinSession[];
  projects: FieldProjectContext[];
  activeProjectId: string | null;
}

export const EMPTY_DEVICE_STATE: DeviceState = {
  version: 3,
  persona: null,
  account: null,
  joinSessions: [],
  projects: [],
  activeProjectId: null,
};

const STATE_KEY = 'insite_mobile_device_state_v3';
const LEGACY_PROFILE_KEY = 'insite_mobile_user_profile_v2';
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

/** The v2 single-project profile, read once to migrate. */
interface LegacyProfileV2 {
  fullName?: string;
  phoneNumber?: string;
  avatarBase64?: string | null;
  activeProjectId?: string | null;
  activeProjectCode?: string | null;
  activeSessionId?: string | null;
  activeSessionToken?: string | null;
  activeRoleId?: string | null;
  activeRoleCode?: string | null;
  activeRoleName?: string | null;
  activeFieldPersonaType?: FieldProjectContext['fieldPersonaType'] | null;
  activeAssuranceWeight?: number | null;
  activeRequiresIdentityAssurance?: boolean;
  activePermissions?: string[];
  assuranceStatus?: FieldProjectContext['assuranceStatus'];
  rejectionReason?: string | null;
  onboardingCompleted?: boolean;
}

function migrateLegacy(legacy: LegacyProfileV2): DeviceState {
  const persona: LocalPersona | null = legacy.onboardingCompleted
    ? {
        fullName: legacy.fullName ?? '',
        phoneNumber: legacy.phoneNumber ?? '',
        avatarBase64: legacy.avatarBase64 ?? null,
      }
    : null;
  const joinSessions: StoredJoinSession[] = [];
  if (legacy.activeSessionToken && legacy.activeProjectId && legacy.activeSessionId && legacy.activeRoleId) {
    joinSessions.push({
      token: legacy.activeSessionToken,
      context: {
        projectId: legacy.activeProjectId,
        // The v2 store kept only the join code; the projects screen refreshes the name.
        projectName: legacy.activeProjectCode ?? 'Project',
        projectCodePrefix: (legacy.activeProjectCode ?? '').split('-').slice(0, 2).join('-'),
        origin: 'JOIN_CODE',
        sessionId: legacy.activeSessionId,
        joinCodeUsed: legacy.activeProjectCode ?? null,
        roleId: legacy.activeRoleId,
        roleCode: legacy.activeRoleCode ?? null,
        roleName: legacy.activeRoleName ?? 'Field reporter',
        fieldPersonaType: legacy.activeFieldPersonaType ?? 'INDEPENDENT_VERIFIER',
        assuranceWeight: legacy.activeAssuranceWeight ?? 1,
        requiresIdentityAssurance: Boolean(legacy.activeRequiresIdentityAssurance),
        permissions: legacy.activePermissions ?? [],
        assuranceStatus: legacy.assuranceStatus ?? 'NOT_SUBMITTED',
        rejectionReason: legacy.rejectionReason ?? null,
      },
    });
  }
  return {
    ...EMPTY_DEVICE_STATE,
    persona,
    joinSessions,
    activeProjectId: joinSessions[0]?.context.projectId ?? null,
  };
}

export async function loadDeviceState(): Promise<DeviceState> {
  try {
    const raw = await SecureStore.getItemAsync(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DeviceState;
      return { ...EMPTY_DEVICE_STATE, ...parsed, version: 3 };
    }
    const legacyRaw = await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    if (legacyRaw) {
      const migrated = migrateLegacy(JSON.parse(legacyRaw) as LegacyProfileV2);
      await saveDeviceState(migrated);
      await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY).catch(() => undefined);
      return migrated;
    }
  } catch (error) {
    console.warn('Failed to load device state from SecureStore:', error);
  }
  return EMPTY_DEVICE_STATE;
}

/** Writes the whole state. Callers build the next state from the previous one. */
export async function saveDeviceState(state: DeviceState): Promise<void> {
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
}

/** Removes everything except the hardware device id (sign-out of the last identity, reset). */
export async function wipeDeviceState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STATE_KEY);
    await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
  } catch (error) {
    console.warn('Failed to clear device state from SecureStore:', error);
  }
}
