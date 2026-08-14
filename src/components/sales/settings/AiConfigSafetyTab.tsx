"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  History,
  RotateCcw,
  FlaskConical,
  BookOpen,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";


interface ConfigVersion {
  id: string;
  version: number;
  changeType: string;
  note: string | null;
  createdAt: string;
  snapshot: {
    voiceProfile?: string | null;
    appointmentMode?: string | null;
    agentMaxTurns?: number | null;
    salesBrandProfile?: Record<string, unknown> | null;
  };
}

interface PreviewResult {
  draft: string;
  kbCitations: { documentId: string | null; name: string; category: string }[];
}

const PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC: "Claude",
  OPENAI: "OpenAI",
  GROQ: "Groq",
};

// One provider serves every drafting tool, so the guidance is about which mix of
// work a workspace does rather than which model to use per task.
const PROVIDERS = [
  {
    value: "anthropic",
    label: "Claude (Anthropic)",
    model: "claude-sonnet-5",
    keyLabel: "Claude (Anthropic) API Key",
    placeholder: "sk-ant-...",
    bestFor: "Blog drafts, brand voice, and the conversational sales agent",
    detail:
      "Strongest on long-form writing and on holding a brand voice across a whole post. This is the default, and the best pick if blog drafts and the sales agent matter most to you.",
  },
  {
    value: "openai",
    label: "OpenAI",
    model: "gpt-4o-mini",
    keyLabel: "OpenAI API Key",
    placeholder: "sk-...",
    bestFor: "A balance of cost and quality across everything",
    detail:
      "Cheaper than Claude and solid on both short copy and longer drafts. A reasonable middle if your workspace does a bit of everything.",
  },
  {
    value: "groq",
    label: "Groq",
    model: "llama-3.3-70b-versatile",
    keyLabel: "Groq API Key",
    placeholder: "gsk_...",
    bestFor: "Short copy — SMS, subject lines, news summaries",
    detail:
      "By far the fastest and cheapest, and more than good enough for short, structured writing. Weaker on long blog posts and on subtle brand voice, so pick it if most of your AI use is campaign steps and summaries rather than articles.",
  },
] as const;

