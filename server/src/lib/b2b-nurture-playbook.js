// The builder version of the Sales 180-day nurture (nurture-playbook.js): same phases, timing,
// channels and keys, rewritten to sell AI4Home to homebuilders. No figures or customer claims:
// the product guide forbids inventing results.
const DAY = 24 * 60;

export const B2B_PLAYBOOK_NAME = "180-Day Builder Nurture";

export const B2B_PHASES = [
  { id: 1, name: "Speed-to-lead", range: "First 24 hours", goal: "Respond instantly, qualify, and book a consultation." },
  { id: 2, name: "First-week conversion", range: "Days 1–7", goal: "Show what AI4Home does and move the builder to a consultation." },
  { id: 3, name: "30-day nurture", range: "Days 8–30", goal: "Keep engagement up and give new reasons to talk." },
  { id: 4, name: "Consultation nurture", range: "Days 31–90", goal: "Keep the lead alive and re-trigger interest every two weeks." },
  { id: 5, name: "Aged-lead reactivation", range: "Days 91–180", goal: "Reactivate older leads and uncover new needs." },
];

const touch = (key, phase, at, type, theme, goal, subject, body) => ({ key, phase, at, type, theme, goal, subject, body });

const TOUCHES = [
  // Phase 1 — speed-to-lead
  touch("welcome-sms", 1, 0, "SMS", "Instant response", "Personal response and consultation invite",
    null,
    "Hi {{firstName}}, thanks for your interest in AI for Homebuilders! Would a quick call to see how AI could help {{companyName}} with sales follow-up and warranty service be useful? Just reply here."),
  touch("welcome-email", 1, 2, "EMAIL", "Instant email", "Welcome and consultation invite",
    "How AI for Homebuilders can help {{companyName}}",
    "Hi {{firstName}},\n\nThanks for your interest in AI for Homebuilders. We help homebuilders answer buyers and homeowners faster: an AI Sales Agent that responds to new leads and helps book visits, and an AI Warranty Agent that answers routine homeowner questions and collects service requests for your team.\n\nThe easiest next step is a short consultation, where we look at how your team works today. Pick a time that suits you: {{bookingLink}}\n\nOr just reply to this email with any questions."),
  touch("qualify-sms", 1, 4 * 60, "SMS", "Qualification", "Find out what matters most",
    null,
    "{{firstName}}, so we can point you in the right direction: what matters most for {{companyName}} right now? Faster lead follow-up, fewer warranty calls, better buyer nurture, or something else? Just reply."),

  // Phase 2 — first week
  touch("why-ai-email", 2, 1 * DAY, "EMAIL", "Why AI now?", "AI versus manual follow-up",
    "Why builders are adding AI to sales and warranty",
    "Hi {{firstName}},\n\nBuyers expect an answer when they ask, not the next business day. Homeowners expect the same when something needs fixing. AI agents give {{companyName}} a consistent first response at any hour, using your own knowledge and policies, while your team keeps control of every hand-off.\n\nWant to see how it would fit your process? Book a consultation: {{bookingLink}}"),
  touch("why-ai-sms", 2, 1 * DAY + 4 * 60, "SMS", "Why AI now?", "Short consultation invite",
    null,
    "An AI agent can answer buyer and homeowner questions around the clock and hand the rest to your team. Want a quick walkthrough for {{companyName}} this week, {{firstName}}? Reply and we'll find a time."),
  touch("platform-email", 2, 2 * DAY, "EMAIL", "Why AI4Home?", "Platform differentiation",
    "Built for homebuilders, not generic chat",
    "Hi {{firstName}},\n\nAI4Home is made for homebuilders. Sales Hub manages leads, campaigns, appointments and your home inventory. Warranty Care handles homeowner requests, tickets, trades and service visits. The AI agents work inside both, using the knowledge you approve.\n\nWe'd be glad to show you around: {{bookingLink}}"),
  touch("sales-agent-email", 2, 3 * DAY, "EMAIL", "Sales Agent spotlight", "Never miss a buyer inquiry",
    "Every buyer inquiry answered, even after hours",
    "Hi {{firstName}},\n\nMany buyer inquiries arrive in the evening or at weekends. The AI Sales Agent answers questions from your knowledge base, shows the homes you've set up, helps qualify the buyer, and helps arrange a visit using your scheduling settings.\n\nSee it working with an example like yours: {{bookingLink}}"),
  touch("warranty-email", 2, 4 * DAY, "EMAIL", "Warranty clarity", "Reduce warranty workload",
    "Fewer routine warranty calls for your team",
    "Hi {{firstName}},\n\nRoutine warranty questions take up a lot of a service team's day. The AI Warranty Agent answers them from your own policy, collects the issue details and photos, and passes real problems to your staff for review, so your team spends its time on the work itself.\n\nTalk it through with us: {{bookingLink}}"),
  touch("nurture-email", 2, 5 * DAY, "EMAIL", "Lead nurture", "Product spotlight",
    "Keep every lead warm without extra work",
    "Hi {{firstName}},\n\nMost buyers aren't ready on day one. AI4Home includes a built-in nurture workflow, email and SMS campaigns with AI-assisted copy, and announcements, so leads keep hearing from {{companyName}} until they're ready to visit.\n\nReply to tell us how you follow up today, or book a walkthrough: {{bookingLink}}"),
  touch("control-email", 2, 6 * DAY, "EMAIL", "You stay in control", "Trust and oversight",
    "AI that works the way your team does",
    "Hi {{firstName}},\n\nYou decide what the AI knows and when a person takes over. Staff can review drafts, pause the agent for any lead, and see every conversation, while consent, opt-outs and quiet hours are respected for outreach.\n\nSee the controls for yourself: {{bookingLink}}"),
  touch("push-sms", 2, 7 * DAY, "SMS", "Consultation push", "Should we hold a time for you?",
    null,
    "{{firstName}}, would a quick consultation this week help? We can show how AI4Home would work for {{companyName}} in about 20–30 minutes. Reply YES and we'll set it up."),

  // Phase 3 — days 8–30
  touch("priority-sms", 3, 8 * DAY, "SMS", "Priority check", "Identify what matters most",
    null,
    "Hi {{firstName}}, just checking in. What's the biggest challenge for {{companyName}} right now: lead response time, warranty volume, staffing, or something else? Happy to share how other builders approach it."),
  touch("speed-email", 3, 10 * DAY, "EMAIL", "Speed to lead", "Create urgency",
    "The first builder to answer often gets the visit",
    "Hi {{firstName}},\n\nWhen a buyer contacts several builders, a fast, helpful answer makes a strong first impression. An AI agent means every new lead hears from {{companyName}} straight away, with a clear next step.\n\nLet's look at your current response process together: {{bookingLink}}"),
  touch("homeowner-email", 3, 12 * DAY, "EMAIL", "Homeowner experience", "Sell the outcome",
    "A better experience for your homeowners",
    "Hi {{firstName}},\n\nAfter closing, homeowners remember how quickly their questions were answered. With Warranty Care they can report issues with photos at any time, get answers to routine questions, and see their requests move to resolution.\n\nSee the homeowner side of AI4Home: {{bookingLink}}"),
  touch("integrations-email", 3, 14 * DAY, "EMAIL", "Fits your tools", "Remove setup worries",
    "Works alongside the tools you already use",
    "Hi {{firstName}},\n\nAI4Home supports Salesforce lead sync, CSV imports, an embeddable website form and calendar connections, so it fits into how {{companyName}} already works. Other integrations depend on your setup, and our team can confirm what fits yours.\n\nAsk us about your stack: {{bookingLink}}"),
  touch("team-email", 3, 17 * DAY, "EMAIL", "Your team", "Emotional connection",
    "Give your team time back",
    "Hi {{firstName}},\n\nYour sales and service staff are your most valuable people. Taking repetitive questions and follow-ups off their plate lets them focus on buyers who are ready and homeowners who need a visit.\n\nFind out where AI could help your team most: {{bookingLink}}"),
  touch("insights-email", 3, 20 * DAY, "EMAIL", "Dashboards & reports", "Product desire",
    "See what's working across sales and warranty",
    "Hi {{firstName}},\n\nDashboards show your leads, campaigns, appointments and service performance in one place, with exports where you need them, so you can see what's moving and what needs attention.\n\nTake a guided look: {{bookingLink}}"),
  touch("getting-started-email", 3, 23 * DAY, "EMAIL", "Getting started", "Reduce setup fears",
    "What getting started actually involves",
    "Hi {{firstName}},\n\nThe most common question we hear is how much work it takes to get started. A short conversation can show you the steps for {{companyName}}: your knowledge, your communities and homes, and who on your team does what. No pressure and no obligation.\n\nTalk it through with us: {{bookingLink}}"),
  touch("demo-email", 3, 26 * DAY, "EMAIL", "Live demo invitation", "Create a reason to meet",
    "You're invited to a live walkthrough",
    "Hi {{firstName}},\n\nWe'd love to show you AI4Home live: the Sales Agent answering a buyer, a warranty request coming in, and the team view behind both. Bring your questions and anyone on your team who should see it.\n\nBook your walkthrough: {{bookingLink}}"),
  touch("still-looking-sms", 3, 30 * DAY, "SMS", "Still interested?", "Segment hot / warm / cold",
    null,
    "Hi {{firstName}}, is improving lead follow-up or warranty service still on the list at {{companyName}}? Reply YES and we'll share options, or tell us what's changed and we'll adjust what we send."),

  // Phase 4 — days 31–90, every ~2 weeks
  touch("whats-new-email", 4, 38 * DAY, "EMAIL", "What's new", "Re-trigger interest",
    "What's new at AI for Homebuilders",
    "Hi {{firstName}},\n\nWe keep adding to AI4Home across sales, marketing and warranty. If you looked at AI tools a while ago, a lot may have changed.\n\nIf the timing is better now, let's reconnect: {{bookingLink}}"),
  touch("objection-sms", 4, 45 * DAY, "SMS", "Objection handling", "Address timing and budget",
    null,
    "Timing, budget and staffing all change quickly. If AI is still on your mind, {{firstName}}, a short call can show what would make sense for {{companyName}}. Want to chat?"),
  touch("feature-email", 4, 52 * DAY, "EMAIL", "Feature spotlight", "Product desire",
    "The details that make a difference",
    "Hi {{firstName}},\n\nFrom home inventory with photos to appointment scheduling, AI conversation summaries to trade portals, the details are designed around how homebuilders actually work.\n\nSee them in person: {{bookingLink}}"),
  touch("market-email", 4, 60 * DAY, "EMAIL", "Market conditions", "Why now?",
    "Doing more with the team you have",
    "Hi {{firstName}},\n\nWhen the market shifts, every lead and every homeowner relationship counts more. AI agents help a team cover more conversations without adding headcount.\n\nReply to tell us what you're seeing in your market, or book a time: {{bookingLink}}"),
  touch("consult-email", 4, 67 * DAY, "EMAIL", "Free consultation", "Create urgency",
    "A no-obligation look at your process",
    "Hi {{firstName}},\n\nOur consultations are a practical review of how {{companyName}} handles leads and warranty today, and where AI could help. You'll leave with ideas either way.\n\nBook a time to review your options: {{bookingLink}}"),
  touch("education-email", 4, 75 * DAY, "EMAIL", "Rollout roadmap", "Build confidence",
    "Your AI rollout roadmap",
    "Hi {{firstName}},\n\nAdding AI works best in steps: start with your knowledge and one agent, review its answers, then widen what it handles. Knowing the path makes it simple.\n\nOur team can walk you through the timeline: {{bookingLink}}"),
  touch("team-invite-email", 4, 82 * DAY, "EMAIL", "Bring your team", "Involve decision makers",
    "Should others at {{companyName}} see this too?",
    "Hi {{firstName}},\n\nDecisions like this usually involve sales, warranty and operations. Bring whoever should be involved to a walkthrough and we'll cover what matters to each of them.\n\nSchedule a session: {{bookingLink}}"),
  touch("still-thinking-sms", 4, 90 * DAY, "SMS", "Still thinking?", "Personal check-in",
    null,
    "Hi {{firstName}}, still thinking about AI for {{companyName}}? Reply with anything that's holding you back and we'll help, or say CALL and someone from our team will reach out."),

  // Phase 5 — days 91–180, monthly
  touch("reactivate-sms", 5, 105 * DAY, "SMS", "Are you still interested?", "Reactivate the lead",
    null,
    "Hi {{firstName}}, checking in from AI for Homebuilders. We've added new features since we last spoke. Is AI for sales or warranty still on your radar? Reply YES to hear more."),
  touch("updates-email", 5, 120 * DAY, "EMAIL", "Product updates", "Features now available",
    "New in AI for Homebuilders",
    "Hi {{firstName}},\n\nAI4Home has changed since you last looked. There may be something that fits {{companyName}} better now.\n\nReply and tell us what you need, or take a look with us: {{bookingLink}}"),
  touch("priorities-email", 5, 135 * DAY, "EMAIL", "Priorities refresh", "Your needs may have changed",
    "Your priorities may have changed",
    "Hi {{firstName}},\n\nTeams, budgets and goals shift over time, and what didn't fit a few months ago may fit now.\n\nGet an updated picture with a quick conversation: {{bookingLink}}"),
  touch("industry-email", 5, 150 * DAY, "EMAIL", "Industry trends", "What's changing",
    "How homebuilders are using AI",
    "Hi {{firstName}},\n\nMore builders are using AI to answer buyers, follow up with leads, and support homeowners after closing. We'd be glad to share what we're seeing and what it could mean for {{companyName}}.\n\nCome talk it through: {{bookingLink}}"),
  touch("event2-email", 5, 165 * DAY, "EMAIL", "Walkthrough invitation", "Create a reason to meet",
    "A good time to see AI4Home",
    "Hi {{firstName}},\n\nWe run walkthroughs and Q&A sessions throughout the year. Ask us what's coming up, or book a private session: {{bookingLink}}"),
  touch("preference-email", 5, 180 * DAY, "EMAIL", "Final preference update", "Stay, update, book, or opt out",
    "Should we keep in touch?",
    "Hi {{firstName}},\n\nWe've enjoyed staying in touch. Let us know what works best for you: reply with your current priorities or timeline and we'll tailor what we send; book a consultation if you're ready ({{bookingLink}}); or unsubscribe below if it's not for {{companyName}}.\n\nThank you for considering AI for Homebuilders."),
];

/** Campaign steps for the B2B engine: each step waits the gap since the previous touch. */
export function b2bPlaybookSteps() {
  let prev = 0;
  return TOUCHES.map((t) => {
    const step = { id: t.key, channel: t.type, delayDays: (t.at - prev) / DAY, subject: t.subject || "", body: t.body, enabled: true };
    prev = t.at;
    return step;
  });
}

export const b2bTouchByKey = Object.fromEntries(TOUCHES.map((t) => [t.key, t]));
