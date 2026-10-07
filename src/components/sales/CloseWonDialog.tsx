"use client";

import { useEffect, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, ApiError } from "@/lib/api";

type Home = { id: string; address: string; status: string; community: { id: string; name: string } };
type Community = { id: string; name: string };

const OTHER = "other";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The sales-to-warranty hand-off: marks the lead Closed Won, makes the buyer a
 * Warranty homeowner with their property, and marks the home SOLD.
 */
export default function CloseWonDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  hasEmail,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  hasEmail: boolean;
  onDone: () => void | Promise<void>;
}) {
  const [homes, setHomes] = useState<Home[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [homeId, setHomeId] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [address, setAddress] = useState("");
  const [closingDate, setClosingDate] = useState(today());
  const [saving, setSaving] = useState(false);

  // Mounted only while open (see the lead page), so state starts fresh each time.
  useEffect(() => {
    if (!open) return;
    apiFetch<{ homes: Home[] }>("/api/sales/homes")
      .then((d) => setHomes((d.homes || []).filter((h) => h.status !== "SOLD")))
      .catch(() => setHomes([]));
    apiFetch<{ communities: Community[] }>("/api/sales/communities")
      .then((d) => setCommunities(d.communities || []))
      .catch(() => setCommunities([]));
  }, [open]);

  const manual = homeId === OTHER || (homeId === "" && homes.length === 0);
  const ready = hasEmail && closingDate && (manual ? communityId && address.trim() : homeId);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ notice?: string | null; createdHomeowner: boolean }>(
        `/api/sales/leads/${leadId}/close-won`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            manual ? { communityId, address, closingDate } : { salesHomeId: homeId, closingDate },
          ),
        },
      );
      if (res.notice) toast.warning(res.notice, { duration: 10000 });
      else
        toast.success(
          res.createdHomeowner
            ? `${leadName} is now a Warranty homeowner. A welcome email was sent to set their password.`
            : `${leadName} is Closed Won and the home was added to their Warranty account.`,
        );
      onOpenChange(false);
      await onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not complete the hand-off.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[#b48c3c]" /> Mark Closed Won
          </DialogTitle>
          <DialogDescription>
            {leadName} becomes a homeowner in the Warranty workspace with 1 year of coverage from the
            closing date, and the home is marked sold.
          </DialogDescription>
        </DialogHeader>

        {!hasEmail ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Add an email address to this lead first. The homeowner signs in with it.
          </p>
        ) : (
          <div className="space-y-4">
            {homes.length > 0 && (
              <div className="space-y-1.5">
                <Label>Home they bought</Label>
                <Select value={homeId} onValueChange={setHomeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a home" />
                  </SelectTrigger>
                  <SelectContent>
                    {homes.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.address} · {h.community.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>Not listed — enter the address</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {manual && (
              <>
                <div className="space-y-1.5">
                  <Label>Community</Label>
                  <Select value={communityId} onValueChange={setCommunityId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a community" />
                    </SelectTrigger>
                    <SelectContent>
                      {communities.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="closeWonAddress">Address</Label>
                  <Input
                    id="closeWonAddress"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. 45 Oak Ridge Dr"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="closeWonDate">Closing date</Label>
              <Input
                id="closeWonDate"
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
            Closed Won
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
