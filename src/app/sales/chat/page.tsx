"use client";

import { useEffect, useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Bot } from "lucide-react";
import SalesChat from "@/components/sales/SalesChat";

export default function SalesChatPage() {
  const { user, isLoading } = useAuth();
  const [themeColor, setThemeColor] = useState("#0F3B3D");

  const companyName = user?.companyName || "Aiforhomebuilder";

  // Same brand color the warranty assistant uses, so both read as one company.
  useEffect(() => {
    if (isLoading || !user) return;
    fetch("/api/company", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.botColor) setThemeColor(data.botColor);
      })
      .catch(() => {
        // Keep the default color.
      });
  }, [user, isLoading]);

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout workspace="sales">
        <div className="flex flex-col h-[calc(100dvh-96px)] md:h-[calc(100dvh-48px)] max-w-6xl mx-auto px-2 sm:px-4 w-full gap-4 pb-4">
          <div className="shrink-0">
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
              <Bot className="h-7 w-7 md:h-8 md:w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
              <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                AI Assistant
              </span>
            </h1>
          </div>
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0 overflow-hidden rounded-3xl shadow-2xl flex flex-col min-h-0">
              <SalesChat
                themeColor={themeColor}
                botName={`${companyName} Sales Assistant`}
                logoUrl={user?.companyLogo}
              />
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
