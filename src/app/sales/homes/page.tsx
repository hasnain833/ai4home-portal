"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SALES_PERMISSION, hasSalesPermission } from "@/lib/sales-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Home,
  Plus,
  UploadCloud,
  RefreshCw,
  Loader2,
  Pencil,
  Trash2,
  Images,
  Star,
  Search,
  FileDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

type Status = "AVAILABLE" | "COMING_SOON" | "UNDER_CONTRACT" | "SOLD";

interface Photo {
  id: string;
  url: string;
  sortOrder: number;
}

interface SalesHome {
  id: string;
  communityId: string;
  community: { id: string; name: string; color: string };
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  lotNumber: string | null;
  planName: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  status: Status;
  moveIn: string | null;
  description: string | null;
  photos: Photo[];
}

interface Community {
  id: string;
  name: string;
  color: string;
  salesHomeCount?: number;
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  AVAILABLE: {
    label: "Available",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50",
  },
  COMING_SOON: {
    label: "Coming soon",
    cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/50",
  },
  UNDER_CONTRACT: {
    label: "Under contract",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  },
  SOLD: {
    label: "Sold",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
};
const STATUSES = Object.keys(STATUS_META) as Status[];
const PAGE_SIZE = 10;

// Column headings the importer understands (it also accepts common variants,
// e.g. "List Price", "Beds", "Floor Plan").
const TEMPLATE_HEADERS = [
  "Community", "Address", "City", "State", "Zip", "Lot", "Plan",
  "Price", "Beds", "Baths", "Sqft", "Status", "Move In", "Description",
];

type FormState = {
  communityId: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  lotNumber: string;
  planName: string;
  price: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  status: Status;
  moveIn: string;
  description: string;
};

const EMPTY_FORM: FormState = {
  communityId: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  lotNumber: "",
  planName: "",
  price: "",
  bedrooms: "",
  bathrooms: "",
  sqft: "",
  status: "AVAILABLE",
  moveIn: "",
  description: "",
};

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (data && data.message) || fallback;
}

