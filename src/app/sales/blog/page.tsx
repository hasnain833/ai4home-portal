"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  FileText,
  Clock,
  Eye,
  ArrowRight,
  TrendingUp,
  Download,
  Check,
  ChevronRight,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishDate?: string;
  readTime: string;
  category: string;
  tags: string[];
  aiAssisted: boolean;
  author: string;
}

// No seeded posts — the blog drafting backend (SW-BLOG) is not built yet, so this
// list starts empty rather than showing fabricated articles.
const initialPosts: BlogPost[] = [];

const aiTopicIdeas = [
  {
    title: "Is Landscaping the Highest ROI Improvement for New Builds?",
    category: "Home Design",
    difficulty: "Medium",
    keywords: ["curb appeal", "ROI", "drought-tolerant", "pavers"]
  },
  {
    title: "Why Multi-Generational Suites Are the Fastest Growing Segment",
    category: "Market Trends",
    difficulty: "Long Form",
    keywords: ["ADU", "dual primary suite", "rental income", "accessibility"]
  },
  {
    title: "The Homeowner's Guide to Preparing for the First Heavy Freeze",
    category: "Maintenance",
    difficulty: "Short & Punchy",
    keywords: ["pipe insulation", "sprinkler blowout", "draft blockers"]
  }
];

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

