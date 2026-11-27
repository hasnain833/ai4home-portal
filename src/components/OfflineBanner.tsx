"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { CONNECTION_LOST_EVENT, RECONNECTED_EVENT } from "@/lib/api";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Seconds to wait before each automatic attempt; the last value repeats.
const BACKOFF_S = [2, 4, 8, 15, 30];

/**
 * App-wide connection status. Offline (the browser says so) and reconnecting (the browser is
 * online but our server didn't answer) both keep the page as it is; nothing already loaded is hidden.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [serverLost, setServerLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const shown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lost = !online || serverLost;

  useEffect(() => {
    // Going offline also counts as lost, so coming back online checks the server before saying so.
    const onLost = () => setServerLost(true);
    window.addEventListener(CONNECTION_LOST_EVENT, onLost);
    window.addEventListener("offline", onLost);
    return () => {
      window.removeEventListener(CONNECTION_LOST_EVENT, onLost);
      window.removeEventListener("offline", onLost);
    };
  }, []);

  const recovered = useCallback(() => {
    setServerLost(false);
    setAttempt(0);
    window.dispatchEvent(new Event(RECONNECTED_EVENT));
    if (shown.current) toast.success("You're back online.");
    shown.current = false;
  }, []);

  const check = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setChecking(true);
    setAttempt((n) => n + 1);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) return recovered();
    } catch {
      /* still unreachable */
    } finally {
      setChecking(false);
    }
    setServerLost(true);
  }, [recovered]);

  // While online but unreachable, try again on a growing delay. Offline: wait for the browser's "online".
  useEffect(() => {
    if (!lost) return;
    shown.current = true;
    if (!online || checking) return;
    const delay = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)] * 1000;
    timer.current = setTimeout(check, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [lost, online, attempt, checking, check]);

  if (!lost) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-100 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-muted/95 px-4 py-2 text-center text-sm text-foreground shadow-sm backdrop-blur"
    >
      {!online ? (
        <>
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>
            You&apos;re offline. You can keep reading this page; changes won&apos;t save until you&apos;re back online.
          </span>
        </>
      ) : (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>
            Reconnecting to the server{attempt > 0 ? ` (attempt ${attempt})` : ""}…
          </span>
          <button
            type="button"
            onClick={check}
            disabled={checking}
            className="font-medium underline underline-offset-2 disabled:opacity-60"
          >
            Retry now
          </button>
        </>
      )}
    </div>
  );
}
