"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, KeyRound, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface PlatformKey {
  provider: string;
  configured: boolean;
  masked: string | null;
}

interface CompanyGrant {
  id: string;
  name: string;
  grant: string | null;
  ownKeyProvider: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC: "Claude (Anthropic)",
  OPENAI: "OpenAI",
};

const label = (p: string | null) => (p ? PROVIDER_LABELS[p] || p : "");

export default function AdminAiKeysPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [platformKeys, setPlatformKeys] = useState<PlatformKey[]>([]);
  const [companies, setCompanies] = useState<CompanyGrant[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingGrant, setSavingGrant] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai-keys");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Could not load AI key settings.");
        return;
      }
      setError("");
      setPlatformKeys(data.platformKeys || []);
      setCompanies(data.companies || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) load();
  }, [user, load]);

  const saveKey = async (provider: string, clear = false) => {
    const apiKey = clear ? "" : (drafts[provider] || "").trim();
    if (!clear && !apiKey) {
      toast.error("Enter a key first.");
      return;
    }
    setSavingKey(provider);
    try {
      const res = await fetch("/api/admin/ai-keys/platform", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to save");
      setPlatformKeys(data.platformKeys || []);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      toast.success(
        clear ? `${label(provider)} platform key removed.` : `${label(provider)} platform key saved.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingKey(null);
    }
  };

  const saveGrant = async (companyId: string, grant: string) => {
    setSavingGrant(companyId);
    const next = grant === "NONE" ? null : grant;
    try {
      const res = await fetch(`/api/admin/ai-keys/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to save");
      setCompanies((prev) =>
        prev.map((c) => (c.id === companyId ? { ...c, grant: next } : c)),
      );
      toast.success(next ? `Granted ${label(next)}.` : "Platform key access revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingGrant(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Platform keys ─────────────────────────────────────────── */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Platform AI Keys</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Keys the platform owns. A tenant can only use one of these if you grant it
                below, and a tenant&apos;s own key always takes priority over the platform key.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4 md:p-6">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Loading AI key settings…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
              {error}
            </div>
          ) : (
            platformKeys.map((k) => (
              <div
                key={k.provider}
                className="rounded-lg border p-3 bg-slate-50/40 dark:bg-slate-900/20">
                <div className="mb-2 flex items-center gap-2">
                  <Label className="text-xs font-semibold">{label(k.provider)}</Label>
                  {k.configured ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Set · {k.masked}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not set</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    placeholder={k.provider === "ANTHROPIC" ? "sk-ant-..." : "sk-..."}
                    value={drafts[k.provider] || ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [k.provider]: e.target.value }))
                    }
                    className="h-9 max-w-md text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveKey(k.provider)}
                    disabled={savingKey === k.provider}
                    className="h-9 gap-1.5 bg-[#0F3B3D] text-xs hover:bg-[#0F3B3D]/90">
                    {savingKey === k.provider ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                  {k.configured && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveKey(k.provider, true)}
                      disabled={savingKey === k.provider}
                      className="h-9 text-xs">
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Per-tenant grants ─────────────────────────────────────── */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Tenant Key Access</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which platform key each tenant may use. Tenants with no grant and no key
                of their own have AI drafting switched off.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 p-4 md:p-6">
          {loading ? null : companies.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No companies yet.</p>
          ) : (
            companies.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 bg-slate-50/40 dark:bg-slate-900/20">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {c.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.ownKeyProvider ? (
                      <>
                        Using their own {label(c.ownKeyProvider)} key &mdash; a grant here is a
                        fallback only
                      </>
                    ) : c.grant ? (
                      <>Using the platform {label(c.grant)} key</>
                    ) : (
                      <>No key of their own &mdash; AI is off for this tenant</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {savingGrant === c.id && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  <Select
                    value={c.grant || "NONE"}
                    onValueChange={(v) => saveGrant(c.id, v)}
                    disabled={savingGrant === c.id}>
                    <SelectTrigger className="h-9 w-55 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No platform key</SelectItem>
                      {platformKeys.map((k) => (
                        <SelectItem key={k.provider} value={k.provider} disabled={!k.configured}>
                          {label(k.provider)}
                          {k.configured ? "" : " — key not set"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
