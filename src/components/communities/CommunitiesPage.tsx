"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/layout/PortalLayout";
import { SupportContactStrip } from "@/components/layout/HelpMenu";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMMUNITY_TYPE_LABELS,
  type CommunityInfo,
  type CommunityType,
} from "@/components/warranty/CommunitiesPanel";

const TYPE_KEYS = Object.keys(COMMUNITY_TYPE_LABELS) as CommunityType[];

/**
 * One community list for both workspaces. Sold homes (warranty properties),
 * homes for sale and KB documents all hang off the same community, so each
 * workspace shows the same rows — only the API path differs, because each path
 * sits behind its own workspace's access check.
 */
export default function CommunitiesPage({ workspace }: { workspace: "warranty" | "sales" }) {
  const api = workspace === "sales" ? "/api/sales/communities" : "/api/communities";
  const confirm = useConfirm();
  const [communities, setCommunities] = useState<CommunityInfo[]>([]);
  const [maxHomes, setMaxHomes] = useState(50);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CommunityType>("UNIT_HOMES");
  const [typeFilter, setTypeFilter] = useState<CommunityType | "all">("all");
  const shown = typeFilter === "all" ? communities : communities.filter((c) => c.type === typeFilter);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error();
      const payload = await res.json();
      setCommunities(payload.communities ?? []);
      if (payload.maxHomes) setMaxHomes(payload.maxHomes);
    } catch {
      toast.error("Could not load communities");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const send = async (url: string, init: RequestInit, done: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        ...init,
        headers: init.body ? { "Content-Type": "application/json" } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Something went wrong");
        return false;
      }
      toast.success(done);
      await load();
      return true;
    } catch {
      toast.error("Server error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Give the community a name.");
    const ok = await send(api, { method: "POST", body: JSON.stringify({ name: trimmed, type }) }, "Community created");
    if (ok) {
      setName("");
      setType("UNIT_HOMES");
    }
  };

  const remove = async (c: CommunityInfo) => {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      confirmText: "Delete",
      destructive: true,
    });
    if (ok) await send(`${api}/${c.id}`, { method: "DELETE" }, "Community deleted");
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace={workspace}>
        <div className="space-y-6 max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Communities
              </h1>
              <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Shared by Warranty and Sales. Each community holds up to {maxHomes} homes, sold and for sale together.
              </p>
            </div>
            <div className="flex gap-2 self-start">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CommunityType | "all")}>
                <SelectTrigger className="h-9 w-44" aria-label="Filter by type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TYPE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {COMMUNITY_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={load} className="gap-2 h-9">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          <SupportContactStrip />

          <Card>
            <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
                placeholder="New community name, e.g. Trophy Club Estates"
                className="h-9 flex-1"
              />
              <Select value={type} onValueChange={(v) => setType(v as CommunityType)}>
                <SelectTrigger className="h-9 sm:w-52" aria-label="Type of the new community">
                  <span className="text-muted-foreground">Type:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {COMMUNITY_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="gap-2 h-9 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white"
                onClick={create}
                disabled={busy}
              >
                <Plus className="h-4 w-4" /> Add community
              </Button>
            </CardContent>
          </Card>

          {loading && communities.length === 0 ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              {communities.length === 0
                ? "No communities yet. Every home belongs to one, so add the first above."
                : `No ${COMMUNITY_TYPE_LABELS[typeFilter as CommunityType]} communities.`}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shown.map((c) => {
                // salesHomeCount leaves out SOLD homes, so the server still has
                // the final say on delete.
                const inUse = c.propertyCount > 0 || c.salesHomeCount > 0 || c.kbCount > 0;
                return (
                  <Card key={c.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-2 font-semibold min-w-0">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <button
                          onClick={() => remove(c)}
                          disabled={busy || inUse}
                          title={inUse ? "Move or remove its homes and KB documents before deleting" : "Delete community"}
                          aria-label={`Delete ${c.name}`}
                          className="text-muted-foreground/70 hover:text-rose-600 disabled:opacity-30 shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <Select
                        value={c.type}
                        onValueChange={(v) =>
                          send(`${api}/${c.id}`, { method: "PATCH", body: JSON.stringify({ type: v }) }, "Community updated")
                        }
                        disabled={busy}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPE_KEYS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {COMMUNITY_TYPE_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${c.isFull ? "bg-rose-500" : "bg-[#0F3B3D]"}`}
                            style={{ width: `${Math.min(100, (c.homeCount / maxHomes) * 100)}%` }}
                          />
                        </div>
                        <p className={`text-xs ${c.isFull ? "text-rose-600 font-semibold" : "text-muted-foreground"}`}>
                          {c.homeCount} / {maxHomes} homes{c.isFull ? " — full" : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{c.propertyCount} sold (warranty)</span>
                        <span>{c.salesHomeCount} for sale</span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {c.kbCount} KB doc{c.kbCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
