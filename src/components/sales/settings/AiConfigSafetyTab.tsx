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

export default function AiConfigSafetyTab() {
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

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

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

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
              <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} className="text-xs min-h-[60px]" />
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
