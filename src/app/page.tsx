"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        if (user.isSuperAdmin) {
          router.push("/admin");
          return;
        }

        const storedLastWorkspace = localStorage.getItem("last-workspace");
        const getCookie = (name: string) => {
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) return parts.pop()?.split(";").shift();
          return null;
        };
        const cookieLastWorkspace = getCookie("last-workspace");
        const lastWorkspace =
          user.lastActiveWorkspace ||
          storedLastWorkspace ||
          cookieLastWorkspace;

        if (lastWorkspace === "warranty" && user.hasWarrantyAccess) {
          router.push("/warranty/dashboard");
        } else if (lastWorkspace === "sales" && user.hasSalesAccess) {
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
