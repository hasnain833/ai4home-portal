/**
 * Demo mode fixtures.
 *
 * The Botpress bot had a whole parallel demo flow so sales could show the
 * homeowner journey without touching a real tenant. This is the same idea with
 * far less surface: the live orchestrator runs unchanged, but property lookups
 * resolve against these fixtures, retrieval is restricted to the shared PLATFORM
 * knowledge base, and no ticket is ever written.
 *
 * Coverage dates are relative so the demo never goes stale — one home is inside
 * its term and one has lapsed, which is what makes the coverage step worth
 * showing.
 */

function monthsFromNow(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const DEMO_HOMEOWNER_EMAIL = "sample.homeowner@example.com";

export const DEMO_PROPERTIES = [
  {
    id: "demo-property-1",
    address: "412 Kestrel Lane",
    homeownerId: "demo-homeowner",
    homeownerEmail: DEMO_HOMEOWNER_EMAIL,
    communityId: null,
    coeDate: monthsFromNow(-14),
    coverageTerm: monthsFromNow(10),
  },
  {
    id: "demo-property-2",
    address: "88 Cottonwood Court",
    homeownerId: "demo-homeowner",
    homeownerEmail: DEMO_HOMEOWNER_EMAIL,
    communityId: null,
    coeDate: monthsFromNow(-38),
    coverageTerm: monthsFromNow(-2),
  },
];

export function demoGreeting() {
  return (
    "You're in demo mode, so nothing here touches real homeowner records and no ticket will actually be filed. " +
    `Try identifying yourself as ${DEMO_HOMEOWNER_EMAIL} to see the full journey.`
  );
}

export function demoTicketConfirmation(classification, isEmergency) {
  const head = isEmergency
    ? "In a live workspace this would have been logged as an emergency and escalated immediately."
    : "In a live workspace this would now be a ticket with the warranty team.";

  return (
    `${head}\n\n` +
    `Classified as: ${classification.issueType} · ${classification.priority} priority` +
    (classification.symptom ? `\nSymptom: ${classification.symptom}` : "") +
    (classification.location ? `\nLocation: ${classification.location}` : "") +
    "\n\n(Demo mode — no ticket was created.)"
  );
}
