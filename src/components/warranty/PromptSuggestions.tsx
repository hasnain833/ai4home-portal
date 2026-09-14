"use client";

import { Sparkles } from "lucide-react";

type Props = {
  title?: string;
  items: string[];
  onSelect: (item: string) => void;
  disabled?: boolean;
};

export default function PromptSuggestions({
  title = "Suggestions",
  items,
  onSelect,
  disabled = false,
}: Props) {
  if (!items.length) return null;

  return (
    <div className="mb-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item)}
            title={item}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Sparkles size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{item}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
