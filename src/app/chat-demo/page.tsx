"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Home, Calendar, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Role = "user" | "agent";
type Message = { role: Role; content: string; id: string };

export default function ChatDemo() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "agent",
      content: "Hello! I'm the Olson Homes Sales Consultant. How can I help you find your dream home today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // Create transcript for backend (just role and content)
      const transcript = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/public/sales-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcript }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const data = await res.json();

      const agentMsg: Message = { id: Date.now().toString(), role: "agent", content: data.message };

      if (data.action === "book") {
        agentMsg.content = `✅ [SYSTEM: Agent initiated booking for slot ${data.slot_iso}]\n\n${agentMsg.content}`;
      } else if (data.action === "escalate") {
        agentMsg.content = `⚠️ [SYSTEM: Agent escalated to human]\n\n${agentMsg.content}`;
      }

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "agent", content: "Sorry, I am having trouble connecting right now." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 font-sans dark:bg-slate-950">
      {/* Header */}
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
          <Home className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Sales agent</h1>
          <p className="text-xs font-medium text-emerald-600">Online • Sales Consultant</p>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex w-full ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`relative max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm sm:max-w-[75%] ${m.role === "user"
                    ? "bg-blue-600 text-white rounded-br-none"
                    : "bg-white text-slate-800 border border-slate-100 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-100 rounded-bl-none"
                  }`}
              >
                {m.content.includes("[SYSTEM: Agent initiated booking") && (
                  <div className="mb-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <Calendar className="h-4 w-4" />
                    Agent booked a slot!
                  </div>
                )}
                {m.content.includes("[SYSTEM: Agent escalated to human]") && (
                  <div className="mb-2 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    Escalation Triggered
                  </div>
                )}
                <div className="whitespace-pre-wrap">
                  {m.content.replace(/✅ \[SYSTEM.*?\]\n\n|⚠️ \[SYSTEM.*?\]\n\n/g, "")}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex w-full justify-start">
              <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-bl-none border border-slate-100 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]"></div>
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]"></div>
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isLoading}
            className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-6 py-3.5 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
          />
          <Button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 p-0 text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
