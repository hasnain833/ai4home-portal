"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

interface MappingSnapshot {
  salesforceField: string;
  portalField: string;
  description?: string | null;
  isActive?: boolean;
  isConsentField?: boolean;
}

interface MappingVersion {
  id: string;
  version: number;
  mappings: MappingSnapshot[];
  changeType: string;
  note: string | null;
  createdAt: string;
}

const CHANGE_STYLES: Record<string, string> = {
  SAVE: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400",
  DELETE: "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400",
  ROLLBACK:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400",
};

export default function MappingHistoryDialog({
  open,
  onOpenChange,
  onRolledBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRolledBack?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<MappingVersion[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/salesforce/mappings/versions", {
        credentials: "include",
      });
      if (res.ok) {
        setVersions(await res.json());
      } else {
        toast.error("Could not load mapping history.");
      }
    } catch (error) {
      console.error("Failed to fetch mapping versions:", error);
      toast.error("Could not load mapping history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      await fetchVersions();
    })();
  }, [open, fetchVersions]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setConfirming(null);
    onOpenChange(next);
  };

  const handleRollback = async (version: number) => {
    setRollingBack(version);
    try {
      const res = await fetch("/api/sales/salesforce/mappings/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || `Restored version ${version}.`);
        setConfirming(null);
        await fetchVersions();
        onRolledBack?.();
      } else {
        toast.error(data.message || "Rollback failed.");
      }
    } catch (error) {
      console.error("Rollback failed:", error);
      toast.error("Rollback failed.");
    } finally {
      setRollingBack(null);
    }
  };

  const currentVersion = versions[0]?.version;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-[#b48c3c]" />
            Field Mapping History
          </DialogTitle>
          <DialogDescription>
            Every mapping change is snapshotted. Restoring a version applies to
            subsequent syncs — a sync already running keeps the mappings it
            started with.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              No history yet. It starts recording from your first mapping
              change.
            </p>
          ) : (
            <div className="space-y-2 py-1">
              {versions.map((v) => {
                const isCurrent = v.version === currentVersion;
                const isOpen = expanded === v.id;
                const count = Array.isArray(v.mappings) ? v.mappings.length : 0;

                return (
                  <div
                    key={v.id}
                    className="border border-border/60 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : v.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-mono font-bold text-xs shrink-0">
                          v{v.version}
                        </span>
                        <Badge
                          className={`text-[9px] border-none shrink-0 ${
                            CHANGE_STYLES[v.changeType] ||
                            "bg-slate-100 text-slate-700"
                          }`}>
                          {v.changeType}
                        </Badge>
                        {isCurrent && (
                          <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 text-[9px] border-none shrink-0">
                            Current
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {v.note || "—"}
                        </span>
                      </button>

                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {new Date(v.createdAt).toLocaleString()}
                      </span>

                      {!isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={rollingBack !== null}
                          onClick={() =>
                            confirming === v.version
                              ? handleRollback(v.version)
                              : setConfirming(v.version)
                          }
                          onBlur={() =>
                            setConfirming((c) => (c === v.version ? null : c))
                          }
                          className={`h-7 text-[10px] gap-1.5 shrink-0 ${
                            confirming === v.version
                              ? "border-amber-400 text-amber-700 dark:text-amber-400"
                              : ""
                          }`}>
                          {rollingBack === v.version ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          {confirming === v.version ? "Confirm?" : "Restore"}
                        </Button>
                      )}
                    </div>

                    {isOpen && (
                      <div className="border-t border-border/50 bg-slate-50/60 dark:bg-slate-900/30 px-3 py-2">
                        {count === 0 ? (
                          <p className="text-[10px] text-muted-foreground py-1">
                            No mappings in this version.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[10px]">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="py-1 pr-3 font-semibold">
                                    Salesforce
                                  </th>
                                  <th className="py-1 pr-3 font-semibold">
                                    Portal
                                  </th>
                                  <th className="py-1 font-semibold">Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.mappings.map((m, i) => (
                                  <tr
                                    key={i}
                                    className="border-t border-border/30">
                                    <td className="py-1 pr-3 font-mono">
                                      {m.salesforceField}
                                    </td>
                                    <td className="py-1 pr-3 font-mono text-[#b48c3c]">
                                      {m.portalField}
                                    </td>
                                    <td className="py-1 text-muted-foreground">
                                      {m.isConsentField ? "Consent" : "Data"}
                                      {m.isActive === false && " · inactive"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
