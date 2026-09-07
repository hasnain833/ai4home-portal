"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, History, Plus, X } from "lucide-react";
import ConversationList, { type ConversationSummary } from "./ConversationList";

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
}

interface WarrantyChatProps {
  companyId: string;
  themeColor?: string;
  botName?: string;
  logoUrl?: string;
  tagline?: string;
  homeownerId?: string;
  isWidget?: boolean;
  enableHistory?: boolean;
  activeConversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
  conversations?: ConversationSummary[];
  loadingHistory?: boolean;
  onSelectConversation?: (id: string) => void;
  onNewConversation?: () => void;
}

const GREETING: Message = {
  id: "greeting",
  role: "agent",
  content: "Hello! I'm your Warranty Care Assistant. How can I help you with your home today?",
};

const STORAGE_PREFIX = "warranty-chat:conversation:";

function readStoredConversationId(companyId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + companyId);
  } catch {
    return null;
  }
}

function writeStoredConversationId(companyId: string, id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_PREFIX + companyId, id);
    else window.localStorage.removeItem(STORAGE_PREFIX + companyId);
  } catch {
  }
}

function AgentAvatar({
  logoUrl,
  botName,
  themeColor,
  size = 24,
}: {
  logoUrl?: string;
  botName: string;
  themeColor: string;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={botName}
        className="rounded-full object-contain bg-white shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 text-white"
      style={{ width: size, height: size, backgroundColor: themeColor }}
    >
      <Bot size={Math.round(size * 0.58)} />
    </div>
  );
}

export default function WarrantyChat({
  companyId,
  themeColor = "#0F3B3D",
  botName = "Warranty Assistant",
  logoUrl,
  tagline = "Tell me what's going on with your home, and I'll help you resolve it or submit a warranty request.",
  homeownerId,
  isWidget = false,
  enableHistory = false,
  activeConversationId,
  onConversationChange,
  conversations = [],
  loadingHistory = false,
  onSelectConversation,
  onNewConversation,
}: WarrantyChatProps) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isControlled = activeConversationId !== undefined;
  const [internalConversationId, setInternalConversationId] = useState<string | null>(null);
  const conversationId = isControlled ? activeConversationId : internalConversationId;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const renderedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  const hasUserMessages = messages.some((m) => m.role === "user");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const hydrate = useCallback(
    async (id: string) => {
      setIsRestoring(true);
      try {
        const res = await fetch(`/api/warranty/chat/conversations/${id}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          writeStoredConversationId(companyId, null);
          setInternalConversationId(null);
          onConversationChange?.(null);
          renderedIdRef.current = null;
          setMessages([GREETING]);
          return;
        }
        const data = await res.json();
        const turns: { role?: string; content?: string }[] = Array.isArray(data.transcript)
          ? data.transcript
          : [];
        renderedIdRef.current = id;
        setMessages(
          turns.length === 0
            ? [GREETING]
            : turns.map((turn, i) => ({
                id: `${id}-${i}`,
                role: turn.role === "agent" ? ("agent" as const) : ("user" as const),
                content: String(turn.content || ""),
              })),
        );
      } catch (error) {
        console.error("Failed to restore conversation:", error);
      } finally {
        setIsRestoring(false);
      }
    },
    [companyId, onConversationChange],
  );

  useEffect(() => {
    if (isControlled || !enableHistory) return;
    const stored = readStoredConversationId(companyId);
    if (stored) setInternalConversationId(stored);
  }, [isControlled, enableHistory, companyId]);

  useEffect(() => {
    if (!enableHistory) return;
    if (!conversationId) {
      if (renderedIdRef.current !== null) {
        renderedIdRef.current = null;
        setMessages([GREETING]);
      }
      return;
    }
    if (conversationId === renderedIdRef.current) return;
    hydrate(conversationId);
  }, [conversationId, enableHistory, hydrate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isRestoring) return;
    if (!companyId) {
      console.error("[WarrantyChat] No companyId — refusing to send.");
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/public/warranty/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          conversationId,
          message: userMessage.content,
          homeownerId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const data = await response.json();

      if (data.conversationId) {
        renderedIdRef.current = data.conversationId;
        if (data.conversationId !== conversationId) {
          setInternalConversationId(data.conversationId);
          writeStoredConversationId(companyId, data.conversationId);
          onConversationChange?.(data.conversationId);
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "agent",
          content: data.reply,
        },
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "agent",
          content: "Sorry, I'm having trouble connecting right now. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`relative overflow-hidden flex flex-col w-full h-full bg-white dark:bg-[#020617] ${isWidget ? "" : "rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm"}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0 text-white"
        style={{ backgroundColor: themeColor }}
      >
        {enableHistory && (
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            title="Conversation history"
            className="w-8 h-8 -ml-1 rounded-full flex items-center justify-center shrink-0 text-white/90 hover:text-white hover:bg-white/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <History className="w-4.5 h-4.5" />
          </button>
        )}

        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={botName} className="w-full h-full object-contain bg-white" />
          ) : (
            <Bot className="w-5 h-5 text-white" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">{botName}</h2>
          <p className="text-xs text-white/80">Online</p>
        </div>

        {enableHistory && (
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(false);
              onNewConversation?.();
            }}
            aria-label="Start a new conversation"
            title="New conversation"
            className="ml-auto w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white/90 hover:text-white hover:bg-white/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Plus className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

      {/* History drawer — inside the chat, over the messages. */}
      {enableHistory && (
        <>
          <div
            onClick={() => setHistoryOpen(false)}
            aria-hidden="true"
            className={`absolute inset-0 z-20 bg-slate-900/40 transition-opacity duration-200 ${
              historyOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
          <aside
            aria-hidden={!historyOpen}
            inert={!historyOpen}
            className={`absolute inset-y-0 left-0 z-30 flex w-72 max-w-[85%] flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-slate-800 dark:bg-slate-950 ${
              historyOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Conversations
              </span>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close conversation history"
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <ConversationList
                conversations={conversations}
                loading={loadingHistory}
                activeId={activeConversationId}
                onSelect={(id) => {
                  onSelectConversation?.(id);
                  setHistoryOpen(false);
                }}
              />
            </div>
          </aside>
        </>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50 dark:bg-[#020617]">
        <div className="flex flex-col justify-end min-h-full p-4 gap-4">
          {/* Branding splash */}
          <div
            className={`flex flex-col items-center text-center px-6 ${
              hasUserMessages ? "pb-2" : "my-auto"
            }`}
          >
            <AgentAvatar logoUrl={logoUrl} botName={botName} themeColor={themeColor} size={56} />
            <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-100">
              {botName}
            </h3>
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
              {tagline}
            </p>
          </div>

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`flex max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} items-end gap-2`}>
                {msg.role === "user" ? (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    <User size={14} />
                  </div>
                ) : (
                  <AgentAvatar logoUrl={logoUrl} botName={botName} themeColor={themeColor} />
                )}
                <div
                  className={`px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-br-sm"
                      : "bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-sm rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-end gap-2">
                <AgentAvatar logoUrl={logoUrl} botName={botName} themeColor={themeColor} />
                <div className="px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-bl-sm shadow-sm flex gap-1">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Form */}
      <div className="p-3 bg-white dark:bg-[#020617] border-t border-slate-100 dark:border-slate-800 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent dark:text-white"
            style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
            disabled={isLoading || isRestoring}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isRestoring}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: themeColor }}
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="ml-0.5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
