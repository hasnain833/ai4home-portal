"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";

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
  avatar?: string;
  companyId?: string;
  companyName?: string;
  properties?: Property[];
  online: boolean;
  lastSeen?: Date;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => void;
  updateAvatar: (avatarUrl: string) => void;
  setOnlineStatus: (status: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check localStorage for saved session
    const savedUser = localStorage.getItem("warranty_user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Login failed");
      }

      const loggedInUser: User = {
        ...data,
        lastSeen: new Date(data.lastSeen),
      };

      setUser(loggedInUser);
      localStorage.setItem("warranty_user", JSON.stringify(loggedInUser));
      document.cookie = `warranty_user=${JSON.stringify(loggedInUser)}; path=/; max-age=604800; SameSite=Lax`;
      router.push("/dashboard");
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    if (user) {
      const updatedUser = { ...user, online: false };
      localStorage.setItem("warranty_user", JSON.stringify(updatedUser));
    }
    setUser(null);
    localStorage.removeItem("warranty_user");
    router.push("/login");
  };

  const updateProfile = (data: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...data };
      setUser(updated);
      localStorage.setItem("warranty_user", JSON.stringify(updated));
    }
  };

  const updateAvatar = (avatarUrl: string) => {
    updateProfile({ avatar: avatarUrl });
  };

  const setOnlineStatus = (status: boolean) => {
    if (user) {
      const updated = {
        ...user,
        online: status,
        lastSeen: status ? user.lastSeen : new Date(),
      };
      setUser(updated);
      localStorage.setItem("warranty_user", JSON.stringify(updated));
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
