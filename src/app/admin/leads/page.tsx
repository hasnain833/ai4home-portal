"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Target, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { parseCsv } from "@/lib/csv";
import { B2B_LEAD_STATUSES, type B2BLead, type B2BLeadStatus, useB2BLeads } from "@/lib/b2b-store";

const STATUS_STYLES: Record<B2BLeadStatus, string> = {
  NEW: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  CONTACTED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  INTERESTED: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  SIGNED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  LOST: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
};

/** CSV header -> lead field. */
const COLUMN_ALIASES: Record<string, string> = {
  company: "companyName",
  companyname: "companyName",
  business: "companyName",
  builder: "companyName",
  contact: "contactName",
  contactname: "contactName",
  name: "contactName",
  email: "email",
  phone: "phone",
  website: "website",
  url: "website",
  city: "city",
  location: "city",
  notes: "notes",
};

const EMPTY_FORM = { companyName: "", contactName: "", email: "", phone: "", website: "", city: "", notes: "" };
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function toLead(row: Partial<typeof EMPTY_FORM>, source: B2BLead["source"]): B2BLead {
  return {
    ...EMPTY_FORM,
    ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, (v ?? "").trim()])),
    email: (row.email ?? "").trim().toLowerCase(),
    id: crypto.randomUUID(),
    status: "NEW",
    source,
    createdAt: new Date().toISOString(),
  };
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useB2BLeads();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<B2BLeadStatus | "ALL">("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<{ valid: B2BLead[]; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingEmails = new Set(leads.map((l) => l.email));

  const addLead = () => {
    if (!form.companyName.trim()) return toast.error("Company name is required.");
    if (!isEmail(form.email.trim())) return toast.error("Enter a valid email.");
    if (existingEmails.has(form.email.trim().toLowerCase())) return toast.error("A lead with that email already exists.");
    setLeads((prev) => [toLead(form, "MANUAL"), ...prev]);
    setForm(EMPTY_FORM);
    setAddOpen(false);
    toast.success("Lead added.");
  };

  const readCsv = async (file: File) => {
    const rows = parseCsv(await file.text(), COLUMN_ALIASES);
    const seen = new Set(existingEmails);
    const valid: B2BLead[] = [];
    for (const row of rows) {
      const email = (row.email ?? "").trim().toLowerCase();
      if (!row.companyName?.trim() || !isEmail(email) || seen.has(email)) continue;
      seen.add(email);
      valid.push(toLead(row, "CSV"));
    }
    setPreview({ valid, skipped: rows.length - valid.length });
  };

  const confirmImport = () => {
    if (!preview?.valid.length) return;
    setLeads((prev) => [...preview.valid, ...prev]);
    toast.success(`Imported ${preview.valid.length} lead${preview.valid.length === 1 ? "" : "s"}.`);
    closeImport();
  };

  const closeImport = () => {
    setImportOpen(false);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const setStatus = (id: string, status: B2BLeadStatus) =>
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));

  const q = query.trim().toLowerCase();
  const visible = leads.filter(
    (l) =>
      (statusFilter === "ALL" || l.status === statusFilter) &&
      (!q || [l.companyName, l.contactName, l.email, l.city].some((v) => v.toLowerCase().includes(q))),
  );
  const counts = leads.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.status]: (acc[l.status] || 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl text-foreground">Business Leads</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Builders and businesses we want to bring onto the platform. Add them by hand or import a CSV.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
                <UploadCloud className="h-3.5 w-3.5" /> Import CSV
              </Button>
              <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add lead
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search leads" className="h-9 pl-8 text-sm" />
            </div>
            {(["ALL", ...B2B_LEAD_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  statusFilter === s ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} ({s === "ALL" ? leads.length : counts[s] || 0})
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                      {leads.length === 0 ? "No leads yet. Add one or import a CSV." : "No leads match these filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((l) => (
                    <TableRow key={l.id} className="hover:bg-muted/40">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{l.companyName}</span>
                          {l.website && (
                            <a href={/^https?:\/\//.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#b48c3c] hover:underline truncate max-w-[200px]">
                              {l.website}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm text-muted-foreground">
                          <span className="text-foreground/90">{l.contactName || "—"}</span>
                          <span className="text-xs">{l.email}</span>
                          {l.phone && <span className="text-xs">{l.phone}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.city || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{l.source === "CSV" ? "CSV" : "Manual"}</Badge>
                      </TableCell>
                      <TableCell>
                        <select
                          value={l.status}
                          onChange={(e) => setStatus(l.id, e.target.value as B2BLeadStatus)}
                          className={`rounded-md border-0 px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${STATUS_STYLES[l.status]}`}
                        >
                          {B2B_LEAD_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-background text-foreground">
                              {s}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(l.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                          title="Delete lead"
                          onClick={() => setLeads((prev) => prev.filter((x) => x.id !== l.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add lead */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add business lead</DialogTitle>
            <DialogDescription>A builder or business we want to sign up.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["companyName", "Company name *", "Olson Homes"],
                ["contactName", "Contact person", "Jane Smith"],
                ["email", "Email *", "jane@olsonhomes.com"],
                ["phone", "Phone", "(562) 596-4770"],
                ["website", "Website", "olsonhomes.com"],
                ["city", "City / State", "Long Beach, CA"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  type={key === "email" ? "email" : "text"}
                  className="h-9 text-sm"
                />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={addLead}>Add lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV import */}
      <Dialog open={importOpen} onOpenChange={(open) => (open ? setImportOpen(true) : closeImport())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import leads from CSV</DialogTitle>
            <DialogDescription>
              Columns: <span className="font-mono">company, contact, email, phone, website, city, notes</span>. Company and email are
              required; rows with a duplicate email are skipped.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground hover:border-[#b48c3c]">
            <UploadCloud className="h-6 w-6" />
            Choose a .csv file
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && readCsv(e.target.files[0])} />
          </label>
          {preview && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-semibold text-emerald-600">{preview.valid.length} ready to import</span>
                {preview.skipped > 0 && <span className="text-muted-foreground"> · {preview.skipped} skipped (missing fields or duplicate)</span>}
              </p>
              {preview.valid.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
                  {preview.valid.slice(0, 50).map((l) => (
                    <li key={l.id} className="flex justify-between gap-2 border-b border-border px-3 py-1.5 last:border-0">
                      <span className="truncate font-medium">{l.companyName}</span>
                      <span className="truncate text-muted-foreground">{l.email}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeImport}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={!preview?.valid.length} onClick={confirmImport}>
              Import {preview?.valid.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
