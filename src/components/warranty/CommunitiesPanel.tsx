"use client";

import { useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CommunityType = "UNIT_HOMES" | "SHARED_HOMES";

export interface CommunityInfo {
  id: string;
  name: string;
  type: CommunityType;
  color: string;
  /** Sold (warranty) plus not-yet-sold sales homes — what the limit counts. */
  homeCount: number;
  propertyCount: number;
  /** Sales homes not marked SOLD. */
  salesHomeCount: number;
  kbCount: number;
  isFull: boolean;
}

export const COMMUNITY_TYPE_LABELS: Record<CommunityType, string> = {
  UNIT_HOMES: "Unit Homes",
  SHARED_HOMES: "Shared Homes",
};

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
 * The homes CSV import for the properties page header — bulk upload is how a
 * community gets its sold homes. Communities themselves are managed on the
 * Communities page, which both workspaces share.
 */
export function HomesCsvImport({
  disabled,
  onImported,
  showToast,
}: {
  disabled: boolean;
  onImported: () => void;
  showToast: (msg: string) => void;
}) {
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<{ line: number; message: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
      <Button
        variant="outline"
        onClick={() => fileRef.current?.click()}
        disabled={importing || disabled}
        className="gap-2 font-semibold self-start sm:self-auto"
        title={
          disabled
            ? "Add a community first"
            : "CSV columns: address, city, state, zipCode, coeDate, units, homeownerEmail, community"
        }
      >
        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        Upload homes CSV
      </Button>

      {/* The import is all-or-nothing, so this is a list to fix, not a report of what got through. */}
      <Dialog open={importErrors.length > 0} onOpenChange={(open) => !open && setImportErrors([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing was imported</DialogTitle>
            <DialogDescription>Fix these rows and upload the file again.</DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-rose-700 dark:text-rose-400 space-y-1 max-h-80 overflow-y-auto">
            {importErrors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
