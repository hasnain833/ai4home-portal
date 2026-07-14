"use client";

import { useCallback, useEffect, useRef } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, Eraser } from "lucide-react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  id?: string;
};

export default function RichTextEditor({ value, onChange, placeholder, id }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
  }, [value]);

  const emit = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const exec = useCallback(
    (command: string, arg?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, arg);
      emit();
    },
    [emit],
  );

  const addLink = useCallback(() => {
    const url = window.prompt("Link URL (https://…)");
    if (!url) return;
    exec("createLink", url);
  }, [exec]);

  const isEmpty = !value || value === "<br>" || value.replace(/<[^>]*>/g, "").trim() === "";

  const btn =
    "h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition";

  return (
    <div className="rounded-xl border bg-background focus-within:ring-1 focus-within:ring-[#b48c3c]">
      <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
        <button type="button" className={btn} title="Bold" onClick={() => exec("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Italic" onClick={() => exec("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Underline" onClick={() => exec("underline")}>
          <Underline className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={btn} title="Bullet list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Insert link" onClick={addLink}>
          <Link2 className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={btn} title="Clear formatting" onClick={() => exec("removeFormat")}>
          <Eraser className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-4 top-3 text-xs text-muted-foreground">
            {placeholder}
          </div>
        )}
        <div
          id={id}
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          onBlur={emit}
          className="rte-content min-h-40 w-full px-4 py-3 text-sm leading-relaxed outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#b48c3c] [&_a]:underline"
        />
      </div>
    </div>
  );
}
