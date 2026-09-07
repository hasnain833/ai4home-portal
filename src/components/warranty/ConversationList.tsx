"use client";

import { MessageSquare, Loader2 } from "lucide-react";

export interface ConversationSummary {
  id: string;
  phase: string;
  status: string;
  ticketId: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  RESOLVED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ESCALATED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  CLOSED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/**
 * The list of past warranty conversations.
 *
 * Lives in its own file because it is rendered inside the chat surface itself
 * (WarrantyChat's history drawer) rather than beside it. It was previously
 * defined in the chat page and duplicated between a desktop sidebar and a mobile
 * dialog; there is one copy now, and one place it appears.
 */
export default function ConversationList({
  conversations,
  loading,
  activeId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  activeId: string | null | undefined;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
        No past conversations yet. Anything you start here is saved so you can pick it back
        up later.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
              c.id === activeId
                ? "bg-slate-200/70 dark:bg-slate-700/50"
                : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
            }`}
          >
            <div className="flex items-start gap-2">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                  {c.preview || "Untitled conversation"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {new Date(c.updatedAt).toLocaleDateString()}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      STATUS_STYLES[c.status] || STATUS_STYLES.CLOSED
                    }`}
                  >
                    {c.status}
                  </span>
                  {c.ticketId && (
                    <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400">
                      {c.ticketId}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
