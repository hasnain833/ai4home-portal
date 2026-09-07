const TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 500;

const sessions = new Map();

function sweep(now = Date.now()) {
  for (const [id, entry] of sessions) {
    if (now - entry.touchedAt > TTL_MS) sessions.delete(id);
  }
}

export function newDemoConversation() {
  const id = `demo_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return {
    id,
    companyId: null,
    homeownerId: null,
    propertyId: null,
    status: "ACTIVE",
    phase: "INTAKE",
    issueState: {},
    ticketId: null,
    transcript: [],
    turnCount: 0,
    demo: true,
  };
}

export function getDemoConversation(id) {
  if (!id) return null;
  const entry = sessions.get(id);
  if (!entry) return null;
  if (Date.now() - entry.touchedAt > TTL_MS) {
    sessions.delete(id);
    return null;
  }
  entry.touchedAt = Date.now();
  return entry.convo;
}

export function saveDemoConversation(convo) {
  const now = Date.now();
  if (sessions.size >= MAX_SESSIONS) sweep(now);
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  sessions.set(convo.id, { convo, touchedAt: now });
  return convo;
}

export function clearDemoConversation(id) {
  return sessions.delete(id);
}

export function isDemoConversationId(id) {
  return typeof id === "string" && id.startsWith("demo_");
}
