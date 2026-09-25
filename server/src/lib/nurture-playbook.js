// The built-in 180-day lead nurture: one per company, enrolled automatically for
// every new lead. Timing and order are fixed; builders can edit the wording and
// switch touches off. `at` is minutes from enrollment.
//
// Default copy uses only merge fields every lead has and makes no factual claims
// (prices, incentives, rates) — those come from the builder's knowledge base via
// the AI rewrite. Replies are handed to the AI sales agent, so SMS never asks for
// a numbered menu answer it would have no context for.

const DAY = 24 * 60;

export const PLAYBOOK_NAME = "180-Day Lead Nurture";

export const PHASES = [
  { id: 1, name: "Speed-to-lead", range: "First 24 hours", goal: "Respond instantly, qualify, and book the appointment." },
  { id: 2, name: "First-week conversion", range: "Days 1–7", goal: "Reduce uncertainty and move the lead to an appointment." },
  { id: 3, name: "30-day nurture", range: "Days 8–30", goal: "Keep engagement up and create new reasons to act." },
  { id: 4, name: "Appointment nurture", range: "Days 31–90", goal: "Keep the lead alive and re-trigger urgency every two weeks." },
  { id: 5, name: "Aged-lead reactivation", range: "Days 91–180", goal: "Reactivate older leads and uncover hidden demand." },
];

const touch = (key, phase, at, type, theme, goal, subject, body) => ({ key, phase, at, type, theme, goal, subject, body });

