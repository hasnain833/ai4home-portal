"use client";

// DEMO ONLY: in-app bug/feature report, writes to the mock ticket store.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Bug, HelpCircle, Lightbulb, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AREAS, PRIORITIES, createTicket, type TicketPriority, type TicketType } from "@/lib/demo-tickets";

const TYPE_OPTS: { key: TicketType; label: string; icon: typeof Bug; tone: string }[] = [
  { key: "BUG", label: "Bug", icon: Bug, tone: "text-red-500" },
  { key: "FEATURE", label: "Feature", icon: Lightbulb, tone: "text-[#b48c3c]" },
  { key: "IMPROVEMENT", label: "Improvement", icon: Sparkles, tone: "text-primary dark:text-[#d4a853]" },
  { key: "QUESTION", label: "Question", icon: HelpCircle, tone: "text-muted-foreground" },
];

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function ReportIssueDialog({
  open,
  onOpenChange,
  defaultType = "BUG",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultType?: TicketType;
}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [type, setType] = useState<TicketType>(defaultType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [area, setArea] = useState(AREAS[0]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = createTicket({
      type,
      title,
      description: `${description}\n\nReported from page: ${pathname}`,
      priority,
      area,
      reporterName: user?.name ?? "Portal user",
      reporterEmail: user?.email ?? "",
      company: user?.companyName,
    });
    toast.success(`Ticket #${t.number} submitted`, { description: "Our team has been notified." });
    setTitle("");
    setDescription("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an issue or request a feature</DialogTitle>
          <DialogDescription>Goes straight to the AI4Home product team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {TYPE_OPTS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setType(o.key)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition hover:bg-muted ${
                  type === o.key ? "border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                }`}
              >
                <o.icon className={`size-5 ${o.tone}`} />
                {o.label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ri-title">Title</Label>
            <Input id="ri-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ri-desc">{type === "BUG" ? "What happened? Steps to reproduce" : "Details"}</Label>
            <Textarea id="ri-desc" required rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ri-area">Area</Label>
              <select id="ri-area" className={selectCls} value={area} onChange={(e) => setArea(e.target.value)}>
                {AREAS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ri-prio">Urgency</Label>
              <select id="ri-prio" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Submitting as <span className="font-medium text-foreground">{user?.name ?? "you"}</span>
            {user?.companyName && <> · {user.companyName}</>}. We&apos;ll attach the page you&apos;re on.
          </p>
          <Button type="submit" className="w-full">Submit</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
