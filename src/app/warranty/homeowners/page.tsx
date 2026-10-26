"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  User,
  Copy,
  CheckCircle,
  Home,
  Phone,
  Pencil,
  Camera,
  Loader2,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { invalidate, QUERY_KEYS } from "@/lib/use-query";

interface Homeowner {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  hasSalesAccess?: boolean;
  createdAt: string;
  property?: {
    id: string;
    address: string;
    city?: string | null;
    state?: string | null;
    coverageTerm?: string | null;
    photoUrl?: string | null;
    community?: { name: string } | null;
  } | null;
}

type Tone = "ok" | "warn" | "off";

const TONE_BADGE: Record<Tone, string> = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  off: "bg-gray-100 text-gray-700",
};

const DAY = 24 * 60 * 60 * 1000;

// Coverage is always one year from closing; coverageTerm holds the end date.
function warrantyState(property: Homeowner["property"]): { label: string; tone: Tone } {
  if (!property) return { label: "No property", tone: "off" };
  if (!property.coverageTerm) return { label: "No coverage", tone: "off" };
  const left = new Date(property.coverageTerm).getTime() - Date.now();
  if (left < 0) return { label: "Expired", tone: "off" };
  if (left <= 30 * DAY) return { label: `Expires in ${Math.max(1, Math.ceil(left / DAY))} days`, tone: "warn" };
  return { label: `Covered · ${Math.round(left / (30 * DAY))} mo left`, tone: "ok" };
}