export const TOUCHES = [
  // Phase 1 — speed-to-lead
  touch("welcome-sms", 1, 0, "SMS", "Instant response", "Personal response and appointment invite",
    null,
    "Hi {{firstName}}, this is {{companyName}}'s sales assistant. Thanks for your interest in our homes! Would you like to set up a quick model-home visit, or have a question I can answer? Just reply here."),
  touch("welcome-email", 1, 2, "EMAIL", "Instant email", "Welcome and appointment invite",
    "Your new home information from {{companyName}}",
    "Hi {{firstName}},\n\nThanks for your interest in {{companyName}}. A new home offers things an older resale home often can't: modern layouts, energy-efficient systems, builder warranty coverage, lower maintenance, and current design finishes, in a home that fits the way you live from day one.\n\nThe easiest next step is a short model-home visit or a quick call with one of our sales consultants. Pick a time that suits you here: {{bookingLink}}\n\nOr just reply to this email with any questions."),
  touch("qualify-sms", 1, 4 * 60, "SMS", "Qualification", "Find out what matters most",
    null,
    "{{firstName}}, so I can point you in the right direction: what matters most right now? Location, monthly payment, a quick move-in home, floor plan, schools, or current incentives? Just reply and I'll help."),

  // Phase 2 — first week
  touch("why-new-email", 2, 1 * DAY, "EMAIL", "Why buy new?", "New construction versus resale",
    "Why so many buyers are choosing new",
    "Hi {{firstName}},\n\nBuying new gives you a cleaner start: modern floor plans, energy efficiency, updated finishes, fewer immediate repairs, and warranty coverage, in a home designed for the way families live today.\n\nWant to see what's available this week? Book a visit: {{bookingLink}}"),
  touch("why-new-sms", 2, 1 * DAY + 4 * 60, "SMS", "Why buy new?", "Short tour invite",
    null,
    "A new home can mean fewer repairs, modern design, and warranty protection. Want to tour one of our {{companyName}} homes this week, {{firstName}}? Reply and I'll find a time."),
  touch("builder-email", 2, 2 * DAY, "EMAIL", "Why {{companyName}}?", "Builder differentiation",
    "What makes {{companyName}} different",
    "Hi {{firstName}},\n\nChoosing a builder matters as much as choosing a home. At {{companyName}} we focus on quality construction, thoughtful community planning, and a clear, supported buying process, with warranty service that continues after you move in.\n\nOur sales consultants can walk you through available homes and what sets them apart: {{bookingLink}}"),
  touch("area-email", 2, 3 * DAY, "EMAIL", "Area spotlight", "Why this area?",
    "Why families choose our communities",
    "Hi {{firstName}},\n\nThe right home is also about the right area: commute, schools, parks, shopping, and how the neighborhood is growing.\n\nA community tour is the best way to get a feel for it. Choose a time that works for you: {{bookingLink}}"),
  touch("payment-email", 2, 4 * DAY, "EMAIL", "Payment clarity", "Affordability education",
    "What will your monthly payment look like?",
    "Hi {{firstName}},\n\nMany buyers pause because they're not sure what they can afford. The best next step isn't guessing online. It's a short conversation about your price range, payment comfort, current incentives, and financing options.\n\nBook a quick payment conversation with our team: {{bookingLink}}"),
  touch("featured-email", 2, 5 * DAY, "EMAIL", "Featured home", "Product spotlight",
    "A home you might love",
    "Hi {{firstName}},\n\nWe have homes and floor plans available now across our communities, with layouts for every stage of life, from flexible office space to room for guests and growing families.\n\nReply to tell us what you're looking for and we'll send options that fit, or tour a home in person: {{bookingLink}}"),
  touch("social-email", 2, 6 * DAY, "EMAIL", "Social proof", "Why buyers like living here",
    "Why our homeowners love where they live",
    "Hi {{firstName}},\n\nThe best part of a new community is the people who make it home: neighbors, shared spaces, and a place that feels settled from day one.\n\nVisit the model and see why buyers choose {{companyName}}: {{bookingLink}}"),
  touch("push-sms", 2, 7 * DAY, "SMS", "Appointment push", "Should we hold a time for you?",
    null,
    "{{firstName}}, would a quick visit this week help? A consultant can show you available homes, current incentives, and payment options in about 20–30 minutes. Reply YES and I'll help schedule it."),

  // Phase 3 — days 8–30
  touch("motivation-sms", 3, 8 * DAY, "SMS", "Motivation check", "Identify what matters most",
    null,
    "Hi {{firstName}}, just checking in from {{companyName}}. What's the biggest thing driving your move: more space, a better location, timing, or something else? Happy to help you compare options."),
  touch("incentive-email", 3, 10 * DAY, "EMAIL", "Incentive update", "Create urgency",
    "Current offers at {{companyName}}",
    "Hi {{firstName}},\n\nBuilder incentives change throughout the year and can make a real difference to your closing costs or monthly payment.\n\nAsk our team what's available right now, or book a time to review current offers: {{bookingLink}}"),
  touch("amenities-email", 3, 12 * DAY, "EMAIL", "Community amenities", "Sell the lifestyle",
    "Life in our communities",
    "Hi {{firstName}},\n\nParks, trails, gathering spaces, and neighbors who become friends: community is a big part of what makes a house feel like home.\n\nSchedule a community tour: {{bookingLink}}"),
  touch("quick-movein-email", 3, 14 * DAY, "EMAIL", "Quick move-in homes", "Capture urgent buyers",
    "Homes ready sooner than you think",
    "Hi {{firstName}},\n\nIf timing matters, ask us about quick move-in homes. They're already under construction or complete, so you can move sooner with fewer decisions to make.\n\nSee which homes are ready soon: {{bookingLink}}"),
  touch("family-email", 3, 17 * DAY, "EMAIL", "Family & stability", "Emotional connection",
    "More than a house",
    "Hi {{firstName}},\n\nHomeownership is more than a transaction. It creates stability, routine, and belonging: a place where children grow, holidays happen, friendships form, and long-term plans take shape.\n\nFind the home that fits your next chapter: {{bookingLink}}"),
  touch("design-email", 3, 20 * DAY, "EMAIL", "Design & features", "Product desire",
    "Features made for the way you live",
    "Hi {{firstName}},\n\nOpen kitchens for easier entertaining, flex rooms that work as an office or playroom, owner's suites designed as a retreat, and energy-efficient systems for everyday comfort.\n\nExplore our floor plans in person: {{bookingLink}}"),
  touch("financing-email", 3, 23 * DAY, "EMAIL", "Payment comfort", "Reduce financing fears",
    "Let's make the numbers clear",
    "Hi {{firstName}},\n\nFinancing questions are the most common reason buyers wait. A short conversation can show you real numbers for your situation, with no pressure and no obligation.\n\nTalk payment options with our team: {{bookingLink}}"),
  touch("event-email", 3, 26 * DAY, "EMAIL", "Event invitation", "Create a reason to visit",
    "You're invited to visit {{companyName}}",
    "Hi {{firstName}},\n\nWe'd love to show you around. Our models are open for visits and our consultants are happy to answer questions about homes, timing, and the buying process.\n\nReply to ask about upcoming events, or book your visit: {{bookingLink}}"),
  touch("still-looking-sms", 3, 30 * DAY, "SMS", "Still looking?", "Segment hot / warm / cold",
    null,
    "Hi {{firstName}}, are you still looking for a new home? Reply YES and I'll share current options, or tell me what's changed and I'll adjust what I send you."),

  // Phase 4 — days 31–90, every ~2 weeks
  touch("new-homesites-email", 4, 38 * DAY, "EMAIL", "New homes & homesites", "Re-trigger interest",
    "New homes available at {{companyName}}",
    "Hi {{firstName}},\n\nNew homes and homesites open up regularly, which can mean new locations, floor plans, and timing options.\n\nIf you've been waiting for the right fit, this is a good time to reconnect: {{bookingLink}}"),
  touch("objection-sms", 4, 45 * DAY, "SMS", "Objection handling", "Address rates and timing",
    null,
    "Rates, timing, and available homes change quickly. If you're still considering a move, {{firstName}}, a quick conversation can show you your real options. Want to chat with a sales consultant?"),
  touch("feature-email", 4, 52 * DAY, "EMAIL", "Home feature spotlight", "Product desire",
    "The details that make a difference",
    "Hi {{firstName}},\n\nFrom the kitchen to the owner's suite, outdoor living to smart-home features, the details of a new home are designed around modern life.\n\nSee them in person: {{bookingLink}}"),
  touch("neighborhood-email", 4, 60 * DAY, "EMAIL", "Neighborhood spotlight", "Why this area?",
    "Get to know the neighborhood",
    "Hi {{firstName}},\n\nSchools, parks, commute routes, shopping, and local employers: the neighborhood shapes everyday life as much as the home does.\n\nReply with the area you're considering and we'll tell you more, or book a tour: {{bookingLink}}"),
  touch("incentive2-email", 4, 67 * DAY, "EMAIL", "Builder incentive", "Create urgency",
    "Have you seen our latest offers?",
    "Hi {{firstName}},\n\nOffers such as closing-cost help or design credits come and go. Ask our team what's available right now; it might change the math for you.\n\nBook a time to review your options: {{bookingLink}}"),
  touch("education-email", 4, 75 * DAY, "EMAIL", "Buyer education", "Build confidence",
    "Your new home buying roadmap",
    "Hi {{firstName}},\n\nBuying new has a few more steps than buying resale: choosing a homesite, selections, construction milestones, and the final walkthrough. Knowing the path makes it simple.\n\nOur consultants can walk you through the timeline: {{bookingLink}}"),
  touch("realtor-email", 4, 82 * DAY, "EMAIL", "Working with an agent?", "Realtor-friendly",
    "Already working with a real estate agent?",
    "Hi {{firstName}},\n\nIf you're working with a real estate agent, we're happy to coordinate. Bring them along to your visit and we'll make it easy for both of you.\n\nSchedule a visit: {{bookingLink}}"),
  touch("still-thinking-sms", 4, 90 * DAY, "SMS", "Still thinking?", "Personal check-in",
    null,
    "Hi {{firstName}}, it's {{companyName}}. Still thinking about a new home? Reply with anything that's holding you back and I'll help, or say CALL and a consultant will reach out."),

  // Phase 5 — days 91–180, monthly
  touch("reactivate-sms", 5, 105 * DAY, "SMS", "Are you still looking?", "Reactivate the lead",
    null,
    "Hi {{firstName}}, checking in from {{companyName}}. We have new availability and updated offers. Are you still considering a move? Reply YES to see options."),
  touch("inventory-email", 5, 120 * DAY, "EMAIL", "New inventory", "Homes now available",
    "New homes have been added",
    "Hi {{firstName}},\n\nOur available homes have changed since you last looked. There may be something that fits better now.\n\nReply and tell us what you're looking for, or take a look in person: {{bookingLink}}"),
  touch("rate-refresh-email", 5, 135 * DAY, "EMAIL", "Payment refresh", "Your options may have changed",
    "Your options may have changed",
    "Hi {{firstName}},\n\nPrices, incentives, and financing options shift over time, and what was out of reach a few months ago may work now.\n\nGet an updated picture with a quick conversation: {{bookingLink}}"),
  touch("growth-email", 5, 150 * DAY, "EMAIL", "Community growth", "What's new nearby",
    "What's new in our communities",
    "Hi {{firstName}},\n\nOur communities keep growing, with new homes, amenities, and neighbors settling in.\n\nCome see what's changed: {{bookingLink}}"),
  touch("event2-email", 5, 165 * DAY, "EMAIL", "Incentive event", "Create a reason to visit",
    "A great time to visit {{companyName}}",
    "Hi {{firstName}},\n\nOpen houses, buyer seminars, and limited-time offers run throughout the year. Ask us what's coming up, or book a private visit: {{bookingLink}}"),
  touch("preference-email", 5, 180 * DAY, "EMAIL", "Final preference update", "Stay, update, book, or opt out",
    "Should we keep in touch?",
    "Hi {{firstName}},\n\nWe've enjoyed staying in touch. Let us know what works best for you: reply with an updated area, budget, or timeline and we'll tailor what we send; book a visit if you're ready ({{bookingLink}}); or unsubscribe below if you're no longer looking.\n\nThank you for considering {{companyName}}."),
];

// Campaign steps for the playbook: a DELAY before each touch that isn't due
// straight away, then the touch itself.
export function playbookSteps() {
  const steps = [];
  let prev = 0;
  for (const t of TOUCHES) {
    const gap = t.at - prev;
    if (gap > 0) {
      const days = gap % DAY === 0;
      steps.push({ type: "DELAY", delayValue: days ? gap / DAY : gap, delayUnit: days ? "DAYS" : "MINUTES" });
    }
    steps.push({ type: t.type, subject: t.subject, body: t.body, playbookKey: t.key });
    prev = t.at;
  }
  return steps.map((s, i) => ({ ...s, position: i + 1 }));
}

export const touchByKey = Object.fromEntries(TOUCHES.map((t) => [t.key, t]));
