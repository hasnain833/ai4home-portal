"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Route } from "lucide-react";
import AutoNurtureWorkflow from "@/components/sales/AutoNurtureWorkflow";
import CampaignsView from "@/components/admin/CampaignsView";

const VIEWS = [
  { id: "nurture", label: "Nurture", icon: Route },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
] as const;

export default function NurtureShell() {
  const router = useRouter();
  const view = useSearchParams().get("view") === "campaigns" ? "campaigns" : "nurture";

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div role="tablist" aria-label="Nurture or campaigns" className="inline-flex flex-wrap justify-center gap-1 rounded-md bg-muted p-1">
          {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => router.replace(id === "nurture" ? "/admin/nurture" : "/admin/nurture?view=campaigns", { scroll: false })}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
          ))}
        </div>
      </div>
      {view === "nurture" ? <AutoNurtureWorkflow variant="b2b" /> : <CampaignsView />}
    </div>
  );
}
