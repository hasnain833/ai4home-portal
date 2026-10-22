// Sales Coach (Track B: AI4Home sales team). Types and scoring are real; the
// data and the buyer/scorer below are mocks until the API exists (SRS v1.1).

export type Difficulty = "Easy" | "Medium" | "Hard";
export type Area = "Products" | "AI" | "Business" | "Executive";
export type SkillKey = "rapport" | "discovery" | "listening" | "product" | "objection" | "value" | "closing";

export const AREAS: Area[] = ["Products", "AI", "Business", "Executive"];
export const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
export const TURN_LIMIT = 20;

// SRS Section 8: default rubric. Weights sum to 100.
export const SKILLS: { key: SkillKey; label: string; weight: number }[] = [
  { key: "rapport", label: "Rapport & opening", weight: 10 },
  { key: "discovery", label: "Discovery", weight: 20 },
  { key: "listening", label: "Listening & empathy", weight: 10 },
  { key: "product", label: "Product knowledge", weight: 15 },
  { key: "objection", label: "Objection handling", weight: 20 },
  { key: "value", label: "Value & urgency", weight: 10 },
  { key: "closing", label: "Closing / next step", weight: 15 },
];

/** Weighted total out of 100. Up to two emphasised skills count double, then weights renormalise. */
export function overallScore(scores: Record<SkillKey, number>, emphasis: SkillKey[] = []) {
  const doubled = emphasis.slice(0, 2);
  const weights = SKILLS.map((s) => s.weight * (doubled.includes(s.key) ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = SKILLS.reduce((sum, s, i) => sum + (scores[s.key] / 5) * weights[i], 0);
  return Math.round((raw / total) * 100);
}

export function band(overall: number) {
  if (overall >= 85) return { label: "Excellent", tone: "emerald", advice: "Ready for real buyers on this scenario. Try a harder one." };
  if (overall >= 70) return { label: "Good", tone: "sky", advice: "Solid. Polish the one improvement below." };
  if (overall >= 50) return { label: "Developing", tone: "amber", advice: "Getting there. Retry with the suggested lines." };
  return { label: "Needs practice", tone: "rose", advice: "Ask the Coach about the weakest skill, then retry." };
}

export type Msg = { role: "trainee" | "buyer" | "hint"; content: string };

export interface HiddenFact {
  fact: string;
  reveal: string;
}

export interface Scenario {
  id: string;
  title: string;
  persona: { name: string; role: string };
  difficulty: Difficulty;
  areas: Area[];
  minutes: number;
  goal: string;
  brief: string;
  opener: string;
  hidden: HiddenFact[];
  objections: string[];
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

export interface Session {
  id: string;
  scenarioId: string;
  trainee: string;
  date: string;
  transcript: Msg[];
  scorecard: Scorecard;
}

// ─── Mock data ────────────────────────────────────────────────────────────

const s = (x: Scenario) => x;

export const SCENARIOS: Scenario[] = [
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
  s({
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
  }),
];

export const ASK_SUGGESTIONS = [
  "How do I answer \"we already have a CRM\"?",
  "Give me 3 discovery questions for a division president",
  "Explain hallucination to a CEO in two sentences",
  "Draft my follow-up email after a call with a VP Sales",
];

const BOOKING_WORDS = /\b(demo|call|meeting|pilot|calendar|tuesday|wednesday|thursday|friday|monday|tomorrow|next week)\b/i;

/** mock: replace with POST /api/admin/sales-coach/sessions/:id/turn */
export function mockBuyerReply(scenario: Scenario, transcript: Msg[]): { reply: string; goalReached: boolean } {
  const trainee = transcript.filter((m) => m.role === "trainee");
  const last = trainee[trainee.length - 1]?.content || "";
  const revealed = transcript.filter((m) => m.role === "buyer").map((m) => m.content);
  const asked = last.includes("?");

  if (BOOKING_WORDS.test(last) && trainee.length >= 3) {
    return { reply: "Alright. Send me an invite for that and I'll take a look.", goalReached: true };
  }
  const nextFact = scenario.hidden.find((h) => !revealed.includes(h.reveal));
  if (asked && nextFact) return { reply: nextFact.reveal, goalReached: false };
  const nextObjection = scenario.objections.find((o) => !revealed.includes(o));
  return { reply: nextObjection || "Okay. So what are you suggesting we do next?", goalReached: false };
}

/** mock: replace with POST /api/admin/sales-coach/sessions/:id/hint */
export function mockHint(transcript: Msg[]) {
  const asked = transcript.filter((m) => m.role === "trainee" && m.content.includes("?")).length;
  return asked < 2
    ? "Before pitching, ask an open question about what's costing them deals today."
    : "You've found some pain. Tie it to a specific next step and offer two times.";
}

/** mock: replace with POST /api/admin/sales-coach/sessions/:id/score */
export function mockScorecard(scenario: Scenario, transcript: Msg[], goalReached: boolean): Scorecard {
  const trainee = transcript.filter((m) => m.role === "trainee").map((m) => m.content);
  const buyer = transcript.filter((m) => m.role === "buyer").map((m) => m.content);
  const questions = trainee.filter((t) => t.includes("?"));
  const uncovered = scenario.hidden.filter((h) => buyer.includes(h.reveal)).map((h) => h.fact);
  const missed = scenario.hidden.filter((h) => !buyer.includes(h.reveal)).map((h) => h.fact);
  const first = trainee[0] || "";
  const quote = (t: string) => `"${t.length > 70 ? t.slice(0, 70) + "…" : t}"`;
  const clamp = (n: number) => Math.max(1, Math.min(5, n));

  const scores: Record<SkillKey, number> = {
    rapport: first.length > 20 ? 4 : 2,
    discovery: clamp(1 + uncovered.length + (questions.length > 3 ? 1 : 0)),
    listening: clamp(2 + Math.min(2, uncovered.length)),
    product: trainee.length > 2 ? 4 : 3,
    objection: clamp(2 + Math.floor(trainee.length / 3)),
    value: uncovered.length >= 2 ? 4 : 3,
    closing: goalReached ? 5 : 2,
  };
  const reasons: Record<SkillKey, string> = {
    rapport: first ? `Opened with ${quote(first)}` : "No opening.",
    discovery: `${questions.length} question${questions.length === 1 ? "" : "s"} asked; ${uncovered.length} of ${scenario.hidden.length} hidden facts found.`,
    listening: uncovered.length ? `Picked up on "${uncovered[0]}".` : "Didn't reflect back what the buyer said.",
    product: trainee[1] ? `Explained the product in ${quote(trainee[1])}` : "Little product detail given.",
    objection: `Handled ${Math.min(scenario.objections.length, Math.floor(trainee.length / 2))} of ${scenario.objections.length} objections raised.`,
    value: uncovered.length >= 2 ? "Linked benefits to the buyer's own situation." : "Benefits weren't tied to what the buyer said.",
    closing: goalReached ? "Asked for a specific next step and got it." : "Never asked for a clear next step.",
  };

  return {
    overall: overallScore(scores, scenario.emphasis),
    skills: SKILLS.map((sk) => ({ key: sk.key, score: scores[sk.key], reason: reasons[sk.key] })),
    goalReached,
    uncovered,
    missed,
    strengths: [
      first.length > 20 ? "Warm, personal opening that set the purpose of the call." : "Got straight to the conversation.",
      uncovered.length ? `Uncovered "${uncovered[0]}" with a good question.` : "Kept the conversation going under pressure.",
    ],
    improvements: [
      ...(missed.length
        ? [{ skill: "Discovery", text: `You missed: ${missed[0].toLowerCase()}.`, example: "\"Before I show you anything, what's the one number you're being judged on this quarter?\"" }]
        : []),
      ...(!goalReached
        ? [{ skill: "Closing", text: "You didn't ask for the next step.", example: "\"Would Tuesday at 10 or Thursday at 2 work for a 30-minute demo with you and your team?\"" }]
        : []),
      { skill: "Value & urgency", text: "Connect the benefit to their numbers, not features.", example: "\"If we got even 10% more of those after-hours leads into a visit, what would that do to your pace?\"" },
    ].slice(0, 3),
    wrongFacts: [],
    hintsUsed: transcript.filter((m) => m.role === "hint").length,
  };
}

/** mock: replace with POST /api/admin/sales-coach/ask */
export function mockAsk(question: string) {
  return (
    `Good question. Here's how I'd handle "${question.slice(0, 80)}":\n\n` +
    "1. **Acknowledge** the concern so they feel heard.\n" +
    "2. **Ask** one clarifying question to find the real worry.\n" +
    "3. **Answer** with one proof point tied to their numbers.\n\n" +
    "**Try saying:** \"That makes sense, a lot of builders felt the same. Can I ask what's driving that? " +
    "...Here's what Lakeline saw in their first 60 days.\"\n\n" +
    "(Mock answer. The real Coach will answer from the Sales Coach knowledge base.)"
  );
}

function demoSession(id: string, scenarioId: string, trainee: string, date: string, lines: string[], goal: boolean): Session {
  const scenario = SCENARIOS.find((x) => x.id === scenarioId)!;
  const transcript: Msg[] = [{ role: "buyer", content: scenario.opener }];
  for (const line of lines) {
    transcript.push({ role: "trainee", content: line });
    transcript.push({ role: "buyer", content: mockBuyerReply(scenario, transcript).reply });
  }
  return { id, scenarioId, trainee, date, transcript, scorecard: mockScorecard(scenario, transcript, goal) };
}

/** mock: replace with GET /api/admin/sales-coach/sessions */
export const MOCK_HISTORY: Session[] = [
  demoSession("h1", "busy-owner", "You", "2026-10-21T15:10:00Z", [
    "Hi Dave, thanks for the form last night. I'll keep this to two minutes, promise.",
    "What happens to leads that come in after you've gone home?",
    "Who else would use something like this day to day?",
    "Could we do a quick demo Thursday at 4 with you and Karen?",
  ], true),
  demoSession("h2", "have-salesforce", "You", "2026-10-20T10:30:00Z", [
    "Hi Mark.",
    "We actually sit on top of Salesforce and sync everything back.",
    "It's really easy to set up.",
  ], false),
  demoSession("h3", "how-ai-works", "You", "2026-10-18T13:45:00Z", [
    "Great question Gary, and you're right to be careful.",
    "What worries you most about it making things up?",
    "It only answers from your own documents, and you can see every reply.",
    "Would you like to try texting it yourself on a call next week?",
  ], true),
];

/** mock: replace with GET /api/admin/sales-coach/team */
export const MOCK_TEAM = [
  { name: "Jordan Pike", sessions: 9, avg: 78, last: "2026-10-21", weakest: "Closing / next step" },
  { name: "Samira Haddad", sessions: 14, avg: 84, last: "2026-10-22", weakest: "Objection handling" },
  { name: "Chris Benton", sessions: 3, avg: 52, last: "2026-10-14", weakest: "Discovery" },
  { name: "Ella Novak", sessions: 0, avg: null as number | null, last: null as string | null, weakest: "—" },
];
