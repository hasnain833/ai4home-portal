"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Bot,
  User,
  Loader2,
  Plus,
  Home,
  BedDouble,
  Bath,
  Ruler,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  MessageCircleQuestion,
} from "lucide-react";
import PromptSuggestions from "@/components/warranty/PromptSuggestions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface HomeCard {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  community: string | null;
  planName: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  status: string;
  moveIn: string | null;
  description: string | null;
  photos: string[];
}

interface PendingBooking {
  slotIso: string;
  label: string;
  locationType: "VIRTUAL" | "ONSITE";
}

interface Booked {
  when: string;
  locationType: string;
  meetingLink: string | null;
  leadName?: string;
}

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  homes?: HomeCard[];
  pendingBooking?: PendingBooking | null;
  booked?: Booked | null;
}

interface SalesChatProps {
  themeColor?: string;
  botName?: string;
  logoUrl?: string;
  tagline?: string;
}

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  COMING_SOON: "Coming soon",
  UNDER_CONTRACT: "Under contract",
  SOLD: "Sold",
};

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const planLabel = (p: string) => (/plan/i.test(p) ? p : `Plan ${p}`);

function AgentAvatar({ logoUrl, botName, themeColor, size = 24 }: { logoUrl?: string; botName: string; themeColor: string; size?: number }) {
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

function Specs({ home }: { home: HomeCard }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      {home.bedrooms != null && (
        <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" />{home.bedrooms} bd</span>
      )}
      {home.bathrooms != null && (
        <span className="inline-flex items-center gap-1"><Bath className="h-3.5 w-3.5" />{home.bathrooms} ba</span>
      )}
      {home.sqft != null && (
        <span className="inline-flex items-center gap-1"><Ruler className="h-3.5 w-3.5" />{home.sqft.toLocaleString("en-US")} sq ft</span>
      )}
    </div>
  );
}

