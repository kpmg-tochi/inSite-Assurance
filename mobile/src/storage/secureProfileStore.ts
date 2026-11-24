import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  FieldProjectContextSchema,
  type FieldProjectContext,
  type MobileAccountProfile,
} from '@insite/shared';

/**
 * Everything that identifies this device's user, kept in the OS keystore (Phase 5; provisioned
 * accounts only since R1d).
 *
 * - `account`: the pre-provisioned account signed in on this device, with its token.
 * - `projects`: the account's projects last listed by the server (offline cache).
 * - `activeProjectId`: the project the app is showing.
 *
 * The state is always written as a whole object, so a field can be cleared.
 */

export interface StoredAccount {
  token: string;
  profile: MobileAccountProfile;
}

export interface DeviceState {
  version: 4;
  account: StoredAccount | null;
  projects: FieldProjectContext[];
  activeProjectId: string | null;
}

export const EMPTY_DEVICE_STATE: DeviceState = {
  version: 4,
  account: null,
  projects: [],
  activeProjectId: null,
};

/** What a load found: the state, and projects whose join-code session was dropped (pre-R1d). */
export interface LoadedDeviceState {
  state: DeviceState;
  endedJoinProjectIds: string[];
}

const STATE_KEY = 'insite_mobile_device_state_v4';
/** v3 (Phase 5): account plus join-code sessions. v2: one join-code session. Read once to migrate. */
const LEGACY_STATE_KEY_V3 = 'insite_mobile_device_state_v3';
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
  } catch {
    // Web or fallback simulation
    return 'DEV-IN-SITU-HARDWARE-001';
  }
}

/** Stored project contexts, reduced to the current shape (older fields are dropped). */
function toContexts(raw: unknown): FieldProjectContext[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const parsed = FieldProjectContextSchema.safeParse(p);
    return parsed.success ? [parsed.data] : [];
  });
}

function toState(raw: Partial<Record<keyof DeviceState, unknown>>): DeviceState {
  const account = raw.account as StoredAccount | null | undefined;
  return {
    version: 4,
    account: account?.token && account.profile ? account : null,
    projects: toContexts(raw.projects),
    activeProjectId: typeof raw.activeProjectId === 'string' ? raw.activeProjectId : null,
  };
}

/**
 * The v3 state kept join-code sessions beside the account. Their tokens no longer work (R1d), so
 * they are dropped; their projects are reported so that work queued under them is held.
 */
function migrateV3(raw: Record<string, unknown>): LoadedDeviceState {
  const joinSessions = Array.isArray(raw.joinSessions) ? (raw.joinSessions as Array<{ context?: { projectId?: unknown } }>) : [];
  const endedJoinProjectIds = joinSessions
    .map((j) => j.context?.projectId)
    .filter((id): id is string => typeof id === 'string');
  return { state: toState(raw), endedJoinProjectIds };
}

/** The v2 store held one join-code session and no account: only its queued work is kept. */
function migrateV2(raw: { activeProjectId?: unknown; activeSessionToken?: unknown }): LoadedDeviceState {
  const projectId = typeof raw.activeProjectId === 'string' && raw.activeSessionToken ? raw.activeProjectId : null;
  return { state: EMPTY_DEVICE_STATE, endedJoinProjectIds: projectId ? [projectId] : [] };
}

export async function loadDeviceState(): Promise<LoadedDeviceState> {
  try {
    const raw = await SecureStore.getItemAsync(STATE_KEY);
    if (raw) return { state: toState(JSON.parse(raw)), endedJoinProjectIds: [] };

    const v3 = await SecureStore.getItemAsync(LEGACY_STATE_KEY_V3);
    const v2 = v3 ? null : await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    if (v3 || v2) {
      const migrated = v3 ? migrateV3(JSON.parse(v3)) : migrateV2(JSON.parse(v2!));
      await saveDeviceState(migrated.state);
      await SecureStore.deleteItemAsync(LEGACY_STATE_KEY_V3).catch(() => undefined);
      await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY).catch(() => undefined);
      return migrated;
    }
  } catch (error) {
    console.warn('Failed to load device state from SecureStore:', error);
  }
  return { state: EMPTY_DEVICE_STATE, endedJoinProjectIds: [] };
}

/** Writes the whole state. Callers build the next state from the previous one. */
export async function saveDeviceState(state: DeviceState): Promise<void> {
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
}

/** Removes everything except the hardware device id (sign-out, reset). */
export async function wipeDeviceState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STATE_KEY);
    await SecureStore.deleteItemAsync(LEGACY_STATE_KEY_V3);
    await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
  } catch (error) {
    console.warn('Failed to clear device state from SecureStore:', error);
  }
}
