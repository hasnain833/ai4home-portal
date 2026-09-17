"use client";

/**
 * Knowledge Base management inside the Prompt Lab.
 *
 * Manages the PLATFORM tier: the shared documents every company's agent
 * retrieves. A single builder's own documents live on that company's own KB
 * screen, not here — except the community under test, which is listed read-only
 * so community-scoped retrieval can be seen working.
 *
 * The probe box runs retrieval with no model call, which is the fast loop for
 * tuning KB content: ask the question, see which passages come back and at what
 * score, adjust the document, reindex, ask again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  ExternalLink,
  Home,
  FlaskConical,
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
  hasFile: boolean;
  /** Uploaded from this lab for testing; never retrieved by the live agent. */
  isSandbox?: boolean;
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

export type KbCommunity = {
  id: string;
  name: string;
  color: string;
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
  /**
   * Community being tested against, or "platform" for the shared default.
   *
   * Owned by the page rather than this panel because the test conversation
   * grounds on the same choice — a community picked here that the chat ignored
   * would be worse than no picker at all.
   */
  communityId?: string;
  onCommunityChange?: (id: string, name: string | null) => void;
};

const PLATFORM = "platform";

const POLL_MS = 4000;
const BUSY_STATUSES = new Set(["PENDING", "INDEXING"]);
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

