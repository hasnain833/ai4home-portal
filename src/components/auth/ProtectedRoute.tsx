"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: ("admin" | "staff" | "homeowner")[];
}

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
    if (
      !isLoading &&
      user &&
      allowedRoles &&
      !allowedRoles.includes(user.role)
    ) {
      router.push("/dashboard");
    }
  }, [user, isLoading, router, pathname, allowedRoles]);

  if (!isLoading && !user) return null;
  if (!isLoading && user && allowedRoles && !allowedRoles.includes(user.role)) return null;

  return <>{children}</>;
}

