"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Loader2, Send, CalendarClock } from "lucide-react";

export interface DispatchTicketTarget {
  id: string;
  issueType: string;
  homeowner?: { name?: string | null } | null;
  property?: { address?: string | null } | null;
}

interface TradeOption {
  tradeType: string;
  businessName: string | null;
  isActive: boolean;
  user: { id: string; name: string | null; email: string };
}

/** "Plumbing" matches a "Plumbing" or "Plumbing & Gas" trade, either way round. */
const tradeMatches = (tradeType: string, issueType: string) => {
  const a = tradeType.toLowerCase();
  const b = issueType.toLowerCase();
  return a.includes(b) || b.includes(a);
};

// No date here: dispatch emails the homeowner a link to pick a time — from the
// assignee's availability, or the company's hours when no one is assigned.
const UNASSIGNED = "none";

const EMPTY_DISPATCH_FORM = {
  staffId: "",
  notes: "",
};

export function DispatchTicketDialog({
  ticket,
  onClose,
  onDispatched,
}: {
  ticket: DispatchTicketTarget | null;
  onClose: () => void;
  // `notice` is set when the dispatch saved but something after it (the email) failed.
  onDispatched: (notice?: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_DISPATCH_FORM);
  const [error, setError] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [trades, setTrades] = useState<TradeOption[]>([]);

  // Loaded here so every page that opens the dialog offers trades.
  useEffect(() => {
    if (!ticket) return;
    fetch("/api/trades")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TradeOption[]) => setTrades(rows.filter((t) => t.isActive)))
      .catch(() => setTrades([]));
  }, [ticket]);

  const matching = ticket ? trades.filter((t) => tradeMatches(t.tradeType, ticket.issueType)) : [];
  const otherTrades = trades.filter((t) => !matching.includes(t));
  const pickedTrade = trades.find((t) => t.user.id === form.staffId);
  const tradeLabel = (t: TradeOption) =>
    `${t.user.name || t.user.email}${t.businessName ? ` (${t.businessName})` : ""} · ${t.tradeType}`;

  const close = () => {
    setForm(EMPTY_DISPATCH_FORM);
    setError("");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setError("");

    setDispatching(true);
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: form.staffId && form.staffId !== UNASSIGNED ? form.staffId : null,
          notes: form.notes.trim() || null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Failed to dispatch the ticket.");
        return;
      }

      close();
      await onDispatched(data.notice);
    } catch (err) {
      console.error("Error dispatching ticket:", err);
      setError("Error connecting to server.");
    } finally {
      setDispatching(false);
    }
  };

  return (
    <AnimatePresence>
      {ticket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative border dark:border-gray-800 my-8"
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-4 top-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-600 transition"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 border-b dark:border-gray-800 pb-4">
              <div className="bg-[#0F3B3D] p-2.5 rounded-2xl text-white">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#0F3B3D] dark:text-[#E8B86B]">
                  Dispatch Ticket
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Send the homeowner a link to book the repair visit.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border dark:border-gray-800 bg-muted/20 p-3 mb-4 space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {ticket.issueType}
              </p>
              <p className="text-xs text-muted-foreground">
                {ticket.homeowner?.name || "Unknown homeowner"}
                {ticket.property?.address ? ` · ${ticket.property.address}` : ""}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="font-semibold">
                  Assign a trade <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select
                  value={form.staffId}
                  onValueChange={(val) => setForm((f) => ({ ...f, staffId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No one yet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>No one yet</SelectItem>
                    {matching.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Trades for {ticket.issueType}</SelectLabel>
                        {matching.map((t) => (
                          <SelectItem key={t.user.id} value={t.user.id}>{tradeLabel(t)}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {otherTrades.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{matching.length ? "Other trades" : "Trades"}</SelectLabel>
                        {otherTrades.map((t) => (
                          <SelectItem key={t.user.id} value={t.user.id}>{tradeLabel(t)}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {trades.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No trades yet. Add them on the{" "}
                    <a href="/warranty/trades" className="underline">Trades</a> page, or dispatch without one.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dispatchNotes" className="font-semibold">Notes for the visit</Label>
                <Textarea
                  id="dispatchNotes"
                  rows={3}
                  placeholder="Anything the visiting team should know before turning up"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border dark:border-gray-800 p-3">
                <CalendarClock className="h-4 w-4 mt-0.5 text-[#0F3B3D] dark:text-[#E8B86B] shrink-0" />
                <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                  {form.staffId && form.staffId !== UNASSIGNED
                    ? `The homeowner is emailed a link to pick a time when ${pickedTrade?.user.name || "this trade"} is free (from their Calendly, if connected). The trade gets the full ticket now and a confirmation once a slot is chosen.`
                    : "No trade yet: the homeowner picks the time from your company's working hours, and admins get the confirmation once a slot is chosen."}
                </p>
              </div>

              {error && (
                <div className="text-red-600 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl text-sm font-semibold">
                  {error}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-3 border-t dark:border-gray-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={close}
                  className="text-gray-600"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={dispatching}
                  className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold gap-2"
                >
                  {dispatching ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Dispatching...</>
                  ) : (
                    <><Send className="h-4 w-4" /> Dispatch &amp; Send Link</>
                  )}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
