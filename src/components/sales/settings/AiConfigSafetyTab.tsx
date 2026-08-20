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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  KeyRound,
  Info,
  MailCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";


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
  // Platform-key request: the grant itself is issued by an administrator.
  const [requestingKey, setRequestingKey] = useState(false);
  const [keyRequestedAt, setKeyRequestedAt] = useState<string | null>(null);

  const loadProviderSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/company", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setAiProvider(data.aiProvider || "platform");
      setPlatformGrant(data.aiPlatformGrant || null);
      setKeyRequestedAt(data.aiPlatformKeyRequestedAt || null);
      setAnthropicMasked(data.aiAnthropicKeyMasked || "");
      setOpenAiMasked(data.aiOpenAiKeyMasked || "");
      setGroqMasked(data.aiGroqKeyMasked || "");
    } catch (e) {
      console.error("Failed to load AI provider settings:", e);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadProviderSettings();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadProviderSettings]);

  const requestPlatformKey = async () => {
    setRequestingKey(true);
    try {
      const res = await fetch("/api/company/request-platform-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: aiProvider === "platform" ? null : aiProvider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Could not send the request.");
        if (data.requestedAt) setKeyRequestedAt(data.requestedAt);
        return;
      }
      setKeyRequestedAt(data.requestedAt || new Date().toISOString());
      toast.success(data.message || "Request sent to your administrator.");
    } catch (e) {
      console.error("Platform key request failed:", e);
      toast.error("Could not send the request.");
    } finally {
      setRequestingKey(false);
    }
  };

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
            <div className="flex items-center gap-1.5">
              <Label className="font-semibold text-xs">Provider</Label>
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    aria-label="Which provider should you pick?"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-base">Which provider should you pick?</DialogTitle>
                    <DialogDescription className="text-xs">
                      This one choice covers every drafting tool &mdash; campaign copy, blog drafts,
                      calendar suggestions, news summaries, and the sales agent. You can&apos;t currently
                      use a different provider per task, so pick for the work you do most.
                    </DialogDescription>
                  </DialogHeader>
                  <ul className="space-y-3">
                    {PROVIDERS.map((pr) => (
                      <li key={pr.value} className="text-[11px]">
                        <span className="font-semibold text-foreground">{pr.label}</span>{" "}
                        <code className="font-mono text-[10px] text-muted-foreground">{pr.model}</code>
                        <span className="text-muted-foreground"> &mdash; {pr.bestFor}.</span>{" "}
                        <span className="text-muted-foreground">{pr.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
                    Knowledge-base search runs on a local embedding model that ships with the portal, so
                    it is unaffected by this choice &mdash; which is why Groq, which has no embeddings
                    API, is still a valid pick here.
                  </p>
                </DialogContent>
              </Dialog>
            </div>
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
                  currently switched off. Pick a provider above and enter your own key to turn it on,
                  or ask your administrator to grant one.
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-[11px] gap-1.5"
                      disabled={requestingKey}
                      onClick={requestPlatformKey}
                    >
                      {requestingKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MailCheck className="h-3.5 w-3.5" />
                      )}
                      Request access from administrator
                    </Button>
                    {keyRequestedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Last requested {new Date(keyRequestedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
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

    </div>
  );
}
