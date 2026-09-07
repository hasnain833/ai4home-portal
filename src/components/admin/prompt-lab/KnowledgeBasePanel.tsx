"use client";

/**
 * Knowledge Base management inside the Prompt Lab.
 *
 * Manages the PLATFORM tier: the shared documents every company's agent
 * retrieves. A single builder's own documents live on that company's own KB
 * screen, not here.
 *
 * The probe box runs retrieval with no model call, which is the fast loop for
 * tuning KB content: ask the question, see which passages come back and at what
 * score, adjust the document, reindex, ask again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Upload,
  Trash2,
  RefreshCw,
  Search,
  FileText,
  Globe,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type KbDocument = {
  id: string;
  name: string;
  size: string;
  category: string;
  status: string;
  scope: "PLATFORM" | "COMPANY";
  chunkCount: number;
  error: string | null;
  companyId: string | null;
  createdAt: string;
};

export type KbProbeResult = {
  documentId: string;
  name: string;
  category: string;
  scope: "PLATFORM" | "COMPANY";
  score: number;
  text: string;
};

type RetrievalStatus = {
  status: string;
  totalChunks?: number;
  embeddedChunks?: number;
  coverage?: number;
  detail?: string | null;
};

type Props = {
  agent: string;
};

/** Documents sit in PENDING/INDEXING until ingestion finishes, so the list polls. */
const POLL_MS = 4000;
const BUSY_STATUSES = new Set(["PENDING", "INDEXING"]);

