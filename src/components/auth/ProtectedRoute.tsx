"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, ReactNode } from "react";
import { hasSalesPermission, type SalesPermission } from "@/lib/sales-permissions";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: ("admin" | "staff" | "homeowner")[];
  requiredPermission?: SalesPermission;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  requiredPermission,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    routerRef.current = router;
    pathnameRef.current = pathname;
  });

  const allowedKey = allowedRoles ? allowedRoles.join(",") : "";

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      routerRef.current.push(`/login?redirect=${encodeURIComponent(pathnameRef.current)}`);
      return;
    }

    if (allowedKey && !allowedKey.split(",").includes(user.role.toLowerCase())) {
      routerRef.current.push("/hub");
      return;
    }

    // Sent back to the workspace they can use, rather than a dead end.
    if (requiredPermission && !hasSalesPermission(user, requiredPermission)) {
      routerRef.current.push("/sales/dashboard");
    }
  }, [user, isLoading, allowedKey, requiredPermission]);

  if (!isLoading && !user) return null;
  if (!isLoading && user && allowedKey && !allowedKey.split(",").includes(user.role)) return null;
  if (!isLoading && user && requiredPermission && !hasSalesPermission(user, requiredPermission)) {
    return null;
  }

  return <>{children}</>;
}
