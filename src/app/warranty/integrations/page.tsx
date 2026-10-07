"use client";

import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import ErpIntegrationsCard from "@/components/integrations/ErpIntegrationsCard";
import { Plug } from "lucide-react";

export default function IntegrationsPage() {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        <div className="space-y-6 max-w-6xl mx-auto">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Plug className="h-8 w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
              <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Integrations
              </span>
            </h1>
            <p className="text-muted-foreground mt-1">
              Connect your warranty ERP so the Warranty Agent can write tickets to it.
            </p>
          </div>
          <ErpIntegrationsCard />
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
