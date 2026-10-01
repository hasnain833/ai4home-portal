"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Loader2, Send, CalendarClock } from "lucide-react";

export interface DispatchStaffOption {
  id: string;
  name: string | null;
  email: string;
}

export interface DispatchTicketTarget {
  id: string;
  issueType: string;
  homeowner?: { name?: string | null } | null;
  property?: { address?: string | null } | null;
}

// No date here: dispatch assigns the staff member and emails the homeowner a
// link to pick a time from that person's availability.
const EMPTY_DISPATCH_FORM = {
  staffId: "",
  notes: "",
};

export function DispatchTicketDialog({
  ticket,
  staff,
  onClose,
  onDispatched,
}: {
  ticket: DispatchTicketTarget | null;
  staff: DispatchStaffOption[];
  onClose: () => void;
  // `notice` is set when the dispatch saved but something after it (the email) failed.
  onDispatched: (notice?: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_DISPATCH_FORM);
  const [error, setError] = useState("");
  const [dispatching, setDispatching] = useState(false);

  const close = () => {
    setForm(EMPTY_DISPATCH_FORM);
    setError("");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setError("");

    if (!form.staffId) {
      setError("Please choose a staff member.");
      return;
    }

    setDispatching(true);
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: form.staffId,
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
                  Assign a staff member and book the repair visit.
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
                <Label className="font-semibold">Assign to</Label>
                <Select
                  value={form.staffId}
                  onValueChange={(val) => setForm((f) => ({ ...f, staffId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name || member.email} &mdash; {member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {staff.length === 0 && (
                  <p className="text-xs text-amber-600">
                    No staff members yet. Add one on the Staff page first.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dispatchNotes" className="font-semibold">Notes for the visit</Label>
                <Textarea
                  id="dispatchNotes"
                  rows={3}
                  placeholder="Anything the staff member should know before turning up"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border dark:border-gray-800 p-3">
                <CalendarClock className="h-4 w-4 mt-0.5 text-[#0F3B3D] dark:text-[#E8B86B] shrink-0" />
                <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                  The homeowner picks the time. They&apos;re emailed a link showing when
                  this staff member is free; the staff member gets the full ticket now
                  and a confirmation once a slot is chosen.
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
