// Sales Coach (Track B: AI4Home sales team). Scenarios, the AI buyer and scoring live on the server.
import { apiFetch } from "@/lib/api";

export type Difficulty = "Easy" | "Medium" | "Hard";
export type Area = "Products" | "AI" | "Business" | "Executive";
export type SkillKey = "rapport" | "discovery" | "listening" | "product" | "objection" | "value" | "closing";

export const AREAS: Area[] = ["Products", "AI", "Business", "Executive"];
export const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
export const TURN_LIMIT = 20; // the server enforces it too

export const SKILLS: { key: SkillKey; label: string }[] = [
  { key: "rapport", label: "Rapport & opening" },
  { key: "discovery", label: "Discovery" },
  { key: "listening", label: "Listening & empathy" },
  { key: "product", label: "Product knowledge" },
  { key: "objection", label: "Objection handling" },
  { key: "value", label: "Value & urgency" },
  { key: "closing", label: "Closing / next step" },
];

export function band(overall: number) {
  if (overall >= 85) return { label: "Excellent", tone: "emerald", advice: "Ready for real buyers on this scenario. Try a harder one." };
  if (overall >= 70) return { label: "Good", tone: "sky", advice: "Solid. Polish the one improvement below." };
  if (overall >= 50) return { label: "Developing", tone: "amber", advice: "Getting there. Retry with the suggested lines." };
  return { label: "Needs practice", tone: "rose", advice: "Ask the Coach about the weakest skill, then retry." };
}

export type Msg = { role: "trainee" | "buyer" | "hint"; content: string; at?: string };

/** What the trainee sees before playing: hidden facts and objections stay on the server. */
export interface Scenario {
  id: string;
  title: string;
  persona: { name: string; role: string };
  difficulty: Difficulty;
  areas: Area[];
  minutes: number;
  goal: string;
  brief: string;
  emphasis: SkillKey[];
}

export interface Scorecard {
  overall: number;
  skills: { key: SkillKey; score: number; reason: string }[];
  goalReached: boolean;
  uncovered: string[];
  missed: string[];
  strengths: string[];
  improvements: { skill: string; text: string; example: string }[];
  wrongFacts: string[];
  hintsUsed: number;
}

export type SessionStatus = "IN_PROGRESS" | "SCORED" | "ABANDONED";

export interface SessionSummary {
  id: string;
  scenarioId: string;
  userId: string;
  userName: string;
  status: SessionStatus;
  startedAt: string;
  hintsUsed: number;
  scorecard: Scorecard | null;
  turns: number;
}

export interface Session extends Omit<SessionSummary, "turns"> {
  transcript: Msg[];
}

export interface TeamRow {
  userId: string;
  name: string;
  sessions: number;
  avg: number | null;
  last: string | null;
  weakest: string | null;
}

export const ASK_SUGGESTIONS = [
  "How do I answer \"we already have a CRM\"?",
  "Give me 3 discovery questions for a division president",
  "Explain hallucination to a CEO in two sentences",
  "Draft my follow-up email after a call with a VP Sales",
];

const BASE = "/api/admin/sales-coach";
const post = <T>(path: string, body: unknown = {}) =>
  apiFetch<T>(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const coachApi = {
  scenarios: () => apiFetch<{ scenarios: Scenario[] }>(`${BASE}/scenarios`),
  start: (scenarioId: string) => post<{ session: Session }>("/sessions", { scenarioId }),
  turn: (id: string, message: string) =>
    post<{ reply: string; outcome: "open" | "reached" | "lost"; ended: boolean }>(`/sessions/${id}/turn`, { message }),
  hint: (id: string) => post<{ hint: string }>(`/sessions/${id}/hint`),
  score: (id: string) => post<{ scorecard: Scorecard }>(`/sessions/${id}/score`),
  sessions: (userId?: string) =>
    apiFetch<{ sessions: SessionSummary[] }>(`${BASE}/sessions${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`),
  session: (id: string) => apiFetch<{ session: Session }>(`${BASE}/sessions/${id}`),
  team: () => apiFetch<{ team: TeamRow[] }>(`${BASE}/team`),
  ask: (messages: { role: "user" | "assistant"; content: string }[]) => post<{ reply: string }>("/ask", { messages }),
};