/**
 * Ingestion runs in the server process, so restarting the server mid-document
 * strands it in INDEXING with nothing to move it along. There is no heartbeat to
 * detect that, so past this age we stop implying it is still working and point at
 * Reindex instead.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

function looksStalled(doc: KbDocument) {
  return (
    BUSY_STATUSES.has(doc.status) &&
    Date.now() - new Date(doc.createdAt).getTime() > STALE_AFTER_MS
  );
}

function statusTone(status: string) {
  if (status === "READY") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (status === "FAILED") return "bg-destructive/10 text-destructive";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
}

export default function KnowledgeBasePanel({ agent }: Props) {
  const confirm = useConfirm();
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("General");
  const [uploadQueue, setUploadQueue] = useState<{ done: number; total: number; current: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [probeText, setProbeText] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<KbProbeResult[] | null>(null);
  const [probeMethod, setProbeMethod] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/prompt-lab/kb?agent=${encodeURIComponent(agent)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to load");
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      setRetrieval(data.retrieval || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Poll only while something is mid-ingestion, then stop.
  useEffect(() => {
    if (!documents.some((d) => BUSY_STATUSES.has(d.status))) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [documents, load]);

  /** Uploads one file. Returns whether it was accepted, so a batch can report totals. */
  const uploadOne = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    body.append("agent", agent);
    body.append("category", uploadCategory);

    // The server stores the file, responds, and indexes afterwards, because
    // embedding a long document takes minutes. The list below polls for status.
    const res = await fetch("/api/admin/prompt-lab/kb/upload", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Upload failed");
    return data;
  };

  /**
   * Uploads a whole selection.
   *
   * Sequential rather than parallel: each upload kicks off a CPU-bound embedding
   * job on the server, and firing ten at once would contend for the same cores
   * and make every one of them slower.
   */
  const uploadMany = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadQueue({ done: 0, total: files.length, current: files[0].name });

    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setUploadQueue({ done: i, total: files.length, current: files[i].name });
      try {
        await uploadOne(files[i]);
      } catch (e) {
        failures.push(`${files[i].name}: ${e instanceof Error ? e.message : "failed"}`);
      }
      // Show each document as soon as its row exists.
      load();
    }

    const ok = files.length - failures.length;
    if (ok > 0) {
      toast.success(
        `${ok} document${ok === 1 ? "" : "s"} uploaded. Indexing now — long documents take a few minutes.`,
      );
    }
    for (const f of failures) toast.error(f);

    setUploadQueue(null);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = async (doc: KbDocument) => {
    const ok = await confirm({
      title: `Delete "${doc.name}"?`,
      description:
        "This removes it from the platform knowledge base along with its indexed chunks. Every company's agent stops retrieving it.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/prompt-lab/kb/${doc.id}?agent=${agent}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Delete failed");
      toast.success("Document deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const reindex = async (doc: KbDocument) => {
    try {
      const res = await fetch(`/api/admin/prompt-lab/kb/${doc.id}/reindex?agent=${agent}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Reindex failed");
      toast.success(`Reindexing ${doc.name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reindex failed");
    }
  };

  const probe = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = probeText.trim();
    if (!question) return;
    setProbing(true);
    try {
      const res = await fetch("/api/admin/prompt-lab/kb/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Retrieval test failed");
      setProbeResults(data.results || []);
      setProbeMethod(data.method || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retrieval test failed");
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Upload */}
      <div className="shrink-0 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-32 flex-1">
            <Label className="text-[11px] font-semibold text-muted-foreground">Category</Label>
            <Select value={uploadCategory} onValueChange={setUploadCategory}>
              <SelectTrigger className="mt-0.5 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(categories.length ? categories : ["General"]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.docx,.txt,.csv"
            onChange={(e) => uploadMany(Array.from(e.target.files || []))}
          />
          <Button
            className="h-9 gap-1.5"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploadQueue
              ? `Uploading ${uploadQueue.done + 1} of ${uploadQueue.total}…`
              : "Upload documents"}
          </Button>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) uploadMany(Array.from(e.dataTransfer.files || []));
          }}
          onClick={() => !uploading && fileRef.current?.click()}
          className={`mt-2 cursor-pointer rounded-md border border-dashed px-3 py-4 text-center transition-colors ${
            dragging ? "border-[#b48c3c] bg-[#b48c3c]/10" : "border-border hover:bg-accent/40"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          {uploadQueue ? (
            <p className="text-[11px] text-muted-foreground">
              Uploading <strong>{uploadQueue.current}</strong> ({uploadQueue.done + 1} of{" "}
              {uploadQueue.total})
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Drag &amp; drop files here, or click to browse — several at once is fine.
              <br />
              PDF, DOCX, TXT, or CSV, up to 25MB each.
            </p>
          )}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Globe className="mt-px h-3 w-3 shrink-0" />
          Documents added here are retrieved by every company&apos;s agent, and stay until you
          delete them.
        </p>
      </div>

      {/* Retrieval health */}
      {retrieval && retrieval.status !== "SEMANTIC" && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Retrieval is <strong>{retrieval.status}</strong>
            {typeof retrieval.coverage === "number" && ` — ${retrieval.coverage}% of chunks embedded`}
            {retrieval.detail ? `. ${retrieval.detail}` : "."}{" "}
            {retrieval.status !== "EMPTY" &&
              "Answers fall back to keyword matching until embeddings finish."}
          </span>
        </div>
      )}

      {/* Probe */}
      <form onSubmit={probe} className="flex shrink-0 gap-2">
        <Input
          value={probeText}
          onChange={(e) => setProbeText(e.target.value)}
          placeholder="Test retrieval — e.g. &quot;my AC isn't cooling&quot;"
          className="h-9"
        />
        <Button type="submit" variant="outline" size="sm" className="h-9 gap-1.5" disabled={probing}>
          {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Test
        </Button>
      </form>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {/* Probe results */}
        {probeResults && (
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold">
                Retrieved {probeResults.length} passage{probeResults.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                {probeMethod && (
                  <Badge variant="secondary" className="text-[10px]">
                    {probeMethod}
                  </Badge>
                )}
                <button
                  className="text-[11px] text-muted-foreground hover:underline"
                  onClick={() => setProbeResults(null)}
                >
                  Clear
                </button>
              </div>
            </div>
            {probeResults.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Nothing matched. The agent would answer this with no source material — which is
                what the no-KB fallback text is for.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {probeResults.map((r, i) => (
                  <li key={`${r.documentId}-${i}`} className="px-3 py-2">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium">{r.name || "Untitled"}</span>
                      <span className="text-[10px] text-muted-foreground">{r.category}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {r.score.toFixed(3)}
                      </span>
                    </div>
                    <p className="line-clamp-4 text-[11px] leading-relaxed text-muted-foreground">
                      {r.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Documents */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DocGroup
            title="Platform knowledge base"
            subtitle="Every company's agent retrieves these"
            icon={<Globe className="h-3.5 w-3.5" />}
            docs={documents}
            onDelete={remove}
            onReindex={reindex}
          />
        )}
      </div>
    </div>
  );
}

function DocGroup({
  title,
  subtitle,
  icon,
  docs,
  onDelete,
  onReindex,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  docs: KbDocument[];
  onDelete: (d: KbDocument) => void;
  onReindex: (d: KbDocument) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {icon}
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{docs.length}</span>
      </div>
      {docs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] text-muted-foreground">
          No documents yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{d.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {d.size} · {d.category}
                  {d.status === "READY" && ` · ${d.chunkCount} chunks`}
                  {BUSY_STATUSES.has(d.status) &&
                    !looksStalled(d) &&
                    " · extracting and embedding, this can take a few minutes"}
                  {looksStalled(d) &&
                    " · no progress for a while — the server may have restarted mid-index. Try Reindex."}
                  {d.error && ` · ${d.error}`}
                </p>
              </div>
              <Badge className={`text-[10px] font-normal ${statusTone(d.status)}`}>
                {d.status === "INDEXING" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
                {d.status}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Reindex"
                onClick={() => onReindex(d)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                title="Delete"
                onClick={() => onDelete(d)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
