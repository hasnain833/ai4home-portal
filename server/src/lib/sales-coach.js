// Sales Coach, Track B (SRS v1.1): AI4Home's own team practises selling the
// platform to builders. Scenarios live in code; sessions live in PlatformSetting.
import prisma from "./prisma.js";

export const TURN_LIMIT = 20;
export const DAILY_SESSION_CAP = 15;
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
export const PROMPT_VERSION = "default";

// SRS Section 8: default rubric, Track B wording. Weights sum to 100.
export const SKILLS = [
  { key: "rapport", label: "Rapport & opening", weight: 10, five: "Warm, personal opening. Uses the buyer's name. Sets the purpose of the conversation.", one: "Jumps straight to pitching or prices." },
  { key: "discovery", label: "Discovery", weight: 20, five: "Open questions that uncover the builder's numbers, pain, timeline, budget and decision makers. Most hidden facts are found.", one: "Few or only yes/no questions. Hidden facts missed." },
  { key: "listening", label: "Listening & empathy", weight: 10, five: "Reflects back what the buyer said. Acknowledges feelings before answering.", one: "Ignores or talks over concerns." },
  { key: "product", label: "Product knowledge", weight: 15, five: "Accurate, relevant platform features, integrations and ROI tied to the buyer's needs. No over-promising about the AI.", one: "Wrong or invented facts. Generic feature lists. Over-promises like \"it never makes mistakes\"." },
  { key: "objection", label: "Objection handling", weight: 20, five: "Clarifies the real concern, answers it with evidence or options, and checks it is resolved.", one: "Argues, dismisses or skips the objection." },
  { key: "value", label: "Value & urgency", weight: 10, five: "Links benefits to what the buyer said they want, in their numbers. Uses honest urgency.", one: "No link to needs, or false pressure." },
  { key: "closing", label: "Closing / next step", weight: 15, five: "Clearly asks for the demo or next meeting, offers specific times, and confirms details.", one: "Never asks, or ends with \"let me know\"." },
];
const SKILL_KEYS = SKILLS.map((s) => s.key);

