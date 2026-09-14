"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Plus } from "lucide-react";
import PromptSuggestions from "./PromptSuggestions";

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
}: WarrantyChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * Choices the agent offered on the most recent turn.
   *
   * Only the latest turn's, deliberately: the panel is docked to the composer, so
   * answering one question replaces its choices with the next question's.
   */
  const [options, setOptions] = useState<string[]>([]);

  // Held in memory only, for the life of this tab.
  //
  // The server still keeps a conversation row while a chat is in progress — it is
  // the agent's working memory for phase, collected facts and the property — but
  // nothing pins the id anywhere durable, so a reload starts a fresh conversation
  // and no past one can be reopened.
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Starter prompts come from the warranty knowledge base, so they track whatever
  // of the diagnostic matrix has been indexed. An empty list hides the panel, which
  // is the correct behaviour for a tenant whose KB has no matrix in it yet.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    fetch(`/api/public/warranty/chat/suggestions?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((d) => {
        if (!cancelled) setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
      })
      .catch(() => {
        // Cosmetic; the chat works without them.
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const hasUserMessages = messages.some((m) => m.role === "user");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  /**
   * Sends one turn. Takes the text explicitly so a suggestion chip can send
   * without first round-tripping through the input box.
   */
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (!companyId) {
      console.error("[WarrantyChat] No companyId — refusing to send.");
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    // The question has been answered, so its choices go before the reply lands.
    setOptions([]);
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

      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
      }

      setOptions(Array.isArray(data.options) ? data.options : []);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className={`relative overflow-hidden flex flex-col w-full h-full bg-white dark:bg-[#020617] ${isWidget ? "" : "rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm"}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0 text-white"
        style={{ backgroundColor: themeColor }}
      >
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

        {/* Starts over: clears the thread and drops the conversation id, so the
            next message opens a new conversation on the server. */}
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setConversationId(null);
              setInput("");
              setOptions([]);
            }}
            aria-label="Start a new conversation"
            title="New conversation"
            className="ml-auto w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white/90 hover:text-white hover:bg-white/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Plus className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

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
        {/*
          One panel, two sources. Mid-conversation it carries the choices the agent
          just offered; before the conversation starts it carries the KB-derived
          openers. Starters stop once someone has spoken — the agent's own questions
          do not, which is why options are checked first.
        */}
        {options.length > 0 ? (
          <PromptSuggestions
            title="Choose one"
            items={options}
            onSelect={sendMessage}
            disabled={!companyId || isLoading}
          />
        ) : (
          messages.length === 0 && (
            <PromptSuggestions
              title="What can we help with?"
              items={suggestions}
              onSelect={sendMessage}
              disabled={!companyId || isLoading}
            />
          )
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent dark:text-white"
            style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
            disabled={!companyId || isLoading}
          />
          <button
            type="submit"
            disabled={!companyId || !input.trim() || isLoading}
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
