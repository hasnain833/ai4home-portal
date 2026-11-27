"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, ReactNode } from "react";
import { hasSalesPermission, SALES_PERMISSION_LABELS, type SalesPermission } from "@/lib/sales-permissions";
import { PermissionDenied } from "@/components/auth/PermissionDenied";

/** ["admin","staff"] -> "an admin or staff account". */
function roleNeeded(roles: string[]) {
  const list = roles.length > 1 ? `${roles.slice(0, -1).join(", ")} or ${roles.at(-1)}` : roles[0];
  return `${/^[aeiou]/.test(list) ? "an" : "a"} ${list} account`;
}

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

    if (!user) routerRef.current.push(`/login?redirect=${encodeURIComponent(pathnameRef.current)}`);
  }, [user, isLoading]);

  if (!isLoading && !user) return null;
  // Signed in but not allowed: say what's missing and who can grant it, instead of bouncing them.
  if (!isLoading && user && allowedKey && !allowedKey.split(",").includes(user.role.toLowerCase())) {
    return (
      <PermissionDenied
        needed={roleNeeded(allowedKey.split(","))}
        grantedBy="your company's administrator"
        exitHref="/hub"
      />
    );
  }
  if (!isLoading && user && requiredPermission && !hasSalesPermission(user, requiredPermission)) {
    return (
      <PermissionDenied
        needed={`the "${SALES_PERMISSION_LABELS[requiredPermission]}" permission`}
        grantedBy="your company's administrator (Team page)"
        exitHref="/sales/dashboard"
        exitLabel="Go to the Sales dashboard"
      />
    );
  }

  return <>{children}</>;
}