/** Weighted total out of 100. Up to two emphasised skills count double, then weights renormalise (SRS 8.1). */
export function overallScore(scores, emphasis = []) {
  const doubled = emphasis.slice(0, 2);
  const weights = SKILLS.map((s) => s.weight * (doubled.includes(s.key) ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = SKILLS.reduce((sum, s, i) => sum + ((scores[s.key] || 1) / 5) * weights[i], 0);
  return Math.round((raw / total) * 100);
}

export function band(overall) {
  if (overall >= 85) return "Excellent";
  if (overall >= 70) return "Good";
  if (overall >= 50) return "Developing";
  return "Needs practice";
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const list = (v, max, n = 400) => (Array.isArray(v) ? v : []).map((x) => clip(x, n)).filter(Boolean).slice(0, max);

/** Turns the model's raw scoring output into a Scorecard; the server, not the model, does the maths. */
export function buildScorecard(scenario, raw, { goalReached, hintsUsed }) {
  const byKey = new Map((Array.isArray(raw?.skills) ? raw.skills : []).map((s) => [s?.key, s]));
  const skills = SKILLS.map((sk) => {
    const s = byKey.get(sk.key);
    const score = Math.max(1, Math.min(5, Math.round(Number(s?.score) || 1)));
    return { key: sk.key, score, reason: clip(s?.reason, 400) || "No evidence in the transcript." };
  });
  const scores = Object.fromEntries(skills.map((s) => [s.key, s.score]));
  const facts = scenario.hidden.map((h) => h.fact);
  // Only facts that exist in the scenario; the model is told to copy them exactly.
  const uncovered = facts.filter((f) => list(raw?.uncovered, 10).includes(f));
  const overall = overallScore(scores, scenario.emphasis);
  return {
    overall,
    band: band(overall),
    skills,
    goalReached: Boolean(goalReached || raw?.goalReached),
    uncovered,
    missed: facts.filter((f) => !uncovered.includes(f)),
    strengths: list(raw?.strengths, 3),
    improvements: (Array.isArray(raw?.improvements) ? raw.improvements : [])
      // The model sometimes names the skill by key ("discovery"); show the label.
      .map((i) => ({ skill: SKILLS.find((s) => s.key === i?.skill)?.label || clip(i?.skill, 60), text: clip(i?.text, 400), example: clip(i?.example, 400) }))
      .filter((i) => i.skill && i.text)
      .slice(0, 3),
    wrongFacts: list(raw?.wrongFacts, 5),
    hintsUsed,
    rubricVersion: PROMPT_VERSION,
  };
}

export const isSkillKey = (k) => SKILL_KEYS.includes(k);

// ─── Scenarios (Appendix A, Track B) ──────────────────────────────────────
// ponytail: scenarios are code, not data; move to a CoachScenario table when Super Admin needs to edit them (FR-SN-04).

export const SCENARIOS = [
  {
    id: "busy-owner", title: "Busy builder owner: \"send me info\"", difficulty: "Easy", areas: ["Executive"], minutes: 8,
    persona: { name: "Dave Kowalski", role: "Owner, Kowalski Homes (40 homes/yr)" },
    goal: "Book a 30-minute demo.",
    brief: "Dave filled in a form on our site last night. He's on a job site and has a couple of minutes.",
    opener: "Yeah, I filled something in. I'm slammed though. Just send me some info and I'll look at it.",
    hidden: [
      { fact: "Losing leads that come in after hours", reveal: "Honestly? Half our web leads come in after six and nobody calls them till next day. Some never." },
      { fact: "His wife runs the office and decides on software", reveal: "My wife Karen runs the office. Anything with a login, she's the one using it." },
      { fact: "Model home opens in 6 weeks", reveal: "We open a new model in about six weeks, so traffic's about to jump." },
    ],
    objections: ["I've got a guy who does our website, he handles all that.", "How much is this going to run me?", "I really don't have time for a big meeting."],
    emphasis: ["closing", "rapport"],
  },
  {
    id: "vp-demo", title: "Product demo to a VP Sales", difficulty: "Easy", areas: ["Products"], minutes: 12,
    persona: { name: "Priya Nair", role: "VP Sales, Lakeline Communities" },
    goal: "Agree a pilot in one community.",
    brief: "Priya booked this demo herself. She wants to see nurture and booking working end to end.",
    opener: "Thanks for making time. I want to see how your follow-up actually works, not slides.",
    hidden: [
      { fact: "OSC team of two can't keep up", reveal: "My two online sales counselors are drowning. They each have 300 open leads." },
      { fact: "Appointment-to-contract is fine; lead-to-appointment is the leak", reveal: "Once people walk the model we close fine. It's getting them in the door." },
      { fact: "Budget decision is hers up to $50k", reveal: "Anything under fifty I can sign off myself." },
    ],
    objections: ["How is this different from the drip emails we already send?", "What happens when the AI says something wrong?", "How long until it's live?"],
    emphasis: ["product"],
  },
  {
    id: "have-salesforce", title: "VP Sales: \"we already have Salesforce\"", difficulty: "Medium", areas: ["Products"], minutes: 12,
    persona: { name: "Mark Ellison", role: "VP Sales, Ridgeview Homes" },
    goal: "Book a discovery call with his Salesforce admin.",
    brief: "Mark took the call as a favour to a mutual contact. He thinks this overlaps with Salesforce.",
    opener: "I'll be straight with you, we spent a fortune on Salesforce. I don't need another tool.",
    hidden: [
      { fact: "Reps don't follow up in Salesforce", reveal: "Half my reps don't even log their calls. The data in there is a mess." },
      { fact: "Admin is overloaded", reveal: "Our Salesforce admin is one person and she's buried." },
      { fact: "Q4 pace target at risk", reveal: "We're behind on our Q4 sales pace and I'm getting heat for it." },
    ],
    objections: ["Salesforce has automation already.", "My admin will kill me if this breaks our data.", "We tried an add-on before and nobody used it."],
    emphasis: ["objection", "product"],
  },
  {
    id: "warranty-manager", title: "Warranty manager drowning in tickets", difficulty: "Medium", areas: ["Products", "Business"], minutes: 10,
    persona: { name: "Luis Ortega", role: "Customer Care Manager, Sunfield Homes" },
    goal: "Book a demo of the Warranty agent with his director.",
    brief: "Luis answered a cold email. Homeowner complaints have been climbing.",
    opener: "Your email said something about warranty requests. We get a lot of those. What is it exactly?",
    hidden: [
      { fact: "Complaints up 30% this year", reveal: "Complaints are up about thirty percent this year and my director noticed." },
      { fact: "Trades miss appointments", reveal: "The worst part is chasing trades. They no-show and the homeowner blames us." },
      { fact: "He doesn't own the budget", reveal: "I'd have to take this to Angela, she runs construction and customer care." },
    ],
    objections: ["Homeowners want a real person, not a bot.", "We already have a warranty portal.", "I can't add anything to my team's workload right now."],
    emphasis: ["discovery"],
  },
  {
    id: "slow-pace", title: "Division president: slow sales pace", difficulty: "Medium", areas: ["Business"], minutes: 15,
    persona: { name: "Sandra Whitfield", role: "Division President, Harbor Point Homes" },
    goal: "Agree a follow-up with her VP Sales.",
    brief: "Twenty minutes on Sandra's calendar. Her division is behind its absorption plan.",
    opener: "I've got twenty minutes. Tell me why I should care about another sales tool.",
    hidden: [
      { fact: "Absorption 2.1 vs plan of 3 per community per month", reveal: "We're running about 2.1 sales a month per community. Plan is three." },
      { fact: "Cost per lead doubled", reveal: "Our cost per lead has basically doubled since last year." },
      { fact: "Corporate review in January", reveal: "Corporate reviews every division in January. I need a story by then." },
    ],
    objections: ["My problem is pricing, not follow-up.", "Every vendor says they'll fix sales pace.", "Show me numbers from a builder like us."],
    emphasis: ["discovery", "value"],
  },
  {
    id: "cfo-roi", title: "CFO focused on cost and ROI", difficulty: "Medium", areas: ["Executive", "Business"], minutes: 12,
    persona: { name: "Robert Chen", role: "CFO, Meadowbrook Builders" },
    goal: "Agree a paid pilot starting Q1.",
    brief: "Robert was looped in by the VP Sales, who likes the product. He holds the budget.",
    opener: "Jen says she likes your product. I like it less until I see the math.",
    hidden: [
      { fact: "Budget frozen until Q1", reveal: "Nothing new gets approved until Q1. That's not negotiable." },
      { fact: "Spends ~$400k/yr on lead gen", reveal: "We spend roughly four hundred thousand a year on leads." },
      { fact: "Wants a pilot with an exit", reveal: "If I do anything it's a pilot I can walk away from." },
    ],
    objections: ["What's the payback period?", "Why not just hire another OSC?", "That price seems high for software."],
    emphasis: ["value", "closing"],
  },
  {
    id: "how-ai-works", title: "\"How does the AI actually work?\"", difficulty: "Medium", areas: ["AI"], minutes: 10,
    persona: { name: "Gary Lindqvist", role: "Owner, Lindqvist Custom Homes" },
    goal: "Book a demo where he can test the agent himself.",
    brief: "Gary is curious and non-technical. He's heard of ChatGPT but doesn't trust it.",
    opener: "My nephew showed me ChatGPT. It made stuff up. How is yours any different?",
    hidden: [
      { fact: "Worried about wrong prices being quoted", reveal: "If it tells somebody the wrong price, I'm on the hook for that." },
      { fact: "Wants to try it himself first", reveal: "I'd want to text it myself and try to trip it up." },
      { fact: "Lost a buyer to slow response last month", reveal: "Lost a buyer last month because we took two days to call back." },
    ],
    objections: ["Where does it get its answers?", "Can I turn it off if it misbehaves?", "Will buyers know it's a computer?"],
    emphasis: ["product", "listening"],
  },
  {
    id: "ceo-10min", title: "10 minutes with the CEO", difficulty: "Hard", areas: ["Executive"], minutes: 10,
    persona: { name: "Catherine Duval", role: "CEO, Duval Homes (900 homes/yr)" },
    goal: "Get a named sponsor and a next meeting.",
    brief: "A board member got you this slot. Catherine is impatient and will end the call early if you ramble.",
    opener: "You've got ten minutes. Go.",
    hidden: [
      { fact: "Strategic priority: reduce cancellation rate", reveal: "Our cancellation rate is my number one problem this year." },
      { fact: "COO Tom owns operations software", reveal: "If this is operational, it goes to Tom, my COO." },
      { fact: "Burned by a previous AI pilot", reveal: "We did an AI pilot last year. Waste of six months." },
    ],
    objections: ["Get to the point.", "Why should this be a priority over everything else?", "Send me something and I'll pass it on."],
    emphasis: ["rapport", "closing"],
  },
  {
    id: "ai-skeptic", title: "Skeptic: \"AI will embarrass us\"", difficulty: "Hard", areas: ["AI"], minutes: 12,
    persona: { name: "Nora Pierce", role: "Marketing Director, Crestline Homes" },
    goal: "Agree a sandbox trial with Prompt Lab access.",
    brief: "Nora protects the brand. She saw a viral story about a chatbot going rogue.",
    opener: "I've seen what happens when a chatbot goes off script. I'm not putting our brand on that.",
    hidden: [
      { fact: "Fair-housing complaint two years ago", reveal: "We had a fair-housing complaint two years ago. Legal is still twitchy." },
      { fact: "Wants approval over tone of voice", reveal: "If I could control exactly how it talks, that would change things." },
      { fact: "Her team answers chat manually 9-5 only", reveal: "My team covers web chat nine to five. After that, nothing." },
    ],
    objections: ["What if it says something discriminatory?", "Who's accountable when it gets it wrong?", "Our legal team will never sign off."],
    emphasis: ["objection", "listening"],
  },
  {
    id: "it-gatekeeper", title: "IT gatekeeper: security and integrations", difficulty: "Hard", areas: ["AI", "Products"], minutes: 12,
    persona: { name: "Kevin Brandt", role: "IT Director, Summit Residential" },
    goal: "Agree a technical review call with our team.",
    brief: "The VP Sales wants to buy. Kevin must approve any vendor touching customer data.",
    opener: "I've got your security questionnaire half filled in. I have concerns.",
    hidden: [
      { fact: "Needs SOC 2 or equivalent", reveal: "Policy says any vendor with PII needs SOC 2 or equivalent." },
      { fact: "Uses Salesforce + an ERP", reveal: "We're on Salesforce and an ERP that nobody likes touching." },
      { fact: "Worried about AI training on their data", reveal: "My real worry is our customer data training somebody's model." },
    ],
    objections: ["Where is our data stored?", "Does the AI vendor train on our data?", "How do we revoke access?"],
    emphasis: ["product"],
  },
  {
    id: "champion", title: "Champion who must sell it internally", difficulty: "Hard", areas: ["Executive"], minutes: 12,
    persona: { name: "Alicia Moreno", role: "Director of Sales, Pinecrest Homes" },
    goal: "Agree a joint meeting with her CEO.",
    brief: "Alicia loved the demo. Her CEO thinks it's a nice-to-have.",
    opener: "I'm sold. My CEO isn't. He asked why we can't just work harder.",
    hidden: [
      { fact: "CEO cares about cost per closing", reveal: "The only number Greg ever asks about is cost per closing." },
      { fact: "Board meeting in three weeks", reveal: "We have a board meeting in three weeks. That's the window." },
      { fact: "She's afraid of looking bad if it fails", reveal: "If I push this and it flops, that's on me." },
    ],
    objections: ["Can you give me a one-pager for Greg?", "He'll say we can't afford it this year.", "What if he asks for references?"],
    emphasis: ["value", "closing"],
  },
  {
    id: "burned-chatbot", title: "Builder who tried a chatbot before", difficulty: "Hard", areas: ["AI", "Executive"], minutes: 12,
    persona: { name: "Tom Haskins", role: "VP Marketing, Bluewater Homes" },
    goal: "Book a call with a reference customer.",
    brief: "Bluewater ran a website chatbot for a year and cancelled it.",
    opener: "We had a chatbot. Buyers hated it. Why would yours be any different?",
    hidden: [
      { fact: "Old bot only answered FAQs, never booked", reveal: "It answered FAQs and that's it. Never booked a single appointment." },
      { fact: "Contract had a long lock-in", reveal: "We were stuck in a two-year contract with them." },
      { fact: "Still gets 200+ web leads/month", reveal: "We still get two hundred plus web leads a month." },
    ],
    objections: ["Every vendor says they're different.", "I won't sign another long contract.", "Show me a builder who's actually seen results."],
    emphasis: ["objection", "product"],
  },
];

export const findScenario = (id) => SCENARIOS.find((s) => s.id === id) || null;

/** What the trainee may see before scoring: no hidden facts, objections or opener (FR-RP-03). */
export const publicScenario = ({ hidden, objections, opener, ...rest }) => rest;

// ─── Sessions ─────────────────────────────────────────────────────────────
// ponytail: one PlatformSetting row per session (key "sales-coach.session.<id>"), scanned in JS.
// Fine for an internal team; move to a CoachSession table for Track A or once rows reach the thousands.

const PREFIX = "sales-coach.session.";

export async function saveSession(session) {
  const value = { ...session, updatedAt: new Date().toISOString() };
  await prisma.platformSetting.upsert({
    where: { key: PREFIX + session.id },
    create: { key: PREFIX + session.id, value },
    update: { value },
  });
  return value;
}

export async function getSession(id) {
  if (!/^[\w-]{6,64}$/.test(String(id || ""))) return null;
  return (await prisma.platformSetting.findUnique({ where: { key: PREFIX + id } }))?.value || null;
}

export async function deleteSessions(ids) {
  if (ids.length) await prisma.platformSetting.deleteMany({ where: { key: { in: ids.map((id) => PREFIX + id) } } });
}

/** All sessions, newest first, optionally for one user. In-progress sessions idle 24h are closed (SRS 10.1). */
export async function listSessions(userId = null) {
  const rows = await prisma.platformSetting.findMany({
    where: {
      key: { startsWith: PREFIX },
      ...(userId ? { value: { path: ["userId"], equals: userId } } : {}),
    },
  });
  const now = Date.now();
  const sessions = [];
  for (const { value } of rows) {
    if (value.status === "IN_PROGRESS" && now - new Date(value.updatedAt).getTime() > ABANDON_AFTER_MS) {
      sessions.push(await saveSession({ ...value, status: "ABANDONED", endedAt: value.updatedAt }));
    } else {
      sessions.push(value);
    }
  }
  return sessions.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

export const traineeTurns = (session) => session.transcript.filter((m) => m.role === "trainee").length;

/** List row: no transcript. */
export const sessionSummary = ({ transcript, ...rest }) => ({ ...rest, turns: transcript.filter((m) => m.role === "trainee").length });

/** FR-MG-01: per trainee this month, sessions, average, last practice and weakest skill. */
export function teamSummary(sessions, members, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const byUser = new Map(members.map((m) => [m.id, { userId: m.id, name: m.name || m.email, scored: [], sessions: 0, last: null }]));
  for (const s of sessions) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, { userId: s.userId, name: s.userName || "Former team member", scored: [], sessions: 0, last: null });
    const row = byUser.get(s.userId);
    if (!row.last || s.startedAt > row.last) row.last = s.startedAt;
    if (s.startedAt < monthStart) continue;
    row.sessions += 1;
    if (s.scorecard) row.scored.push(s.scorecard);
  }
  return [...byUser.values()].map(({ scored, ...row }) => {
    if (!scored.length) return { ...row, avg: null, weakest: null };
    const avg = Math.round(scored.reduce((a, c) => a + c.overall, 0) / scored.length);
    const skillAvg = SKILLS.map((sk) => ({
      label: sk.label,
      v: scored.reduce((a, c) => a + (c.skills.find((x) => x.key === sk.key)?.score || 0), 0) / scored.length,
    }));
    return { ...row, avg, weakest: skillAvg.reduce((a, b) => (b.v < a.v ? b : a)).label };
  });
}
