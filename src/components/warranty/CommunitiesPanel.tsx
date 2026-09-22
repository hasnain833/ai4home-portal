"use client";

import { useRef, useState } from "react";
import { Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CommunityType = "UNIT_HOMES" | "SHARED_HOMES";

export interface CommunityInfo {
  id: string;
  name: string;
  type: CommunityType;
  color: string;
  homeCount: number;
  isFull: boolean;
}

export const COMMUNITY_TYPE_LABELS: Record<CommunityType, string> = {
  UNIT_HOMES: "Unit Homes",
  SHARED_HOMES: "Shared Homes",
};

const TYPE_KEYS = Object.keys(COMMUNITY_TYPE_LABELS) as CommunityType[];

/** Header name in the file -> field name the import endpoint expects. */
const COLUMN_ALIASES: Record<string, string> = {
  address: "address",
  propertyaddress: "address",
  city: "city",
  state: "state",
  zip: "zipCode",
  zipcode: "zipCode",
  units: "units",
  coedate: "coeDate",
  homeowneremail: "homeownerEmail",
  email: "homeownerEmail",
  community: "community",
  communityname: "community",
};

/**
 * A small CSV reader, quoted fields included. The files here are short lists of
 * homes — at most a few hundred rows — so this stays in the browser rather than
 * going through the async job pipeline the leads importer uses.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const splitLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };

  const headers = splitLine(lines[0]).map((h) => h.replace(/[\s_-]+/g, "").toLowerCase());

  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      const field = COLUMN_ALIASES[h];
      if (field) row[field] = cells[i] ?? "";
    });
    return row;
  });
}

/**
 * Communities live on the properties page rather than a page of their own,
 * because a community only matters as the thing a home belongs to. It also
 * carries the CSV import, since bulk upload is how a community gets filled.
 */
export function CommunitiesPanel({
  communities,
  maxHomes,
  onChanged,
  onImported,
  showToast,
}: {
  communities: CommunityInfo[];
  maxHomes: number;
  onChanged: () => void;
  onImported: () => void;
  showToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CommunityType>("UNIT_HOMES");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<{ line: number; message: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the community a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Could not create that community.");
        return;
      }
      setName("");
      setType("UNIT_HOMES");
      setAdding(false);
      onChanged();
      showToast("Community created.");
    } catch {
      setError("Server error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const changeType = async (id: string, next: CommunityType) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/communities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: next }),
      });
      if (res.ok) {
        onChanged();
        showToast("Community updated.");
      }
    } catch {
      showToast("Could not update that community.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (community: CommunityInfo) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/communities/${community.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.message || "Could not delete that community.");
        return;
      }
      onChanged();
      showToast("Community deleted.");
    } catch {
      showToast("Could not delete that community.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        showToast("That file has no rows.");
        return;
      }
      const res = await fetch("/api/properties/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportErrors(data.errors ?? []);
        showToast(data.message || "Import failed.");
        return;
      }
      showToast(`Imported ${data.created} home${data.created === 1 ? "" : "s"}.`);
      onImported();
    } catch {
      showToast("Could not read that file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const totalHomes = communities.reduce((n, c) => n + c.homeCount, 0);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/30 transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#0F3B3D]/10 text-[#0F3B3D] dark:text-[#a0c5c7]">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold">Communities</p>
            <p className="text-xs text-muted-foreground">
              {communities.length} communit{communities.length === 1 ? "y" : "ies"} ·{" "}
              {totalHomes} home{totalHomes === 1 ? "" : "s"} · max {maxHomes} per community
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[#b48c3c]">{open ? "Hide" : "Manage"}</span>
      </button>

      {open && (
        <CardContent className="border-t p-5 space-y-4">
          {communities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No communities yet. Every home belongs to one, so add the first below.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {communities.map((c) => (
                <div key={c.id} className="rounded-xl border border-border/70 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold text-sm min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <button
                      onClick={() => remove(c)}
                      disabled={busy || c.homeCount > 0}
                      title={
                        c.homeCount > 0
                          ? "Move its homes elsewhere before deleting"
                          : "Delete community"
                      }
                      className="text-muted-foreground/70 hover:text-rose-600 disabled:opacity-30 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <Select
                    value={c.type}
                    onValueChange={(v) => changeType(c.id, v as CommunityType)}
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
                    <p
                      className={`text-[11px] ${
                        c.isFull ? "text-rose-600 font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {c.homeCount} / {maxHomes} homes{c.isFull ? " — full" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="rounded-xl border border-dashed p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Trophy Club Estates"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as CommunityType)}>
                    <SelectTrigger className="h-9">
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
                </div>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdding(false);
                    setError("");
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={create} disabled={busy}>
                  Add community
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New community
              </Button>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={importing || communities.length === 0}
                title={
                  communities.length === 0 ? "Add a community first" : "Upload homes from a CSV"
                }
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Importing…
                  </>
                ) : (
                  "Upload homes CSV"
                )}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Columns: address, city, state, zipCode, coeDate, units, homeownerEmail, community
              </span>
            </div>
          )}

          {importErrors.length > 0 && (
            // The import is all-or-nothing, so this is a list to fix, not a
            // report of what got through.
            <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                Nothing was imported — fix these rows and try again:
              </p>
              <ul className="text-[11px] text-rose-700 dark:text-rose-400 space-y-0.5 max-h-40 overflow-y-auto">
                {importErrors.map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default CommunitiesPanel;