export default function KnowledgeBasePanel({
  agent,
  communityId = PLATFORM,
  onCommunityChange,
}: Props) {
  const confirm = useConfirm();
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [communityDocs, setCommunityDocs] = useState<KbDocument[]>([]);
  const [communities, setCommunities] = useState<KbCommunity[]>([]);
  const [supportsCommunities, setSupportsCommunities] = useState(false);
  const [testCompany, setTestCompany] = useState<{ id: string; name: string } | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ done: number; total: number; current: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [probeText, setProbeText] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<KbProbeResult[] | null>(null);
  const [probeMethod, setProbeMethod] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/prompt-lab/kb?agent=${encodeURIComponent(agent)}` +
          `&communityId=${encodeURIComponent(communityId)}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to load");
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setCommunityDocs(Array.isArray(data.communityDocuments) ? data.communityDocuments : []);
      setCommunities(Array.isArray(data.communities) ? data.communities : []);
      setSupportsCommunities(Boolean(data.supportsCommunities));
      setTestCompany(data.testCompany || null);
      setRetrieval(data.retrieval || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [agent, communityId]);

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

  const uploadOne = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    body.append("agent", agent);
    // Uploading while a community is selected files the document against that
    // community as a sandbox document, rather than into the platform tier.
    body.append("communityId", communityId);
    const res = await fetch("/api/admin/prompt-lab/kb/upload", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Upload failed");
    return data;
  };

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

  const openDocument = async (doc: KbDocument) => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const res = await fetch(
        `/api/admin/prompt-lab/kb/${doc.id}/url?agent=${encodeURIComponent(agent)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.message || "Could not open that document.");
      }
      // A blocked popup leaves nothing to navigate; fall back to this tab.
      if (tab) tab.location.replace(data.url);
      else window.location.assign(data.url);
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : "Could not open that document.");
    }
  };

  const communityName = communities.find((c) => c.id === communityId)?.name || null;

  const probe = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = probeText.trim();
    if (!question) return;
    setProbing(true);
    try {
      const res = await fetch("/api/admin/prompt-lab/kb/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, question, communityId }),
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
      {/* Community under test */}
      {supportsCommunities && (
        <div className="shrink-0 rounded-lg border border-border bg-muted/30 p-3">
          <Label className="text-[11px] font-semibold text-muted-foreground">
            Test as a homeowner in
          </Label>
          <Select
            value={communityId}
            onValueChange={(v) =>
              onCommunityChange?.(v, communities.find((c) => c.id === v)?.name || null)
            }
            disabled={!onCommunityChange}
          >
            <SelectTrigger className="mt-0.5 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PLATFORM}>Platform (no community)</SelectItem>
              {communities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            {communityId === PLATFORM ? (
              <>
                <Globe className="mt-px h-3 w-3 shrink-0" />
                Platform documents are the default — every tenant&apos;s agent retrieves these, and
                nothing else is in play.
              </>
            ) : (
              <>
                <Home className="mt-px h-3 w-3 shrink-0" />
                Retrieval returns the platform documents <strong>plus</strong>
                {testCompany ? ` ${testCompany.name}'s` : " this tenant's"} documents filed under
                this community — exactly what a homeowner there would be answered from.
              </>
            )}
          </p>
          {communities.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {testCompany
                ? `${testCompany.name} has no communities yet.`
                : "No company exists to test communities against."}
            </p>
          )}
        </div>
      )}

      {/* Upload */}
      <div className="shrink-0 rounded-lg border border-border bg-muted/30 p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.xlsx,.txt,.csv"
          onChange={(e) => uploadMany(Array.from(e.target.files || []))}
        />
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
          className={`cursor-pointer rounded-md border border-dashed px-3 py-5 text-center transition-colors ${
            dragging ? "border-[#b48c3c] bg-[#b48c3c]/10" : "border-border hover:bg-accent/40"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          {uploadQueue ? (
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading <strong>{uploadQueue.current}</strong> ({uploadQueue.done + 1} of{" "}
              {uploadQueue.total})
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground">
                <Upload className="h-3.5 w-3.5" />
                Drag &amp; drop files here, or click to browse
              </span>
              <span className="mt-1 block">
                Several at once is fine. PDF, DOCX, XLSX, TXT, or CSV, up to 25MB each.
              </span>
              {supportsCommunities && communityId !== PLATFORM && (
                <span className="mt-1.5 flex items-center justify-center gap-1.5 font-medium text-[#b48c3c]">
                  <FlaskConical className="h-3 w-3" />
                  Uploads go to {communityName || "this community"} as test documents
                </span>
              )}
            </p>
          )}
        </div>
        {supportsCommunities && communityId !== PLATFORM ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <FlaskConical className="mt-px h-3 w-3 shrink-0" />
            Test documents. They are retrieved here and in the Test Sandbox so you can check
            community-scoped answers, and <strong>never by the live agent</strong> — no real
            homeowner will ever be answered from them.
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Globe className="mt-px h-3 w-3 shrink-0" />
            Documents added here are retrieved by every company&apos;s agent, and stay until you
            delete them.
          </p>
        )}
      </div>

      {/* Retrieval health */}
      {retrieval && retrieval.status !== "SEMANTIC" && (
        <div className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Retrieval is <strong>{retrieval.status}</strong>
              {retrieval.detail ? `. ${retrieval.detail}` : "."}{" "}
              {retrieval.status !== "EMPTY" &&
                "Answers fall back to keyword matching until embeddings finish."}
            </span>
          </div>
          {typeof retrieval.coverage === "number" && (retrieval.totalChunks || 0) > 0 && (
            <div className="mt-1.5 flex items-center gap-2 pl-5.5">
              <div
                role="progressbar"
                aria-label="Chunks embedded"
                aria-valuenow={retrieval.coverage}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/60"
              >
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-500 ease-out dark:bg-amber-400"
                  // A sliver of fill so "started" never renders as "nothing yet".
                  style={{
                    width: retrieval.coverage > 0 ? `${Math.max(2, Math.min(100, retrieval.coverage))}%` : 0,
                  }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-[10px] text-amber-800/80 dark:text-amber-200/70">
                {(retrieval.embeddedChunks ?? 0).toLocaleString()} /{" "}
                {(retrieval.totalChunks ?? 0).toLocaleString()} chunks
              </span>
            </div>
          )}
        </div>
      )}

      {/* Probe */}
      <form onSubmit={probe} className="flex shrink-0 gap-2">
        <Input
          value={probeText}
          onChange={(e) => setProbeText(e.target.value)}
          placeholder="Test retrieval — e.g. &quot;my AC isn&apos;t cooling&quot;"
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
                      {supportsCommunities && (
                        <Badge variant="secondary" className="text-[9px] font-normal">
                          {r.scope === "PLATFORM" ? "Platform" : "Community"}
                        </Badge>
                      )}
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
          <>
            <DocGroup
              title="Platform knowledge base"
              subtitle="Every company's agent retrieves these"
              icon={<Globe className="h-3.5 w-3.5" />}
              docs={documents}
              onOpen={openDocument}
              onDelete={remove}
              onReindex={reindex}
            />
            {/*
              The tenant's own documents for the community under test. Read-only
              on purpose: the lab owns the platform tier, and a super-admin
              deleting a builder's document from a testing screen would be a
              surprise nobody asked for. They are listed because a probe that
              returns nothing is otherwise ambiguous — empty community, or bad
              question?
            */}
            {supportsCommunities && communityId !== PLATFORM && (
              <DocGroup
                title={`${communityName || "Community"} documents`}
                subtitle={`Test uploads, plus ${testCompany?.name || "the tenant"}'s own (read-only)`}
                icon={<Home className="h-3.5 w-3.5" />}
                docs={communityDocs}
                onOpen={openDocument}
                // Only the lab's own test documents can be changed from here;
                // DocGroup hides the controls per row on the same rule the
                // server enforces.
                onDelete={remove}
                onReindex={reindex}
                mutableOnly="sandbox"
              />
            )}
          </>
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
  onOpen,
  onDelete,
  onReindex,
  mutableOnly,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  docs: KbDocument[];
  onOpen: (d: KbDocument) => void;
  /** Omitted for groups the lab shows but does not own. */
  onDelete?: (d: KbDocument) => void;
  onReindex?: (d: KbDocument) => void;
  /** "sandbox" limits the controls to the lab's own test documents. */
  mutableOnly?: "sandbox";
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
          {docs.map((d) => {
            const mutable = mutableOnly === "sandbox" ? Boolean(d.isSandbox) : true;
            return (
            <li
              key={d.id}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                d.isSandbox ? "border-[#b48c3c]/40 bg-[#b48c3c]/5" : "border-border"
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {d.hasFile ? (
                  <button
                    type="button"
                    onClick={() => onOpen(d)}
                    title={`Open ${d.name}`}
                    className="block max-w-full truncate text-left text-xs font-medium hover:underline"
                  >
                    {d.name}
                  </button>
                ) : (
                  <p className="truncate text-xs font-medium">{d.name}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {d.size}
                  {d.status === "READY" && ` · ${d.chunkCount} chunks`}
                  {BUSY_STATUSES.has(d.status) &&
                    !looksStalled(d) &&
                    " · extracting and embedding, this can take a few minutes"}
                  {looksStalled(d) &&
                    " · no progress for a while — the server may have restarted mid-index. Try Reindex."}
                  {d.error && ` · ${d.error}`}
                </p>
              </div>
              {d.isSandbox && (
                <Badge
                  variant="outline"
                  className="gap-1 border-[#b48c3c]/50 text-[9px] font-medium text-[#b48c3c]"
                  title="Test document — the live agent never retrieves this"
                >
                  <FlaskConical className="h-2.5 w-2.5" />
                  TEST
                </Badge>
              )}
              <Badge className={`text-[10px] font-normal ${statusTone(d.status)}`}>
                {d.status === "INDEXING" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
                {d.status}
              </Badge>
              {d.hasFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Open document"
                  onClick={() => onOpen(d)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              {onReindex && mutable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Reindex"
                  onClick={() => onReindex(d)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDelete && mutable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  title="Delete"
                  onClick={() => onDelete(d)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
