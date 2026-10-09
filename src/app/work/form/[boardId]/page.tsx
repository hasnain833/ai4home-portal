"use client";

// DEMO ONLY: public intake form, anyone with the link can add an item to a board.

import { use, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, SUPER_ADMIN, createItem, pushNotification, useWork, type Priority } from "../../store";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function BoardFormPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = use(params);
  const state = useWork();
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ name: "", description: "", priority: "MEDIUM" as Priority, reporter: "", email: "", values: {} as Record<string, string> });

  if (!state) return <div className="min-h-screen bg-background" />;
  const board = state.boards.find((b) => b.id === boardId);
  const textCols = board?.columns.filter((c) => c.type === "text" || c.type === "dropdown") ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!board) return;
    const values = Object.fromEntries(Object.entries(f.values).filter(([, v]) => v));
    const item = createItem(
      board.id,
      board.groups[0].id,
      f.name,
      { description: `${f.description}\n\nSubmitted by ${f.reporter} <${f.email}>`, priority: f.priority, values },
      `${f.reporter} submitted this via the public form`,
    );
    pushNotification(SUPER_ADMIN, `New form submission on ${board.name}: “${item.name}”`, item.id);
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-muted/60 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <BrandLogo className="h-8 w-auto" />
          <span className="text-sm text-muted-foreground">Request form</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        {!board ? (
          <p className="text-center text-muted-foreground">This form doesn&apos;t exist (the board may have been deleted).</p>
        ) : done ? (
          <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
            <h1 className="mt-4 text-2xl font-semibold">Thanks, we&apos;ve got it!</h1>
            <p className="mt-2 text-muted-foreground">Your request was added to <b>{board.name}</b> and the team has been notified.</p>
            <Button className="mt-6" onClick={() => { setDone(false); setF((x) => ({ ...x, name: "", description: "" })); }}>Submit another</Button>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">{board.name}</h1>
            <p className="mt-2 text-muted-foreground">{board.description || "Submit a request to our team."}</p>
            <form onSubmit={submit} className="mt-8 space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <div className="space-y-1.5">
                <Label htmlFor="f-name">Title</Label>
                <Input id="f-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-desc">Details</Label>
                <Textarea id="f-desc" required rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="f-prio">Urgency</Label>
                  <select id="f-prio" className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
                {textCols.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <Label htmlFor={`f-${c.id}`}>{c.name}</Label>
                    {c.type === "dropdown" ? (
                      <select id={`f-${c.id}`} className={selectCls} value={f.values[c.id] ?? ""} onChange={(e) => setF({ ...f, values: { ...f.values, [c.id]: e.target.value } })}>
                        <option value="">—</option>
                        {(c.options ?? []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <Input id={`f-${c.id}`} value={f.values[c.id] ?? ""} onChange={(e) => setF({ ...f, values: { ...f.values, [c.id]: e.target.value } })} />
                    )}
                  </div>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="f-rep">Your name</Label>
                  <Input id="f-rep" required value={f.reporter} onChange={(e) => setF({ ...f, reporter: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-email">Email</Label>
                  <Input id="f-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </div>
              </div>
              <Button type="submit" size="lg"><Send /> Submit</Button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