export default function AiConfigSafetyTab() {
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [aiProvider, setAiProvider] = useState("platform");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [anthropicMasked, setAnthropicMasked] = useState("");
  const [openAiMasked, setOpenAiMasked] = useState("");
  const [groqMasked, setGroqMasked] = useState("");
  // Which platform key an administrator has granted this workspace, if any.
  const [platformGrant, setPlatformGrant] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);

  // Preview state
  const [feature, setFeature] = useState<"nurture" | "blog">("nurture");
  const [goal, setGoal] = useState("Re-engage a lead who requested information but hasn't replied.");
  const [topic, setTopic] = useState("New energy-efficient homes in our community");
  const [candidateVoice, setCandidateVoice] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/kb/brand-profile/versions", { credentials: "include" });
      if (res.ok) {
        setVersions(await res.json());
      } else if (res.status !== 403) {
        toast.error("Could not load config history.");
      }
    } catch (e) {
      console.error("Failed to load config versions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProviderSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/company", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setAiProvider(data.aiProvider || "platform");
      setPlatformGrant(data.aiPlatformGrant || null);
      setAnthropicMasked(data.aiAnthropicKeyMasked || "");
      setOpenAiMasked(data.aiOpenAiKeyMasked || "");
      setGroqMasked(data.aiGroqKeyMasked || "");
    } catch (e) {
      console.error("Failed to load AI provider settings:", e);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadVersions();
      loadProviderSettings();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadVersions, loadProviderSettings]);

  const saveProviderSettings = async () => {
    setSavingProvider(true);
    try {
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aiProvider,
          ...(anthropicKey.trim() ? { aiAnthropicKey: anthropicKey.trim() } : {}),
          ...(openAiKey.trim() ? { aiOpenAiKey: openAiKey.trim() } : {}),
          ...(groqKey.trim() ? { aiGroqKey: groqKey.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Failed to save AI provider settings.");
        return;
      }
      setAnthropicKey("");
      setOpenAiKey("");
      setGroqKey("");
      toast.success("AI provider settings saved.");
      await loadProviderSettings();
    } catch (e) {
      console.error("Failed to save AI provider settings:", e);
      toast.error("Failed to save AI provider settings.");
    } finally {
      setSavingProvider(false);
    }
  };

  // Only the selected provider's key field is shown, so resolve which state pair
  // that field is bound to.
  const activeProvider = PROVIDERS.find((p) => p.value === aiProvider) || null;
  const activeKey =
    aiProvider === "openai"
      ? { value: openAiKey, set: setOpenAiKey, masked: openAiMasked }
      : aiProvider === "groq"
        ? { value: groqKey, set: setGroqKey, masked: groqMasked }
        : { value: anthropicKey, set: setAnthropicKey, masked: anthropicMasked };

  const rollback = async (version: number) => {
    setRollingBack(version);
    try {
      const res = await fetch(`/api/sales/kb/brand-profile/versions/${version}/rollback`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Rolled back to v${version}. Live config restored.`);
        await loadVersions();
      } else {
        toast.error(data.message || "Rollback failed.");
      }
    } catch (e) {
      console.error("Rollback failed:", e);
      toast.error("Rollback failed.");
    } finally {
      setRollingBack(null);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        feature,
        sample: feature === "blog" ? { topic } : { goal, stepType: "email" },
      };
      if (candidateVoice.trim()) body.config = { voiceProfile: candidateVoice.trim() };
      const res = await fetch("/api/sales/kb/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ draft: data.draft, kbCitations: data.kbCitations || [] });
      } else {
        toast.error(data.message || "Preview failed.");
      }
    } catch (e) {
      console.error("Preview failed:", e);
      toast.error("Preview failed.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-[#b48c3c]" />
            AI Provider &amp; Merge Tags
          </CardTitle>
          <CardDescription className="text-xs">
            Choose the provider used for campaign copy, calendar suggestions, blog drafts, and other sales AI drafting tools. Enter your own key, or use the platform key if your administrator has granted your workspace one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5 max-w-xs">
            <Label className="font-semibold text-xs">Provider</Label>
            <Select value={aiProvider} onValueChange={setAiProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="platform" disabled={!platformGrant}>
                  {platformGrant
                    ? "Platform key (" + (PROVIDER_LABELS[platformGrant] || platformGrant) + ")"
                    : "Platform key \u2014 not granted to your workspace"}
                </SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label} &mdash; my own key
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {aiProvider === "platform" ? (
            <div className="rounded-lg border border-border/70 bg-muted/25 p-4 text-[11px] text-muted-foreground">
              {platformGrant ? (
                <>
                  Your workspace uses the platform&apos;s {PROVIDER_LABELS[platformGrant] || platformGrant} key,
                  granted by your administrator &mdash; no key of your own is needed. To use your own instead,
                  pick a provider above and save its key.
                </>
              ) : (
                <>
                  Your administrator has not granted your workspace a platform key, so AI drafting is
                  currently switched off. Pick a provider above and enter your own key to turn it on.
                </>
              )}
            </div>
          ) : activeProvider ? (
            <div className="space-y-1.5 max-w-md">
              <Label className="font-semibold text-xs">{activeProvider.keyLabel}</Label>
              <Input
                type="password"
                placeholder={activeKey.masked || activeProvider.placeholder}
                value={activeKey.value}
                onChange={(e) => activeKey.set(e.target.value)}
                className="text-xs"
              />
              {activeKey.masked ? (
                <p className="text-[10px] text-muted-foreground">Saved key: {activeKey.masked}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  No key saved yet &mdash; AI drafting stays switched off until you add one.
                </p>
              )}
            </div>
          ) : null}

          <div className="rounded-lg border border-border/70 bg-muted/25 p-4 space-y-3">
            <h4 className="text-xs font-bold">Which provider should you pick?</h4>
            <p className="text-[11px] text-muted-foreground">
              This one choice covers every drafting tool &mdash; campaign copy, blog drafts,
              calendar suggestions, news summaries, and the sales agent. You can&apos;t currently
              use a different provider per task, so pick for the work you do most.
            </p>
            <ul className="space-y-2">
              {PROVIDERS.map((p) => (
                <li key={p.value} className="text-[11px]">
                  <span className="font-semibold text-foreground">{p.label}</span>{" "}
                  <code className="font-mono text-[10px] text-muted-foreground">{p.model}</code>
                  <span className="text-muted-foreground"> &mdash; {p.bestFor}.</span>{" "}
                  <span className="text-muted-foreground">{p.detail}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
              Knowledge-base search runs on a local embedding model that ships with the portal, so
              it is unaffected by this choice &mdash; which is why Groq, which has no embeddings
              API, is still a valid pick here.
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/25 p-4">
            <h4 className="text-xs font-bold mb-2">Supported merge tags for AI copy</h4>
            <div className="grid gap-2 sm:grid-cols-2 text-[11px] text-muted-foreground">
              <p><code className="font-mono text-foreground">{`{firstName}`}</code> lead first name</p>
              <p><code className="font-mono text-foreground">{`{lastName}`}</code> lead last name</p>
              <p><code className="font-mono text-foreground">{`{companyName}`}</code> builder/company name</p>
              <p><code className="font-mono text-foreground">{`{campaignName}`}</code> campaign name</p>
              <p><code className="font-mono text-foreground">{`{city}`}</code> lead city</p>
              <p><code className="font-mono text-foreground">{`{bookingLink}`}</code> appointment booking link</p>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Use these exact braces in subjects and message bodies. Example: Hi {`{firstName}`}, this is {`{companyName}`}.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveProviderSettings} disabled={savingProvider} size="sm" className="gap-1.5 h-8 text-xs bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
              {savingProvider && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save AI Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview / sandbox */}
      <Card className="border border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <FlaskConical className="h-4.5 w-4.5 text-[#b48c3c]" />
            Preview &amp; Sandbox
          </CardTitle>
          <CardDescription className="text-xs">
            Test how the AI features write with your current brand profile — or a candidate
            tone — before it affects any live send. Nothing here is saved or sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="font-semibold text-xs">Feature</Label>
              <Select value={feature} onValueChange={(v) => setFeature(v as "nurture" | "blog")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nurture">Nurture / campaign copy</SelectItem>
                  <SelectItem value="blog">Blog draft (sample section)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-semibold text-xs">Candidate voice (optional)</Label>
              <Input
                placeholder="e.g. warm and playful — leave blank to use saved voice"
                value={candidateVoice}
                onChange={(e) => setCandidateVoice(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {feature === "blog" ? (
            <div className="space-y-1.5">
              <Label className="font-semibold text-xs">Sample topic</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} className="text-xs" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="font-semibold text-xs">Sample goal</Label>
              <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} className="text-xs min-h-15" />
            </div>
          )}

          <Button onClick={runPreview} disabled={previewing} size="sm" className="gap-1.5 h-8 text-xs bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Run preview
          </Button>

          {result && (
            <div className="rounded-lg border border-border/60 bg-slate-50/60 dark:bg-slate-900/30 p-4 space-y-3">
              <p className="text-xs font-mono whitespace-pre-wrap text-slate-800 dark:text-slate-200">{result.draft}</p>
              {result.kbCitations.length > 0 && (
                <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
                  <BookOpen className="h-3 w-3 inline mr-1" />
                  Grounded in {result.kbCitations.length} KB document{result.kbCitations.length > 1 ? "s" : ""}:{" "}
                  {result.kbCitations.map((c) => c.name).join(", ")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Version history */}
      <Card className="border border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-[#b48c3c]" />
            Configuration History
          </CardTitle>
          <CardDescription className="text-xs">
            Every change to the brand profile and agent toggles is versioned. Roll back to any
            prior version if a change hurts your AI output.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <ShieldCheck className="h-6 w-6 opacity-40" />
              No versions yet. The first snapshot is written the next time you save the brand
              profile or agent settings.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {versions.map((v, idx) => (
                <li key={v.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tabular-nums">v{v.version}</span>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{v.changeType}</Badge>
                      {idx === 0 && (
                        <Badge className="text-[9px] px-1.5 py-0 border-none bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {v.note || "—"}
                      {v.snapshot?.voiceProfile ? ` · voice: ${v.snapshot.voiceProfile}` : ""}
                      {v.snapshot?.appointmentMode ? ` · mode: ${v.snapshot.appointmentMode}` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">{new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                  {idx !== 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={rollingBack !== null}
                      onClick={() => rollback(v.version)}
                      className="h-7 text-[10px] gap-1 text-[#0F3B3D] dark:text-[#b48c3c] hover:bg-[#0F3B3D]/10 shrink-0"
                    >
                      {rollingBack === v.version ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Roll back
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
