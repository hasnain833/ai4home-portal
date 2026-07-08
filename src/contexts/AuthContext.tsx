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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // Stable ref — createClient() returns a singleton so this is safe
  const supabaseRef = useRef(createClient());

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
        // Verify if a superadmin session is active before clearing
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

    // Fallback: if onAuthStateChange didn't fire INITIAL_SESSION (older SDK), fetch manually
    setTimeout(() => {
      if (!initialFetchDone && mounted) {
        fetchUser();
      }
    }, 100);

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]); // router is stable

  const login = async (
    email: string,
    password: string,
    redirectPath?: string,
  ) => {
    setIsLoading(true);
    try {
      const isSuperAdminEmail = email.toLowerCase() === "admin@gmail.com";

      const response = await fetch("/api/auth/superadmin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const body = await response.json();
        if (body.isSuperAdmin) {
          const meResponse = await fetch("/api/auth/me");
          if (meResponse.ok) {
            const userData = await meResponse.json();
            setUser(userData);
          }
          router.push(redirectPath || "/admin");
          return;
        }
      }

      if (isSuperAdminEmail) {
        throw new Error("Invalid credentials");
      }

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
    // Optimistically update UI immediately
    setUser({ ...user, avatar: avatarUrl });
    // Persist to DB (staff/homeowner only — admin avatar = company logo, managed separately)
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
      }}
    >
      {children}
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
