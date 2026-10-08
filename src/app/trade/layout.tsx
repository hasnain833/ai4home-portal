"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layout/PortalLayout";

/** The trade portal: the same shell as Warranty and Sales, with the trade's own nav. */
export default function TradeLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace("/login");
    else if (user.role !== "trade") router.replace("/");
  }, [user, isLoading, router]);

  if (isLoading || user?.role !== "trade") {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PortalLayout workspace="trade">
      <div className="mx-auto max-w-5xl">{children}</div>
    </PortalLayout>
  );
}
