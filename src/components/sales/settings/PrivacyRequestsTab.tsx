"use client";
import { useState } from "react";
import { useQuery } from "@/lib/use-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Loader2,
  Search,
  Download,
  ShieldOff,
  UserRound,
  Home,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
type SubjectType = "lead" | "homeowner";

interface Subject {
  id: string;
  type: SubjectType;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  archived: boolean;
}

interface LogEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: { subjectType?: string; mode?: string } | null;
  createdAt: string;
}

export default function PrivacyRequestsTab() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  // The request history is read-only and shared, so it comes from the query
  // cache; `refresh` is called after an export or erasure adds an entry.
  const { data: logData, loading: loadingLog, refresh: loadLog } =
    useQuery<{ entries: LogEntry[] }>("/api/sales/privacy/log");
  const log: LogEntry[] = logData?.entries ?? [];

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 3) {
      toast.error("Enter at least 3 characters to search.");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/sales/privacy/subjects?query=${encodeURIComponent(query.trim())}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Search failed.");
        return;
      }
      setSubjects(data.subjects || []);
      if ((data.subjects || []).length === 0) {
        toast.info("No matching records — this person may not be in your data.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setSearching(false);
    }
  };

  const handleExport = async (subject: Subject) => {
    setBusyId(subject.id);
    try {
      const res = await fetch(
        `/api/sales/privacy/subjects/${subject.type}/${subject.id}/export`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Could not build the export.");
        return;
      }

      // Hand the subject a portable file (GDPR Art. 20).
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `data-export-${subject.type}-${subject.id}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Export downloaded. The request has been recorded in the log.");
      loadLog();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  const handleErase = async (subject: Subject, mode: "anonymize" | "delete") => {
    const isDelete = mode === "delete";
    const ok = await confirm({
      title: isDelete ? "Permanently delete this person's data?" : "Erase personal data?",
      description: isDelete
        ? `Every record for ${subject.name} will be destroyed, including history. This cannot be undone — export first if the subject asked for a copy.`
        : `All identifying details for ${subject.name} will be removed and their message history deleted. Non-identifying records are kept so reporting totals stay accurate. This cannot be undone.`,
      confirmText: isDelete ? "Delete permanently" : "Erase",
    });
    if (!ok) return;

    setBusyId(subject.id);
    try {
      const res = await fetch(
        `/api/sales/privacy/subjects/${subject.type}/${subject.id}/erase`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mode, confirm: true }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Erasure failed.");
        return;
      }
      toast.success(data.message || "Erasure complete.");
      setSubjects((prev) => (prev || []).filter((s) => s.id !== subject.id));
      loadLog();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#b48c3c]" /> Data Subject Requests
          </CardTitle>
          <CardDescription className="text-xs">
            Handle GDPR / CCPA access and erasure requests. Search for the person by
            email, phone or name, export everything you hold about them, then erase it.
            Every action here is recorded below.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <form onSubmit={runSearch} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="space-y-1.5 flex-1">
              <Label className="font-semibold text-xs">Email, phone or name</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="jane@example.com"
                className="h-9"
              />
            </div>
            <Button type="submit" disabled={searching} className="h-9 gap-2">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </form>

          {subjects !== null && subjects.length > 0 && (
            <div className="rounded-lg border divide-y">
              {subjects.map((s) => (
                <div
                  key={`${s.type}-${s.id}`}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {s.type === "homeowner" ? (
                        <Home className="h-3.5 w-3.5 text-[#b48c3c]" />
                      ) : (
                        <UserRound className="h-3.5 w-3.5 text-[#b48c3c]" />
                      )}
                      <span className="truncate">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.type === "homeowner" ? "Homeowner" : "Lead"}
                      </Badge>
                      {s.archived && (
                        <Badge variant="outline" className="text-[10px]">Archived</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {[s.email, s.phone].filter(Boolean).join(" · ") || "No contact details"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={busyId === s.id}
                      onClick={() => handleExport(s)}
                    >
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-amber-700 hover:text-amber-800"
                      disabled={busyId === s.id}
                      onClick={() => handleErase(s, "anonymize")}
                    >
                      <ShieldOff className="h-3.5 w-3.5" /> Erase
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-500 hover:text-red-600"
                      disabled={busyId === s.id}
                      onClick={() => handleErase(s, "delete")}
                    >
                      Delete all
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {subjects !== null && subjects.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No records matched. If the person isn&apos;t found, you hold no data about
              them — which is itself a valid response to an access request.
            </p>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
            <strong>Erase</strong> removes all identifying details and deletes message
            history, but keeps the non-identifying record so campaign and conversion
            totals stay accurate. <strong>Delete all</strong> destroys the record
            entirely. Opt-out status survives both, stored as a one-way hash, so an
            erased person is never contacted again by mistake.
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[#b48c3c]" /> Request History
          </CardTitle>
          <CardDescription className="text-xs">
            Your record of requests handled — the evidence an auditor asks for.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingLog ? (
            <div className="py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : log.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No data subject requests have been processed yet.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                  <th className="py-3 px-6">Action</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Handled by</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className="border-b dark:border-slate-800">
                    <td className="py-3 px-6">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          entry.action === "PRIVACY_DATA_ERASED"
                            ? "text-red-600 border-red-200"
                            : "text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {entry.action === "PRIVACY_DATA_ERASED"
                          ? `Erased${entry.metadata?.mode ? ` (${entry.metadata.mode})` : ""}`
                          : "Exported"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      {entry.metadata?.subjectType || entry.targetType} · {entry.targetId}
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      {entry.actorEmail || "—"}
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
