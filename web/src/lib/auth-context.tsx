import React, { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import type { WebUserProfile } from "@insite/shared";
import {
  getStoredToken,
  registerUnauthorizedHandler,
  updateToken,
} from "../config/apiConfig";
import { getCurrentUser } from "../api/auth/authApi";
import { useLoginMutation } from "../mutations/auth/useAuthMutations";

interface AuthContextValue {
  user: WebUserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  quickSwitchDemoAccount: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const SEEDED_DEMO_ACCOUNTS = [
  {
    role: "MONITOR" as const,
    roleTitle: "Independent Monitor (Certifier)",
    name: "QS Tunde Adebayo",
    organization: "KPMG Advisory",
    email: "monitor@insite.ng",
    password: "Password123!",
    credential: "QSRBN #3842",
    initials: "TA",
  },
  {
    role: "LENDER" as const,
    roleTitle: "Lender / Guarantor (Approver)",
    name: "Chidinma Okafor, CFA",
    organization: "InfraCredit",
    email: "lender@insite.ng",
    password: "Password123!",
    credential: "ICAN #MB/049120",
    initials: "CO",
  },
  {
    role: "CONTRACTOR" as const,
    roleTitle: "Main Contractor (Claimant)",
    name: "Engr. Musa Danladi",
    organization: "J&S Civil Eng.",
    email: "contractor@insite.ng",
    password: "Password123!",
    credential: "COREN #R.49201",
    initials: "MD",
  },
];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<WebUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const loginMutation = useLoginMutation();

  const logout = () => {
    updateToken(null);
    setUser(null);
    toast.info("Signed out of InSite Assurance.");
  };

  useEffect(() => {
    registerUnauthorizedHandler(logout);

    const token = getStoredToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    getCurrentUser()
      .then((res) => {
        if (res.user) {
          setUser(res.user);
        } else {
          updateToken(null);
        }
      })
      .catch(() => {
        updateToken(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = async (email: string, password: string) => {
    const res = await loginMutation.mutateAsync({ email, password });
    updateToken(res.accessToken);
    setUser(res.user);
    toast.success(`Signed in as ${res.user.fullName} (${res.user.role})`);
  };

  const quickSwitchDemoAccount = async (email: string) => {
    await login(email, "Password123!");
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, quickSwitchDemoAccount, logout }}
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
