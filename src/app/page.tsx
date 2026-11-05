"use client";

import { isPlatformUser } from "@/lib/admin-permissions";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        if (isPlatformUser(user)) {
          router.push("/admin");
          return;
        }
        if (user.role === "trade") {
          router.push("/trade");
          return;
        }

        if (user.lastActiveWorkspace === "warranty" && user.hasWarrantyAccess) {
          router.push("/warranty/dashboard");
        } else if (user.lastActiveWorkspace === "sales" && user.hasSalesAccess) {
          router.push("/sales/dashboard");
        } else {
          const hasWarranty = user.hasWarrantyAccess;
          const hasSales = user.hasSalesAccess;
          if (hasWarranty && hasSales) {
            router.push("/hub");
          } else if (hasWarranty) {
            router.push("/warranty/dashboard");
          } else if (hasSales) {
            router.push("/sales/dashboard");
          } else {
            logoutAndRedirect();
          }
        }
      } else {
        router.push("/login");
      }
    }

    async function logoutAndRedirect() {
      router.push("/login?error=no_workspace_access");
    }
  }, [user, isLoading, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}
