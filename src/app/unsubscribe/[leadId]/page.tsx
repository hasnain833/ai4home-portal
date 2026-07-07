"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function UnsubscribePage() {
  const params = useParams();
  const leadId = Array.isArray(params.leadId) ? params.leadId[0] : params.leadId;

  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!leadId) {
      setState("error");
      setMessage("This unsubscribe link is invalid.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/compliance/unsubscribe-link/${leadId}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.success) {
          setCompanyName(data.companyName || null);
          setEmail(data.email || null);
          setState("success");
        } else {
          setMessage(data.message || "We couldn't process your request.");
          setState("error");
        }
      } catch {
        if (!cancelled) {
          setMessage("Network error. Please try again.");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="bg-[#0F3B3D] px-8 py-6 text-center border-b-[3px] border-[#b48c3c]">
          <h1 className="text-white text-xl font-semibold">{companyName || "Sales & Warranty Portal"}</h1>
        </div>

        <div className="p-8 text-center">
          {state === "loading" && (
            <>
              <Loader2 className="h-10 w-10 text-[#b48c3c] animate-spin mx-auto" />
              <p className="mt-4 text-sm text-muted-foreground">Processing your request…</p>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <h2 className="mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">You&apos;ve been unsubscribed</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {email ? (
                  <>
                    <span className="font-medium">{email}</span> will no longer receive marketing emails
                    {companyName ? <> from {companyName}</> : null}.
                  </>
                ) : (
                  <>You will no longer receive these messages.</>
                )}
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Changed your mind? Contact {companyName || "the sender"} to opt back in.
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle className="h-12 w-12 text-red-500 mx-auto" />
              <h2 className="mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            </>
          )}
        </div>

        <div className="px-8 py-4 border-t border-border/60 text-center">
          <p className="text-[11px] text-muted-foreground">&copy; 2026 {companyName || "Sales & Warranty Portal"}. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
