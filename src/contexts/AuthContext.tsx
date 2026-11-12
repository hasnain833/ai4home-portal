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

export type UserRole = "admin" | "staff" | "homeowner" | "trade" | "super_staff";

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
  phone?: string | null;
  role: UserRole;
  isSuperAdmin?: boolean;
  isSuperStaff?: boolean;
  adminPermissions?: string[];
  avatar?: string;
  companyId?: string;
  companyName?: string;
  companyLogo?: string;
  properties?: Property[];
  online: boolean;
  lastSeen?: Date;
  hasWarrantyAccess: boolean;
  hasSalesAccess: boolean;
  salesPermissions?: string[];
  lastActiveWorkspace?: string;
  pendingEmail?: string | null;
  emailChangeExpiresAt?: string | null;
  verificationStatus?: string;
  verificationDocUrl?: string | null;
  agreementDocUrl?: string | null;
  agreementVersion?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
    redirectPath?: string,
  ) => Promise<{ mfaChallenge?: string } | void>;
  verifySuperadminCode: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  updateAvatar: (avatarUrl: string) => void;
  setOnlineStatus: (status: boolean) => void;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Who is signed in, or null when nobody is. A 401 here is the normal logged-out answer, so this
 * stays a raw fetch rather than apiFetch, which would log it as an error. A dropped connection still throws.
 */
async function fetchMe(): Promise<User | null> {
  const response = await fetch("/api/auth/me");
  return response.ok ? response.json() : null;
}

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
    let recovery: Promise<boolean> | null = null;

    const recoverSession = () => {
      if (recovery) return recovery;
      recovery = (async () => {
        try {
          let check = await originalFetch("/api/auth/me");
          if (check.ok) return true;
          if (check.status !== 401) return false;
          // Supabase can refresh an ordinary session; the separate Super Admin
          // cookie is renewed by the API and must not adopt another user's JWT.
          if (!userRef.current?.isSuperAdmin) {
            const { data, error } = await supabaseRef.current.auth.refreshSession();
            if (!error && data.session) {
              check = await originalFetch("/api/auth/me");
              if (check.ok) return true;
              if (check.status !== 401) return false;
            }
          }
          setSessionExpired(true);
        } catch {
          // A network failure is not evidence that the user signed out.
        }
        return false;
      })().finally(() => { recovery = null; });
      return recovery;
    };

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const retryArgs: Parameters<typeof fetch> = [
        args[0] instanceof Request ? args[0].clone() : args[0], args[1],
      ];
      const response = await originalFetch(...args);
      try {
        const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), window.location.href);
        const isApiCall = url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");
        if (response.status === 401 && isApiCall && userRef.current) {
          if (await recoverSession()) return originalFetch(...retryArgs);
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
    void supabaseRef.current.auth.signOut().finally(() => setUser(null));
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
        const userData = await fetchMe();
        if (mounted) setUser(userData);
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (event === "INITIAL_SESSION") initialFetchDone = true;
        fetchUser();
      } else if (event === "SIGNED_OUT") {
        checkSuperadminOrLogout();
      }
    });

    async function checkSuperadminOrLogout() {
      try {
        const userData = await fetchMe();
        if (userData?.isSuperAdmin) {
          if (mounted) {
            setUser(userData);
            setIsLoading(false);
          }
          return;
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

  const enterSuperadminPortal = async () => {
    const userData = await fetchMe();
    if (userData) setUser(userData);
    setIsLoading(false);
    router.push("/admin");
  };

  const verifySuperadminCode = async (challenge: string, code: string) => {
    const response = await fetch("/api/auth/superadmin-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, code }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "That code is incorrect or has expired.");
    }
    await enterSuperadminPortal();
  };

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
        if (body.mfaRequired) {
          setIsLoading(false);
          return { mfaChallenge: body.challenge };
        }
        if (body.isSuperAdmin) {
          await enterSuperadminPortal();
          return;
        }
      } else if (response.status === 502) {
        // Only the Super Admin gets here, with the right password: Supabase can't help.
        const body = await response.json().catch(() => ({}));
        if (body?.code === "MFA_SEND_FAILED") throw new Error(body.message);
      } else if (response.status !== 401) {
        // This endpoint is only a superadmin probe. A database/configuration
        // failure here must not prevent ordinary users from using Supabase auth.
        console.warn(
          `[auth] Superadmin check returned ${response.status}; continuing with normal sign-in.`,
        );
      }

      // 401 (not a super admin) → normal user: authenticate with Supabase.
      const { error } = await supabaseRef.current.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (response.status === 429) {
          throw new Error("Too many sign-in attempts. Please wait 15 minutes and try again.");
        }
        throw error;
      }

      // Valid password but a suspended company: sign straight back out and say why.
      const me = await fetch("/api/auth/me");
      if (me.status === 403) {
        const body = await me.json().catch(() => ({}));
        if (body?.code === "COMPANY_SUSPENDED") {
          await supabaseRef.current.auth.signOut();
          throw new Error(body.message);
        }
      }

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
      const userData = await fetchMe();
      if (userData) {
        setUser(userData);
        return userData;
      }
    } catch (err) {
      console.error("Failed to refresh user", err);
    }
    return null;
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && userRef.current) {
        void refreshUser();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
        verifySuperadminCode,
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
