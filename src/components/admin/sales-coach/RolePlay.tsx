"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flag,
  Lightbulb,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Send,
  Target,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  SKILLS,
  TURN_LIMIT,
  band,
  mockBuyerReply,
  mockHint,
  mockScorecard,
  type Difficulty,
  type Msg,
  type Scenario,
  type Scorecard,
} from "./coach";

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  Easy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Hard: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const BAND_STYLE: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
};

const BAR_STYLE = ["", "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];

export function DifficultyBadge({ level }: { level: Difficulty }) {
  return (
    <Badge variant="outline" className={DIFFICULTY_STYLE[level]}>
      {level}
    </Badge>
  );
}

// mock: the API call replaces this delay.
const think = () => new Promise((r) => setTimeout(r, 700 + Math.random() * 600));

type Stage = "brief" | "chat" | "score";

/** Brief → chat with the AI buyer → scorecard (SRS 2.2). */
export function RolePlay({
  scenario,
  onExit,
  onAsk,
}: {
  scenario: Scenario;
  onExit: () => void;
  onAsk: (question: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("brief");
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [goalReached, setGoalReached] = useState(false);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setTranscript([{ role: "buyer", content: scenario.opener }]);
    setGoalReached(false);
    setScorecard(null);
    setStage("chat");
  };

  const endAndScore = async (final: Msg[] = transcript, reached = goalReached) => {
    setBusy(true);
    await think();
    setScorecard(mockScorecard(scenario, final, reached));
    setBusy(false);
    setStage("score");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onExit} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Scenario library
        </Button>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">{scenario.title}</span>
      </div>

      {stage === "brief" && <Brief scenario={scenario} onStart={start} />}

      {stage === "chat" && (
        <Chat
          scenario={scenario}
          transcript={transcript}
          setTranscript={setTranscript}
          scoring={busy}
          onRestart={start}
          onEnd={(final, reached) => {
            setGoalReached(reached);
            void endAndScore(final, reached);
          }}
        />
      )}

      {stage === "score" && scorecard && (
        <ScorecardView
          scenario={scenario}
          scorecard={scorecard}
          transcript={transcript}
          onRetry={start}
          onAsk={onAsk}
        />
      )}
    </div>
  );
}

function Brief({ scenario, onStart }: { scenario: Scenario; onStart: () => void }) {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardContent className="space-y-5 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#b48c3c]">Role-play brief</p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{scenario.title}</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <DifficultyBadge level={scenario.difficulty} />
            {scenario.areas.map((a) => (
              <Badge key={a} variant="secondary">{a}</Badge>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">You&apos;re talking to</p>
            <p className="mt-1 font-semibold text-foreground">{scenario.persona.name}</p>
            <p className="text-sm text-muted-foreground">{scenario.persona.role}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="h-3.5 w-3.5" /> Your goal
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">{scenario.goal}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Length
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              About {scenario.minutes} min · up to {TURN_LIMIT} messages
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">The situation</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{scenario.brief}</p>
        </div>

        <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          The buyer has concerns they won&apos;t share unless you ask good questions. Use{" "}
          <strong>Hint</strong> if you get stuck (it&apos;s noted on your scorecard), and{" "}
          <strong>End &amp; score</strong> whenever you&apos;re done.
        </p>

        <Button onClick={onStart} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90">
          Start role-play
        </Button>
      </CardContent>
    </Card>
  );
}

function Chat({
  scenario,
  transcript,
  setTranscript,
  scoring,
  onRestart,
  onEnd,
}: {
  scenario: Scenario;
  transcript: Msg[];
  setTranscript: (t: Msg[]) => void;
  scoring: boolean;
  onRestart: () => void;
  onEnd: (final: Msg[], goalReached: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [reached, setReached] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const turns = transcript.filter((m) => m.role === "trainee").length;
  const atLimit = turns >= TURN_LIMIT;
  const locked = typing || scoring || reached || atLimit;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, typing]);

  const send = async () => {
    const text = input.trim();
    if (!text || locked) return;
    const next: Msg[] = [...transcript, { role: "trainee", content: text }];
    setTranscript(next);
    setInput("");
    setTyping(true);
    await think();
    const { reply, goalReached } = mockBuyerReply(scenario, next);
    const final: Msg[] = [...next, { role: "buyer", content: reply }];
    setTranscript(final);
    setTyping(false);
    // FR-RP-10: the session ends at the goal or the turn limit.
    if (goalReached || final.filter((m) => m.role === "trainee").length >= TURN_LIMIT) {
      setReached(goalReached);
      onEnd(final, goalReached);
    }
  };

  const hint = () => setTranscript([...transcript, { role: "hint", content: mockHint(transcript) }]);

  return (
    <Card className="border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#b48c3c]/15 text-sm font-semibold text-[#b48c3c]">
            {scenario.persona.name.split(" ").map((w) => w[0]).join("")}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{scenario.persona.name}</p>
            <p className="text-xs text-muted-foreground">{scenario.persona.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {turns}/{TURN_LIMIT}
          </span>
          <Button variant="outline" size="sm" onClick={hint} disabled={locked} className="gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> Hint
          </Button>
          <Button variant="outline" size="sm" onClick={onRestart} disabled={scoring} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Restart
          </Button>
          <Button
            size="sm"
            onClick={() => onEnd(transcript, false)}
            disabled={scoring || typing || turns === 0}
            className="gap-1.5 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
          >
            {scoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}
            End &amp; score
          </Button>
        </div>
      </div>

      <div className="h-[55vh] space-y-3 overflow-y-auto p-4">
        <p className="text-center text-xs text-muted-foreground">Goal: {scenario.goal}</p>
        <Transcript messages={transcript} buyerName={scenario.persona.name} />
        {typing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {scenario.persona.name.split(" ")[0]} is typing…
          </div>
        )}
        {scoring && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your scorecard…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={locked}
          placeholder={atLimit ? "Turn limit reached." : `Reply to ${scenario.persona.name.split(" ")[0]}…`}
          aria-label="Your reply"
          className="max-h-32 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F3B3D]/40 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="icon"
          disabled={locked || !input.trim()}
          aria-label="Send"
          className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}

function Transcript({ messages, buyerName }: { messages: Msg[]; buyerName: string }) {
  return (
    <>
      {messages.map((m, i) =>
        m.role === "hint" ? (
          <div key={i} className="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {m.content}
          </div>
        ) : (
          <div key={i} className={`flex ${m.role === "trainee" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%]">
              <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${m.role === "trainee" ? "text-right" : ""}`}>
                {m.role === "trainee" ? "You" : buyerName}
              </p>
              <div
                className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.role === "trainee" ? "bg-[#0F3B3D] text-white" : "bg-muted text-foreground"
                }`}
              >
                {m.content}
              </div>
            </div>
          </div>
        ),
      )}
    </>
  );
}

export function ScorecardView({
  scenario,
  scorecard,
  transcript,
  onRetry,
  onAsk,
}: {
  scenario: Scenario;
  scorecard: Scorecard;
  transcript: Msg[];
  onRetry: () => void;
  onAsk: (question: string) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const b = band(scorecard.overall);

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="grid gap-6 p-5 md:grid-cols-[220px_1fr] md:p-6">
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overall</p>
            <p className="mt-1 text-5xl font-bold tabular-nums text-foreground">
              {scorecard.overall}
              <span className="text-lg font-medium text-muted-foreground">/100</span>
            </p>
            <p className={`mt-1 font-semibold ${BAND_STYLE[b.tone]}`}>{b.label}</p>
            <p className="mt-3 flex items-center gap-1.5 text-sm">
              {scorecard.goalReached ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Goal reached</>
              ) : (
                <><XCircle className="h-4 w-4 text-rose-500" /> Goal not reached</>
              )}
            </p>
            {scorecard.hintsUsed > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {scorecard.hintsUsed} hint{scorecard.hintsUsed === 1 ? "" : "s"} used
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{b.advice}</p>
          </div>

          <div className="space-y-3">
            {scorecard.skills.map((sk) => {
              const meta = SKILLS.find((x) => x.key === sk.key)!;
              const doubled = scenario.emphasis.includes(sk.key);
              return (
                <div key={sk.key}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-foreground">
                      {meta.label}
                      {doubled && <span className="ml-1.5 text-[10px] font-semibold uppercase text-[#b48c3c]">×2</span>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{sk.score}/5</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted" role="img" aria-label={`${meta.label}: ${sk.score} out of 5`}>
                    <div className={`h-2 rounded-full ${BAR_STYLE[sk.score]}`} style={{ width: `${sk.score * 20}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{sk.reason}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-semibold text-foreground">What you did well</p>
            <ul className="space-y-2">
              {scorecard.strengths.map((t) => (
                <li key={t} className="flex gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {t}
                </li>
              ))}
            </ul>
            <div className="border-t border-border pt-3">
              <p className="text-sm font-semibold text-foreground">Hidden facts</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {scorecard.uncovered.map((f) => (
                  <li key={f} className="flex gap-2 text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
                {scorecard.missed.map((f) => (
                  <li key={f} className="flex gap-2 text-muted-foreground">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /> Missed: {f}
                  </li>
                ))}
              </ul>
            </div>
            {scorecard.wrongFacts.length > 0 && (
              <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                Wrong facts: {scorecard.wrongFacts.join("; ")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-semibold text-foreground">Try next time</p>
            {scorecard.improvements.map((imp) => (
              <div key={imp.skill} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{imp.skill}:</span> {imp.text}
                  </p>
                  <button
                    type="button"
                    onClick={() => onAsk(`How do I improve my ${imp.skill.toLowerCase()}? ${imp.text}`)}
                    className="shrink-0 text-xs font-medium text-[#b48c3c] hover:underline"
                  >
                    Ask the Coach
                  </button>
                </div>
                <p className="mt-2 border-l-2 border-[#b48c3c] pl-3 text-sm italic text-muted-foreground">{imp.example}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onRetry} className="gap-1.5 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90">
          <RotateCcw className="h-4 w-4" /> Retry scenario
        </Button>
        <Button variant="outline" onClick={() => setShowTranscript((v) => !v)} className="gap-1.5">
          <MessageSquareText className="h-4 w-4" /> {showTranscript ? "Hide" : "Show"} transcript
        </Button>
      </div>

      {showTranscript && (
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="space-y-3 p-4">
            <Transcript messages={transcript} buyerName={scenario.persona.name} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
