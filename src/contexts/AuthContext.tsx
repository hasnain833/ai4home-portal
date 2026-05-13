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

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  companyName?: string;
  online: boolean;
  lastSeen?: Date;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, role: UserRole) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => void;
  updateAvatar: (avatarUrl: string) => void;
  setOnlineStatus: (status: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock users for demo
const MOCK_USERS: Record<string, User> = {
  "admin@builder.com": {
    id: "1",
    name: "John Builder",
    email: "admin@builder.com",
    role: "admin",
    companyName: "Premier Homes",
    online: true,
    avatar: "",
  },
  "staff@builder.com": {
    id: "2",
    name: "Sarah Warranty",
    email: "staff@builder.com",
    role: "staff",
    companyName: "Premier Homes",
    online: true,
    avatar: "",
  },
  "homeowner@example.com": {
    id: "3",
    name: "Mike Homeowner",
    email: "homeowner@example.com",
    role: "homeowner",
    online: false,
    avatar: "",
  },
};

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

  const login = async (email: string, password: string, role: UserRole) => {
    setIsLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      // Check against stored users (for demo)
      const storedUsers = JSON.parse(
        localStorage.getItem("warranty_users") || "[]",
      );
      const user = storedUsers.find(
        (u: any) => u.email === email && u.role === role,
      );
      if (user && user.password === password) {
        const loggedInUser: User = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyName: user.companyName,
          online: true,
          lastSeen: new Date(),
          avatar: "",
        };
        setUser(loggedInUser);
        localStorage.setItem("warranty_user", JSON.stringify(loggedInUser));
        document.cookie = `warranty_user=${JSON.stringify(loggedInUser)}; path=/; max-age=604800; SameSite=Lax`;
        router.push("/dashboard");
      } else {
        // Fallback to built-in demo users (for quick testing)
        const demoUsers = {
          "admin@builder.com": {
            role: "admin",
            name: "Admin User",
            company: "Demo Builder",
          },
          "staff@builder.com": {
            role: "staff",
            name: "Staff User",
            company: "Demo Builder",
          },
          "homeowner@example.com": {
            role: "homeowner",
            name: "Homeowner",
            company: "",
          },
        };
        if (
          demoUsers[email as keyof typeof demoUsers] &&
          demoUsers[email as keyof typeof demoUsers].role === role
        ) {
          const loggedInUser: User = {
            id: `demo_${email}`,
            name: demoUsers[email as keyof typeof demoUsers].name,
            email,
            role,
            companyName: demoUsers[email as keyof typeof demoUsers].company,
            online: true,
            lastSeen: new Date(),
            avatar: "",
          };
          setUser(loggedInUser);
          localStorage.setItem("warranty_user", JSON.stringify(loggedInUser));
          document.cookie = `warranty_user=${JSON.stringify(loggedInUser)}; path=/; max-age=604800; SameSite=Lax`;
          router.push("/dashboard");
        } else {
          throw new Error("Invalid email, password, or role mismatch");
        }
      }
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
