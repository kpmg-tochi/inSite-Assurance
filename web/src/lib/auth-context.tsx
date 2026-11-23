import { setDisplayContext } from "./formatters";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  resolveRatingLabels,
  resolveTerm,
  resolveTerminology,
  SEGREGATED_DISBURSEMENT_PERMISSIONS,
  type ResolvedTerminology,
  type TerminologyKey,
  type ChangePasswordRequest,
  type ResolvedRatingLabels,
  type TenantBrandingConfig,
  type WebUserProfile,
} from "@insite/shared";
import {
  getStoredToken,
  registerUnauthorizedHandler,
  updateToken,
} from "../config/apiConfig";
import { changePassword as changePasswordRequest, getCurrentUser } from "../api/auth/authApi";
import { useLoginMutation } from "../mutations/auth/useAuthMutations";
import { loadDemoAccounts } from "../config/useDemoAccounts";
import { APPLICATION_NAME } from "../config/appName";

const DEFAULT_BRANDING: TenantBrandingConfig = {
  primaryColorHex: "#00338D",
  navyColorHex: "#0C233C",
  tagline: "Capital Projects Assurance Platform",
};

function hexToRgbChannels(hex: string): string | null {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function darkenHex(hex: string, factor = 0.78): string {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return "#00266B";
  const r = Math.max(0, Math.round(parseInt(clean.slice(0, 2), 16) * factor));
  const g = Math.max(0, Math.round(parseInt(clean.slice(2, 4), 16) * factor));
  const b = Math.max(0, Math.round(parseInt(clean.slice(4, 6), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function applyTenantBranding(branding?: Partial<TenantBrandingConfig> | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const primaryHex = branding?.primaryColorHex || DEFAULT_BRANDING.primaryColorHex;
  const navyHex = branding?.navyColorHex || DEFAULT_BRANDING.navyColorHex;
  const hoverHex = darkenHex(primaryHex);

  const primaryChannels = hexToRgbChannels(primaryHex);
  const hoverChannels = hexToRgbChannels(hoverHex);
  const navyChannels = hexToRgbChannels(navyHex);

  if (primaryChannels) root.style.setProperty("--color-brand-primary", primaryChannels);
  if (hoverChannels) root.style.setProperty("--color-brand-hover", hoverChannels);
  if (navyChannels) root.style.setProperty("--color-brand-navy", navyChannels);

  root.style.setProperty("--hex-brand-primary", primaryHex);
  root.style.setProperty("--hex-brand-hover", hoverHex);
  root.style.setProperty("--hex-brand-navy", navyHex);
}

interface AuthContextValue {
  user: WebUserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  quickSwitchDemoAccount: (email: string) => Promise<void>;
  changePassword: (payload: ChangePasswordRequest) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (permissionKey: string) => boolean;
  hasAnyPermission: (...permissionKeys: string[]) => boolean;
  /** Tenant display labels for evidence ratings (defaults until the profile loads). */
  ratingLabels: ResolvedRatingLabels;
  /** Phase 11: tenant wording for domain terms (defaults until the profile loads). */
  terminology: ResolvedTerminology;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<WebUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const loginMutation = useLoginMutation();
  const queryClient = useQueryClient();

  // Cached data belongs to one identity. Drop all of it whenever the identity changes so the
  // next user never sees the previous user's projects, reports or notifications.
  const resetCache = useCallback(() => {
    queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(() => {
    updateToken(null);
    setUser(null);
    resetCache();
    applyTenantBranding(DEFAULT_BRANDING);
    toast.info(`Signed out of ${APPLICATION_NAME}.`);
  }, [resetCache]);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      applyTenantBranding(DEFAULT_BRANDING);
      return;
    }
    const res = await getCurrentUser();
    if (res.user) {
      setUser(res.user);
      applyTenantBranding(res.user.tenant?.brandingConfig);
      setDisplayContext({ currency: res.user.tenant?.defaultCurrency, timeZone: res.user.tenant?.timezone });
    } else {
      updateToken(null);
      setUser(null);
      applyTenantBranding(DEFAULT_BRANDING);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(logout);

    const token = getStoredToken();
    if (!token) {
      applyTenantBranding(DEFAULT_BRANDING);
      setIsLoading(false);
      return;
    }

    refreshUser()
      .catch(() => {
        updateToken(null);
        setUser(null);
        applyTenantBranding(DEFAULT_BRANDING);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [logout, refreshUser]);

  const login = async (email: string, password: string) => {
    const res = await loginMutation.mutateAsync({ email, password });
    resetCache();
    updateToken(res.accessToken);
    setUser(res.user);
    applyTenantBranding(res.user.tenant?.brandingConfig);
    setDisplayContext({ currency: res.user.tenant?.defaultCurrency, timeZone: res.user.tenant?.timezone });
    toast.success(`Signed in as ${res.user.fullName} (${res.user.roleName})`);
  };

  const quickSwitchDemoAccount = async (email: string) => {
    const demo = await loadDemoAccounts();
    if (!demo) {
      toast.error("Demo account switching is disabled in live mode.");
      return;
    }
    await login(email, demo.password);
  };

  /** Changes the password; the server revokes other sessions and returns a fresh token. */
  const changePassword = async (payload: ChangePasswordRequest) => {
    const res = await changePasswordRequest(payload);
    updateToken(res.accessToken);
    setUser(res.user);
    toast.success("Password updated. Other sessions for this account have been signed out.");
  };

  // Mirrors the server: the platform super admin passes every check except the segregated
  // disbursement permissions (D-3.1), which must be held through a role.
  const hasPermission = useCallback(
    (permissionKey: string): boolean => {
      if (!user) return false;
      if (user.permissions.includes(permissionKey)) return true;
      return user.isPlatformSuperAdmin && !SEGREGATED_DISBURSEMENT_PERMISSIONS.includes(permissionKey);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (...permissionKeys: string[]): boolean => permissionKeys.some((key) => hasPermission(key)),
    [hasPermission]
  );

  const ratingLabels = useMemo(
    () => user?.ratingLabels ?? resolveRatingLabels({}),
    [user]
  );

  const terminology = useMemo(() => user?.terminology ?? resolveTerminology({}), [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        quickSwitchDemoAccount,
        changePassword,
        logout,
        refreshUser,
        hasPermission,
        hasAnyPermission,
        ratingLabels,
        terminology,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return ctx;
}

/**
 * Phase 11: the tenant's word for a domain term. term("funderParty") gives "Lender" or "Funding
 * authority"; { plural: true } for the plural, { lower: true } mid-sentence (acronyms kept).
 * Display only: never use the result as an API value.
 */
export function useTerm() {
  const { terminology } = useAuth();
  return useCallback(
    (key: TerminologyKey, options: { plural?: boolean; lower?: boolean } = {}) => resolveTerm(terminology, key, options),
    [terminology]
  );
}