export default function BlogDraftingPage() {
  const [posts, setPosts] = useState<BlogPost[]>(initialPosts);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  
  // Editor State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorExcerpt, setEditorExcerpt] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorCategory, setEditorCategory] = useState("Market Trends");
  const [editorStatus, setEditorStatus] = useState<"DRAFT" | "SCHEDULED" | "PUBLISHED">("DRAFT");
  const [editorTags, setEditorTags] = useState("");
  const [editorPublishDate, setEditorPublishDate] = useState("");
  const [isAiAssisted, setIsAiAssisted] = useState(false);
  
  // AI Prompt Modal
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiTone, setAiTone] = useState("professional");
  const [aiKeywords, setAiKeywords] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  
  const handleOpenEditor = (post?: BlogPost) => {
    if (post) {
      setSelectedPost(post);
      setEditorTitle(post.title);
      setEditorExcerpt(post.excerpt);
      setEditorContent(post.content);
      setEditorCategory(post.category);
      setEditorStatus(post.status);
      setEditorTags(post.tags.join(", "));
      setEditorPublishDate(post.publishDate || "");
      setIsAiAssisted(post.aiAssisted);
    } else {
      setSelectedPost(null);
      setEditorTitle("");
      setEditorExcerpt("");
      setEditorContent("");
      setEditorCategory("Market Trends");
      setEditorStatus("DRAFT");
      setEditorTags("");
      setEditorPublishDate("");
      setIsAiAssisted(false);
    }
    setEditorOpen(true);
  };

  const handleSavePost = () => {
    if (!editorTitle.trim()) {
      toast.error("Title is required.");
      return;
    }

    const tagsArr = editorTags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    if (selectedPost) {
      // Update existing post
      setPosts(prev =>
        prev.map(p =>
          p.id === selectedPost.id
            ? {
                ...p,
                title: editorTitle,
                excerpt: editorExcerpt,
                content: editorContent,
                category: editorCategory,
                status: editorStatus,
                tags: tagsArr,
                publishDate: editorStatus !== "DRAFT" ? editorPublishDate || new Date().toISOString().slice(0, 10) : undefined,
                aiAssisted: isAiAssisted
              }
            : p
        )
      );
    } else {
      // Create new post
      const newPost: BlogPost = {
        id: `B-${Math.floor(100 + Math.random() * 900)}`,
        title: editorTitle,
        excerpt: editorExcerpt,
        content: editorContent,
        category: editorCategory,
        status: editorStatus,
        tags: tagsArr,
        publishDate: editorStatus !== "DRAFT" ? editorPublishDate || new Date().toISOString().slice(0, 10) : undefined,
        readTime: `${Math.ceil(editorContent.split(/\s+/).length / 200)} min read`,
        aiAssisted: isAiAssisted,
        author: isAiAssisted ? "AI Content Assistant" : "System Agent"
      };
      setPosts(prev => [newPost, ...prev]);
    }
    setEditorOpen(false);
  };

  const confirm = useConfirm();

  const handleDeletePost = async (id: string) => {
    if (await confirm({
      title: "Delete blog post?",
      description: "This can't be undone.",
      confirmText: "Delete",
    })) {
      setPosts(prev => prev.filter(p => p.id !== id));
      if (selectedPost && selectedPost.id === id) {
        setEditorOpen(false);
      }
    }
  };

  // Simulate AI blog generation
  const handleGenerateAIDraft = () => {
    if (!aiPrompt.trim()) {
      toast.error("Please enter a topic prompt or keywords.");
      return;
    }
    setGeneratingDraft(true);
    
    // Simulate generation delay
    setTimeout(() => {
      const generatedTitle = aiPrompt.length > 50 ? aiPrompt.substring(0, 47) + "..." : aiPrompt;
      const toneDescriptor = aiTone.charAt(0).toUpperCase() + aiTone.slice(1);
      
      const contentTemplate = `## ${generatedTitle}\n\n*Generated in ${toneDescriptor} Tone. Relevant Keywords: ${aiKeywords || "None specified"}.*\n\nAs the residential landscape expands in 2026, homeowners and buyers are seeking transparency, compliance, and long-term utility in every transaction.\n\n### The Core Opportunity\nWhether analyzing market trends or architectural layouts, building a pipeline requires understanding your target demographic. This means using dynamic tools, understanding regional constraints, and aligning with compliance standard rules.\n\n### 3 Key Considerations for Developers:\n1. **Integration and Scalability:** Ensure your software integrations sync in real-time.\n2. **Energy Resilience:** Highlight heat pump performance and solar storage capacities.\n3. **Post-Closing Support:** Standardize onboarding warranties to build client trust.`;

      const excerptTemplate = `An AI-assisted overview exploring how to leverage ${aiPrompt.toLowerCase()} to drive community engagement and build brand authority.`;

      setEditorTitle(generatedTitle);
      setEditorExcerpt(excerptTemplate);
      setEditorContent(contentTemplate);
      setEditorCategory("Market Trends");
      setEditorStatus("DRAFT");
      setEditorTags(aiKeywords ? aiKeywords.split(",").map(k => k.trim()).join(", ") : "AI Generated, Housing Market");
      setIsAiAssisted(true);
      
      setGeneratingDraft(false);
      setAiModalOpen(false);
      setEditorOpen(true);
    }, 1800);
  };

  const handleApplyTopicIdea = (idea: typeof aiTopicIdeas[0]) => {
    setAiPrompt(idea.title);
    setAiKeywords(idea.keywords.join(", "));
    setAiModalOpen(true);
  };

  const filteredPosts = posts.filter(post => {
    const matchesSearch =
      post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (activeTab === "all") return matchesSearch;
    return matchesSearch && post.status === activeTab.toUpperCase();
  });

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 max-w-7xl mx-auto"
        >
          {/* Header */}
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                AI Blog Post Builder
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Draft builder blogs, leverage AI topic ideas, and export structured articles to your buyer portal.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setAiModalOpen(true)} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 border-none">
                <Sparkles className="h-4 w-4" /> AI Draft Assistant
              </Button>
              <Button onClick={() => handleOpenEditor()} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90 gap-2 h-9">
                <Plus className="h-4 w-4" /> New Blog Post
              </Button>
            </div>
          </motion.div>

          {/* Main Layout Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* AI Topics Sidebar */}
            <motion.div variants={fadeInUp} className="lg:col-span-1 space-y-6">
              <Card className="border border-border/80 shadow-xs bg-slate-50/50 dark:bg-slate-900/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-[#b48c3c]">
                    <Sparkles className="h-4 w-4" />
                    <CardTitle className="text-sm font-bold">AI Recommended Topics</CardTitle>
                  </div>
                  <CardDescription className="text-xs">Based on current local search trends.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {aiTopicIdeas.map((idea, idx) => (
                    <div key={idx} className="p-3 border bg-white dark:bg-slate-900 hover:border-[#b48c3c]/50 transition rounded-xl space-y-2 relative group">
                      <div className="flex justify-between items-center">
                        <Badge className="bg-[#0F3B3D]/10 text-[#0F3B3D] dark:text-[#8fc3c5] text-[9px] font-semibold border-none">
                          {idea.category}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">{idea.difficulty}</span>
                      </div>
                      <h4 className="text-xs font-bold leading-snug group-hover:text-[#b48c3c] transition">{idea.title}</h4>
                      <p className="text-[9px] text-muted-foreground font-mono truncate">Keywords: {idea.keywords.join(", ")}</p>
                      
                      <button 
                        onClick={() => handleApplyTopicIdea(idea)}
                        className="w-full flex items-center justify-end gap-1 text-[10px] text-[#b48c3c] font-semibold pt-1 border-t hover:underline mt-2 cursor-pointer"
                      >
                        Write Draft <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Newsletter / RSS Scraper Status */}
              <Card className="border border-border/60">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">RSS Market Feed Sync</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Scraping local housing updates. Ready to supply topics for AI agent drafting.
                  </p>
                  <div className="flex justify-between items-center text-[10px] pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Last Scraped:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Today, 8:40 AM</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Blogs Directory Content */}
            <motion.div variants={fadeInUp} className="lg:col-span-3 space-y-6">
              <Card className="border border-border/80 shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                      <TabsList className="bg-slate-100/80 dark:bg-slate-900 grid grid-cols-4 h-9 p-1 rounded-lg">
                        <TabsTrigger value="all" className="text-xs rounded-md">All</TabsTrigger>
                        <TabsTrigger value="draft" className="text-xs rounded-md">Drafts</TabsTrigger>
                        <TabsTrigger value="scheduled" className="text-xs rounded-md">Scheduled</TabsTrigger>
                        <TabsTrigger value="published" className="text-xs rounded-md">Published</TabsTrigger>
                      </TabsList>
                    </Tabs>

                    <div className="relative w-full sm:w-60">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search posts or tags..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8 h-9 text-xs"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <AnimatePresence mode="popLayout">
                    {filteredPosts.length > 0 ? (
                      <div className="space-y-4">
                        {filteredPosts.map((post) => (
                          <motion.div
                            key={post.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="p-4 border border-border/60 hover:border-border rounded-xl bg-white dark:bg-slate-900/30 flex flex-col md:flex-row justify-between gap-4 transition-all"
                          >
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-mono font-semibold text-slate-400">{post.id}</span>
                                <Badge className={`text-[9px] font-semibold tracking-tight px-2 py-0.5 border border-none rounded-md ${
                                  post.status === "PUBLISHED" 
                                    ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400" 
                                    : post.status === "SCHEDULED"
                                    ? "bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400"
                                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                }`}>
                                  {post.status}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                                  {post.category}
                                </Badge>
                                {post.aiAssisted && (
                                  <Badge className="bg-[#b48c3c]/10 text-[#b48c3c] border-none text-[9px] gap-1 px-1.5 py-0">
                                    <Sparkles className="h-2.5 w-2.5" /> AI Assisted
                                  </Badge>
                                )}
                              </div>
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 hover:text-[#b48c3c] transition cursor-pointer" onClick={() => handleOpenEditor(post)}>
                                {post.title}
                              </h3>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {post.excerpt}
                              </p>
                              
                              <div className="flex gap-1.5 pt-1.5 flex-wrap">
                                {post.tags.map((t, i) => (
                                  <span key={i} className="text-[9px] bg-slate-50 dark:bg-slate-800/40 text-slate-500 font-mono px-2 py-0.5 rounded-md border border-slate-100 dark:border-slate-800">
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="flex flex-row md:flex-col justify-between items-start md:items-end gap-3 md:min-w-44 border-t md:border-t-0 pt-3 md:pt-0 border-dashed border-border/80">
                              <div className="text-[10px] text-muted-foreground space-y-1">
                                <p className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {post.readTime}
                                </p>
                                <p className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" /> {post.publishDate ? `Publish: ${post.publishDate}` : "No scheduled date"}
                                </p>
                                <p className="text-slate-400">By: {post.author}</p>
                              </div>

                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-[#b48c3c] hover:bg-[#b48c3c]/10" onClick={() => handleOpenEditor(post)} title="Edit post">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-500/10" onClick={() => handleDeletePost(post.id)} title="Delete post">
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
                        <p className="font-semibold text-sm">No blog posts found.</p>
                        <p className="text-xs mt-1 text-slate-400">Search with another keyword or use the AI Assistant to generate one.</p>
                      </div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>

          </div>
        </motion.div>

        {/* AI Draft Prompt Input Modal */}
        <Dialog open={aiModalOpen} onOpenChange={setAiModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#b48c3c]" />
                AI Content Prompt Wizard
              </DialogTitle>
              <DialogDescription>
                Define topics or keywords. The AI agent will auto-draft structures, headers, and bulleted sections.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="aiTopic" className="font-semibold text-xs">Topic Prompt *</Label>
                <Input
                  id="aiTopic"
                  placeholder="e.g. 2026 Housing Market Trends or Sprinkler Winterization tips"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  disabled={generatingDraft}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aiTone" className="font-semibold text-xs">Aesthetic Tone</Label>
                  <Select value={aiTone} onValueChange={setAiTone} disabled={generatingDraft}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional & Direct</SelectItem>
                      <SelectItem value="friendly">Informative & Friendly</SelectItem>
                      <SelectItem value="bold">Bold & Marketing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aiKeywords" className="font-semibold text-xs">Target Keywords</Label>
                  <Input
                    id="aiKeywords"
                    placeholder="curb appeal, ROI, year 1"
                    value={aiKeywords}
                    onChange={(e) => setAiKeywords(e.target.value)}
                    disabled={generatingDraft}
                  />
                </div>
              </div>

              {generatingDraft && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border rounded-xl flex items-center justify-center gap-3">
                  <Sparkles className="h-5 w-5 text-[#b48c3c] animate-pulse" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">AI is drafting outline and headers...</span>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setAiModalOpen(false)} disabled={generatingDraft}>Cancel</Button>
              <Button onClick={handleGenerateAIDraft} disabled={generatingDraft} className="bg-[#b48c3c] text-white">
                Generate AI Outline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Post Editor & Rich Text Layout Dialog */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto pr-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-[#0F3B3D]" />
                {selectedPost ? `Edit Post: ${selectedPost.id}` : "Create New Blog Post"}
              </DialogTitle>
              <DialogDescription>Draft your post. Markdown is supported in the draft canvas below.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="postTitle" className="font-semibold text-xs">Blog Article Title *</Label>
                <Input
                  id="postTitle"
                  placeholder="Enter catching title..."
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="postExcerpt" className="font-semibold text-xs">Excerpt / Subtitle</Label>
                <Input
                  id="postExcerpt"
                  placeholder="Enter short description to display on grid cards..."
                  value={editorExcerpt}
                  onChange={(e) => setEditorExcerpt(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="postCategory" className="font-semibold text-xs">Category</Label>
                  <Select value={editorCategory} onValueChange={setEditorCategory}>
                    <SelectTrigger id="postCategory"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Home Design">Home Design</SelectItem>
                      <SelectItem value="Finance">Finance</SelectItem>
                      <SelectItem value="Warranty & Support">Warranty & Support</SelectItem>
                      <SelectItem value="Market Trends">Market Trends</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="postStatus" className="font-semibold text-xs">Publish Status</Label>
                  <Select value={editorStatus} onValueChange={(val: any) => setEditorStatus(val)}>
                    <SelectTrigger id="postStatus"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft Canvas</SelectItem>
                      <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                      <SelectItem value="PUBLISHED">Published Portal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="postPublishDate" className="font-semibold text-xs">Publication Date</Label>
                  <Input
                    id="postPublishDate"
                    type="date"
                    disabled={editorStatus === "DRAFT"}
                    value={editorPublishDate}
                    onChange={(e) => setEditorPublishDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="postTags" className="font-semibold text-xs">Tags (comma-separated)</Label>
                <Input
                  id="postTags"
                  placeholder="ROI, energy, DIY"
                  value={editorTags}
                  onChange={(e) => setEditorTags(e.target.value)}
                />
              </div>

              {/* Mock Rich Text Canvas */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-900 px-3 py-1.5 rounded-t-xl border-t border-x text-xs text-muted-foreground font-semibold">
                  <div className="flex gap-2.5 items-center">
                    <span className="font-bold border-r pr-2">Canvas Toolbar:</span>
                    <button className="hover:text-foreground font-extrabold cursor-pointer">B</button>
                    <button className="hover:text-foreground italic cursor-pointer">I</button>
                    <button className="hover:text-foreground font-mono cursor-pointer">H1</button>
                    <button className="hover:text-foreground font-mono cursor-pointer">H2</button>
                    <span className="border-r h-3.5 inline-block" />
                    <button className="hover:text-foreground underline cursor-pointer">Link</button>
                    <button className="hover:text-foreground cursor-pointer">Bullet</button>
                  </div>
                  {isAiAssisted && (
                    <span className="text-[10px] text-[#b48c3c] flex items-center gap-1 font-bold">
                      <Sparkles className="h-3 w-3" /> AI Copy generated
                    </span>
                  )}
                </div>
                <Textarea
                  id="postContent"
                  placeholder="## Start drafting in markdown..."
                  rows={10}
                  className="rounded-t-none rounded-b-xl border focus-visible:ring-1 focus-visible:ring-[#b48c3c] text-xs font-mono"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={handleSavePost} className="bg-[#0F3B3D] text-white">
                {selectedPost ? "Save Changes" : "Save Blog Post"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
