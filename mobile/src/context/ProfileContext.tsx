import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearActiveProjectSession,
  loadLocalProfile,
  updateLocalProfile,
  wipeAllLocalProfileData,
  type LocalUserProfile,
} from '../storage/secureProfileStore';
import { getCachedBaselinePack, saveBaselinePack, setFieldAgentAuth } from '../config/apiConfig';
import { fetchFieldSessionStatus } from '../api/auth/authApi';
import { persistBaselinePack } from '../storage/baselineStore';
import { hydrateBaselinePack } from '../storage/baselineStore';
import { ensureDeviceKeyRegistered } from '../security/deviceKeyRegistration';
import { getInitials } from '../utils/userUtils';

interface ProfileContextValue {
  profile: LocalUserProfile | null;
  loading: boolean;
  isVerified: boolean;
  projectCode: string;
  activeProjectId: string;
  userInitials: string;
  refreshProfile: () => Promise<LocalUserProfile | null>;
  updateProfile: (updates: Partial<LocalUserProfile>) => Promise<LocalUserProfile>;
  clearSession: () => Promise<void>;
  resetAllProfileState: () => Promise<void>;
  /**
   * Reads assurance status from the server (`/auth/me`), the only source of truth for it.
   * Called at startup, on app foreground, on pull-to-refresh and when a push arrives.
   */
  refreshAssuranceStatus: () => Promise<LocalUserProfile | null>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const syncAuthToken = useCallback((saved: LocalUserProfile | null) => {
    setFieldAgentAuth(saved?.activeSessionToken ?? null, null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const saved = await loadLocalProfile();
    syncAuthToken(saved);
    setProfile(saved);
    return saved;
  }, [syncAuthToken]);

  useEffect(() => {
    let mounted = true;
    async function hydrate() {
      try {
        const saved = await loadLocalProfile();
        if (mounted) {
          syncAuthToken(saved);
          setProfile(saved);
        }
        // Geofence checks must work after a restart, offline included.
        if (saved?.activeProjectId) {
          await hydrateBaselinePack(saved.activeProjectId).catch(() => null);
        }
        if (saved?.activeSessionToken) {
          void ensureDeviceKeyRegistered(saved.activeSessionId);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    hydrate();
    return () => {
      mounted = false;
    };
  }, [syncAuthToken]);

  const updateProfile = useCallback(async (updates: Partial<LocalUserProfile>) => {
    const updated = await updateLocalProfile(updates);
    syncAuthToken(updated);
    setProfile(updated);
    return updated;
  }, [syncAuthToken]);

  const clearSession = useCallback(async () => {
    await clearActiveProjectSession();
    const updated = await loadLocalProfile();
    syncAuthToken(updated);
    setProfile(updated);
  }, [syncAuthToken]);

  const refreshAssuranceStatus = useCallback(async () => {
    const saved = await loadLocalProfile();
    if (!saved?.activeSessionToken) return saved;
    try {
      const status = await fetchFieldSessionStatus();
      const updated = await updateLocalProfile({
        assuranceStatus: status.assuranceStatus,
        rejectionReason: status.assuranceStatus === 'REJECTED' ? status.rejectionReason ?? null : null,
        activeRequiresIdentityAssurance: status.requiresIdentityAssurance,
      });
      setProfile(updated);
      // Packs saved before projects had a time zone get it from the server.
      const pack = getCachedBaselinePack();
      if (pack && status.project?.timezone && pack.timezone !== status.project.timezone) {
        const next = { ...pack, timezone: status.project.timezone };
        saveBaselinePack(next);
        await persistBaselinePack(next).catch(() => undefined);
      }
      return updated;
    } catch {
      // Offline or session ended (the session-ended overlay handles the latter).
      return saved;
    }
  }, []);

  const resetAllProfileState = useCallback(async () => {
    await wipeAllLocalProfileData();
    syncAuthToken(null);
    setProfile(null);
  }, [syncAuthToken]);

  const value = useMemo<ProfileContextValue>(() => {
    const isVerified = profile?.assuranceStatus === 'APPROVED';
    const projectCode = profile?.activeProjectCode || '';
    const activeProjectId = profile?.activeProjectId || '';
    const userInitials = getInitials(profile?.fullName, 'CO');

    return {
      profile,
      loading,
      isVerified,
      projectCode,
      activeProjectId,
      userInitials,
      refreshProfile,
      updateProfile,
      clearSession,
      resetAllProfileState,
      refreshAssuranceStatus,
    };
  }, [profile, loading, refreshProfile, updateProfile, clearSession, resetAllProfileState, refreshAssuranceStatus]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return ctx;
}