/** A home the agent pointed at. The whole card opens its details. */
function HomeCardView({ home, themeColor, onOpen }: { home: HomeCard; themeColor: string; onOpen: () => void }) {
  const photo = home.photos[0];
  const place = [home.city, home.state].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-64 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 dark:border-slate-800 dark:bg-slate-900"
      style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
      aria-label={`View details for ${home.address}`}
    >
      <div className="relative aspect-4/3 bg-slate-100 dark:bg-slate-800">
        {photo ? (
          <img src={photo} alt={home.address} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
            <Home className="h-8 w-8" />
            <span className="text-[11px]">No photos yet</span>
          </div>
        )}
        <span
          className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: themeColor }}
        >
          {STATUS_LABELS[home.status] || home.status}
        </span>
        {home.photos.length > 1 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
            {home.photos.length} photos
          </span>
        )}
      </div>

      <div className="space-y-1 p-3">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">
          {home.price != null ? money(home.price) : "Price on request"}
        </p>
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={home.address}>
          {home.address}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {[home.community, place].filter(Boolean).join(" · ")}
        </p>
        <div className="pt-1"><Specs home={home} /></div>
        {(home.planName || home.moveIn) && (
          <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {[home.planName && planLabel(home.planName), home.moveIn && `Move-in ${home.moveIn}`].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="pt-1 text-[11px] font-semibold" style={{ color: themeColor }}>View details →</p>
      </div>
    </button>
  );
}

/** Full view of one home: every photo, the facts, and a way back into the chat. */
function HomeDetails({
  home,
  themeColor,
  onClose,
  onAsk,
}: {
  home: HomeCard | null;
  themeColor: string;
  onClose: () => void;
  onAsk: (text: string) => void;
}) {
  const [shown, setShown] = useState(0);
  if (!home) return null;
  const count = home.photos.length;
  const index = count ? shown % count : 0;
  const place = [home.city, home.state].filter(Boolean).join(", ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="relative aspect-video bg-slate-100 dark:bg-slate-800">
          {count ? (
            <img src={home.photos[index]} alt={`${home.address}, photo ${index + 1}`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
              <Home className="h-10 w-10" />
              <span className="text-sm">No photos published yet</span>
            </div>
          )}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => setShown((index - 1 + count) % count)}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setShown((index + 1) % count)}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
                {index + 1} / {count}
              </span>
            </>
          )}
        </div>

        {count > 1 && (
          <div className="flex gap-2 overflow-x-auto px-5 pt-4">
            {home.photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setShown(i)}
                aria-label={`Show photo ${i + 1}`}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 ${i === index ? "" : "border-transparent opacity-70 hover:opacity-100"}`}
                style={i === index ? { borderColor: themeColor } : undefined}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="space-y-4 p-5">
          <DialogHeader className="text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: themeColor }}>
                {STATUS_LABELS[home.status] || home.status}
              </span>
              <span className="text-xl font-bold">{home.price != null ? money(home.price) : "Price on request"}</span>
            </div>
            <DialogTitle className="text-lg">{home.address}</DialogTitle>
            <DialogDescription>{[home.community, place].filter(Boolean).join(" · ")}</DialogDescription>
          </DialogHeader>

          <Specs home={home} />

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {home.planName && (
              <p><span className="text-muted-foreground">Floor plan: </span>{home.planName}</p>
            )}
            {home.moveIn && (
              <p><span className="text-muted-foreground">Move-in: </span>{home.moveIn}</p>
            )}
          </div>

          {home.description && (
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{home.description}</p>
          )}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
            <button
              type="button"
              onClick={() => onAsk(`I'd like to book a visit to see ${home.address}.`)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: themeColor }}
            >
              <CalendarPlus className="h-4 w-4" /> Book a visit to see this home
            </button>
            <button
              type="button"
              onClick={() => onAsk(`Tell me more about ${home.address}.`)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold"
            >
              <MessageCircleQuestion className="h-4 w-4" /> Ask about this home
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Who the visit is for. Shown when the agent has agreed a time. */
function BookingForm({
  pending,
  prefill,
  themeColor,
  homes,
  onBooked,
}: {
  pending: PendingBooking;
  prefill: { name: string; email: string; phone: string } | null;
  themeColor: string;
  homes: string[];
  onBooked: (reply: string, booked: Booked | null) => void;
}) {
  const [name, setName] = useState(prefill?.name || "");
  const [email, setEmail] = useState(prefill?.email || "");
  const [phone, setPhone] = useState(prefill?.phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sales/chat/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pending, name, email, phone, homes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const alt = Array.isArray(data.slots) && data.slots.length
          ? ` Here are the next open times:\n${data.slots.map((s: { label: string }) => `• ${s.label}`).join("\n")}\nWhich one works?`
          : "";
        onBooked(`Sorry — that time was just taken.${alt}`, null);
        return;
      }
      if (!res.ok) throw new Error(data.message || "Could not book the visit");
      onBooked(data.reply, data.booked || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book the visit");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white";
  const ring = { "--tw-ring-color": themeColor } as React.CSSProperties;

  return (
    <form onSubmit={submit} className="ml-8 w-full max-w-sm space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <CalendarPlus className="h-4 w-4" style={{ color: themeColor }} />
        {pending.label} · {pending.locationType === "ONSITE" ? "On site" : "Virtual"}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">Who is this visit for?</p>
      <input className={field} style={ring} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
      <input className={field} style={ring} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      <input className={field} style={ring} type="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: themeColor }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm booking
      </button>
    </form>
  );
}

/**
 * The Sales workspace's AI Assistant: the same agent the SMS / email flow runs,
 * talking here as a web chat. The whole transcript goes up with every turn —
 * the server keeps no conversation, so a reload starts fresh.
 */
export default function SalesChat({
  themeColor = "#0F3B3D",
  botName = "Sales Assistant",
  logoUrl,
  tagline = "Ask about our homes and communities, what's available, pricing, or book a visit.",
}: SalesChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [openHome, setOpenHome] = useState<HomeCard | null>(null);
  const [prefill, setPrefill] = useState<{ name: string; email: string; phone: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Openers are written from this builder's KB, homes and live prompt. An empty
  // list hides the panel.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sales/chat/suggestions")
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
  }, []);

  const hasUserMessages = messages.some((m) => m.role === "user");
  // Only the newest agent turn can hold an open booking form.
  const lastAgentId = [...messages].reverse().find((m) => m.role === "agent")?.id;
  // Homes shown in this conversation, newest first — recorded on the booking.
  const homesDiscussed = [...new Set(messages.flatMap((m) => m.homes || []).reverse().map((h) => h.address))];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const appendAgent = (content: string, extra: Partial<Message> = {}) =>
    setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", content, ...extra }]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { id: `${Date.now()}-u`, role: "user", content: trimmed };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/sales/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to send message");

      if (data.contactPrefill) setPrefill(data.contactPrefill);
      appendAgent(data.reply, {
        homes: Array.isArray(data.homes) ? data.homes : [],
        pendingBooking: data.pendingBooking || null,
      });
    } catch (error) {
      console.error("Sales chat error:", error);
      appendAgent(
        error instanceof Error && error.message !== "Failed to send message"
          ? error.message
          : "Sorry, I'm having trouble connecting right now. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="relative overflow-hidden flex flex-col w-full h-full bg-white dark:bg-[#020617] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
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

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setInput("");
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
          <div className={`flex flex-col items-center text-center px-6 ${hasUserMessages ? "pb-2" : "my-auto"}`}>
            <AgentAvatar logoUrl={logoUrl} botName={botName} themeColor={themeColor} size={56} />
            <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-100">{botName}</h3>
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{tagline}</p>
          </div>

          {messages.map((msg) => (
            <div key={msg.id} className="flex flex-col gap-2">
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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

              {msg.booked && (
                <div className="ml-8 inline-flex w-fit items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CalendarCheck className="h-4 w-4" />
                  Visit booked{msg.booked.leadName ? ` for ${msg.booked.leadName}` : ""} — {msg.booked.when}
                  {msg.booked.locationType === "ONSITE" ? " (on site)" : " (virtual)"}
                </div>
              )}

              {msg.pendingBooking && msg.id === lastAgentId && (
                <BookingForm
                  pending={msg.pendingBooking}
                  prefill={prefill}
                  themeColor={themeColor}
                  homes={homesDiscussed}
                  onBooked={(reply, booked) => {
                    // The form has done its job; the confirmation replaces it.
                    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pendingBooking: null } : m)));
                    appendAgent(reply, { booked });
                  }}
                />
              )}

              {msg.homes && msg.homes.length > 0 && (
                <div className="ml-8 flex gap-3 overflow-x-auto pb-1">
                  {msg.homes.map((h) => (
                    <HomeCardView key={h.id} home={h} themeColor={themeColor} onOpen={() => setOpenHome(h)} />
                  ))}
                </div>
              )}
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

      {/* Input */}
      <div className="p-3 bg-white dark:bg-[#020617] border-t border-slate-100 dark:border-slate-800 shrink-0">
        {messages.length === 0 && (
          <PromptSuggestions
            title="What would you like to know?"
            items={suggestions}
            onSelect={sendMessage}
            disabled={isLoading}
          />
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent dark:text-white"
            style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
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

      {/* Keyed by home so the photo index starts at the first photo each time. */}
      <HomeDetails
        key={openHome?.id || "none"}
        home={openHome}
        themeColor={themeColor}
        onClose={() => setOpenHome(null)}
        onAsk={(text) => {
          setOpenHome(null);
          void sendMessage(text);
        }}
      />
    </div>
  );
}
