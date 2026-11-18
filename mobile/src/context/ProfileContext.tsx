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
import { setFieldAgentAuth } from '../config/apiConfig';
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
    };
  }, [profile, loading, refreshProfile, updateProfile, clearSession, resetAllProfileState]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return ctx;
}