export default function HomeownersManagementPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");

  const [newHomeowner, setNewHomeowner] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });

  // Phone edit for an existing homeowner — needed so warranty SMS can reach them.
  const [phoneEdit, setPhoneEdit] = useState<{ id: string; name: string; value: string } | null>(null);
  const [phoneError, setPhoneError] = useState("");

  const savePhone = async () => {
    if (!phoneEdit) return;
    setPhoneError("");
    try {
      const res = await fetch(`/api/homeowners/${phoneEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: phoneEdit.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPhoneError(data.message || "Could not save phone number."); return; }
      setHomeowners((prev) => prev.map((h) => (h.id === phoneEdit.id ? { ...h, phone: data.phone ?? null } : h)));
      setSuccess(`Phone number updated for ${phoneEdit.name}.`);
      setPhoneEdit(null);
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setPhoneError("Could not save phone number.");
    }
  };

  // Redirect if not admin or staff
  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "staff") {
      router.push("/warranty/dashboard");
    }
  }, [user, router]);

  const fetchHomeowners = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/homeowners");
      if (!res.ok) throw new Error("Failed to load homeowners");
      const data = await res.json();
      setHomeowners(data);
    } catch {
      setError("Could not load homeowners.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin" || user?.role === "staff") {
      fetchHomeowners();
    }
  }, [user]);

  const handleCreateHomeowner = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!newHomeowner.name.trim() || !newHomeowner.email.trim()) {
      setFormError("Name and Email are required");
      return;
    }

    try {
      const res = await fetch("/api/homeowners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newHomeowner),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.message || "Failed to create homeowner"); return; }

      setSuccess(data.notice || `Homeowner ${newHomeowner.name} added. A welcome email with a set-password link is on its way.`);
      setNewHomeowner({ name: "", email: "", phone: "", password: "" });
      setIsDialogOpen(false);
      fetchHomeowners();
      invalidate(QUERY_KEYS.homeownerOptions);
      setTimeout(() => setSuccess(""), 5000);
    } catch {
      setFormError("An unexpected error occurred.");
    }
  };

  const handleDeleteHomeowner = async (homeownerId: string, homeownerName: string) => {
    try {
      const res = await fetch("/api/homeowners", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeownerId }),
      });
      if (!res.ok) throw new Error("Failed to remove homeowner");
      setSuccess(`${homeownerName} has been removed.`);
      fetchHomeowners();
      invalidate(QUERY_KEYS.homeownerOptions);
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setError("Failed to remove homeowner.");
    }
  };

  // Grants a homeowner the Sales workspace (SRS 4.12). Admin-only, and the
  // server refuses if the company is not entitled to Sales.
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);

  const toggleSalesAccess = async (homeowner: Homeowner, next: boolean) => {
    setSavingAccessId(homeowner.id);
    // Optimistic: reverted below if the server refuses.
    setHomeowners((prev) =>
      prev.map((h) => (h.id === homeowner.id ? { ...h, hasSalesAccess: next } : h)),
    );
    try {
      const res = await fetch(`/api/homeowners/${homeowner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hasSalesAccess: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHomeowners((prev) =>
          prev.map((h) => (h.id === homeowner.id ? { ...h, hasSalesAccess: !next } : h)),
        );
        setError(data.message || "Could not change Sales access.");
        return;
      }
      setSuccess(`Sales access ${next ? "granted to" : "removed from"} ${homeowner.name}.`);
    } catch {
      setHomeowners((prev) =>
        prev.map((h) => (h.id === homeowner.id ? { ...h, hasSalesAccess: !next } : h)),
      );
      setError("Could not change Sales access.");
    } finally {
      setSavingAccessId(null);
    }
  };

  // Details dialog, opened by clicking a row.
  const [viewId, setViewId] = useState<string | null>(null);
  const viewed = homeowners.find((h) => h.id === viewId) ?? null;
  const viewedWarranty = warrantyState(viewed?.property);

  // House photo: one exterior shot per property, shown only in the details dialog.
  const photoInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<Homeowner | null>(null);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);

  const pickPhoto = (homeowner: Homeowner) => {
    photoTarget.current = homeowner;
    photoInput.current?.click();
  };

  const housePhotoRequest = async (homeowner: Homeowner, file?: File) => {
    setError("");
    setPhotoBusyId(homeowner.id);
    try {
      let body: FormData | undefined;
      if (file) {
        body = new FormData();
        body.append("file", file);
      }
      const res = await fetch(`/api/homeowners/${homeowner.id}/house-photo`, { method: file ? "POST" : "DELETE", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.message || "Could not update the house photo."); return; }
      setHomeowners((prev) => prev.map((h) => (h.id === homeowner.id ? { ...h, property: data } : h)));
      if (file) {
        setSuccess(`House photo saved for ${homeowner.name}.`);
        setTimeout(() => setSuccess(""), 4000);
      }
    } catch {
      setError("Could not update the house photo.");
    } finally {
      setPhotoBusyId(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!user || (user.role !== "admin" && user.role !== "staff")) return null;

  return (
    <PortalLayout>
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Home className="h-8 w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
              <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Homeowners Management
              </span>
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage homeowners. You can register or remove homeowners.
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
                <UserPlus className="h-4 w-4" />
                Add Homeowner
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Homeowner</DialogTitle>
                <DialogDescription>
                  We&apos;ll email the homeowner a welcome link to set their own password.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateHomeowner} className="space-y-4 mt-2">
                {formError && (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="John Doe"
                      className="pl-9"
                      value={newHomeowner.name}
                      onChange={(e) => setNewHomeowner({ ...newHomeowner, name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      className="pl-9"
                      value={newHomeowner.email}
                      onChange={(e) => setNewHomeowner({ ...newHomeowner, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Mobile Phone (optional)</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      className="pl-9"
                      value={newHomeowner.phone}
                      onChange={(e) => setNewHomeowner({ ...newHomeowner, phone: e.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Ticket and visit updates are also sent by SMS to this number.</p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
                    Add Homeowner
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Success / Error messages */}
        {success && (
          <Alert className="mb-6 border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Homeowners list */}
        <Card>
          <CardHeader>
            <CardTitle>Current Homeowners</CardTitle>
            <CardDescription>
              {homeowners.length} homeowner{homeowners.length !== 1 ? "s" : ""} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : homeowners.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No homeowners found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {homeowners.map((homeowner, index) => (
                  <motion.div
                    key={homeowner.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setViewId(homeowner.id)}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-[#0F3B3D]/10 dark:bg-[#b48c3c]/10 flex items-center justify-center">
                        <span className="text-[#0F3B3D] dark:text-[#b48c3c] font-semibold text-sm">
                          {homeowner.name?.charAt(0).toUpperCase() ?? "H"}
                        </span>
                      </div>
                      <div>
                        {/* The whole row opens the details; this button is the keyboard route in. */}
                        <button type="button" className="font-medium text-foreground text-left hover:underline">
                          {homeowner.name}
                        </button>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm text-muted-foreground">{homeowner.email}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(homeowner.email, homeowner.id); }}
                            className="text-muted-foreground hover:text-[#0F3B3D] transition-colors"
                          >
                            {copiedId === homeowner.id ? (
                              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPhoneError(""); setPhoneEdit({ id: homeowner.id, name: homeowner.name, value: homeowner.phone || "" }); }}
                          className="flex items-center gap-1.5 mt-0.5 text-sm text-muted-foreground hover:text-[#0F3B3D] dark:hover:text-[#b48c3c] transition-colors"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {homeowner.phone || "Add phone"}
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <Badge variant="secondary" className="bg-green-100 text-green-700">
                        Homeowner
                      </Badge>
                      {user.role === "admin" && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={!!homeowner.hasSalesAccess}
                            disabled={savingAccessId === homeowner.id}
                            onCheckedChange={(checked) =>
                              toggleSalesAccess(homeowner, checked === true)
                            }
                            aria-label={`Sales workspace access for ${homeowner.name}`}
                          />
                          Sales access
                        </label>
                      )}
                      <p className="text-xs text-muted-foreground hidden sm:block">
                        Added {new Date(homeowner.createdAt).toLocaleDateString()}
                      </p>
                      {user.role === "admin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeleteConfirmId(homeowner.id);
                            setDeleteConfirmName(homeowner.name);
                          }}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && photoTarget.current) housePhotoRequest(photoTarget.current, file);
          }}
        />
      </motion.div>
    </div>

    {/* Homeowner Details Dialog — the only place the house photo shows */}
    <Dialog open={viewed !== null} onOpenChange={(open) => { if (!open) setViewId(null); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        {viewed && (
          <>
            <div className="relative h-52 bg-muted flex items-center justify-center">
              {viewed.property?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={viewed.property.photoUrl} alt={`House at ${viewed.property.address}`} className="absolute inset-0 h-full w-full object-cover" />
              ) : viewed.property ? (
                <button
                  type="button"
                  onClick={() => pickPhoto(viewed)}
                  disabled={photoBusyId === viewed.id}
                  className="flex flex-col items-center gap-2 border-2 border-dashed border-muted-foreground/40 rounded-xl px-6 py-4 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
                >
                  <Camera className="h-6 w-6" />
                  Add house photo
                </button>
              ) : (
                <div className="text-center text-sm text-muted-foreground px-6">
                  <Home className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No property assigned yet.{" "}
                  <Link href="/warranty/properties" className="underline">Add one in Properties</Link>
                </div>
              )}
              <span className={`absolute left-3 top-3 px-2.5 py-1 rounded-full text-xs font-semibold ${TONE_BADGE[viewedWarranty.tone]}`}>
                {viewedWarranty.label}
              </span>
              {photoBusyId === viewed.id && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
              {viewed.property?.photoUrl && photoBusyId !== viewed.id && (
                <div className="absolute right-3 bottom-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => housePhotoRequest(viewed)}>Remove</Button>
                  <Button size="sm" className="gap-1.5 bg-[#0F3B3D]/90 hover:bg-[#0F3B3D] text-white" onClick={() => pickPhoto(viewed)}>
                    <Camera className="h-4 w-4" /> Change
                  </Button>
                </div>
              )}
            </div>

            <div className="p-5 space-y-4">
              <DialogHeader className="text-left space-y-0.5">
                <DialogTitle className="text-lg">{viewed.name}</DialogTitle>
                <DialogDescription>
                  {viewed.property
                    ? [viewed.property.address, viewed.property.city, viewed.property.state].filter(Boolean).join(", ")
                    : "No property assigned"}
                </DialogDescription>
                {viewed.property?.community?.name && (
                  <p className="text-xs text-muted-foreground">{viewed.property.community.name}</p>
                )}
              </DialogHeader>

              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{viewed.email}</p>
                <p className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {viewed.phone || <span className="text-muted-foreground">No phone</span>}
                </p>
                {viewed.property?.coverageTerm && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Warranty ends {new Date(viewed.property.coverageTerm).toLocaleDateString(undefined, { dateStyle: "medium" })}
                  </p>
                )}
              </div>

              {viewed.property && (
                <div className="border-t pt-3">
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <Link href={`/warranty/tickets?propertyId=${viewed.property.id}`}>
                      <Ticket className="h-4 w-4" /> View tickets
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* Edit Phone Dialog */}
    <Dialog open={phoneEdit !== null} onOpenChange={(open) => { if (!open) setPhoneEdit(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mobile phone</DialogTitle>
          <DialogDescription>
            Ticket and visit updates for {phoneEdit?.name} are also sent by SMS to this number. Leave empty to stop SMS.
          </DialogDescription>
        </DialogHeader>
        {phoneError && (
          <Alert variant="destructive">
            <AlertDescription>{phoneError}</AlertDescription>
          </Alert>
        )}
        <Input
          type="tel"
          placeholder="(555) 123-4567"
          value={phoneEdit?.value ?? ""}
          onChange={(e) => setPhoneEdit((p) => (p ? { ...p, value: e.target.value } : p))}
          onKeyDown={(e) => { if (e.key === "Enter") savePhone(); }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setPhoneEdit(null)}>Cancel</Button>
          <Button className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90" onClick={savePhone}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Homeowner Confirmation Dialog */}
    <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
      <DialogContent className="sm:max-w-md bg-card border border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">Remove Homeowner</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-2">
            Are you sure you want to remove <span className="font-semibold text-foreground">{deleteConfirmName}</span>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="bg-red-600 hover:bg-red-700 text-white font-medium"
            onClick={() => {
              if (deleteConfirmId) {
                handleDeleteHomeowner(deleteConfirmId, deleteConfirmName);
                setDeleteConfirmId(null);
              }
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </PortalLayout>
  );
}
