"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, MailWarning } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Notification = {
  id: string;
  type: "TICKET_CREATED" | "TICKET_REMINDER" | "TICKET_STATUS_CHANGED";
  title: string;
  body: string;
  link: string | null;
  ticketId: string | null;
  isRead: boolean;
  emailFallback: boolean;
  createdAt: string;
};

const POLL_MS = 60_000;

export function NotificationBell({
  expanded = false,
  className = "",
}: {
  /** Sidebar is expanded — show the "Notifications" label next to the icon. */
  expanded?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnread(data.unreadCount ?? 0);
    } catch {
      // A failed poll is not worth surfacing — the next one will catch up.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      // Leave whatever was already on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for the badge only. The list is fetched when the panel opens, so a
  // closed bell costs one small request a minute. The fetch is kicked off
  // asynchronously so the effect body never sets state synchronously.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/notifications/unread-count", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setUnread(data.unreadCount ?? 0);
      } catch {
        // A failed poll is not worth surfacing — the next one will catch up.
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void loadList();
  };

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
    } catch {
      loadCount();
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await fetch("/api/notifications/read-all", {
        method: "PATCH",
        credentials: "include",
      });
    } catch {
      loadCount();
    }
  };

  const onSelect = async (n: Notification) => {
    if (!n.isRead) await markRead(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={expanded ? "sm" : "icon"}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className={`relative ${expanded ? "w-full justify-start" : ""} ${className}`}
        >
          <span className="relative inline-flex">
            <Bell className={`h-4 w-4 ${expanded ? "mr-2" : ""}`} />
            {unread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </span>
          {expanded && "Notifications"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading && items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => onSelect(n)}
                className={`flex w-full flex-col items-start gap-1 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60 ${
                  n.isRead ? "" : "bg-muted/30"
                }`}
              >
                <div className="flex w-full items-start gap-2">
                  {!n.isRead && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <span
                    className={`flex-1 text-sm ${n.isRead ? "font-normal" : "font-semibold"}`}
                  >
                    {n.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="pl-4 text-xs text-muted-foreground">{n.body}</p>
                {n.emailFallback && (
                  // The homeowner was not emailed. Say so, so nobody assumes
                  // the notification and the email went out together.
                  <p className="flex items-center gap-1 pl-4 text-[11px] text-amber-600">
                    <MailWarning className="h-3 w-3 shrink-0" />
                    No email sent — email delivery is temporarily unavailable.
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
