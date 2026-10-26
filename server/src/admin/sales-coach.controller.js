import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma.js";
import { chat, toolCall, hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { denyUnlessAdminAccess } from "../middlewares/auth.js";
import { effectiveAdminPermissions } from "../lib/admin-permissions.js";
import { renderTemplate } from "../prompts/template.js";
import { queryDetailed, queryHelp } from "../services/vector-store.service.js";
import { ASK_PROMPT, BUYER_PROMPT, BUYER_TOOL, HINT_PROMPT, SCORE_PROMPT, SCORE_TOOL } from "../prompts/sales-coach.js";
import {
  PROMPT_VERSION,
  SCENARIOS,
  SKILLS,
  TURN_LIMIT,
  buildScorecard,
  deleteSessions,
  findScenario,
  getSession,
  listSessions,
  publicScenario,
  saveSession,
  sessionSummary,
  teamSummary,
  traineeTurns,
} from "../lib/sales-coach.js";

const SOURCE = "sales-coach";
const MAX_MESSAGE_CHARS = 2000;
const MAX_ASK_TURNS = 20;

const wrap = (label, fn) => async (req, res) => {
  try {
    if (denyUnlessAdminAccess(req, res)) return;
    await fn(req, res);
  } catch (error) {
    console.error(`[Sales Coach ${label}] Error:`, error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const bullets = (items) => items.map((i) => `- ${i}`).join("\n") || "(none)";

function scenarioVars(scenario) {
  return {
    title: scenario.title,
    personaName: scenario.persona.name,
    personaRole: scenario.persona.role,
    brief: scenario.brief,
    goal: scenario.goal,
    hidden: bullets(scenario.hidden.map((h) => `${h.fact}: "${h.reveal}"`)),
    objections: bullets(scenario.objections),
  };
}

/** Platform tier plus the Help docs: both describe AI4Home and neither is company data. */
async function coachKnowledge(question) {
  const [platform, help] = await Promise.all([
    queryDetailed(null, question, 4).catch(() => ({ results: [] })),
    queryHelp(question, 3),
  ]);
  const results = [...platform.results, ...help.results];
  return results.length ? results.map((r) => `[${r.name}]\n${r.text}`).join("\n\n---\n\n") : "(no Sales Coach material matched)";
}

// Owner, or the Super Admin (FR-MG-02).
async function loadSession(req, res) {
  const session = await getSession(req.params.id);
  if (!session || (session.userId !== req.user.id && !req.user.isSuperAdmin)) {
    res.status(404).json({ message: "Session not found." });
    return null;
  }
  return session;
}

async function loadOwnInProgress(req, res) {
  const session = await loadSession(req, res);
  if (!session) return null;
  if (session.userId !== req.user.id) {
    res.status(403).json({ message: "Only the trainee can continue this session." });
    return null;
  }
  if (session.status !== "IN_PROGRESS") {
    res.status(409).json({ message: "This session has ended. Start a new one to keep practising." });
    return null;
  }
  return session;
}

export const getScenarios = wrap("Scenarios", async (_req, res) => {
  res.json({ scenarios: SCENARIOS.map(publicScenario), turnLimit: TURN_LIMIT });
});

export const startSession = wrap("Start", async (req, res) => {
  const scenario = findScenario(req.body?.scenarioId);
  if (!scenario) return res.status(400).json({ message: "Pick a scenario first." });
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });

  // Restart: drop this trainee's sessions that never got a message, so history stays clean.
  const empty = (await listSessions(req.user.id)).filter((s) => s.status === "IN_PROGRESS" && traineeTurns(s) === 0);
  await deleteSessions(empty.map((s) => s.id));

  const now = new Date().toISOString();
  const session = await saveSession({
    id: randomUUID(),
    track: "AI4HOME",
    mode: "ROLEPLAY",
    userId: req.user.id,
    userName: req.user.name || req.user.email,
    scenarioId: scenario.id,
    status: "IN_PROGRESS",
    transcript: [{ role: "buyer", content: scenario.opener, at: now }],
    hintsUsed: 0,
    goalReached: false,
    scorecard: null,
    promptVersion: PROMPT_VERSION,
    startedAt: now,
    endedAt: null,
  });
  res.status(201).json({ session });
});

export const sendTurn = wrap("Turn", async (req, res) => {
  const session = await loadOwnInProgress(req, res);
  if (!session) return;
  const text = String(req.body?.message || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return res.status(400).json({ message: "Write a message first." });
  if (traineeTurns(session) >= TURN_LIMIT) return res.status(409).json({ message: "Turn limit reached. End & score the session." });
  const scenario = findScenario(session.scenarioId);

  const transcript = [...session.transcript, { role: "trainee", content: text, at: new Date().toISOString() }];
  // The API wants a user turn first; hints are for the trainee only.
  const messages = [
    { role: "user", content: "(The conversation starts.)" },
    ...transcript
      .filter((m) => m.role !== "hint")
      .map((m) => ({ role: m.role === "trainee" ? "user" : "assistant", content: m.content })),
  ];
  const out = await toolCall({
    companyId: null,
    system: renderTemplate(BUYER_PROMPT, scenarioVars(scenario)),
    messages,
    tool: BUYER_TOOL,
    maxTokens: 400,
    source: SOURCE,
  });
  const reply = String(out?.reply || "").trim();
  // NFR-10: nothing is saved on failure, so the trainee can resend the same message.
  if (!reply) return res.status(502).json({ message: "The buyer didn't answer. Send your message again." });

  transcript.push({ role: "buyer", content: reply, at: new Date().toISOString() });
  const outcome = ["reached", "lost"].includes(out.outcome) ? out.outcome : "open";
  const saved = await saveSession({ ...session, transcript, goalReached: outcome === "reached" });
  const ended = outcome !== "open" || traineeTurns(saved) >= TURN_LIMIT;
  res.json({ reply, outcome, ended, turns: traineeTurns(saved) });
});

export const getHint = wrap("Hint", async (req, res) => {
  const session = await loadOwnInProgress(req, res);
  if (!session) return;
  const scenario = findScenario(session.scenarioId);
  const transcript = session.transcript
    .filter((m) => m.role !== "hint")
    .map((m) => `${m.role === "trainee" ? "TRAINEE" : "BUYER"}: ${m.content}`)
    .join("\n");
  const hint = String(
    (await chat({
      companyId: null,
      system: renderTemplate(HINT_PROMPT, scenarioVars(scenario)),
      user: `Transcript so far:\n${transcript}\n\nYour one tip:`,
      maxTokens: 150,
      source: SOURCE,
    })) || "",
  ).trim();
  if (!hint) return res.status(502).json({ message: "No hint just now. Try again." });

  await saveSession({
    ...session,
    hintsUsed: session.hintsUsed + 1,
    transcript: [...session.transcript, { role: "hint", content: hint, at: new Date().toISOString() }],
  });
  res.json({ hint });
});

// Also scores a session left in progress or abandoned (NFR-10: score it later).
export const scoreSession = wrap("Score", async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.scorecard) return res.json({ scorecard: session.scorecard });
  if (session.userId !== req.user.id) return res.status(403).json({ message: "Only the trainee can score this session." });
  if (traineeTurns(session) === 0) return res.status(400).json({ message: "Say something to the buyer before scoring." });
  const scenario = findScenario(session.scenarioId);

  const lines = session.transcript.map((m) =>
    m.role === "hint" ? `[Trainee used a hint: ${m.content}]` : `${m.role === "trainee" ? "TRAINEE" : "BUYER"}: ${m.content}`,
  );
  const traineeText = session.transcript.filter((m) => m.role === "trainee").map((m) => m.content).join(" ");
  const rubric = SKILLS.map((s) => `- ${s.key} (${s.label}, ${s.weight}%): 5 = ${s.five} 1 = ${s.one}`).join("\n");
  const system = renderTemplate(SCORE_PROMPT, {
    ...scenarioVars(scenario),
    hidden: bullets(scenario.hidden.map((h) => h.fact)),
    emphasis: scenario.emphasis.map((k) => SKILLS.find((s) => s.key === k)?.label).join(", ") || "none",
    rubric,
    kbContext: await coachKnowledge(traineeText.slice(0, 1000)),
  });

  const raw = await toolCall({
    companyId: null,
    system,
    messages: [{ role: "user", content: `Transcript:\n${lines.join("\n")}\n\nScore it.` }],
    tool: SCORE_TOOL,
    maxTokens: 2000,
    temperature: 0,
    source: SOURCE,
  });
  if (!raw?.skills) return res.status(502).json({ message: "The scorecard couldn't be prepared. Your transcript is saved; try again." });

  const scorecard = buildScorecard(scenario, raw, { goalReached: session.goalReached, hintsUsed: session.hintsUsed });
  await saveSession({ ...session, scorecard, status: "SCORED", endedAt: new Date().toISOString() });
  res.json({ scorecard });
});

export const getSessions = wrap("List", async (req, res) => {
  // Super Admin can read anyone's (FR-MG-02); everyone else only their own.
  const userId = req.user.isSuperAdmin && req.query.userId ? String(req.query.userId) : req.user.id;
  const sessions = (await listSessions(userId)).filter((s) => s.transcript.some((m) => m.role === "trainee"));
  res.json({ sessions: sessions.map(sessionSummary) });
});

export const getSessionDetail = wrap("Detail", async (req, res) => {
  const session = await loadSession(req, res);
  if (session) res.json({ session });
});

export const getTeam = wrap("Team", async (req, res) => {
  if (!req.user.isSuperAdmin) return res.status(403).json({ message: "Only the Super Admin can see the team." });
  const staff = await prisma.user.findMany({
    where: { role: "SUPER_STAFF" },
    select: { id: true, name: true, email: true, adminPermissions: true },
  });
  const members = staff.filter((u) => effectiveAdminPermissions({ isSuperStaff: true, adminPermissions: u.adminPermissions }).includes("sales-coach"));
  const sessions = (await listSessions()).filter((s) => s.transcript.some((m) => m.role === "trainee"));
  res.json({ team: teamSummary(sessions, members) });
});

export const askCoach = wrap("Ask", async (req, res) => {
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m) => ["user", "assistant"].includes(m?.role) && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_ASK_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ message: "Ask a question first." });
  }
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });

  const system = renderTemplate(ASK_PROMPT, {
    scenarios: SCENARIOS.map((s) => `"${s.title}"`).join(", "),
    kbContext: await coachKnowledge(messages[messages.length - 1].content),
  });
  const reply = await chat({ companyId: null, system, messages, maxTokens: 900, source: SOURCE });
  if (!reply) return res.status(502).json({ message: "The Coach couldn't answer just now. Please try again." });
  res.json({ reply });
});
