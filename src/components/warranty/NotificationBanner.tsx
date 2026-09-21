"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, ChevronUp, MailWarning, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Notification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  emailFallback: boolean;
  createdAt: string;
};

/**
 * Slim unread bar for the tickets page. Renders nothing at all when there is
 * nothing unread, so it never takes up space on a quiet day.
 */
export function NotificationBanner({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10&unreadOnly=true", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
    } catch {
      // Silent — the bell in the sidebar is the primary surface.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/notifications?limit=10&unreadOnly=true", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setItems(data.notifications ?? []);
      } catch {
        // Silent.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const markAllRead = async () => {
    setItems([]);
    try {
      await fetch("/api/notifications/read-all", {
        method: "PATCH",
        credentials: "include",
      });
    } catch {
      void load();
    }
  };

  const open = async (n: Notification) => {
    try {
      await fetch(`/api/notifications/${n.id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
    } catch {
      // Navigate regardless — the read flag is not worth blocking on.
    }
    if (n.link) router.push(n.link);
  };

  if (dismissed || items.length === 0) return null;

  const count = items.length;
  const latest = items[0];

  return (
    <div
      className={`rounded-xl border border-secondary/40 bg-secondary/10 px-4 py-3 ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/20">
          <Bell className="h-4 w-4 text-primary" />
        </span>

        <button
          onClick={() => (count === 1 ? open(latest) : setExpanded((v) => !v))}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 text-sm font-semibold text-foreground">
            {count} new notification{count === 1 ? "" : "s"}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            — {latest.title}
          </span>
          {count > 1 &&
            (expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ))}
        </button>

        <button
          onClick={markAllRead}
          className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Mark all read
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss notifications banner"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {expanded && count > 1 && (
        <ul className="mt-3 space-y-1 border-t border-secondary/30 pt-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-secondary/15"
              >
                <div className="flex w-full items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">{n.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{n.body}</span>
                {n.emailFallback && (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600">
                    <MailWarning className="h-3 w-3 shrink-0" />
                    No email sent — email delivery is temporarily unavailable.
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default NotificationBanner;
