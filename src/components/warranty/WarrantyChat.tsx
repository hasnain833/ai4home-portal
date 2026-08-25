"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";

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

// The company logo stands in for the bot avatar wherever one is shown, and
// falls back to the generic icon when the company has not uploaded one.
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "greeting",
      role: "agent",
      content: "Hello! I'm your Warranty Care Assistant. How can I help you with your home today?",
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Until the homeowner says something the splash stays vertically centered,
  // the way the previous webchat presented an idle conversation.
  const hasUserMessages = messages.some((m) => m.role === "user");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

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

      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
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
    <div className={`flex flex-col w-full h-full bg-white dark:bg-[#020617] ${isWidget ? "" : "rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm"}`}>
      {/* Header */}
      <div
        className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0 text-white"
        style={{ backgroundColor: themeColor }}
      >
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center mr-3 overflow-hidden shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={botName} className="w-full h-full object-contain bg-white" />
          ) : (
            <Bot className="w-5 h-5 text-white" />
          )}
        </div>
        <div>
          <h2 className="font-semibold text-sm">{botName}</h2>
          <p className="text-xs text-white/80">Online</p>
        </div>
      </div>

      {/* Messages — the column is bottom-anchored so a short conversation sits
          just above the composer rather than hanging from the top. */}
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
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
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
