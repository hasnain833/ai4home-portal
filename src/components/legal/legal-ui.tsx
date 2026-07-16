import type { ReactNode } from "react";

// Shared presentational helpers for the legal pages (Terms, Privacy) so both
// read as one consistent, theme-aware document.

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-lg font-semibold text-foreground scroll-mt-24">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground/60">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// Bracketed placeholders (legal entity, jurisdiction, contact) that a company
// fills in. Rendered so they're visually obvious and easy to find/replace.
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      {children}
    </span>
  );
}
