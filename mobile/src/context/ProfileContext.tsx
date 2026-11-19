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
  fieldContextFromJoinSession,
  fieldContextFromProvisionedProject,
  type FieldProjectContext,
  type MobileChangePasswordResponse,
  type MobileLoginResponse,
  type MobileTenantBranding,
} from '@insite/shared';
import { defaultColors } from '../styles/commonStyles';
import {
  EMPTY_DEVICE_STATE,
  loadDeviceState,
  saveDeviceState,
  wipeDeviceState,
  type DeviceState,
  type LocalPersona,
  type StoredAccount,
} from '../storage/secureProfileStore';
import { setAuthRegistry } from '../config/authRegistry';
import { clearSessionEnded } from '../config/sessionState';
import {
  fetchAccountProjects,
  fetchBaselinePack,
  fetchJoinSessionStatus,
  fetchProjectSession,
  signOutAccount,
  type JoinProjectMobileResponse,
} from '../api/auth/authApi';
import { deleteBaselinePacks, hydrateBaselinePack, persistBaselinePack, getLoadedBaselinePack } from '../storage/baselineStore';
import { ensureDeviceKeyRegistered } from '../security/deviceKeyRegistration';
import { holdItemsFromEndedSessions } from '../storage/heldItems';
import { getInitials } from '../utils/userUtils';
import type { PushIdentity } from '../services/pushNotificationService';

/**
 * The device's identities and projects (Phase 5). One provisioned account and any number of
 * join-code sessions can live side by side; `activeProjectId` picks what the app shows. Every
 * server profile is mapped through the shared `fieldContextFrom*` functions, never by hand.
 */
