"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AuthChangeEvent } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff" | "homeowner";

export interface Property {
  id: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  coeDate?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isSuperAdmin?: boolean;
  avatar?: string;
  companyId?: string;
  companyName?: string;
  companyLogo?: string;
  properties?: Property[];
  online: boolean;
  lastSeen?: Date;
  hasWarrantyAccess: boolean;
  hasSalesAccess: boolean;
  lastActiveWorkspace?: string;
  // Tenant onboarding gate: PENDING | SUBMITTED | VERIFIED
  verificationStatus?: string;
  verificationDocUrl?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
    redirectPath?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  updateAvatar: (avatarUrl: string) => void;
  setOnlineStatus: (status: boolean) => void;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
        const isApiCall = url.includes("/api/") && !url.includes("/api/auth/me");
        if (response.status === 401 && isApiCall && userRef.current) {
          setSessionExpired(true);
        }
      } catch {
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (!sessionExpired) return;
    supabaseRef.current.auth.signOut().catch(() => {});
    setUser(null);
  }, [sessionExpired]);

  const handleSessionExpiredRedirect = () => {
    setSessionExpired(false);
    router.push("/login");
  };

  useEffect(() => {
    const supabase = supabaseRef.current;
    let mounted = true;
    let initialFetchDone = false;

    async function fetchUser() {
      if (!mounted) return;
      setIsLoading(true);
      try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
          const userData = await response.json();
          if (mounted) setUser(userData);
        } else {
          if (mounted) setUser(null);
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (event === "INITIAL_SESSION") initialFetchDone = true;
        fetchUser();
      } else if (event === "SIGNED_OUT") {
        checkSuperadminOrLogout();
      }
    });

    async function checkSuperadminOrLogout() {
      try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
          const userData = await response.json();
          if (userData.isSuperAdmin) {
            if (mounted) {
              setUser(userData);
              setIsLoading(false);
            }
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
      if (mounted) {
        setUser(null);
        setIsLoading(false);
      }
      router.push("/login");
    }

    setTimeout(() => {
      if (!initialFetchDone && mounted) {
        fetchUser();
      }
    }, 100);

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]); 

  const login = async (
    email: string,
    password: string,
    redirectPath?: string,
  ) => {
    setIsLoading(true);
    try {
      let response: Response;
      try {
        response = await fetch("/api/auth/superadmin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new Error(
          "We couldn't reach the server. Please make sure the backend is running and try again.",
        );
      }

      if (response.ok) {
        const body = await response.json();
        if (body.isSuperAdmin) {
          const meResponse = await fetch("/api/auth/me");
          if (meResponse.ok) {
            const userData = await meResponse.json();
            setUser(userData);
          }
          setIsLoading(false);
          router.push("/admin");
          return;
        }
      } else if (response.status !== 401) {
        throw new Error(
          "The server is temporarily unavailable. Please try again in a few moments.",
        );
      }

      // 401 (not a super admin) → normal user: authenticate with Supabase.
      const { error } = await supabaseRef.current.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      router.push(redirectPath || "/");
    } catch (err) {
      setIsLoading(false);
      throw err;
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      if (user?.isSuperAdmin) {
        await fetch("/api/auth/logout", { method: "POST" });
      } else {
        await supabaseRef.current.auth.signOut();
      }
    } catch (err) {
      console.error("Logout API failed", err);
    }
    setUser(null);
    router.push("/login");
    setTimeout(() => setLoggingOut(false), 600);
  };

  const updateProfile = async (data: Partial<User>) => {
    if (user) {
      const originalUser = user;
      const updated = { ...user, ...data };
      setUser(updated);

      try {
        const response = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            errData.message || "Failed to update profile on server",
          );
        }

        const serverData = await response.json();
        const finalUser = { ...updated, ...serverData };
        setUser(finalUser);

        if (data.email) {
          await supabaseRef.current.auth.refreshSession();
        }
      } catch (err) {
        console.error("Profile update API failed", err);
        setUser(originalUser);
        throw err;
      }
    }
  };

  const updateAvatar = async (avatarUrl: string) => {
    if (!user) return;
    setUser({ ...user, avatar: avatarUrl });
    if (user.role !== "admin") {
      try {
        await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar: avatarUrl }),
        });
      } catch (err) {
        console.error("Avatar update failed", err);
      }
    }
  };

  const refreshUser = async (): Promise<User | null> => {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return userData;
      }
    } catch (err) {
      console.error("Failed to refresh user", err);
    }
    return null;
  };

  const setOnlineStatus = (status: boolean) => {
    if (user) {
      setUser({
        ...user,
        online: status,
        lastSeen: status ? user.lastSeen : new Date(),
      });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        updateProfile,
        updateAvatar,
        setOnlineStatus,
        refreshUser,
      }}
    >
      {children}
      {loggingOut && (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-slate-950/40 backdrop-blur-md">
          <div className="mx-4 flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white px-8 py-7 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Logging out…</p>
          </div>
        </div>
      )}
      {sessionExpired && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/40 backdrop-blur-md">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Session expired</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You&apos;ve been logged out for your security. Please sign in again to continue.
            </p>
            <button
              onClick={handleSessionExpiredRedirect}
              className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Log in again
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
