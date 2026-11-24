import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fieldContextFromProvisionedProject,
  type FieldProjectContext,
  type MobileChangePasswordResponse,
  type MobileLoginResponse,
  type MobileTenantBranding,
  resolveTerminology,
  type ResolvedTerminology,
} from '@insite/shared';
import { defaultColors } from '../styles/commonStyles';
import {
  EMPTY_DEVICE_STATE,
  loadDeviceState,
  saveDeviceState,
  wipeDeviceState,
  type DeviceState,
  type StoredAccount,
} from '../storage/secureProfileStore';
import { setAuthRegistry } from '../config/authRegistry';
import { clearSessionEnded } from '../config/sessionState';
import { fetchAccountProjects, fetchBaselinePack, fetchProjectSession, signOutAccount } from '../api/auth/authApi';
import { deleteBaselinePacks, hydrateBaselinePack } from '../storage/baselineStore';
import { holdItemsFromEndedSessions } from '../storage/heldItems';
import { getInitials } from '../utils/userUtils';
import type { PushIdentity } from '../services/pushNotificationService';

/**
 * The device's account and projects (Phase 5; provisioned accounts only since R1d). The one way in
 * is a provisioned account; `activeProjectId` picks which of its projects the app shows. Server
 * profiles are mapped through the shared `fieldContextFromProvisionedProject`, never by hand.
 */
interface ProfileContextValue {
  state: DeviceState;
  loading: boolean;
  account: StoredAccount | null;
  /** The signed-in account's projects. */
  projects: FieldProjectContext[];
  activeContext: FieldProjectContext | null;
  /** '' when no project is open. */
  activeProjectId: string;
  projectCode: string;
  /** The server session id on the active project, once known (null before first sync). */
  activeSessionId: string | null;
  displayName: string;
  phoneNumber: string;
  userInitials: string;
  /** Branding of the signed-in account's tenant, or the neutral InSite default (Phase 6). */
  branding: ActiveBranding;
  /** The identities on the device that should receive pushes (the signed-in account). */
  pushIdentities: PushIdentity[];
  signIn: (result: MobileLoginResponse) => Promise<void>;
  completePasswordChange: (result: MobileChangePasswordResponse) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  /** Re-lists the account's projects from the server (pull to refresh). */
  refreshProjects: () => Promise<void>;
  signOut: () => Promise<void>;
  resetAll: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/** The branding the app applies. `isTenant` is false for the neutral InSite default. */
export interface ActiveBranding {
  isTenant: boolean;
  tenantName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  /** ISO 4217 code for money display. */
  currency: string;
  /** Phase 11: tenant wording for domain terms (defaults when the payload has none). */
  terminology: ResolvedTerminology;
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Neutral InSite default: used before sign-in and wherever the tenant is not known. */
export const NEUTRAL_BRANDING: ActiveBranding = {
  isTenant: false,
  tenantName: null,
  logoUrl: null,
  primaryColor: defaultColors.primary,
  currency: 'NGN',
  terminology: resolveTerminology({}),
};

function toActiveBranding(b: MobileTenantBranding | null | undefined): ActiveBranding {
  if (!b) return NEUTRAL_BRANDING;
  return {
    isTenant: true,
    tenantName: b.tenantName,
    logoUrl: b.logoUrl || null,
    primaryColor: HEX_COLOR.test(b.primaryColorHex) ? b.primaryColorHex : NEUTRAL_BRANDING.primaryColor,
    currency: b.currency || NEUTRAL_BRANDING.currency,
    terminology: b.terminology ?? NEUTRAL_BRANDING.terminology,
  };
}

function pickActive(state: DeviceState, preferred: string | null): string | null {
  const ids = state.projects.map((p) => p.projectId);
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0] ?? null;
}

export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DeviceState>(EMPTY_DEVICE_STATE);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef(state);

  /** Persists the whole next state, then publishes it to React and the token registry. */
  const commit = useCallback(async (next: DeviceState) => {
    stateRef.current = next;
    setAuthRegistry({
      accountToken: next.account?.token ?? null,
      projectSessions: next.projects.map((p) => ({ projectId: p.projectId, sessionId: p.sessionId })),
      activeProjectId: next.activeProjectId,
    });
    setState(next);
    await saveDeviceState(next);
  }, []);

  const update = useCallback(
    async (fn: (prev: DeviceState) => DeviceState) => commit(fn(stateRef.current)),
    [commit]
  );

  /** Patches one project's context. */
  const patchProject = useCallback(
    (prev: DeviceState, projectId: string, patch: Partial<FieldProjectContext>): DeviceState => ({
      ...prev,
      projects: prev.projects.map((p) => (p.projectId === projectId ? { ...p, ...patch } : p)),
    }),
    []
  );

