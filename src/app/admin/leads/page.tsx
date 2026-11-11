"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { History, Loader2, Pencil, Plus, Search, Target, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { parseCsv } from "@/lib/csv";
import { apiFetch } from "@/lib/api";
import {
  B2B_API,
  B2B_LEAD_STATUSES,
  type B2BLead,
  type B2BLeadStatus,
  type B2BTimeline,
  sendJson,
  titleCase,
  useB2BLeads,
  useB2BSegments,
  matchesB2BSegment,
  type B2BSegment,
} from "@/lib/b2b-store";

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
  smsconsent: "smsConsent",
};

const EMPTY_FORM = { companyName: "", contactName: "", email: "", phone: "", website: "", city: "", notes: "" };
type LeadForm = typeof EMPTY_FORM;
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function AdminLeadsPage() {
  const confirm = useConfirm();
  const [nurtureOnly, setNurtureOnly] = useState(false);
  const { items: leads, loading, reload } = useB2BLeads();
  const { items: segments, reload: reloadSegments } = useB2BSegments();
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [savingSegment, setSavingSegment] = useState(false);
  const [activeSegment, setActiveSegment] = useState("all");
  const [pagination, setPagination] = useState({ page: 1, filterKey: "" });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<B2BLeadStatus | "ALL">("ALL");
  // null = closed, "" = adding, otherwise the id of the lead being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [smsConsent, setSmsConsent] = useState(false);
  const [needsPerson, setNeedsPerson] = useState(false);
  const [timelineFor, setTimelineFor] = useState<B2BLead | null>(null);
  const [timeline, setTimeline] = useState<B2BTimeline | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<{ rows: Partial<LeadForm>[]; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openTimeline = async (lead: B2BLead) => {
    setTimelineFor(lead);
    setTimeline(null);
    try {
      setTimeline(await apiFetch<B2BTimeline>(`${B2B_API}/leads/${lead.id}/timeline`));
    } catch (e) {
      toast.error(errorMessage(e));
      setTimelineFor(null);
    }
  };

  // ?lead=<id> (the link Salesforce shows) opens that lead's timeline once the list is in.
  const linkedLead = useRef(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("lead"));
  useEffect(() => {
    const id = linkedLead.current;
    if (!id || loading) return;
    linkedLead.current = null;
    const lead = leads.find((l) => l.id === id);
    if (lead) void openTimeline(lead);
    else toast.error("That lead wasn't found. It may have been deleted.");
  }, [loading, leads]);

  const setJourney = async (join: boolean) => {
    if (!timelineFor) return;
    try {
      const out = await sendJson<{ joined?: number }>(`${B2B_API}/nurture/journey/${join ? "join" : "remove"}`, "POST", { leadIds: [timelineFor.id] });
      if (join && !out.joined) toast.error("This lead can't join: it is closed, opted out of email, or already in the journey.");
      else toast.success(join ? "Added to the journey." : "Removed from the journey.");
      await Promise.all([openTimeline(timelineFor), reload()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setLeadPaused = async (paused: boolean, answerWaiting = false) => {
    if (!timelineFor) return;
    try {
      await sendJson(`${B2B_API}/leads/${timelineFor.id}/agent`, "POST", { paused, answerWaiting });
      toast.success(paused ? "AI paused for this lead." : "AI resumed for this lead.");
      await Promise.all([openTimeline(timelineFor), reload()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const openForm = (lead?: B2BLead) => {
    setForm(
      lead
        ? Object.fromEntries(Object.keys(EMPTY_FORM).map((k) => [k, (lead[k as keyof LeadForm] as string) || ""])) as LeadForm
        : EMPTY_FORM,
    );
    setSmsConsent(!!lead?.smsConsentAt);
    setEditing(lead?.id ?? "");
  };

  const saveLead = async () => {
    if (!form.companyName.trim()) return toast.error("Company name is required.");
    if (!isEmail(form.email.trim())) return toast.error("Enter a valid email.");
    setSaving(true);
    try {
      const body = { ...form, smsConsent };
      if (editing) await sendJson(`${B2B_API}/leads/${editing}`, "PATCH", body);
      else await sendJson(`${B2B_API}/leads`, "POST", body);
      toast.success(editing ? "Lead updated." : "Lead added.");
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const readCsv = async (file: File) => {
    let rows: Partial<LeadForm>[];
    try {
      rows = (await parseCsv(await file.text(), COLUMN_ALIASES)) as Partial<LeadForm>[];
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    const existing = new Set(leads.map((l) => l.email));
    const seen = new Set<string>();
    const valid = rows.filter((row) => {
      const email = (row.email ?? "").trim().toLowerCase();
      if (!row.companyName?.trim() || !isEmail(email) || existing.has(email) || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
    setPreview({ rows: valid, skipped: rows.length - valid.length });
  };

  const confirmImport = async () => {
    if (!preview?.rows.length) return;
    setSaving(true);
    try {
      const r = await sendJson<{ imported: number; duplicates: number; invalid: number }>(`${B2B_API}/leads/import`, "POST", {
        rows: preview.rows,
      });
      const extra = r.duplicates + r.invalid;
      toast.success(`Imported ${r.imported} lead${r.imported === 1 ? "" : "s"}${extra ? ` · ${extra} skipped` : ""}.`);
      closeImport();
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const closeImport = () => {
    setImportOpen(false);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const setStatus = async (lead: B2BLead, status: B2BLeadStatus) => {
    try {
      await sendJson(`${B2B_API}/leads/${lead.id}`, "PATCH", { status });
      if (["SIGNED", "LOST"].includes(status) && lead.activeCampaigns.length) {
        toast.success(`Removed from ${lead.activeCampaigns.length} running campaign${lead.activeCampaigns.length === 1 ? "" : "s"}.`);
      }
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const deleteLead = async (lead: B2BLead) => {
    const ok = await confirm({
      title: `Delete ${lead.companyName}?`,
      description: lead.activeCampaigns.length
        ? `They'll be removed from ${lead.activeCampaigns.map((c) => c.name).join(", ")} and stop receiving messages. This can't be undone.`
        : "This lead and its campaign history will be removed. This can't be undone.",
      confirmText: "Delete lead",
    });
    if (!ok) return;
    try {
      await sendJson(`${B2B_API}/leads/${lead.id}`, "DELETE");
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const filters = { status: statusFilter, query, nurtureOnly };
  const visible = leads.filter((lead) => matchesB2BSegment(lead, filters) && (!needsPerson || !!lead.agentPausedAt));
  const needsPersonCount = leads.filter((lead) => lead.agentPausedAt).length;
  const filterKey = JSON.stringify({ ...filters, needsPerson });
  const totalPages = Math.max(1, Math.ceil(visible.length / 25));
  const currentPage = Math.min(pagination.filterKey === filterKey ? pagination.page : 1, totalPages);
  const pageLeads = visible.slice((currentPage - 1) * 25, currentPage * 25);
  const applySegment = (segment: B2BSegment) => {
    setActiveSegment(segment.id);
    setStatusFilter(segment.filters.status);
    setQuery(segment.filters.query);
    setNurtureOnly(segment.filters.nurtureOnly);
  };
  const saveSegment = async () => {
    if (!segmentName.trim()) return;
    setSavingSegment(true);
    try {
      const segment = await sendJson<B2BSegment>(`${B2B_API}/segments`, "POST", { name: segmentName, filters });
      await reloadSegments();
      setActiveSegment(segment.id);
      setSegmentOpen(false);
      setSegmentName("");
      toast.success("Segment saved. Membership updates as leads change.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSavingSegment(false); }
  };
  const deleteSegment = async (segment: B2BSegment) => {
    if (!await confirm({ title: `Delete segment "${segment.name}"?`, description: "Leads and existing campaign enrollments will remain.", confirmText: "Delete segment" })) return;
    try {
      await sendJson(`${B2B_API}/segments/${segment.id}`, "DELETE");
      if (activeSegment === segment.id && segments[0]) applySegment(segments[0]);
      await reloadSegments();
    } catch (error) { toast.error(errorMessage(error)); }
  };
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
                  Builders and businesses we want to bring onto the platform. Includes AI4HB website inquiries; tenant homebuyer leads stay separate.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
                <UploadCloud className="h-3.5 w-3.5" /> Import CSV
              </Button>
              <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => openForm()}>
                <Plus className="h-3.5 w-3.5" /> Add lead
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} maxLength={200} onChange={(e) => { setQuery(e.target.value); setActiveSegment(""); }} placeholder="Search leads" className="h-9 pl-8 text-sm" />
            </div>
            {(["ALL", ...B2B_LEAD_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setStatusFilter(s); setActiveSegment(""); }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  statusFilter === s ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "ALL" ? "All" : titleCase(s)} ({s === "ALL" ? leads.length : counts[s] || 0})
              </button>
            ))}
            {/* Status picks one. These two can each be on or off alongside it, so a divider sets them apart. */}
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              aria-pressed={nurtureOnly}
              onClick={() => { setNurtureOnly(!nurtureOnly); setActiveSegment(""); }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                nurtureOnly ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Nurture opt-in only
            </button>
            <button
              type="button"
              aria-pressed={needsPerson}
              onClick={() => setNeedsPerson(!needsPerson)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                needsPerson
                  ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]"
                  : needsPersonCount
                    ? "border-amber-500/50 text-amber-600"
                    : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Needs a person ({needsPersonCount})
            </button>
          </div>
          <div className="mt-4 space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-medium">Segments</p><p className="text-xs text-muted-foreground">Sales pipeline contains leads marked Interested. Save status, search and opt-in filters as reusable groups.</p></div>
              <Button variant="outline" size="sm" onClick={() => setSegmentOpen(true)}>Save current filters</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {segments.map((segment) => <div key={segment.id} className={`inline-flex items-center rounded-full border text-xs ${activeSegment === segment.id ? "border-[#b48c3c] bg-[#b48c3c]/10" : "border-border"}`}>
                <button type="button" className="px-3 py-2" onClick={() => applySegment(segment)}>{segment.name} ({leads.filter((lead) => matchesB2BSegment(lead, segment.filters)).length})</button>
                {!segment.builtIn && <button type="button" className="mr-2 p-1 text-muted-foreground hover:text-red-500" aria-label={`Delete segment ${segment.name}`} onClick={() => deleteSegment(segment)}><Trash2 className="h-3 w-3" /></button>}
              </div>)}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-250">
              <TableHeader className="bg-muted/15 border-b border-border/50">
                <TableRow>
                  {["Company / Contact", "Email", "Phone", "Status", "Opt-in Consent"].map((heading) => <TableHead key={heading} className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">{heading}</TableHead>)}
                  <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-right pr-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-20 text-center text-muted-foreground"><Target className="h-12 w-12 mx-auto opacity-20 text-[#b48c3c] mb-3" /><p className="font-semibold text-sm">{leads.length === 0 ? "No business leads yet." : "No leads match these filters."}</p><p className="text-xs mt-1">{leads.length === 0 ? "Add a lead or import a CSV to get started." : "Choose another segment or adjust your filters."}</p></TableCell></TableRow>
                ) : pageLeads.map((lead) => (
                  <TableRow key={lead.id} onClick={() => openForm(lead)} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition border-b border-border/30 cursor-pointer">
                    <TableCell className="py-3 px-4 align-middle">
                      <div className="flex flex-col gap-0.5 min-w-40 max-w-56">
                        <button type="button" className="text-left text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-[#b48c3c]" onClick={(event) => { event.stopPropagation(); openForm(lead); }}>{lead.companyName || "Company not provided"}</button>
                        <span className="text-xs text-slate-500 font-medium">{lead.contactName || "Contact not provided"}{lead.city ? " / " + lead.city : ""}</span>
                        {lead.website && <a href={/^https?:\/\//.test(lead.website) ? lead.website : "https://" + lead.website} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="text-[11px] text-[#b48c3c] hover:underline truncate">{lead.website}</a>}
                        {lead.notes && <span className="text-[11px] text-muted-foreground truncate" title={lead.notes}>{lead.notes}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-xs font-semibold text-slate-800 dark:text-slate-200 align-middle">{lead.email}</TableCell>
                    <TableCell className="py-3 px-4 text-xs text-slate-500 font-medium align-middle whitespace-nowrap">{lead.phone || "-"}</TableCell>
                    <TableCell className="py-3 px-4 align-middle" onClick={(event) => event.stopPropagation()}>
                      <Select value={lead.status} onValueChange={(status) => setStatus(lead, status as B2BLeadStatus)}>
                        <SelectTrigger size="sm" aria-label={"Status for " + lead.companyName} className={"w-auto min-w-32 rounded-full border-transparent text-xs font-semibold " + STATUS_STYLES[lead.status]}><SelectValue /></SelectTrigger>
                        <SelectContent align="start">
                          {B2B_LEAD_STATUSES.map((status) => <SelectItem key={status} value={status}><span className={"inline-flex items-center gap-2 " + STATUS_STYLES[status].split(" ").filter((style) => !style.startsWith("bg-")).join(" ")}><span className="h-2 w-2 rounded-full bg-current" />{titleCase(status)}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-xs font-semibold align-middle whitespace-nowrap">
                      <div className="space-y-0.5">
                        <span className={lead.emailOptOut ? "text-slate-400 block" : "text-green-600 block"}>{lead.emailOptOut ? "Email opted out" : "Email eligible"}</span>
                        <span className={lead.smsOptOut || !lead.phone || !lead.smsConsentAt ? "text-slate-400 block" : "text-green-600 block"}>{!lead.phone ? "No phone" : lead.smsOptOut ? "SMS opted out" : !lead.smsConsentAt ? "No SMS consent" : "SMS eligible"}</span>
                        {lead.marketingOptIn && !lead.emailOptOut && <Badge variant="secondary" className="text-[9px] font-mono tracking-tight px-1.5 py-0">Nurture opt-in</Badge>}
                        {lead.source.startsWith("WEBSITE_") && !lead.marketingOptIn && <span className="text-[10px] text-slate-400 block">No marketing consent</span>}
                        {lead.agentPausedAt && <span className="text-amber-600 block" title={lead.agentPauseReason || undefined}>{lead.agentPauseReason === "paused by the team" ? "AI paused" : "AI paused: needs a person"}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right pr-6 space-x-1 align-middle whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="text-xs px-2" title="Timeline" aria-label={"Timeline for " + lead.companyName} onClick={() => openTimeline(lead)}><History className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="text-xs px-2" aria-label={"Edit " + lead.companyName} onClick={() => openForm(lead)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-500/10 text-xs px-2" aria-label={"Delete " + lead.companyName} onClick={() => deleteLead(lead)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!loading && visible.length > 0 && <div className="flex flex-col gap-3 px-6 py-4 border-t border-border/50 bg-slate-50/30 dark:bg-slate-900/10 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">Showing {(currentPage - 1) * 25 + 1} to {Math.min(currentPage * 25, visible.length)} of {visible.length} business leads</div>
            <div className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground mr-1">Page {currentPage} of {totalPages}</span><Button variant="outline" size="sm" className="h-8 text-xs" disabled={currentPage === 1} onClick={() => setPagination({ page: currentPage - 1, filterKey })}>Previous</Button><Button variant="outline" size="sm" className="h-8 text-xs" disabled={currentPage >= totalPages} onClick={() => setPagination({ page: currentPage + 1, filterKey })}>Next</Button></div>
          </div>}
        </CardContent>
      </Card>

      <Dialog open={segmentOpen} onOpenChange={setSegmentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Save segment</DialogTitle><DialogDescription>Leads join or leave this group automatically as they match these filters. Campaign enrollment uses the matches at that moment.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="segment-name">Segment name</Label><Input id="segment-name" maxLength={80} value={segmentName} onChange={(event) => setSegmentName(event.target.value)} placeholder="Builders considering our services" /></div>
          <p className="text-sm text-muted-foreground">Status: {statusFilter === "ALL" ? "All" : titleCase(statusFilter)}; search: {query.trim() || "Any"}; nurture opt-in: {nurtureOnly ? "Required" : "Any"}. {visible.length} matching leads.</p>
          <DialogFooter><Button variant="outline" onClick={() => setSegmentOpen(false)}>Cancel</Button><Button disabled={savingSegment || !segmentName.trim()} onClick={saveSegment}>{savingSegment ? "Saving…" : "Save segment"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Timeline */}
      <Dialog open={!!timelineFor} onOpenChange={(open) => !open && setTimelineFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{timelineFor?.companyName}: timeline</DialogTitle>
            <DialogDescription>Campaign messages, replies, AI answers and meetings, newest first.</DialogDescription>
          </DialogHeader>
          {!timeline ? (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <span className="min-w-0">
                  {timeline.agentPausedAt ? `AI is paused for this lead: ${timeline.agentPauseReason || "paused by the team"}.` : "AI answers this lead's replies automatically."}
                  {timeline.agentPausedUntil && ` It resumes on its own after ${new Date(timeline.agentPausedUntil).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`}
                  {timeline.waiting > 0 && ` ${timeline.waiting} unanswered message${timeline.waiting === 1 ? "" : "s"}.`}
                </span>
                <div className="flex flex-wrap gap-2">
                  {timeline.agentPausedAt && timeline.waiting > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setLeadPaused(false, true)}>Resume and answer</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setLeadPaused(!timeline.agentPausedAt)}>
                    {timeline.agentPausedAt ? "Resume AI" : "Pause AI"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <span className="min-w-0">
                  {timeline.journeyStage ? `Journey: ${titleCase(timeline.journeyStage)}.` : "Not in the journey."}
                  {timeline.journeyNextAt && ` Next step ${new Date(timeline.journeyNextAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`}
                  {timeline.journeyHoldReason && ` On hold: ${timeline.journeyHoldReason}.`}
                </span>
                <Button variant="outline" size="sm" onClick={() => setJourney(!timeline.journeyStage)}>
                  {timeline.journeyStage ? "Remove from journey" : "Add to journey"}
                </Button>
              </div>
              {timeline.profile && (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">What the AI remembers</p>
                  <dl className="mt-1 grid gap-1 text-muted-foreground">
                    {Object.entries(timeline.profile).map(([key, value]) => (
                      <div key={key}><dt className="inline font-medium">{titleCase(key)}: </dt><dd className="inline">{value}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
              {timeline.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="space-y-2">
                  {timeline.items.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className={"rounded-lg border p-3 text-sm " + (item.kind === "lead" ? "border-[#b48c3c]/40 bg-[#b48c3c]/5" : "border-border")}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.status && <span className={item.status === "failed" ? "text-red-500" : ""}>{titleCase(item.status)} · </span>}
                          {new Date(item.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </div>
                      {item.body && <p className="mt-1 whitespace-pre-wrap wrap-break-word text-muted-foreground">{item.body}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / edit lead */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit business lead" : "Add business lead"}</DialogTitle>
            <DialogDescription>A builder or business we want to sign up.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["companyName", "Company name *", "Olson Homes"],
                ["contactName", "Contact person", "Jane Smith"],
                ["email", "Email *", "jane@olsonhomes.com"],
                ["phone", "Phone (+1)", "+1 (562) 596-4770"],
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
                  type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                  className="h-9 text-sm"
                />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="text-sm" />
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
              <span>
                This person agreed to receive marketing texts
                <span className="block text-xs text-muted-foreground">Campaign SMS steps are skipped without this.</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={saving} onClick={saveLead}>
              {editing ? "Save" : "Add lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV import */}
      <Dialog open={importOpen} onOpenChange={(open) => (open ? setImportOpen(true) : closeImport())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import leads from CSV</DialogTitle>
            <DialogDescription>
              Columns: <span className="font-mono">company, contact, email, phone, website, city, notes, smsconsent</span>. Use yes in smsconsent only for people who agreed to marketing texts. Company and email are
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
                <span className="font-semibold text-emerald-600">{preview.rows.length} ready to import</span>
                {preview.skipped > 0 && <span className="text-muted-foreground"> · {preview.skipped} skipped (missing fields or duplicate)</span>}
              </p>
              {preview.rows.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
                  {preview.rows.slice(0, 50).map((l) => (
                    <li key={l.email} className="flex justify-between gap-2 border-b border-border px-3 py-1.5 last:border-0">
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
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={!preview?.rows.length || saving} onClick={confirmImport}>
              Import {preview?.rows.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
