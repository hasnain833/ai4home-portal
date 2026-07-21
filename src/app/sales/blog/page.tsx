"use client";

import { useState, useEffect, useCallback } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Pencil,
  Sparkles,
  Search,
  Plus,
  Trash2,
  Calendar,
  Globe,
  BookOpen,
  FileText,
  Clock,
  Download,
  Check,
  CheckCircle2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

type BlogStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "SCHEDULED" | "PUBLISHED";

interface BlogPost {
  id: string;
  title: string;
  excerpt?: string | null;
  content: string;
  category: string;
  tags: string[];
  status: BlogStatus;
  aiAssisted: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  headings?: string[];
  citations?: { title: string; url: string }[] | null;
  kbCitations?: { documentId: string | null; name: string; category: string }[] | null;
  approvedAt?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  slug?: string | null;
  readTime?: string;
  authorId?: string | null;
  updatedAt?: string;
}

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  originalUrl: string;
}

const STATUS_STYLES: Record<BlogStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  PENDING_REVIEW: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400",
  APPROVED: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400",
  SCHEDULED: "bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400",
  PUBLISHED: "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400",
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`/api/sales/blog${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = "Request failed";
    try {
      msg = (await res.json())?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export default function BlogDraftingPage() {
  const confirm = useConfirm();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorExcerpt, setEditorExcerpt] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorCategory, setEditorCategory] = useState("Market Trends");
  const [editorTags, setEditorTags] = useState("");
  const [editorMetaTitle, setEditorMetaTitle] = useState("");
  const [editorMetaDesc, setEditorMetaDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // AI modal state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiTone, setAiTone] = useState("professional");
  const [aiKeywords, setAiKeywords] = useState("");
  const [aiAudience, setAiAudience] = useState("prospective homebuyers");
  const [aiLength, setAiLength] = useState("800-1000 words");
  const [generating, setGenerating] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selectedNewsIds, setSelectedNewsIds] = useState<string[]>([]);

  // Schedule modal
  const [scheduleFor, setScheduleFor] = useState<BlogPost | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");

  // Note: no synchronous setState here (loading starts true) so this is safe to
  // call directly from an effect without triggering cascading renders.
  const fetchPosts = useCallback(async () => {
    try {
      const data = await api("");
      setPosts(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const openAiModal = async () => {
    setAiModalOpen(true);
    setSelectedNewsIds([]);
    try {
      const res = await fetch("/api/sales/news?limit=8");
      if (res.ok) {
        const json = await res.json();
        setNews((json.data || []).map((n: any) => ({ id: n.id, title: n.title, summary: n.summary, originalUrl: n.originalUrl })));
      }
    } catch {}
  };

  const handleGenerate = async () => {
    if (!aiTopic.trim()) return toast.error("Enter a topic prompt.");
    try {
      setGenerating(true);
      const post: BlogPost = await api("/generate", {
        method: "POST",
        body: JSON.stringify({
          topic: aiTopic,
          tone: aiTone,
          keywords: aiKeywords ? aiKeywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
          targetAudience: aiAudience,
          targetLength: aiLength,
          newsIds: selectedNewsIds,
        }),
      });
      toast.success("AI draft generated.");
      setAiModalOpen(false);
      setAiTopic("");
      setAiKeywords("");
      await fetchPosts();
      openEditor(post);
    } catch (e: any) {
      toast.error(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const openEditor = (post?: BlogPost) => {
    setSelectedPost(post || null);
    setEditorTitle(post?.title || "");
    setEditorExcerpt(post?.excerpt || "");
    setEditorContent(post?.content || "");
    setEditorCategory(post?.category || "Market Trends");
    setEditorTags((post?.tags || []).join(", "));
    setEditorMetaTitle(post?.metaTitle || "");
    setEditorMetaDesc(post?.metaDescription || "");
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!editorTitle.trim()) return toast.error("Title is required.");
    const body = JSON.stringify({
      title: editorTitle,
      excerpt: editorExcerpt,
      content: editorContent,
      category: editorCategory,
      tags: editorTags.split(",").map((t) => t.trim()).filter(Boolean),
      metaTitle: editorMetaTitle,
      metaDescription: editorMetaDesc,
    });
    try {
      setSaving(true);
      if (selectedPost) {
        await api(`/${selectedPost.id}`, { method: "PATCH", body });
        toast.success("Post updated.");
      } else {
        await api("", { method: "POST", body });
        toast.success("Post created.");
      }
      setEditorOpen(false);
      await fetchPosts();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    try {
      setBusyId(id);
      await fn();
    } catch (e: any) {
      toast.error(e.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (post: BlogPost) => {
    if (
      await confirm({ title: "Delete blog post?", description: "This can't be undone.", confirmText: "Delete" })
    ) {
      await withBusy(post.id, async () => {
        await api(`/${post.id}`, { method: "DELETE" });
        toast.success("Deleted.");
        await fetchPosts();
      });
    }
  };

  const handleApprove = (post: BlogPost) =>
    withBusy(post.id, async () => {
      await api(`/${post.id}/approve`, { method: "POST" });
      toast.success("Approved — ready to publish, export, or schedule.");
      await fetchPosts();
    });

  const handlePublish = (post: BlogPost) =>
    withBusy(post.id, async () => {
      await api(`/${post.id}/publish`, { method: "POST" });
      toast.success("Published to your hosted blog.");
      await fetchPosts();
    });

  const handleExport = (post: BlogPost, format: "md" | "html") =>
    withBusy(post.id, async () => {
      const res = await fetch(`/api/sales/blog/${post.id}/export?format=${format}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${post.slug || post.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  const submitSchedule = async () => {
    if (!scheduleFor) return;
    if (!scheduleDate) return toast.error("Pick a date.");
    await withBusy(scheduleFor.id, async () => {
      await api(`/${scheduleFor.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt: new Date(scheduleDate).toISOString() }),
      });
      toast.success("Scheduled and added to the content calendar.");
      setScheduleFor(null);
      setScheduleDate("");
      await fetchPosts();
    });
  };

  const filtered = posts.filter((post) => {
    const s = searchTerm.toLowerCase();
    const matches =
      post.title.toLowerCase().includes(s) ||
      (post.excerpt || "").toLowerCase().includes(s) ||
      post.tags.some((t) => t.toLowerCase().includes(s));
    if (activeTab === "all") return matches;
    return matches && post.status === activeTab.toUpperCase();
  });

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-6 max-w-7xl mx-auto">
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                AI Blog Post Builder
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Draft builder blogs with AI grounded in your brand voice, knowledge base, and market news — then approve, publish, or schedule.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={openAiModal} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 border-none">
                <Sparkles className="h-4 w-4" /> AI Draft Assistant
              </Button>
              <Button onClick={() => openEditor()} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90 gap-2 h-9">
                <Plus className="h-4 w-4" /> New Blog Post
              </Button>
            </div>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border border-border/80 shadow-xs">
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                    <TabsList className="bg-slate-100/80 dark:bg-slate-900 grid grid-cols-5 h-9 p-1 rounded-lg">
                      <TabsTrigger value="all" className="text-xs rounded-md">All</TabsTrigger>
                      <TabsTrigger value="draft" className="text-xs rounded-md">Drafts</TabsTrigger>
                      <TabsTrigger value="approved" className="text-xs rounded-md">Approved</TabsTrigger>
                      <TabsTrigger value="scheduled" className="text-xs rounded-md">Scheduled</TabsTrigger>
                      <TabsTrigger value="published" className="text-xs rounded-md">Published</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="relative w-full sm:w-60">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search posts or tags..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9 text-xs" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {loading ? (
                  <div className="text-center py-16 text-muted-foreground text-sm">Loading posts…</div>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {filtered.length > 0 ? (
                      <div className="space-y-4">
                        {filtered.map((post) => (
                          <motion.div
                            key={post.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="p-4 border border-border/60 hover:border-border rounded-xl bg-white dark:bg-slate-900/30 flex flex-col md:flex-row justify-between gap-4 transition-all"
                          >
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge className={`text-[9px] font-semibold tracking-tight px-2 py-0.5 border-none rounded-md ${STATUS_STYLES[post.status]}`}>
                                  {post.status.replace("_", " ")}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{post.category}</Badge>
                                {post.aiAssisted && (
                                  <Badge className="bg-[#b48c3c]/10 text-[#b48c3c] border-none text-[9px] gap-1 px-1.5 py-0">
                                    <Sparkles className="h-2.5 w-2.5" /> AI Draft
                                  </Badge>
                                )}
                              </div>
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 hover:text-[#b48c3c] transition cursor-pointer" onClick={() => openEditor(post)}>
                                {post.title}
                              </h3>
                              <p className="text-xs text-muted-foreground leading-relaxed">{post.excerpt}</p>
                              <div className="flex gap-1.5 pt-1.5 flex-wrap">
                                {post.tags.map((t, i) => (
                                  <span key={i} className="text-[9px] bg-slate-50 dark:bg-slate-800/40 text-slate-500 font-mono px-2 py-0.5 rounded-md border border-slate-100 dark:border-slate-800">#{t}</span>
                                ))}
                              </div>
                              {Array.isArray(post.citations) && post.citations.length > 0 && (
                                <p className="text-[10px] text-muted-foreground pt-1">
                                  <Globe className="h-3 w-3 inline mr-1" />{post.citations.length} source citation{post.citations.length > 1 ? "s" : ""}
                                </p>
                              )}
                              {Array.isArray(post.kbCitations) && post.kbCitations.length > 0 && (
                                <p className="text-[10px] text-muted-foreground pt-1" title={post.kbCitations.map((c) => c.name).join(", ")}>
                                  <BookOpen className="h-3 w-3 inline mr-1" />{post.kbCitations.length} KB document{post.kbCitations.length > 1 ? "s" : ""} referenced
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col justify-between items-start md:items-end gap-3 md:min-w-52 border-t md:border-t-0 pt-3 md:pt-0 border-dashed border-border/80">
                              <div className="text-[10px] text-muted-foreground space-y-1 md:text-right">
                                <p className="flex items-center gap-1 md:justify-end"><Clock className="h-3 w-3" /> {post.readTime}</p>
                                <p className="flex items-center gap-1 md:justify-end">
                                  <Calendar className="h-3 w-3" />
                                  {post.publishedAt ? `Published ${new Date(post.publishedAt).toLocaleDateString()}`
                                    : post.scheduledAt ? `Scheduled ${new Date(post.scheduledAt).toLocaleDateString()}`
                                    : "Not scheduled"}
                                </p>
                              </div>

                              <div className="flex gap-1 flex-wrap md:justify-end">
                                {(post.status === "DRAFT" || post.status === "PENDING_REVIEW") && (
                                  <Button variant="ghost" size="sm" disabled={busyId === post.id} className="h-7 px-2 text-blue-600 hover:bg-blue-500/10 text-[11px]" onClick={() => handleApprove(post)} title="Approve (required before publishing)">
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                                  </Button>
                                )}
                                {(post.status === "APPROVED" || post.status === "SCHEDULED") && (
                                  <Button variant="ghost" size="sm" disabled={busyId === post.id} className="h-7 px-2 text-green-600 hover:bg-green-500/10 text-[11px]" onClick={() => handlePublish(post)} title="Publish to hosted blog">
                                    <Send className="h-3.5 w-3.5 mr-1" /> Publish
                                  </Button>
                                )}
                                {post.approvedAt && post.status !== "PUBLISHED" && (
                                  <Button variant="ghost" size="sm" disabled={busyId === post.id} className="h-7 px-2 text-purple-600 hover:bg-purple-500/10 text-[11px]" onClick={() => { setScheduleFor(post); setScheduleDate(""); }} title="Schedule on the content calendar">
                                    <Calendar className="h-3.5 w-3.5 mr-1" /> Schedule
                                  </Button>
                                )}
                                {post.approvedAt && (
                                  <>
                                    <Button variant="ghost" size="icon" disabled={busyId === post.id} className="h-7 w-7 text-slate-500 hover:bg-slate-500/10" onClick={() => handleExport(post, "md")} title="Export Markdown">
                                      <Download className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" disabled={busyId === post.id} className="h-7 w-7 text-slate-500 hover:bg-slate-500/10" onClick={() => handleExport(post, "html")} title="Export HTML">
                                      <FileText className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-[#b48c3c] hover:bg-[#b48c3c]/10" onClick={() => openEditor(post)} title="Edit">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" disabled={busyId === post.id} className="h-7 w-7 text-red-500 hover:bg-red-500/10" onClick={() => handleDelete(post)} title="Delete">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl p-8">
                        <FileText className="h-12 w-12 mx-auto opacity-20 text-[#b48c3c] mb-2" />
                        <p className="font-semibold text-sm">No blog posts yet.</p>
                        <p className="text-xs mt-1 text-slate-400">Use the AI Draft Assistant to generate one grounded in your brand voice and market news.</p>
                      </div>
                    )}
                  </AnimatePresence>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* AI Draft modal */}
        <Dialog open={aiModalOpen} onOpenChange={setAiModalOpen}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-[#b48c3c]" /> AI Draft Assistant</DialogTitle>
              <DialogDescription>Claude drafts a post grounded in your brand voice, knowledge base, and any market news you pick as sources.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Topic Prompt *</Label>
                <Input placeholder="e.g. How rising rates affect first-time buyers in our communities" value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} disabled={generating} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Tone</Label>
                  <Select value={aiTone} onValueChange={setAiTone} disabled={generating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional & Direct</SelectItem>
                      <SelectItem value="friendly">Informative & Friendly</SelectItem>
                      <SelectItem value="bold">Bold & Marketing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Target Length</Label>
                  <Select value={aiLength} onValueChange={setAiLength} disabled={generating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="500-700 words">Short (500-700)</SelectItem>
                      <SelectItem value="800-1000 words">Medium (800-1000)</SelectItem>
                      <SelectItem value="1200-1500 words">Long (1200-1500)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Target Audience</Label>
                  <Input value={aiAudience} onChange={(e) => setAiAudience(e.target.value)} disabled={generating} />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Keywords</Label>
                  <Input placeholder="curb appeal, ROI" value={aiKeywords} onChange={(e) => setAiKeywords(e.target.value)} disabled={generating} />
                </div>
              </div>
              {news.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Cite market news (optional)</Label>
                  <div className="max-h-36 overflow-y-auto border rounded-lg divide-y">
                    {news.map((n) => {
                      const checked = selectedNewsIds.includes(n.id);
                      return (
                        <label key={n.id} className="flex items-start gap-2 p-2 text-[11px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            disabled={generating}
                            onChange={(e) => setSelectedNewsIds((prev) => (e.target.checked ? [...prev, n.id] : prev.filter((id) => id !== n.id)))}
                          />
                          <span className="line-clamp-2">{n.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {generating && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border rounded-xl flex items-center justify-center gap-3">
                  <Sparkles className="h-5 w-5 text-[#b48c3c] animate-pulse" />
                  <span className="text-xs font-semibold">Claude is writing your draft…</span>
                </div>
              )}
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setAiModalOpen(false)} disabled={generating}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={generating} className="bg-[#b48c3c] text-white">Generate Draft</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Editor modal */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto pr-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-[#0F3B3D]" /> {selectedPost ? "Edit Post" : "Create New Blog Post"}</DialogTitle>
              <DialogDescription>
                Markdown is supported in the body. {selectedPost && ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(selectedPost.status) ? "Editing content will send this post back to review." : "Drafts must be approved before publishing or export."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Title *</Label>
                <Input value={editorTitle} onChange={(e) => setEditorTitle(e.target.value)} placeholder="Enter a catching title..." />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Excerpt / Subtitle</Label>
                <Input value={editorExcerpt} onChange={(e) => setEditorExcerpt(e.target.value)} placeholder="Short summary for cards & SEO" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Category</Label>
                  <Select value={editorCategory} onValueChange={setEditorCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Home Design">Home Design</SelectItem>
                      <SelectItem value="Finance">Finance</SelectItem>
                      <SelectItem value="Warranty & Support">Warranty & Support</SelectItem>
                      <SelectItem value="Market Trends">Market Trends</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">Tags (comma-separated)</Label>
                  <Input value={editorTags} onChange={(e) => setEditorTags(e.target.value)} placeholder="ROI, energy, DIY" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">SEO Meta Title</Label>
                  <Input value={editorMetaTitle} onChange={(e) => setEditorMetaTitle(e.target.value)} placeholder="≤ 60 chars" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold text-xs">SEO Meta Description</Label>
                  <Input value={editorMetaDesc} onChange={(e) => setEditorMetaDesc(e.target.value)} placeholder="≤ 160 chars" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Body (Markdown)</Label>
                <Textarea rows={12} className="border focus-visible:ring-1 focus-visible:ring-[#b48c3c] text-xs font-mono" placeholder="## Start drafting in markdown..." value={editorContent} onChange={(e) => setEditorContent(e.target.value)} />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-[#0F3B3D] text-white gap-2">
                <Check className="h-4 w-4" /> {selectedPost ? "Save Changes" : "Save Post"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Schedule modal */}
        <Dialog open={!!scheduleFor} onOpenChange={(o) => !o && setScheduleFor(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Calendar className="h-5 w-5 text-purple-600" /> Schedule Post</DialogTitle>
              <DialogDescription>Adds this approved post to your content calendar as a Blog item.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 pt-2">
              <Label className="font-semibold text-xs">Publish date</Label>
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setScheduleFor(null)}>Cancel</Button>
              <Button onClick={submitSchedule} className="bg-purple-600 text-white">Schedule</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