export default function SalesHomesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canManage = !!user && hasSalesPermission(user, SALES_PERMISSION.kbManage);

  const [homes, setHomes] = useState<SalesHome[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [communityFilter, setCommunityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Add / edit
  const [editing, setEditing] = useState<SalesHome | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [newCommunity, setNewCommunity] = useState("");
  const [addingCommunity, setAddingCommunity] = useState(false);

  // Photos
  const [photoHomeId, setPhotoHomeId] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoHome = homes.find((h) => h.id === photoHomeId) || null;

  // Import
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCommunity, setImportCommunity] = useState("none");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    communitiesCreated: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  // Fetches without touching `loading` first, so the mount effect sets state
  // only after the requests come back.
  const fetchAll = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([fetch("/api/sales/homes"), fetch("/api/sales/communities")]);
      if (h.ok) setHomes((await h.json()).homes || []);
      else toast.error(await readError(h, "Could not load homes"));
      if (c.ok) setCommunities((await c.json()).communities || []);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const t = setTimeout(() => void fetchAll(), 0);
    return () => clearTimeout(t);
  }, [fetchAll]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return homes.filter((h) => {
      if (communityFilter !== "all" && h.communityId !== communityFilter) return false;
      if (statusFilter !== "all" && h.status !== statusFilter) return false;
      if (!q) return true;
      return [h.address, h.city, h.planName, h.lotNumber, h.community?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [homes, search, communityFilter, statusFilter]);

  // Clamped rather than reset in an effect: a filter that shrinks the list
  // just lands on its last page.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of homes) out[h.status] = (out[h.status] || 0) + 1;
    return out;
  }, [homes]);

  const replaceHome = (updated: SalesHome) =>
    setHomes((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));

  // --- Add / edit ---

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, communityId: communityFilter !== "all" ? communityFilter : communities[0]?.id || "" });
    setFormOpen(true);
  };

  const openEdit = (h: SalesHome) => {
    setEditing(h);
    setForm({
      communityId: h.communityId,
      address: h.address,
      city: str(h.city),
      state: str(h.state),
      zipCode: str(h.zipCode),
      lotNumber: str(h.lotNumber),
      planName: str(h.planName),
      price: str(h.price),
      bedrooms: str(h.bedrooms),
      bathrooms: str(h.bathrooms),
      sqft: str(h.sqft),
      status: h.status,
      moveIn: str(h.moveIn),
      description: str(h.description),
    });
    setFormOpen(true);
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const addCommunity = async () => {
    const name = newCommunity.trim();
    if (!name) return;
    setAddingCommunity(true);
    try {
      const res = await fetch("/api/sales/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not add community"));
      const created: Community = await res.json();
      setCommunities((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, communityId: created.id }));
      setNewCommunity("");
      toast.success(`Added ${created.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add community");
    } finally {
      setAddingCommunity(false);
    }
  };

  const saveHome = async () => {
    if (!form.communityId) return toast.error("Choose a community");
    if (!form.address.trim()) return toast.error("Address is required");
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/sales/homes/${editing.id}` : "/api/sales/homes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not save home"));
      const saved: SalesHome = await res.json();
      if (editing) replaceHome(saved);
      else setHomes((prev) => [...prev, saved]);
      setFormOpen(false);
      toast.success(editing ? "Home updated" : "Home added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save home");
    } finally {
      setSaving(false);
    }
  };

  const deleteHome = async (h: SalesHome) => {
    const ok = await confirm({
      title: "Delete this home?",
      description: `${h.address} and its ${h.photos.length} photo${h.photos.length === 1 ? "" : "s"} will be removed. The AI Assistant stops offering it right away.`,
      confirmText: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/sales/homes/${h.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error(await readError(res, "Could not delete home"));
    setHomes((prev) => prev.filter((x) => x.id !== h.id));
    toast.success("Home deleted");
  };

  const quickStatus = async (h: SalesHome, status: Status) => {
    const res = await fetch(`/api/sales/homes/${h.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return toast.error(await readError(res, "Could not change status"));
    replaceHome(await res.json());
  };

  // --- Photos ---

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length || !photoHome) return;
    setUploadingPhotos(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((f) => body.append("files", f));
      const res = await fetch(`/api/sales/homes/${photoHome.id}/photos`, { method: "POST", body });
      if (!res.ok) throw new Error(await readError(res, "Could not upload photos"));
      replaceHome(await res.json());
      toast.success(`${files.length} photo${files.length === 1 ? "" : "s"} added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload photos");
    } finally {
      setUploadingPhotos(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const photoAction = async (photo: Photo, action: "cover" | "delete") => {
    if (!photoHome) return;
    if (action === "delete") {
      const ok = await confirm({ title: "Delete this photo?", confirmText: "Delete" });
      if (!ok) return;
    }
    const res = await fetch(
      `/api/sales/homes/${photoHome.id}/photos/${photo.id}${action === "cover" ? "/cover" : ""}`,
      { method: action === "cover" ? "POST" : "DELETE" },
    );
    if (!res.ok) return toast.error(await readError(res, "Could not update photos"));
    replaceHome(await res.json());
  };

  // --- Import ---

  const downloadTemplate = () => {
    const example = [
      "Descanso Walk", "1068 W. Foothill Blvd #12", "Claremont", "CA", "91711", "12", "Plan 2",
      "649900", "3", "2.5", "1850", "Available", "Now", "Corner homesite with a private patio",
    ];
    const csv = [TEMPLATE_HEADERS, example]
      .map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "homes-for-sale-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (!importFile) return toast.error("Choose a file to import");
    setImporting(true);
    setImportResult(null);
    try {
      const body = new FormData();
      body.append("file", importFile);
      if (importCommunity !== "none") body.append("communityId", importCommunity);
      const res = await fetch("/api/sales/homes/import", { method: "POST", body });
      if (!res.ok) throw new Error(await readError(res, "Import failed"));
      const result = await res.json();
      setImportResult(result);
      toast.success(`Imported: ${result.created} added, ${result.updated} updated`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Homes for Sale
              </h1>
              <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" />
                The AI Assistant offers available and coming-soon homes to buyers, and shows their photos.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={load} className="gap-2 h-9">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              {canManage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 h-9"
                    onClick={() => {
                      setImportFile(null);
                      setImportResult(null);
                      setImportOpen(true);
                    }}
                  >
                    <UploadCloud className="h-4 w-4" /> Import CSV
                  </Button>
                  <Button size="sm" className="gap-2 h-9 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Add Home
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Status summary */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatusFilter(statusFilter === s ? "all" : s);
                  setPage(1);
                }}
                className={`rounded-xl border p-4 text-left transition hover:border-[#b48c3c]/60 ${
                  statusFilter === s ? "border-[#b48c3c] bg-[#b48c3c]/5" : "border-border bg-card"
                }`}
              >
                <p className="text-xs font-semibold text-muted-foreground">{STATUS_META[s].label}</p>
                <p className="mt-1 text-2xl font-bold">{counts[s] || 0}</p>
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search address, plan, lot or community…"
                className="pl-9"
              />
            </div>
            <Select value={communityFilter} onValueChange={(v) => { setCommunityFilter(v); setPage(1); }}>
              <SelectTrigger className="sm:w-60"><SelectValue placeholder="All communities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All communities</SelectItem>
                {communities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="sm:w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* List */}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {loading && homes.length === 0 ? (
                <div className="py-16 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : visible.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  {homes.length === 0
                    ? "No homes yet. Import a CSV or add one — the AI Assistant can only offer homes listed here."
                    : "No homes match these filters."}
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                      <th className="py-3 px-4">Home</th>
                      <th className="py-3 px-4">Community</th>
                      <th className="py-3 px-4">Price</th>
                      <th className="py-3 px-4">Size</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Photos</th>
                      <th className="py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((h) => (
                      <tr key={h.id} className="border-b dark:border-slate-800 hover:bg-slate-50/40 dark:hover:bg-slate-900/20">
                        <td className="py-3 px-4">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{h.address}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[
                                [h.city, h.state].filter(Boolean).join(", "),
                                h.planName && (/plan/i.test(h.planName) ? h.planName : `Plan ${h.planName}`),
                                h.lotNumber && `Lot ${h.lotNumber}`,
                                h.moveIn && `Move-in ${h.moveIn}`,
                              ].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: h.community?.color || "#0F3B3D" }} />
                            {h.community?.name}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold whitespace-nowrap">{h.price != null ? money(h.price) : "—"}</td>
                        <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {[
                            h.bedrooms != null && `${h.bedrooms} bd`,
                            h.bathrooms != null && `${h.bathrooms} ba`,
                            h.sqft != null && `${h.sqft.toLocaleString("en-US")} sf`,
                          ].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="py-3 px-4">
                          {canManage ? (
                            <Select value={h.status} onValueChange={(v) => quickStatus(h, v as Status)}>
                              <SelectTrigger className={`h-7 w-36 rounded-full border px-2.5 text-[11px] font-semibold ${STATUS_META[h.status].cls}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className={`text-[11px] ${STATUS_META[h.status].cls}`}>{STATUS_META[h.status].label}</Badge>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => setPhotoHomeId(h.id)}>
                            <Images className="h-4 w-4" /> {h.photos.length}
                          </Button>
                        </td>
                        <td className="py-3 px-4">
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(h)} aria-label="Edit home">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                onClick={() => deleteHome(h)}
                                aria-label="Delete home"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
            {visible.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length} homes
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <span className="tabular-nums">Page {safePage} of {pageCount}</span>
                  <Button variant="outline" size="sm" className="h-8" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Add / edit */}
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit home" : "Add a home"}</DialogTitle>
              <DialogDescription>Only the community and address are required.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold">Community</Label>
                <Select value={form.communityId} onValueChange={(v) => setForm((f) => ({ ...f, communityId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose a community" /></SelectTrigger>
                  <SelectContent>
                    {communities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input
                    value={newCommunity}
                    onChange={(e) => setNewCommunity(e.target.value)}
                    placeholder="…or add a new community"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addCommunity();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8" disabled={!newCommunity.trim() || addingCommunity} onClick={addCommunity}>
                    {addingCommunity ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold">Address</Label>
                <Input value={form.address} onChange={set("address")} placeholder="1068 W. Foothill Blvd #12" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">City</Label>
                <Input value={form.city} onChange={set("city")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">State</Label>
                  <Input value={form.state} onChange={set("state")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Zip</Label>
                  <Input value={form.zipCode} onChange={set("zipCode")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Plan</Label>
                <Input value={form.planName} onChange={set("planName")} placeholder="Plan 2" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Lot / homesite</Label>
                <Input value={form.lotNumber} onChange={set("lotNumber")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Price ($)</Label>
                <Input value={form.price} onChange={set("price")} inputMode="numeric" placeholder="649900" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as Status }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Beds</Label>
                  <Input value={form.bedrooms} onChange={set("bedrooms")} inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Baths</Label>
                  <Input value={form.bathrooms} onChange={set("bathrooms")} inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Sq ft</Label>
                  <Input value={form.sqft} onChange={set("sqft")} inputMode="numeric" />
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold">Move-in</Label>
                <Input value={form.moveIn} onChange={set("moveIn")} placeholder="Now, Spring 2027, Q2…" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold">Description</Label>
                <Textarea value={form.description} onChange={set("description")} rows={3} placeholder="Features the assistant can mention to buyers" />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={saveHome} disabled={saving} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editing ? "Save changes" : "Add home"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Photos */}
        <Dialog open={!!photoHome} onOpenChange={(open) => !open && setPhotoHomeId(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Photos — {photoHome?.address}</DialogTitle>
              <DialogDescription>
                The first photo is the cover. The AI Assistant shows these when a buyer asks to see this home.
              </DialogDescription>
            </DialogHeader>

            {photoHome && photoHome.photos.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No photos yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photoHome?.photos.map((p, i) => (
                  <div key={p.id} className="group relative aspect-4/3 overflow-hidden rounded-lg border bg-slate-100 dark:bg-slate-800">
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-[#b48c3c] px-2 py-0.5 text-[10px] font-semibold text-white">Cover</span>
                    )}
                    {canManage && (
                      <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-linear-to-t from-black/60 to-transparent p-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        {i !== 0 && (
                          <Button size="sm" variant="secondary" className="h-7 gap-1 text-[11px]" onClick={() => photoAction(p, "cover")}>
                            <Star className="h-3.5 w-3.5" /> Cover
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" className="h-7 w-7 p-0" onClick={() => photoAction(p, "delete")} aria-label="Delete photo">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canManage && (
              <DialogFooter>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(e) => uploadPhotos(e.target.files)}
                />
                <Button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhotos} className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white">
                  {uploadingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  Upload photos
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>

        {/* Import */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Import homes</DialogTitle>
              <DialogDescription>
                A CSV or Excel file with one home per row. A Community column puts each row in its community — new ones are
                created. Rows that match an existing home (same community and address) update it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
                <FileDown className="h-4 w-4" /> Download template
              </Button>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">File</Label>
                <Input type="file" accept=".csv,.xlsx" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Community for rows without one</Label>
                <Select value={importCommunity} onValueChange={setImportCommunity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None — use the file&apos;s Community column</SelectItem>
                    {communities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {importResult && (
                <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
                  <p className="font-semibold">
                    {importResult.created} added · {importResult.updated} updated · {importResult.skipped} skipped
                    {importResult.communitiesCreated > 0 && ` · ${importResult.communitiesCreated} new communit${importResult.communitiesCreated === 1 ? "y" : "ies"}`}
                  </p>
                  {importResult.errors.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto text-rose-600 dark:text-rose-400">
                      {importResult.errors.map((e) => (
                        <li key={e.row}>Row {e.row}: {e.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
              <Button onClick={runImport} disabled={!importFile || importing} className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
