"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, ReactNode } from "react";

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
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  routerRef.current = router;
  pathnameRef.current = pathname;

  const allowedKey = allowedRoles ? allowedRoles.join(",") : "";

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      routerRef.current.push(`/login?redirect=${encodeURIComponent(pathnameRef.current)}`);
      return;
    }

    if (allowedKey && !allowedKey.split(",").includes(user.role.toLowerCase())) {
      routerRef.current.push("/hub");
    }
  }, [user, isLoading, allowedKey]);

  if (!isLoading && !user) return null;
  if (!isLoading && user && allowedKey && !allowedKey.split(",").includes(user.role)) return null;

  return <>{children}</>;
}
