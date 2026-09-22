"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, MailWarning, Trash2, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  // The dropdown carries only what still needs attention; everything ever
  // received lives in the archive dialog.
  const [items, setItems] = useState<Notification[]>([]);
  const [archive, setArchive] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const res = await fetch("/api/notifications?limit=20&unreadOnly=true", {
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

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=100", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setArchive(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      // Leave whatever was already on screen.
    } finally {
      setArchiveLoading(false);
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

  const openArchive = () => {
    setOpen(false);
    setShowAll(true);
    void loadArchive();
  };

  const markRead = async (id: string) => {
    // Reading is what clears it from the bell — it stays in the archive.
    setItems((prev) => prev.filter((n) => n.id !== id));
    setArchive((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
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
    setItems([]);
    setArchive((prev) => prev.map((n) => ({ ...n, isRead: true })));
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

  const remove = async (id: string) => {
    const wasUnread = archive.find((n) => n.id === id)?.isRead === false;
    setBusyId(id);
    setArchive((prev) => prev.filter((n) => n.id !== id));
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnread((c) => Math.max(0, c - 1));
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("delete failed");
      const data = await res.json().catch(() => ({}));
      if (typeof data.unreadCount === "number") setUnread(data.unreadCount);
    } catch {
      // Put it back rather than leaving the screen lying about what was deleted.
      await loadArchive();
    } finally {
      setBusyId(null);
    }
  };

  const clearRead = async () => {
    const readOnes = archive.filter((n) => n.isRead);
    if (readOnes.length === 0) return;
    setArchive((prev) => prev.filter((n) => !n.isRead));
    try {
      const res = await fetch("/api/notifications/read", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("clear failed");
    } catch {
      await loadArchive();
    }
  };

  const onSelect = async (n: Notification) => {
    if (!n.isRead) await markRead(n.id);
    setOpen(false);
    setShowAll(false);
    if (n.link) router.push(n.link);
  };

  const renderMeta = (n: Notification) => (
    <>
      <p className="text-xs text-muted-foreground">{n.body}</p>
      {n.emailFallback && (
        // The homeowner was not emailed. Say so, so nobody assumes the
        // notification and the email went out together.
        <p className="flex items-center gap-1 text-[11px] text-amber-600">
          <MailWarning className="h-3 w-3 shrink-0" />
          No email sent — email delivery is temporarily unavailable.
        </p>
      )}
    </>
  );

  return (
    <>
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
                You&apos;re all caught up.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onSelect(n)}
                  className="flex w-full flex-col items-start gap-1 border-b bg-muted/30 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60"
                >
                  <div className="flex w-full items-start gap-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="flex-1 text-sm font-semibold">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="pl-4">{renderMeta(n)}</div>
                </button>
              ))
            )}
          </div>

          <button
            onClick={openArchive}
            className="w-full border-t px-3 py-2.5 text-center text-xs font-semibold text-primary hover:bg-muted/50"
          >
            Show all notifications
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-w-2xl p-0 gap-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="text-base">All notifications</DialogTitle>
            <DialogDescription className="text-xs">
              Everything you&apos;ve received, read or not. Deleting one removes it for good.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto">
            {archiveLoading && archive.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">Loading…</p>
            ) : archive.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
              </div>
            ) : (
              <ul>
                {archive.map((n) => (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 border-b px-5 py-3 last:border-b-0 ${
                      n.isRead ? "" : "bg-muted/30"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(n)}
                      className="min-w-0 flex-1 space-y-1 text-left"
                    >
                      <div className="flex items-start gap-2">
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
                      <div className={n.isRead ? "" : "pl-4"}>{renderMeta(n)}</div>
                    </button>

                    <button
                      onClick={() => remove(n.id)}
                      disabled={busyId === n.id}
                      aria-label={`Delete notification: ${n.title}`}
                      title="Delete"
                      className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground/70 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {archive.some((n) => n.isRead) && (
            <div className="flex justify-end border-t px-5 py-3">
              <button
                onClick={clearRead}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear read notifications
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default NotificationBell;