  /** Makes sure the project's baseline is on the device and, when online, current. */
  const prepareProject = useCallback(
    async (projectId: string) => {
      await hydrateBaselinePack(projectId).catch(() => null);
      try {
        await fetchBaselinePack(projectId);
        // Creates the provisioned session on first use and tells us its id and role.
        const session = await fetchProjectSession(projectId);
        await update((prev) =>
          patchProject(prev, projectId, {
            sessionId: session.sessionId,
            roleName: session.roleName,
            roleCode: session.roleCode,
            assuranceWeight: session.assuranceWeight,
            permissions: session.permissions,
          })
        );
      } catch {
        // Offline, or the session ended (the overlay handles that). The stored pack still works.
      }
    },
    [update, patchProject]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { state: saved, endedJoinProjectIds } = await loadDeviceState();
        const next = { ...saved, activeProjectId: pickActive(saved, saved.activeProjectId) };
        if (!mounted) return;
        await commit(next);
        // Work queued under a pre-R1d join-code session is never sent under the account as it is:
        // it is held for the person to remove or update (Phase 5 Step 8).
        for (const projectId of endedJoinProjectIds) {
          await holdItemsFromEndedSessions(projectId, 'account').catch(() => 0);
        }
        // Geofence checks must work after a restart, offline included.
        await Promise.all(next.projects.map((p) => hydrateBaselinePack(p.projectId).catch(() => null)));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [commit]);

  const signIn = useCallback(
    async (result: MobileLoginResponse) => {
      const projects = result.projects.map((p) => fieldContextFromProvisionedProject(p, result.account.mobileRole));
      await update((prev) => {
        const next: DeviceState = {
          ...prev,
          account: { token: result.accessToken, profile: result.account },
          projects,
        };
        return { ...next, activeProjectId: pickActive(next, prev.activeProjectId) };
      });
      clearSessionEnded();
      if (!result.account.mustChangePassword) {
        const active = stateRef.current.activeProjectId;
        if (active) void prepareProject(active);
      }
    },
    [update, prepareProject]
  );

  const completePasswordChange = useCallback(
    async (result: MobileChangePasswordResponse) => {
      await update((prev) => ({ ...prev, account: { token: result.accessToken, profile: result.account } }));
      clearSessionEnded('account');
      const active = stateRef.current.activeProjectId;
      if (active) void prepareProject(active);
    },
    [update, prepareProject]
  );

  const switchProject = useCallback(
    async (projectId: string) => {
      // Switching never touches the outbox: queued items keep their own project.
      await update((prev) => ({ ...prev, activeProjectId: projectId }));
      await prepareProject(projectId);
    },
    [update, prepareProject]
  );

  const refreshProjects = useCallback(async () => {
    const account = stateRef.current.account;
    if (!account) return;
    const list = await fetchAccountProjects(account.token);
    await update((prev) => {
      const byId = new Map(prev.projects.map((p) => [p.projectId, p]));
      const projects = list.map((p) => {
        const fresh = fieldContextFromProvisionedProject(p, account.profile.mobileRole);
        const known = byId.get(p.id);
        // Keep the session id learned from the server's session for this device.
        return known ? { ...fresh, sessionId: known.sessionId } : fresh;
      });
      const next = { ...prev, projects };
      return { ...next, activeProjectId: pickActive(next, prev.activeProjectId) };
    });
  }, [update]);

  const signOut = useCallback(async () => {
    const account = stateRef.current.account;
    if (account) void signOutAccount(account.token).catch(() => undefined);
    const projectIds = stateRef.current.projects.map((p) => p.projectId);
    await update((prev) => ({ ...prev, account: null, projects: [], activeProjectId: null }));
    clearSessionEnded();
    await deleteBaselinePacks(projectIds).catch(() => undefined);
  }, [update]);

  const resetAll = useCallback(async () => {
    const account = stateRef.current.account;
    if (account) void signOutAccount(account.token).catch(() => undefined);
    await wipeDeviceState();
    await deleteBaselinePacks().catch(() => undefined);
    clearSessionEnded();
    await commit(EMPTY_DEVICE_STATE);
  }, [commit]);

  const value = useMemo<ProfileContextValue>(() => {
    const projects = state.projects;
    const activeContext = projects.find((p) => p.projectId === state.activeProjectId) ?? null;
    const displayName = state.account?.profile.fullName ?? '';
    return {
      state,
      loading,
      account: state.account,
      projects,
      activeContext,
      activeProjectId: activeContext?.projectId ?? '',
      projectCode: activeContext?.projectCodePrefix ?? '',
      activeSessionId: activeContext?.sessionId ?? null,
      displayName,
      phoneNumber: state.account?.profile.phoneNumber ?? '',
      userInitials: getInitials(displayName, 'CO'),
      branding: state.account?.profile.tenantBranding
        ? toActiveBranding(state.account.profile.tenantBranding)
        : NEUTRAL_BRANDING,
      pushIdentities:
        state.account && !state.account.profile.mustChangePassword
          ? [{ token: state.account.token, scope: 'account' as const }]
          : [],
      signIn,
      completePasswordChange,
      switchProject,
      refreshProjects,
      signOut,
      resetAll,
    };
  }, [state, loading, signIn, completePasswordChange, switchProject, refreshProjects, signOut, resetAll]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return ctx;
}

/**
 * Active branding for headers, logos and primary buttons. Safe outside the provider (returns the
 * neutral default), so shared components can use it anywhere.
 */
export function useActiveBranding(): ActiveBranding {
  return useContext(ProfileContext)?.branding ?? NEUTRAL_BRANDING;
}
