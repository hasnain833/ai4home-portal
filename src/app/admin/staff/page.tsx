"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Loader2, Mail, Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@/lib/use-query";
import { sendJson } from "@/lib/b2b-store";

type Member = { id: string; name: string | null; email: string; adminPermissions: string[]; createdAt: string };
type Catalogue = Record<string, { label: string; description: string }>;
type Draft = { id: string | null; name: string; email: string; permissions: string[] };

const API = "/api/admin/super-staff";

/** AI4HB team members with access to chosen areas of the Super Admin portal. */
export default function StaffPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { data, loading, refresh: load } = useQuery<{ staff: Member[]; permissionCatalogue: Catalogue }>(
    user?.isSuperAdmin ? API : null,
  );
  const staff = data?.staff ?? [];
  const catalogue = data?.permissionCatalogue ?? {};
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.id) {
        await sendJson(`${API}/${draft.id}`, "PATCH", { name: draft.name, permissions: draft.permissions });
        toast.success("Access updated.");
      } else {
        const out = await sendJson<{ emailed: boolean }>(API, "POST", draft);
        if (out.emailed) toast.success(`Invite sent to ${draft.email}.`);
        else toast.warning("Account created, but the invite email didn't send. Use Resend invite.");
      }
      setDraft(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resend = async (m: Member) => {
    try {
      const out = await sendJson<{ emailed: boolean }>(`${API}/${m.id}/invite`, "POST");
      if (out.emailed) toast.success(`Invite sent to ${m.email}.`);
      else toast.error("The invite email didn't send.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (m: Member) => {
    const ok = await confirm({
      title: `Remove ${m.name || m.email}?`,
      description: "They lose access to the admin portal immediately and their login is deleted.",
      confirmText: "Remove",
    });
    if (!ok) return;
    try {
      await sendJson(`${API}/${m.id}`, "DELETE");
      toast.success("Staff member removed.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggle = (key: string) =>
    setDraft((d) =>
      d && {
        ...d,
        permissions: d.permissions.includes(key) ? d.permissions.filter((p) => p !== key) : [...d.permissions, key],
      },
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Give AI4HB team members access to parts of this portal. Only you can add, change or remove staff.
          </p>
        </div>
        <Button
          className="gap-2 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
          onClick={() => setDraft({ id: null, name: "", email: "", permissions: [] })}
        >
          <UserPlus className="h-4 w-4" /> Invite staff
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>
            Staff sign in on the normal sign-in page and see only the areas ticked for them.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 p-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : staff.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No staff yet.</p>
          ) : (
            staff.map((m) => (
              <div key={m.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{m.name || m.email}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.adminPermissions.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No access yet</span>
                    ) : (
                      m.adminPermissions.map((p) => (
                        <Badge key={p} variant="secondary" className="font-normal">
                          {catalogue[p]?.label || p}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDraft({ id: m.id, name: m.name || "", email: m.email, permissions: m.adminPermissions })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => resend(m)}>
                    <Mail className="h-3.5 w-3.5" /> Resend invite
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-red-600 hover:bg-red-500/10 hover:text-red-700"
                    onClick={() => remove(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit access" : "Invite staff"}</DialogTitle>
            <DialogDescription>
              {draft?.id
                ? "Changes apply within about 30 seconds."
                : "They'll get an email to set their password."}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="staff-name">Name</Label>
                  <Input id="staff-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input
                    id="staff-email"
                    type="email"
                    value={draft.email}
                    disabled={!!draft.id}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Access</Label>
                {Object.entries(catalogue).map(([key, p]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 hover:bg-muted/40">
                    <Checkbox checked={draft.permissions.includes(key)} onCheckedChange={() => toggle(key)} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
              onClick={save}
              disabled={saving || !draft?.name.trim() || !draft?.email.trim()}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {draft?.id ? "Save" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
