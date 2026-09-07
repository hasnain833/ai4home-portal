"use client";

import { useCallback, useEffect, useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Bot, Copy, Check, Info, Code } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import WarrantyChat from "@/components/warranty/WarrantyChat";
import { type ConversationSummary } from "@/components/warranty/ConversationList";

export default function AIChatPage() {
  const { user, isLoading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [embedMode, setEmbedMode] = useState<"widget" | "fullscreen">("widget");
  const [themeColor, setThemeColor] = useState("#0F3B3D");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  // undefined means "let the chat resume whatever this browser last used". Once
  // the panel is touched it owns the selection, with null meaning a fresh thread.
  const [activeConversationId, setActiveConversationId] = useState<string | null | undefined>(
    undefined,
  );

  const companyName = user?.companyName || "Aiforhomebuilder";
  const botName = `${companyName} Assistant`;

  useEffect(() => {
    if (isLoading || !user) return;

    const fetchCompanyData = async () => {
      try {
        const response = await fetch("/api/company", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data && data.botColor) {
            setThemeColor(data.botColor);
          }
        }
      } catch (error) {
        console.error("Failed to fetch company details:", error);
      }
    };
    fetchCompanyData();
  }, [user, isLoading]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/warranty/chat/conversations", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch (error) {
      console.error("Failed to load conversation history:", error);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading || !user) return;
    loadConversations();
  }, [user, isLoading, loadConversations]);

  const startNewConversation = () => setActiveConversationId(null);
  const openConversation = (id: string) => setActiveConversationId(id);



  const portalUrl =
    process.env.NEXT_PUBLIC_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  // Empty until auth resolves, never a placeholder id. This used to fall back to
  // "demo-company", which no deployment actually has — nothing creates a Company
  // with that id — so anything sent during the auth-loading window went to the
  // agent as a real tenant and came back 404.
  const companyId = user?.companyId || "";
  const widgetScriptCode = `<script src="${portalUrl}/widget.js?company=${companyId}&mode=widget"></script>`;
  const fullScreenScriptCode = `<script src="${portalUrl}/widget.js?company=${companyId}&mode=fullscreen"></script>`;
  const fullScreenUrl = `${portalUrl}/widget/${companyId}?mode=fullscreen`;
  const embedScriptCode =
    embedMode === "widget" ? widgetScriptCode : fullScreenScriptCode;


  const copyToClipboard = (value = embedScriptCode) => {
    // ProtectedRoute renders its children while auth is still loading, so there
    // is a window where companyId is empty. Handing out an embed snippet built
    // from it would produce `?company=` — a widget that loads on the builder's
    // site and refuses every message. Nothing leaves this page until the id is
    // real.
    if (!companyId) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        {/* Offsets match PortalLayout's chrome: mobile is a 64px sticky header
            plus p-4 top and bottom; from md there is no header, just p-6. */}
        <div className="flex flex-col h-[calc(100dvh-96px)] md:h-[calc(100dvh-48px)] max-w-6xl mx-auto px-2 sm:px-4 w-full gap-4 pb-4">
          <div className="flex flex-row items-center justify-between gap-4 shrink-0">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
                <Bot className="h-7 w-7 md:h-8 md:w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
                <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                  AI Assistant
                </span>
              </h1>
            </div>

            <div className="flex items-center gap-2">
            {(user?.role === "admin" || user?.role === "staff") && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-medium"
                    size="sm"
                    // Unavailable until the company is known, so the snippet on
                    // the other side is never built from an empty id.
                    disabled={!companyId}
                    title={companyId ? undefined : "Loading your company details…"}
                  >
                    <Code className="h-4 w-4" />
                    Embed Widget
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl bg-card border border-border shadow-xl w-full overflow-hidden">
                  <DialogHeader className="border-b border-border/50 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-[#0F3B3D]/10 dark:bg-[#b48c3c]/10 text-primary dark:text-[#b48c3c]">
                        <Bot className="h-6 w-6" />
                      </div>
                      <div>
                        <DialogTitle className="text-lg">AI Assistant Widget Embed</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                          Integrate this AI assistant into your company website.
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                  <div className="pt-4 space-y-4 w-full overflow-hidden">
                    {/* Color Customizer */}
                    <div className="bg-[#0F3B3D]/5 dark:bg-[#b48c3c]/5 border border-border/50 rounded-xl p-4 space-y-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-foreground">Chatbot Theme Color</span>
                        <span className="text-[10px] text-muted-foreground">Select a custom color matching your company branding color scheme.</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={themeColor}
                          onChange={async (e) => {
                            const newColor = e.target.value;
                            setThemeColor(newColor);
                            try {
                              const response = await fetch("/api/company", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ botColor: newColor })
                              });
                              if (!response.ok) {
                                throw new Error(`Save failed with status ${response.status}`);
                              }
                            } catch (err) {
                              console.error("Failed to save bot color:", err);
                            }
                          }}
                          className="h-9 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0 overflow-hidden shrink-0"
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">{themeColor}</span>
                          <span className="text-[9px] text-muted-foreground uppercase font-semibold">HEX Color Value</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-1">
                      <button
                        type="button"
                        onClick={() => setEmbedMode("widget")}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                          embedMode === "widget"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Widget Mode
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmbedMode("fullscreen")}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                          embedMode === "fullscreen"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Full Screen Mode
                      </button>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {embedMode === "widget" ? "Widget Script" : "Full Screen Script"}
                      </span>
                      <Button
                        onClick={() => copyToClipboard()}
                        className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-medium"
                        size="sm"
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 text-green-400" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy Script
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="relative rounded-xl border border-slate-800 bg-[#020617] p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-50 w-full">
                      <pre className="whitespace-pre">{embedScriptCode}</pre>
                    </div>
                    {embedMode === "fullscreen" && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Direct Full Screen URL</span>
                          <Button
                            onClick={() => copyToClipboard(fullScreenUrl)}
                            variant="outline"
                            className="gap-2 font-medium"
                            size="sm"
                          >
                            <Copy className="h-4 w-4" />
                            Copy URL
                          </Button>
                        </div>
                        <div className="relative rounded-xl border border-border bg-muted/40 p-3 text-xs font-mono text-muted-foreground overflow-x-auto w-full">
                          <pre className="whitespace-pre">{fullScreenUrl}</pre>
                        </div>
                      </div>
                    )}
                    <div className="bg-[#0F3B3D]/5 dark:bg-[#b48c3c]/5 border border-[#0F3B3D]/25 dark:border-[#b48c3c]/25 rounded-xl p-4 flex items-start gap-3 w-full">
                      <Info className="h-5 w-5 text-[#0F3B3D] dark:text-[#b48c3c] shrink-0 mt-0.5" />
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p className="font-semibold text-foreground">How to use this script:</p>
                        <p>1. Copy the script code block above.</p>
                        <p>2. Paste the snippet into the HTML of your external website, preferably before the closing <code className="px-1 py-0.5 rounded bg-muted font-mono">&lt;/body&gt;</code> tag.</p>
                        <p>3. Widget mode shows the floating chat bubble. Full Screen mode fills the browser window.</p>
                        <p>4. The custom theme color, logo, and name are loaded automatically from the database.</p>
                      </div>
                    </div>
                  </div>

                </DialogContent>
              </Dialog>
            )}
            </div>
          </div>

          {/* History lives inside the chat now, in a drawer opened from its own
              header — so the conversation gets the full width, and the same
              affordance works at every breakpoint instead of a desktop sidebar
              plus a separate mobile dialog. */}
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0 overflow-hidden rounded-3xl shadow-2xl p-0 flex flex-col min-h-0">
              <WarrantyChat
                companyId={companyId}
                themeColor={themeColor}
                botName={botName}
                logoUrl={user?.companyLogo}
                homeownerId={user?.id}
                enableHistory
                activeConversationId={activeConversationId}
                onConversationChange={(id) => {
                  setActiveConversationId(id);
                  loadConversations();
                }}
                conversations={conversations}
                loadingHistory={loadingHistory}
                onSelectConversation={openConversation}
                onNewConversation={startNewConversation}
              />
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}



