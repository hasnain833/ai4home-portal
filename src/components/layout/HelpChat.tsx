"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How do I add a community?",
  "How do I import leads from a CSV?",
  "How do I dispatch a ticket to a trade?",
  "How do I connect Salesforce?",
];

// **bold** only; everything else stays plain text with its line breaks.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}

export function HelpChatPanel({ draftPrompt, className = "h-[60vh]" }: { draftPrompt?: string; className?: string }) {
  const page = usePathname();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/help-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, page, ...(draftPrompt ? { draftPrompt } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) throw new Error(data.message || "The assistant couldn't answer just now.");
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Ask how to do anything in the portal. Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user" ? "bg-[#0F3B3D] text-white" : "bg-muted text-foreground"
              }`}
            >
              {m.role === "assistant" ? <Rich text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-end gap-2 pt-3 border-t mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask a question…"
          aria-label="Your question"
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm max-h-32 focus:outline-none focus:ring-2 focus:ring-[#0F3B3D]/40"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send" className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

export function HelpChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-[#0F3B3D] dark:text-[#E8B86B]" /> AI4HB Help Assistant
          </DialogTitle>
          <DialogDescription>Step-by-step help with anything in the portal.</DialogDescription>
        </DialogHeader>
        <HelpChatPanel />
      </DialogContent>
    </Dialog>
  );
}
