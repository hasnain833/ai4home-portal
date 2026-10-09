"use client";

import { useEffect, useState } from "react";
import { BookOpen, Bot, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HelpChatPanel } from "@/components/layout/HelpChat";
import KnowledgeBasePanel from "@/components/admin/prompt-lab/KnowledgeBasePanel";

type Placeholder = { token: string; description: string };
type HelpAgent = { prompt: string; isDefault: boolean; defaultPrompt: string; placeholders: Placeholder[] };

export default function HelpAgentLab() {
  const [agent, setAgent] = useState<HelpAgent | null>(null);
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"prompt" | "kb">("prompt");

  useEffect(() => {
    fetch("/api/admin/help-agent")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Could not load the Help Agent");
        setAgent(data);
        setPrompt(data.prompt);
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/help-agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not save");
      const next = value.trim() ? value : agent!.defaultPrompt;
      setAgent({ ...agent!, prompt: next, isDefault: data.isDefault });
      setPrompt(next);
      toast.success(data.isDefault ? "Using the built-in prompt" : "Saved — builders get it on their next question");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const dirty = agent !== null && prompt !== agent.prompt;
  const tabClass = (on: boolean) =>
    `flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3">
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            <button type="button" onClick={() => setTab("prompt")} className={tabClass(tab === "prompt")}>
              <FlaskConical className="h-3.5 w-3.5" /> Prompt
            </button>
            <button type="button" onClick={() => setTab("kb")} className={tabClass(tab === "kb")}>
              <BookOpen className="h-3.5 w-3.5" /> Knowledge base
            </button>
          </div>
          {tab === "prompt" && agent && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => save("")}
              disabled={saving || (agent.isDefault && !dirty)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to built-in
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pb-3">
          {tab === "kb" ? (
            <KnowledgeBasePanel agent="help" />
          ) : !agent ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {agent.placeholders.map((p) => (
                  <code
                    key={p.token}
                    title={p.description}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {`{{${p.token}}}`}
                  </code>
                ))}
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="Help Agent prompt"
                className="min-h-80 flex-1 resize-none font-mono text-[11px] leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">
                <code>{"{{portalGuide}}"}</code> adds the built-in guide to every page and workflow in the portal.
                Upload docs on the Knowledge base tab for anything else.
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => save(prompt)} disabled={saving || !dirty}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save &amp; go live
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-[#b48c3c]" /> Test the Help Agent
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">Uses the prompt on the left, saved or not.</p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col pb-3">
          <HelpChatPanel draftPrompt={dirty ? prompt : undefined} className="min-h-96 flex-1" />
        </CardContent>
      </Card>
    </div>
  );
}
