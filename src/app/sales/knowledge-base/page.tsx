"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  UploadCloud,
  FileText,
  Trash2,
  Loader2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

type KbDoc = {
  id: string;
  name: string;
  size: string;
  category: string;
  status: "PENDING" | "INDEXING" | "READY" | "FAILED";
  chunkCount: number;
  error?: string | null;
  createdAt: string;
};

type Match = { documentId: string; name: string; category: string; text: string; score: number };

const CATEGORIES = [
  { value: "General", label: "General" },
  { value: "brand_voice", label: "Brand Voice" },
  { value: "community", label: "Community / Product" },
  { value: "pricing", label: "Pricing / Policy" },
  { value: "faq", label: "Sales FAQ" },
  { value: "compliance", label: "Compliance" },
];

const ACCEPTED = ".pdf,.docx,.txt,.md";
const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

const statusBadge: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  READY: {
    cls: "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400",
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Indexed",
  },
  INDEXING: {
    cls: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "Indexing",
  },
  PENDING: {
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    icon: <Clock className="h-3 w-3" />,
    label: "Queued",
  },
  FAILED: {
    cls: "bg-red-50 text-red-700 border-red-200/50 dark:bg-red-950/20 dark:text-red-400",
    icon: <AlertTriangle className="h-3 w-3" />,
    label: "Failed",
  },
};

function labelFor(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}

export default function SalesKnowledgeBasePage() {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("General");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Retrieval test (SW-KB-005)
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/kb");
      if (res.ok) setDocs(await res.json());
    } catch {
      // surfaced via toast on actions
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Auto-refresh while any document is still indexing so status flips to Indexed live.
  useEffect(() => {
    const inProgress = docs.some((d) => d.status === "PENDING" || d.status === "INDEXING");
    if (!inProgress) return;
    const t = setInterval(loadDocs, 4000);
    return () => clearInterval(t);
  }, [docs, loadDocs]);

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;

    for (const file of arr) {
      const isAllowed =
        ACCEPTED_MIME.includes(file.type) || /\.(pdf|docx|txt|md)$/i.test(file.name);
      if (!isAllowed) {
        toast.error(`Skipped ${file.name}: only PDF, DOCX, TXT, or MD are allowed`);
        fail++;
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`Skipped ${file.name}: file must be under 50MB`);
        fail++;
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", category);
        const res = await fetch("/api/sales/kb/upload", { method: "POST", body: fd });
        if (res.ok) ok++;
        else {
          const d = await res.json().catch(() => ({}));
          toast.error(`${file.name}: ${d.message || "upload failed"}`);
          fail++;
        }
      } catch {
        fail++;
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (ok > 0) toast.success(`Uploaded ${ok} document${ok === 1 ? "" : "s"} — indexing started.`);
    if (ok > 0) loadDocs();
    else if (fail > 0) toast.error("No documents were uploaded.");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const confirm = useConfirm();

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirm({
      title: "Remove from knowledge base?",
      description: `Remove "${name}"? It stops being used for AI retrieval.`,
      confirmText: "Remove",
    }))) return;
    try {
      const res = await fetch(`/api/sales/kb/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Document removed.");
        setDocs((prev) => prev.filter((d) => d.id !== id));
      } else {
        toast.error("Could not remove the document.");
      }
    } catch {
      toast.error("Network error.");
    }
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    setMatches(null);
    try {
      const res = await fetch("/api/sales/kb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: searchQuery, k: 5 }),
      });
      const data = await res.json();
      if (res.ok) {
        setMatches(data.matches || []);
        if ((data.matches || []).length === 0) toast.info("No matching passages found.");
      } else {
        toast.error(data.message || "Search unavailable (KB indexing keys may not be configured).");
      }
    } catch {
      toast.error("Network error while searching.");
    } finally {
      setSearching(false);
    }
  };

  const readyCount = docs.filter((d) => d.status === "READY").length;
  const totalChunks = docs.reduce((s, d) => s + (d.chunkCount || 0), 0);

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Sales Knowledge Base
              </h1>
              <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Upload brand, product & policy docs — indexed for the Sales AI features (RAG).
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadDocs} className="gap-2 h-9">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {/* Uploader */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-bold">Upload Documents</CardTitle>
              <CardDescription className="text-xs">
                PDF, DOCX, or TXT up to 50MB. Documents are chunked, embedded, and indexed automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                <div className="space-y-1.5 sm:w-64">
                  <Label className="font-semibold text-xs">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground sm:pb-2">
                  Tag documents so AI features can scope retrieval (e.g. the blog drafter uses Brand Voice; FAQs answer questions).
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 cursor-pointer transition ${
                  dragActive ? "border-[#b48c3c] bg-[#b48c3c]/5" : "border-border hover:border-[#b48c3c]/50"
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-7 w-7 text-[#b48c3c] animate-spin" />
                    <p className="text-sm font-medium">Uploading…</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-7 w-7 text-[#b48c3c]" />
                    <p className="text-sm font-medium">Drag & drop files here, or click to browse</p>
                    <p className="text-[11px] text-muted-foreground">PDF · DOCX · TXT · MD</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Document list */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold">
                Documents {docs.length > 0 && <span className="text-muted-foreground font-normal">· {readyCount}/{docs.length} indexed · {totalChunks} chunks</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="py-16 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : docs.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No documents yet. Upload your brand, product, and policy files to power the Sales AI.
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                      <th className="py-3 px-6">Document</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Size</th>
                      <th className="py-3 px-4">Uploaded</th>
                      <th className="py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => {
                      const b = statusBadge[d.status] || statusBadge.PENDING;
                      return (
                        <tr key={d.id} className="border-b dark:border-slate-800 hover:bg-slate-50/20 dark:hover:bg-slate-900/10 transition">
                          <td className="py-3.5 px-6 font-semibold flex items-center gap-2">
                            <FileText className="h-4 w-4 text-[#b48c3c] shrink-0" /> {d.name}
                          </td>
                          <td className="py-3.5 px-4 text-xs">
                            <Badge variant="outline" className="text-[10px]">{labelFor(d.category)}</Badge>
                          </td>
                          <td className="py-3.5 px-4">
                            <span title={d.status === "FAILED" && d.error ? d.error : undefined} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
                              {b.icon}
                              {b.label}{d.status === "READY" ? ` · ${d.chunkCount}` : ""}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-muted-foreground">{d.size}</td>
                          <td className="py-3.5 px-4 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</td>
                          <td className="py-3.5 px-4">
                            <Button variant="ghost" size="sm" className="h-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(d.id, d.name)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Retrieval test (SW-KB-005) */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2"><Search className="h-4 w-4 text-[#b48c3c]" /> Test Retrieval</CardTitle>
              <CardDescription className="text-xs">Ask a question to see which indexed passages the AI would retrieve and cite.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <form onSubmit={runSearch} className="flex gap-2">
                <Input
                  placeholder="e.g. What financing options are available?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button type="submit" disabled={searching} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 shrink-0">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                </Button>
              </form>

              {matches && matches.length > 0 && (
                <div className="space-y-3">
                  {matches.map((m, i) => (
                    <div key={i} className="rounded-lg border p-3 bg-slate-50/40 dark:bg-slate-900/20">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] font-semibold flex items-center gap-1.5">
                          <FileText className="h-3 w-3 text-[#b48c3c]" /> {m.name || "Document"}
                          <Badge variant="outline" className="text-[9px]">{labelFor(m.category)}</Badge>
                        </span>
                        <span className="text-[10px] text-muted-foreground">score {m.score?.toFixed(3)}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3">{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
