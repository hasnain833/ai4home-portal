"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ApiError } from "@/lib/api";
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
async function fetchMe(required = false): Promise<User | null> {
  const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
  if (response.ok) return response.json();
  if (!required) return null;
  const body = await response.json().catch(() => ({}));
  console.warn("[auth] Sign-in session verification failed", { status: response.status, code: body?.code });
  throw new ApiError(
    body?.message || "We couldn't establish your portal session. Please try signing in again.",
    response.status,
    body,
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [resumeError, setResumeError] = useState("");
  // Read by the SIGNED_OUT listener: while the expired-session prompt is up, the page stays put.
  const sessionExpiredRef = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const userRef = useRef<User | null>(null);
  const signingInRef = useRef(false);
  const authRequestVersionRef = useRef(0);
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

  // The page stays mounted under the prompt, so nothing typed is lost unless the user picks "Sign in here".
  useEffect(() => {
    sessionExpiredRef.current = sessionExpired;
  }, [sessionExpired]);

  /** After signing in from another tab: pick the new session up and carry on where they were. */
  const resumeSession = useCallback(async () => {
    setResumeError("");
    try {
      const userData = await fetchMe(true);
      if (userData) {
        userRef.current = userData;
        setUser(userData);
        setSessionExpired(false);
        return;
      }
    } catch {
      /* fall through */
    }
    setResumeError("You're still signed out. Finish signing in in the other tab, then try again.");
  }, []);

  // Coming back to this tab after signing in elsewhere resumes on its own.
  useEffect(() => {
    if (!sessionExpired) return;
    const onFocus = () => {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => (r.ok ? resumeSession() : undefined))
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [sessionExpired, resumeSession]);

  const handleSessionExpiredRedirect = async () => {
    const here = window.location.pathname + window.location.search;
    // Local only: signing out "globally" would also end this person's sessions on other devices.
    await supabaseRef.current.auth.signOut({ scope: "local" }).catch(() => {});
    setSessionExpired(false);
    setUser(null);
    router.push(`/login?redirect=${encodeURIComponent(here)}`);
  };

  useEffect(() => {
    const supabase = supabaseRef.current;
    let mounted = true;
    let initialFetchDone = false;

    async function fetchUser() {
      if (!mounted || signingInRef.current) return;
      const version = ++authRequestVersionRef.current;
      setIsLoading(true);
      try {
        const userData = await fetchMe();
        if (mounted && version === authRequestVersionRef.current) setUser(userData);
      } catch {
        if (mounted && version === authRequestVersionRef.current) setUser(null);
      } finally {
        if (mounted && version === authRequestVersionRef.current) setIsLoading(false);
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
      if (!mounted || signingInRef.current || sessionExpiredRef.current) return;
      const version = ++authRequestVersionRef.current;
      try {
        const userData = await fetchMe();
        if (!mounted || version !== authRequestVersionRef.current) return;
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
      if (!mounted || version !== authRequestVersionRef.current) return;
      if (mounted) {
        setUser(null);
        setIsLoading(false);
      }
      router.push("/login");
    }

    const initialFetchTimer = setTimeout(() => {
      if (!initialFetchDone && mounted) {
        fetchUser();
      }
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(initialFetchTimer);
      subscription.unsubscribe();
    };
  }, [router]); 

  const enterSuperadminPortal = async () => {
    const userData = await fetchMe(true);
    ++authRequestVersionRef.current;
    userRef.current = userData;
    setUser(userData);
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
    signingInRef.current = true;
    ++authRequestVersionRef.current;
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

      // A valid Supabase password is not enough: the API must accept the browser
      // session and resolve the company profile before any portal navigation.
      const userData = await fetchMe(true);
      ++authRequestVersionRef.current;
      userRef.current = userData;
      setUser(userData);
      setSessionExpired(false);
      // Same-site paths only: "//evil.com" or "https://…" in ?redirect= must not send someone off-site.
      router.push(redirectPath && /^\/(?![/\\])/.test(redirectPath) ? redirectPath : "/");
    } catch (err) {
      if (err instanceof ApiError && (err.body as { code?: string } | null)?.code === "COMPANY_SUSPENDED") {
        await supabaseRef.current.auth.signOut({ scope: "local" });
      }
      throw err;
    } finally {
      signingInRef.current = false;
      setIsLoading(false);
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
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/40 backdrop-blur-md"
        >
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 id="session-expired-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Your session has expired
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You were signed out for your security. This page is still here, so sign in again in a new tab and
              you can carry on with anything you haven&apos;t saved.
            </p>
            <a
              href="/login?redirect=/hub"
              target="_blank"
              rel="noopener"
              className="mt-5 block w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Sign in in a new tab
            </a>
            <button
              onClick={resumeSession}
              className="mt-2 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted"
            >
              I&apos;ve signed in — continue
            </button>
            {resumeError && <p role="alert" className="mt-2 text-xs text-destructive">{resumeError}</p>}
            <button
              onClick={handleSessionExpiredRedirect}
              className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Sign in on this page instead (unsaved changes here will be lost)
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
