"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import KnowledgeBasePanel from "@/components/admin/prompt-lab/KnowledgeBasePanel";
import { api, errorMessage } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type Placeholder = { token: string; description: string; required: boolean };
type CoachPrompt = {
  key: string;
  label: string;
  description: string;
  placeholders: Placeholder[];
  defaultPrompt: string;
  prompt: string;
  isDefault: boolean;
};

const API = "/api/admin/sales-coach/prompts";

/** Prompt Lab tab for the Sales Coach: four prompts (save = live) and its own knowledge base. */
export default function SalesCoachLab() {
  const [saved, setSaved] = useState<CoachPrompt[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [active, setActive] = useState("buyer");
  const [tab, setTab] = useState<"prompt" | "kb">("prompt");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get<{ prompts: CoachPrompt[] }>(API)
      .then((data) => {
        setSaved(data.prompts);
        setDrafts(Object.fromEntries(data.prompts.map((p) => [p.key, p.prompt])));
      })
      .catch((e) => toast.error(errorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const current = saved?.find((p) => p.key === active);
  const dirtyKeys = (saved ?? []).filter((p) => drafts[p.key] !== p.prompt).map((p) => p.key);

  const save = async (prompts: Record<string, string>) => {
    setSaving(true);
    try {
      await api.put(API, { prompts });
      toast.success("Saved — the next role-play message uses it");
      await load();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const { dialog: unsavedDialog } = useUnsavedChanges({
    dirty: dirtyKeys.length > 0,
    itemName:
      dirtyKeys.length === 1
        ? `the "${saved?.find((p) => p.key === dirtyKeys[0])?.label ?? dirtyKeys[0]}" coach prompt`
        : `${dirtyKeys.length} Sales Coach prompts`,
    onSave: () => save(Object.fromEntries(dirtyKeys.map((k) => [k, drafts[k]]))),
  });

  const tabClass = (on: boolean) =>
    `flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {unsavedDialog}
      <CardHeader className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          <button type="button" onClick={() => setTab("prompt")} className={tabClass(tab === "prompt")}>
            <FlaskConical className="h-3.5 w-3.5" /> Prompts
          </button>
          <button type="button" onClick={() => setTab("kb")} className={tabClass(tab === "kb")}>
            <BookOpen className="h-3.5 w-3.5" /> Knowledge base
          </button>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/admin/sales-coach" target="_blank">
            Try it in Sales Coach <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3">
        {tab === "kb" ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              Training material for the team: pricing, competitor notes, objection scripts. Only the Sales Coach reads
              these. It also reads the B2B agent&apos;s knowledge base for product facts.
            </p>
            <KnowledgeBasePanel agent="coach" />
          </>
        ) : !saved || !current ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {saved.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setActive(p.key)}
                  aria-pressed={active === p.key}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active === p.key ? "border-[#0F3B3D] bg-[#0F3B3D] text-white" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {p.label}
                  {dirtyKeys.includes(p.key) ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
                  ) : (
                    !p.isDefault && <span className="h-1.5 w-1.5 rounded-full bg-[#b48c3c]" title="Edited" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{current.description}</p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={saving || (current.isDefault && drafts[active] === current.defaultPrompt)}
                onClick={() => save({ [active]: "" })}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset to built-in
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {current.placeholders.map((p) => (
                <code
                  key={p.token}
                  title={p.description}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {`{{${p.token}}}`}
                  {p.required && "*"}
                </code>
              ))}
              <span className="text-[10px] text-muted-foreground">* must stay in the prompt</span>
            </div>

            <Textarea
              value={drafts[active] ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [active]: e.target.value })}
              aria-label={`${current.label} prompt`}
              className="min-h-80 flex-1 resize-none field-sizing-fixed font-mono text-[11px] leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Scenarios, the scoring rubric and its weights stay in code.
              </p>
              <Button
                size="sm"
                disabled={saving || !dirtyKeys.length}
                onClick={() => save(Object.fromEntries(dirtyKeys.map((k) => [k, drafts[k]])))}
              >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save &amp; go live{dirtyKeys.length > 1 ? ` (${dirtyKeys.length})` : ""}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
