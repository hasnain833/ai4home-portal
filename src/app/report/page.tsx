"use client";

// DEMO ONLY: public "report a bug / request a feature" page backed by mock localStorage data.

import { useState } from "react";
import { Bug, Lightbulb, Sparkles, HelpCircle, CheckCircle2, Send } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AREAS, PRIORITIES, createTicket, type TicketPriority, type TicketType } from "@/lib/demo-tickets";

const TYPE_CARDS: { key: TicketType; label: string; hint: string; icon: typeof Bug; tone: string }[] = [
  { key: "BUG", label: "Report a bug", hint: "Something isn't working", icon: Bug, tone: "text-red-500" },
  { key: "FEATURE", label: "Request a feature", hint: "Something new you need", icon: Lightbulb, tone: "text-[#b48c3c]" },
  { key: "IMPROVEMENT", label: "Suggest improvement", hint: "Make something better", icon: Sparkles, tone: "text-primary dark:text-[#d4a853]" },
  { key: "QUESTION", label: "Ask a question", hint: "Need help or guidance", icon: HelpCircle, tone: "text-muted-foreground" },
];

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function ReportPage() {
  const [type, setType] = useState<TicketType>("BUG");
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM" as TicketPriority,
    area: AREAS[0],
    reporterName: "",
    reporterEmail: "",
    company: "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = createTicket({ ...form, type });
    setSubmitted(t.number);
  }

  function reset() {
    setSubmitted(null);
    setForm((f) => ({ ...f, title: "", description: "" }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/60 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <BrandLogo className="h-8 w-auto" />
          <span className="text-sm text-muted-foreground">Support &amp; Feedback</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        {submitted ? (
          <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
            <h1 className="mt-4 text-2xl font-semibold">Thanks, we&apos;ve got it!</h1>
            <p className="mt-2 text-muted-foreground">
              Your ticket <span className="font-mono font-semibold text-foreground">#{submitted}</span> has been
              created and our team has been notified.
            </p>
            <Button className="mt-6" onClick={reset}>
              Submit another
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">How can we help?</h1>
            <p className="mt-2 text-muted-foreground">
              Report a problem or tell us what you&apos;d like to see next in AI4Home.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TYPE_CARDS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setType(c.key)}
                  className={`rounded-xl border bg-card p-4 text-left transition hover:shadow-md ${
                    type === c.key ? "border-primary ring-2 ring-primary/30" : ""
                  }`}
                >
                  <c.icon className={`size-6 ${c.tone}`} />
                  <div className="mt-3 text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.hint}</div>
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="mt-6 space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  required
                  value={form.title}
                  onChange={set("title")}
                  placeholder={type === "BUG" ? "e.g. Chat freezes when uploading photos" : "e.g. Export tickets to Excel"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">
                  {type === "BUG" ? "What happened? Steps to reproduce" : "Describe it"}
                </Label>
                <Textarea id="description" required rows={5} value={form.description} onChange={set("description")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="area">Area of the platform</Label>
                  <select id="area" className={selectCls} value={form.area} onChange={set("area")}>
                    {AREAS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="priority">How urgent is it?</Label>
                  <select id="priority" className={selectCls} value={form.priority} onChange={set("priority")}>
                    {PRIORITIES.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" required value={form.reporterName} onChange={set("reporterName")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={form.reporterEmail} onChange={set("reporterEmail")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" value={form.company} onChange={set("company")} />
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full sm:w-auto">
                <Send /> Submit ticket
              </Button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
