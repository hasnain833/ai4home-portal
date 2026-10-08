"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/components/ui/confirm-dialog";
import PortalLayout from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Mail, Pencil, Phone, Plus, Send, Trash2, Wrench } from "lucide-react";

interface Trade {
  id: string;
  tradeType: string;
  businessName: string | null;
  isActive: boolean;
  createdAt: string;
  user: { id: string; name: string | null; email: string; phone: string | null };
}

// Suggestions only; builders can type any trade. Same wording the AI uses for issue types.
const COMMON_TRADES = [
  "Plumbing", "Electrical", "HVAC", "Roofing", "Drywall & Paint",
  "Flooring", "Appliances", "Structural", "Carpentry", "Landscaping",
];

const EMPTY_FORM = { name: "", email: "", phone: "", tradeType: "", businessName: "" };

export default function TradesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();
  const isAdmin = user?.role === "admin";

  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // One dialog for add and edit; `editing` set means edit.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "staff") router.push("/warranty/dashboard");
  }, [user, router]);

  const flash = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Bumped after every change to refetch the list.
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  const canView = user?.role === "admin" || user?.role === "staff";

  useEffect(() => {
    if (!canView) return;
    fetch("/api/trades")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setTrades)
      .catch(() => flash("error", "Could not load trades."))
      .finally(() => setLoading(false));
  }, [canView, version]);

  const tradeTypes = useMemo(() => [...new Set(trades.map((t) => t.tradeType))].sort(), [trades]);
  const shown = filter === "all" ? trades : trades.filter((t) => t.tradeType === filter);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (t: Trade) => {
    setEditing(t);
    setForm({
      name: t.user.name || "",
      email: t.user.email,
      phone: t.user.phone || "",
      tradeType: t.tradeType,
      businessName: t.businessName || "",
    });
    setFormError("");
    setDialogOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.tradeType.trim() || (!editing && (!form.name.trim() || !form.email.trim()))) {
      setFormError(editing ? "Trade type is required" : "Name, email and trade type are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/trades/${editing.id}` : "/api/trades", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing ? { tradeType: form.tradeType, businessName: form.businessName } : form,
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.message || "Could not save the trade.");
        return;
      }
      setDialogOpen(false);
      flash("success", data.notice || (editing ? "Trade updated." : `Invite sent to ${form.email}.`));
      load();
    } catch {
      setFormError("Error connecting to server.");
    } finally {
      setSaving(false);
    }
  };

  const act = async (request: RequestInit & { url: string }, done: string) => {
    const { url, ...init } = request;
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return flash("error", data.message || "Something went wrong.");
    flash("success", done);
    load();
  };

  const toggleActive = (t: Trade) =>
    act(
      { url: `/api/trades/${t.id}`, method: "PATCH", body: JSON.stringify({ isActive: !t.isActive }) },
      t.isActive ? `${t.user.name} deactivated.` : `${t.user.name} reactivated.`,
    );

  const remove = async (t: Trade) => {
    if (!(await confirm({
      title: "Remove trade?",
      description: `${t.user.name} will no longer be on your list. Their login stays for any other builders they work with.`,
      confirmText: "Remove",
    }))) return;
    act({ url: `/api/trades/${t.id}`, method: "DELETE" }, `${t.user.name} removed.`);
  };

  if (!user || (user.role !== "admin" && user.role !== "staff")) return null;

  return (
    <PortalLayout>
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Wrench className="h-8 w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
              <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Trades
              </span>
            </h1>
            <p className="text-muted-foreground mt-1">
              Plumbers, electricians and other trades you dispatch tickets to. Each gets their own login to see their jobs.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={openAdd} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
              <Plus className="h-4 w-4" /> Add Trade
            </Button>
          )}
        </div>

        {message && (
          <Alert
            variant={message.type === "error" ? "destructive" : "default"}
            className={message.type === "success" ? "mb-6 border-green-500 bg-green-50 dark:bg-green-950/30" : "mb-6"}
          >
            {message.type === "success" && <CheckCircle className="h-4 w-4 text-green-600" />}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Your trades</CardTitle>
              <CardDescription>
                {trades.filter((t) => t.isActive).length} active of {trades.length}
              </CardDescription>
            </div>
            {tradeTypes.length > 1 && (
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All trades</SelectItem>
                  {tradeTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
              </div>
            ) : shown.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wrench className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No trades yet</p>
                <p className="text-sm mt-1">
                  {isAdmin ? "Add your first trade to start dispatching tickets to them." : "An administrator will add trades here."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {shown.map((t) => (
                  <div
                    key={t.id}
                    className={`flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-lg border bg-card ${t.isActive ? "" : "opacity-60"}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{t.user.name || t.user.email}</p>
                        <Badge variant="secondary">{t.tradeType}</Badge>
                        {!t.isActive && <Badge variant="outline">Inactive</Badge>}
                      </div>
                      {t.businessName && <p className="text-sm text-muted-foreground">{t.businessName}</p>}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{t.user.email}</span>
                        {t.user.phone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{t.user.phone}</span>}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => openEdit(t)} className="gap-1.5">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => act({ url: `/api/trades/${t.id}/invite`, method: "POST" }, `Invite re-sent to ${t.user.email}.`)}
                        >
                          <Send className="h-3.5 w-3.5" /> Resend invite
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => toggleActive(t)}>
                          {t.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => remove(t)} aria-label={`Remove ${t.user.name}`}>
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Trade" : "Add Trade"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Name, email and phone belong to the trade's own login, so they change those from their profile."
                  : "We'll email them a link to set their password. If they already work with another builder on the portal, they keep their existing login."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={save} className="space-y-4 mt-2">
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="trade-name">Contact name</Label>
                <Input id="trade-name" value={form.name} disabled={!!editing} placeholder="Mike Ross"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trade-email">Email</Label>
                <Input id="trade-email" type="email" value={form.email} disabled={!!editing} placeholder="mike@rosselectric.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {!editing && (
                <div className="space-y-2">
                  <Label htmlFor="trade-phone">Mobile phone (optional)</Label>
                  <Input id="trade-phone" type="tel" value={form.phone} placeholder="(555) 123-4567"
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Job assignments are also sent by SMS.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="trade-type">Trade</Label>
                <Input id="trade-type" list="trade-types" value={form.tradeType} placeholder="Electrical"
                  onChange={(e) => setForm({ ...form, tradeType: e.target.value })} />
                <datalist id="trade-types">
                  {COMMON_TRADES.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trade-business">Business name (optional)</Label>
                <Input id="trade-business" value={form.businessName} placeholder="Ross Electric LLC"
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
                  {saving ? "Saving..." : editing ? "Save" : "Send Invite"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </PortalLayout>
  );
}
