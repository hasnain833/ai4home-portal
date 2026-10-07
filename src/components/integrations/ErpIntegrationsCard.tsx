"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Zap, Plug, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

// All three are placeholders until we have real vendor API access; the server
// refuses to save keys for them (COMING_SOON_PLATFORMS in erp-service.js).
const PLATFORMS = [
  { id: "BUILTOPIA", label: "Builtopia", description: "New home construction management and warranty tracking platform.", icon: Database },
  { id: "BUILDERTREND", label: "Buildertrend", description: "Cloud-based construction project management for homebuilders.", icon: Zap },
  { id: "HYPHEN", label: "Hyphen Solutions", description: "Integrated supply chain and homebuilder operations platform.", icon: Plug },
];

export default function ErpIntegrationsCard() {
  const [configured, setConfigured] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const confirm = useConfirm();

  // Admin-only endpoint; for other roles this fails quietly and the cards just show "Coming soon".
  const load = async () => {
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) return;
      const data: { platform: string; configured: boolean }[] = await res.json();
      setConfigured(data.filter((d) => d.configured).map((d) => d.platform));
    } catch {
      // silent
    }
  };

  useEffect(() => { load(); }, []);

  // Keys saved before these went "coming soon" would otherwise have no UI to remove them.
  const handleRemove = async (id: string, label: string) => {
    if (!(await confirm({
      title: "Remove saved keys?",
      description: `Remove the saved ${label} keys?`,
      confirmText: "Remove",
    }))) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/integrations/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: id }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${label} keys removed.`);
      await load();
    } catch {
      toast.error(`Could not remove the ${label} keys. Please try again.`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Builder ERP Integrations</h2>
        <p className="text-xs text-muted-foreground">Sync leads and warranty tickets with your construction management platform.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {PLATFORMS.map(({ id, label, description, icon: Icon }) => (
          <Card key={id} className="flex flex-col border border-border/80 shadow-xs">
            <CardHeader className="border-b border-border/40 bg-slate-50/40 dark:bg-slate-950/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-xl bg-[#0F3B3D]/10 shrink-0">
                    <Icon className="h-5 w-5 text-[#0F3B3D] dark:text-[#b48c3c]" />
                  </div>
                  <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px] text-[#b48c3c] border-[#b48c3c]/40 shrink-0">
                  Coming soon
                </Badge>
              </div>
              <CardDescription className="text-xs">{description}</CardDescription>
            </CardHeader>
            {/* The credential form (API key, secret, environment, test) goes here once the platform is live. */}
            <CardContent className="flex-1 flex flex-col justify-between gap-3 pt-4">
              <p className="text-xs text-muted-foreground">
                The {label} connection is on the way. Nothing is sent to {label} yet.
              </p>
              {configured.includes(id) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-xs text-red-500 hover:text-red-700"
                  onClick={() => handleRemove(id, label)}
                  disabled={deleting === id}
                >
                  {deleting === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Remove saved keys
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
