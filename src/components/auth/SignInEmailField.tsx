"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Clock, X } from "lucide-react";
import { motion } from "framer-motion";

/**
 * The address the signed-in user actually signs in with (User.email), not the
 * company contact address. Changing it never takes effect inline: the server
 * mails a confirmation link to the new address and the change lands only when
 * that link is opened.
 */
export function SignInEmailField({
  onNotify,
}: {
  onNotify?: (type: "success" | "error", text: string) => void;
}) {
  const { user, refreshUser } = useAuth();

  const [value, setValue] = useState(user?.email || "");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentEmail = user?.email || "";
  const pendingEmail = user?.pendingEmail || null;
  const dirty = value.trim().toLowerCase() !== currentEmail.toLowerCase();

  const notify = (type: "success" | "error", text: string) => {
    if (onNotify) onNotify(type, text);
    else if (type === "error") setError(text);
  };

  const handleSubmit = async () => {
    const next = value.trim().toLowerCase();
    if (!next) return setError("Email is required");
    if (!/^\S+@\S+\.\S+$/.test(next)) return setError("Invalid email format");
    if (!dirty) return;

    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Could not request the email change");
        notify("error", data.message || "Could not request the email change");
        return;
      }

      notify("success", data.message || `Confirmation sent to ${next}`);
      await refreshUser();
    } catch {
      const message = "Could not reach the server. Please try again.";
      setError(message);
      notify("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await fetch("/api/auth/email-change/cancel", { method: "POST" });
      await refreshUser();
      setValue(currentEmail);
      setError(null);
      notify("success", "Pending email change cancelled");
    } catch {
      notify("error", "Could not cancel the pending change");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <Label className="text-sm font-semibold">Sign-in Email *</Label>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="email"
          className="pl-9 pr-24"
          value={value}
          disabled={submitting}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="you@company.com"
        />
        {dirty && (
          <Button
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-1.5">
        This is the address you sign in with. Changing it sends a confirmation link to the
        new address — the change only takes effect once you open it.
      </p>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-red-500 mt-1"
        >
          {error}
        </motion.p>
      )}

      {pendingEmail && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-900/50 dark:bg-amber-950/20"
        >
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="text-amber-800 dark:text-amber-300">
              Awaiting confirmation at <strong>{pendingEmail}</strong>. You still sign in
              with {currentEmail} until that link is opened.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-amber-700 hover:text-amber-900 dark:text-amber-400"
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
