"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, Eye, GraduationCap, Loader2, Send, Shuffle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { Rich } from "@/components/layout/HelpChat";
import { DifficultyBadge, RolePlay, ScorecardView } from "@/components/admin/sales-coach/RolePlay";
import {
  AREAS,
  ASK_SUGGESTIONS,
  DIFFICULTIES,
  MOCK_HISTORY,
  MOCK_TEAM,
  SCENARIOS,
  SKILLS,
  band,
  mockAsk,
  type Area,
  type Difficulty,
  type Scenario,
  type Session,
} from "@/components/admin/sales-coach/coach";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Sales Coach, Track B: AI4Home's own team practises selling the platform to builders. */
export default function SalesCoachPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("practice");
  const [active, setActive] = useState<Scenario | null>(null);
  const [viewing, setViewing] = useState<Session | null>(null);
  const [askSeed, setAskSeed] = useState<string | null>(null);

  const ask = (question: string) => {
    setActive(null);
    setViewing(null);
    setAskSeed(question);
    setTab("ask");
  };

  if (active) return <RolePlay key={active.id} scenario={active} onExit={() => setActive(null)} onAsk={ask} />;

  if (viewing) {
    const scenario = SCENARIOS.find((x) => x.id === viewing.scenarioId)!;
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setViewing(null)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{scenario.title}</h2>
          <p className="text-sm text-muted-foreground">
            {viewing.trainee} · {day(viewing.date)}
          </p>
        </div>
        <ScorecardView
          scenario={scenario}
          scorecard={viewing.scorecard}
          transcript={viewing.transcript}
          onRetry={() => {
            setViewing(null);
            setActive(scenario);
          }}
          onAsk={ask}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Sales Coach</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Practise selling AI4Home to builders with an AI role-play partner, then get scored feedback.
              </p>
            </div>
          </div>
          {/* FR-MG-05 */}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Your manager can see your practice sessions and scores.
          </p>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="practice">Practice</TabsTrigger>
          <TabsTrigger value="ask">Ask the Coach</TabsTrigger>
          <TabsTrigger value="history">My history</TabsTrigger>
          {user?.isSuperAdmin && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>

        <TabsContent value="practice" className="mt-4">
          <Library onStart={setActive} />
        </TabsContent>
        <TabsContent value="ask" className="mt-4">
          <AskCoach key={askSeed ?? ""} seed={askSeed} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <History sessions={MOCK_HISTORY} onOpen={setViewing} />
        </TabsContent>
        {user?.isSuperAdmin && (
          <TabsContent value="team" className="mt-4">
            <Team />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on ? "border-[#0F3B3D] bg-[#0F3B3D] text-white" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Library({ onStart }: { onStart: (s: Scenario) => void }) {
  const [level, setLevel] = useState<Difficulty | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const list = SCENARIOS.filter((s) => (!level || s.difficulty === level) && (!area || s.areas.includes(area)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip on={!level && !area} onClick={() => { setLevel(null); setArea(null); }}>All</Chip>
          {DIFFICULTIES.map((d) => (
            <Chip key={d} on={level === d} onClick={() => setLevel(level === d ? null : d)}>{d}</Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {AREAS.map((a) => (
            <Chip key={a} on={area === a} onClick={() => setArea(area === a ? null : a)}>{a}</Chip>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!list.length}
          onClick={() => onStart(list[Math.floor(Math.random() * list.length)])}
        >
          <Shuffle className="h-3.5 w-3.5" /> Surprise me
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No scenarios match those filters.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStart(s)}
              className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-[#b48c3c]/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b48c3c]/50"
            >
              <div className="flex items-center justify-between gap-2">
                <DifficultyBadge level={s.difficulty} />
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> {s.minutes} min
                </span>
              </div>
              <p className="mt-3 font-semibold text-foreground group-hover:text-[#b48c3c]">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.persona.name} · {s.persona.role}
              </p>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Goal:</span> {s.goal}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {s.areas.map((a) => (
                  <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type AskMsg = { role: "user" | "assistant"; content: string };

function AskCoach({ seed }: { seed: string | null }) {
  const [messages, setMessages] = useState<AskMsg[]>([]);
  const [input, setInput] = useState(seed ?? "");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: AskMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900)); // mock: POST /api/admin/sales-coach/ask
    setMessages([...next, { role: "assistant", content: mockAsk(q) }]);
    setBusy(false);
  };

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardContent className="flex h-[60vh] flex-col p-4">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Ask about our products, AI, the homebuilding business or executive selling. Try:
              </p>
              <div className="flex flex-wrap gap-2">
                {ASK_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-[#0F3B3D] text-white" : "bg-muted text-foreground"
                }`}
              >
                {m.role === "assistant" ? <Rich text={m.content} /> : m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Coach is thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          className="mt-3 flex items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask the Coach…"
            aria-label="Your question"
            className="max-h-32 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F3B3D]/40"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function History({ sessions, onOpen }: { sessions: Session[]; onOpen: (s: Session) => void }) {
  // FR-HI-03: average per skill, weakest highlighted.
  const avg = SKILLS.map((sk) => ({
    ...sk,
    value: sessions.reduce((sum, s) => sum + (s.scorecard.skills.find((x) => x.key === sk.key)?.score || 0), 0) / (sessions.length || 1),
  }));
  const weakest = avg.reduce((a, b) => (b.value < a.value ? b : a), avg[0]);

  if (!sessions.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No practice sessions yet. Start one from the library.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold text-foreground">My progress</p>
          {avg.map((sk) => (
            <div key={sk.key}>
              <div className="flex justify-between text-xs">
                <span className={sk.key === weakest.key ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground"}>
                  {sk.label}
                </span>
                <span className="tabular-nums text-muted-foreground">{sk.value.toFixed(1)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div
                  className={`h-1.5 rounded-full ${sk.key === weakest.key ? "bg-rose-500" : "bg-[#0F3B3D] dark:bg-[#b48c3c]"}`}
                  style={{ width: `${sk.value * 20}%` }}
                />
              </div>
            </div>
          ))}
          <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
            Focus on <strong className="text-foreground">{weakest.label}</strong> next.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Goal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const scenario = SCENARIOS.find((x) => x.id === s.scenarioId)!;
                const b = band(s.scorecard.overall);
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpen(s)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{day(s.date)}</TableCell>
                    <TableCell>
                      <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => onOpen(s)}>
                        {scenario.title}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold">{s.scorecard.overall}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{b.label}</span>
                    </TableCell>
                    <TableCell>
                      {s.scorecard.goalReached ? (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Reached</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Not reached</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Team() {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-[#b48c3c]" /> Team practice this month
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trainee</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Avg score</TableHead>
              <TableHead>Last practice</TableHead>
              <TableHead>Weakest skill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_TEAM.map((t) => (
              <TableRow key={t.name}>
                <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                <TableCell className="text-right tabular-nums">{t.sessions}</TableCell>
                <TableCell className="text-right tabular-nums">{t.avg ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{t.last ? day(t.last) : "Never"}</TableCell>
                <TableCell className="text-muted-foreground">{t.weakest}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