interface ProfileContextValue {
  state: DeviceState;
  loading: boolean;
  account: StoredAccount | null;
  persona: LocalPersona | null;
  /** Every project on the device: provisioned projects first, then join-code projects. */
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
  isVerified: boolean;
  /** Signed in, or has typed a name for joining with codes. */
  hasIdentity: boolean;
  /** Branding of the tenant behind the active project, or the neutral InSite default (Phase 6). */
  branding: ActiveBranding;
  /** Every identity on the device that should receive pushes: the account and each join session. */
  pushIdentities: PushIdentity[];
  signIn: (result: MobileLoginResponse) => Promise<void>;
  completePasswordChange: (result: MobileChangePasswordResponse) => Promise<void>;
  addJoinSession: (result: JoinProjectMobileResponse) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  /** Re-lists provisioned projects from the server (pull to refresh). */
  refreshProjects: () => Promise<void>;
  /**
   * Reads assurance status for the active join session from the server (`/auth/me`), the only
   * source of truth for it. Called at startup, on foreground, on pull-to-refresh and on push.
   */
  refreshAssuranceStatus: () => Promise<void>;
  updateActiveContext: (patch: Partial<FieldProjectContext>) => Promise<void>;
  savePersona: (persona: LocalPersona) => Promise<void>;
  /** Removes a join-code project from this device (its queued items stay in the outbox). */
  leaveJoinProject: (projectId: string) => Promise<void>;
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
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Neutral InSite default: used before sign-in and wherever the tenant is not known. */
export const NEUTRAL_BRANDING: ActiveBranding = {
  isTenant: false,
  tenantName: null,
  logoUrl: null,
  primaryColor: defaultColors.primary,
  currency: 'NGN',
};

function toActiveBranding(b: MobileTenantBranding | null | undefined): ActiveBranding {
  if (!b) return NEUTRAL_BRANDING;
  return {
    isTenant: true,
    tenantName: b.tenantName,
    logoUrl: b.logoUrl || null,
    primaryColor: HEX_COLOR.test(b.primaryColorHex) ? b.primaryColorHex : NEUTRAL_BRANDING.primaryColor,
    currency: b.currency || NEUTRAL_BRANDING.currency,
  };
}

/**
 * The tenant is known from the active join session's profile or from the signed-in account. A join
 * session wins on its own project; otherwise the account's tenant; otherwise neutral.
 */
function resolveBranding(state: DeviceState, activeProjectId: string | null): ActiveBranding {
  const join = state.joinSessions.find((j) => j.context.projectId === activeProjectId);
  if (join?.tenantBranding) return toActiveBranding(join.tenantBranding);
  if (state.account?.profile.tenantBranding) return toActiveBranding(state.account.profile.tenantBranding);
  return NEUTRAL_BRANDING;
}

function allProjects(state: DeviceState): FieldProjectContext[] {
  const joinIds = new Set(state.joinSessions.map((j) => j.context.projectId));
  // A project can be both assigned to the account and joined with a code; the join session wins
  // on that project because its token is what was used for the queued work.
  return [...state.projects.filter((p) => !joinIds.has(p.projectId)), ...state.joinSessions.map((j) => j.context)];
}

function pickActive(state: DeviceState, preferred: string | null): string | null {
  const ids = allProjects(state).map((p) => p.projectId);
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
      joinTokens: next.joinSessions.map((j) => ({
        projectId: j.context.projectId,
        token: j.token,
        sessionId: j.context.sessionId,
      })),
      activeProjectId: next.activeProjectId,
    });
    setState(next);
    await saveDeviceState(next);
  }, []);

  const update = useCallback(
    async (fn: (prev: DeviceState) => DeviceState) => commit(fn(stateRef.current)),
    [commit]
  );

  /** Patches one project's context wherever it lives (account list or join session). */
  const patchProject = useCallback(
    (prev: DeviceState, projectId: string, patch: Partial<FieldProjectContext>): DeviceState => ({
      ...prev,
      projects: prev.projects.map((p) => (p.projectId === projectId ? { ...p, ...patch } : p)),
      joinSessions: prev.joinSessions.map((j) =>
        j.context.projectId === projectId ? { ...j, context: { ...j.context, ...patch } } : j
      ),
    }),
    []
  );

  /** Makes sure the project's baseline is on the device and, when online, current. */
  const prepareProject = useCallback(
    async (projectId: string) => {
      await hydrateBaselinePack(projectId).catch(() => null);
      const isProvisioned = !stateRef.current.joinSessions.some((j) => j.context.projectId === projectId);
      try {
        if (!getLoadedBaselinePack(projectId) || isProvisioned) await fetchBaselinePack(projectId);
        if (isProvisioned) {
          // Creates the provisioned session on first use and tells us its id and role.
          const session = await fetchProjectSession(projectId);
          await update((prev) =>
            patchProject(prev, projectId, {
              sessionId: session.sessionId,
              roleName: session.roleName,
              roleCode: session.roleCode,
              assuranceWeight: session.assuranceWeight,
              permissions: session.permissions,
              // Phase 6: the contractor package the session works for (null when project-wide).
              ...(session.contractor !== undefined ? { contractor: session.contractor } : {}),
            })
          );
        }
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
        const saved = await loadDeviceState();
        const next = { ...saved, activeProjectId: pickActive(saved, saved.activeProjectId) };
        if (!mounted) return;
        await commit(next);
        // Geofence checks must work after a restart, offline included.
        await Promise.all(allProjects(next).map((p) => hydrateBaselinePack(p.projectId).catch(() => null)));
        for (const j of next.joinSessions) {
          void ensureDeviceKeyRegistered({ sessionId: j.context.sessionId, projectId: j.context.projectId, token: j.token });
        }
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
      clearSessionEnded('account');
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

  const addJoinSession = useCallback(
    async (result: JoinProjectMobileResponse) => {
      const context = fieldContextFromJoinSession(result.sessionProfile);
      await update((prev) => ({
        ...prev,
        joinSessions: [
          ...prev.joinSessions.filter((j) => j.context.projectId !== context.projectId),
          { token: result.accessToken, context, tenantBranding: result.sessionProfile.tenantBranding ?? null },
        ],
        activeProjectId: context.projectId,
      }));
      clearSessionEnded(`project:${context.projectId}`);
      if (result.baselinePack) await persistBaselinePack(result.baselinePack).catch(() => undefined);
      // Phase 5 Step 8: anything still queued under an earlier session on this project is held
      // for the person to remove or update; it is never sent under the new session as it is.
      if (context.sessionId) {
        await holdItemsFromEndedSessions(context.projectId, `join:${context.sessionId}`).catch(() => 0);
      }
    },
    [update]
  );

  const switchProject = useCallback(
    async (projectId: string) => {
      // Switching never touches the outbox: queued items keep their own project and token.
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
        // Keep the session id and contractor learned from the server's session for this device.
        return known ? { ...fresh, sessionId: known.sessionId, contractor: known.contractor ?? null } : fresh;
      });
      const next = { ...prev, projects };
      return { ...next, activeProjectId: pickActive(next, prev.activeProjectId) };
    });
  }, [update]);

  const refreshAssuranceStatus = useCallback(async () => {
    const current = stateRef.current;
    const active = current.joinSessions.find((j) => j.context.projectId === current.activeProjectId);
    if (!active) return; // Provisioned projects have no assurance step.
    try {
      const status = await fetchJoinSessionStatus(active.token, active.context.projectId);
      await update((prev) =>
        patchProject(prev, active.context.projectId, {
          assuranceStatus: status.assuranceStatus,
          rejectionReason: status.assuranceStatus === 'REJECTED' ? status.rejectionReason ?? null : null,
          requiresIdentityAssurance: status.requiresIdentityAssurance,
          roleName: status.roleName ?? active.context.roleName,
          assuranceWeight: status.assuranceWeight ?? active.context.assuranceWeight,
          ...(status.project?.name ? { projectName: status.project.name } : {}),
          ...(status.project?.codePrefix ? { projectCodePrefix: status.project.codePrefix } : {}),
        })
      );
      // Packs saved before projects had a time zone get it from the server.
      const pack = getLoadedBaselinePack(active.context.projectId);
      if (pack && status.project?.timezone && pack.timezone !== status.project.timezone) {
        await persistBaselinePack({ ...pack, timezone: status.project.timezone }).catch(() => undefined);
      }
    } catch {
      // Offline or session ended (the session-ended overlay handles the latter).
    }
  }, [update, patchProject]);

  const updateActiveContext = useCallback(
    async (patch: Partial<FieldProjectContext>) => {
      const id = stateRef.current.activeProjectId;
      if (!id) return;
      await update((prev) => patchProject(prev, id, patch));
    },
    [update, patchProject]
  );

  const savePersona = useCallback(
    async (persona: LocalPersona) => update((prev) => ({ ...prev, persona })),
    [update]
  );

  const leaveJoinProject = useCallback(
    async (projectId: string) => {
      await update((prev) => {
        const next = { ...prev, joinSessions: prev.joinSessions.filter((j) => j.context.projectId !== projectId) };
        return { ...next, activeProjectId: pickActive(next, prev.activeProjectId === projectId ? null : prev.activeProjectId) };
      });
      clearSessionEnded(`project:${projectId}`);
    },
    [update]
  );

  const signOut = useCallback(async () => {
    const account = stateRef.current.account;
    if (account) void signOutAccount(account.token).catch(() => undefined);
    const provisionedIds = stateRef.current.projects.map((p) => p.projectId);
    await update((prev) => {
      const next = { ...prev, account: null, projects: [] };
      return { ...next, activeProjectId: pickActive(next, prev.activeProjectId) };
    });
    clearSessionEnded('account');
    const stillJoined = new Set(stateRef.current.joinSessions.map((j) => j.context.projectId));
    await deleteBaselinePacks(provisionedIds.filter((id) => !stillJoined.has(id))).catch(() => undefined);
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
    const projects = allProjects(state);
    const activeContext = projects.find((p) => p.projectId === state.activeProjectId) ?? null;
    const displayName = state.account?.profile.fullName ?? state.persona?.fullName ?? '';
    return {
      state,
      loading,
      account: state.account,
      persona: state.persona,
      projects,
      activeContext,
      activeProjectId: activeContext?.projectId ?? '',
      projectCode: activeContext?.projectCodePrefix ?? '',
      activeSessionId: activeContext?.sessionId ?? null,
      displayName,
      phoneNumber: state.account?.profile.phoneNumber ?? state.persona?.phoneNumber ?? '',
      userInitials: getInitials(displayName, 'CO'),
      isVerified: activeContext?.assuranceStatus === 'APPROVED',
      branding: resolveBranding(state, activeContext?.projectId ?? null),
      hasIdentity: Boolean(state.account || state.persona),
      pushIdentities: [
        ...(state.account && !state.account.profile.mustChangePassword
          ? [{ token: state.account.token, scope: 'account' as const }]
          : []),
        ...state.joinSessions.map((j) => ({
          token: j.token,
          scope: `project:${j.context.projectId}` as const,
        })),
      ],
      signIn,
      completePasswordChange,
      addJoinSession,
      switchProject,
      refreshProjects,
      refreshAssuranceStatus,
      updateActiveContext,
      savePersona,
      leaveJoinProject,
      signOut,
      resetAll,
    };
  }, [
    state,
    loading,
    signIn,
    completePasswordChange,
    addJoinSession,
    switchProject,
    refreshProjects,
    refreshAssuranceStatus,
    updateActiveContext,
    savePersona,
    leaveJoinProject,
    signOut,
    resetAll,
  ]);

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
